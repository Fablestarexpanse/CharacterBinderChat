/**
 * ComfyUI provider adapter.
 * ComfyUI runs locally and exposes a REST API (default http://127.0.0.1:8188).
 * Docs: https://github.com/comfyanonymous/ComfyUI
 *
 * Flow: load a template from /api/workflows/<name> → inject settings into the
 * node graph (via the template's _meta.fablechat mapping, plus class_type
 * inspection for anything unmapped) → POST /prompt → poll /history/<id> →
 * render /view?… image URLs. All ComfyUI traffic goes through the app's
 * /api/comfyui/* proxy — ComfyUI doesn't send CORS headers by default, so the
 * browser can't call it directly. This module is transport only; queueImage()
 * in lib/chat/imageGen.ts owns the queue-poll-update lifecycle.
 */

import { injectReferences } from "@/lib/media/imageLook";
import type { ImageGenerationSettings, AspectRatio } from "@/lib/types";

const DEFAULT_BASE_URL = "http://127.0.0.1:8188";
const POLL_INTERVAL_MS = 1500;
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;

// UI sampler names → ComfyUI sampler_name (+ scheduler override where the UI
// name bakes one in). Unknown names pass through unchanged.
const SAMPLER_MAP: Record<string, { sampler: string; scheduler?: string }> = {
  euler: { sampler: "euler" },
  euler_a: { sampler: "euler_ancestral" },
  dpmpp_2m: { sampler: "dpmpp_2m" },
  dpmpp_2m_karras: { sampler: "dpmpp_2m", scheduler: "karras" },
  ddim: { sampler: "ddim" },
  lcm: { sampler: "lcm" },
};

interface FableWorkflowMeta {
  promptNode?: string | null;
  negativePromptNode?: string | null;
  stepsNode?: string | null;
  cfgNode?: string | null;
  seedNode?: string | null;
  widthNode?: string | null;
  heightNode?: string | null;
  /** Node taking inline `<lora:name:weight>` syntax (LoRA Manager pipelines) */
  loraSyntaxNode?: string | null;
  /** Keep the workflow's own steps, CFG and sampler (see WorkflowMapping.ownSampling) */
  ownSampling?: boolean;
  /** A video workflow's frame count */
  videoLengthNode?: string | null;
}

type OutputFile = { filename: string; subfolder: string; type: string };
/** SaveImage reports `images`; SaveVideo reports its clip under `images` (with `animated`) or `videos`; VHS under `gifs`. */
type NodeOutput = { images?: OutputFile[]; videos?: OutputFile[]; gifs?: OutputFile[] };

// ─── Aspect ratio ─────────────────────────────────────────────────────────────
// Picking a ratio used to store a label that nothing read, so "16:9" still
// rendered a square. Ratios now resolve to real dimensions at a fixed
// megapixel target, snapped to 32px like the Krea2 preset table.

const RATIO_SIDES: Record<Exclude<AspectRatio, "custom">, [number, number]> = {
  "1:1":  [1, 1],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "4:3":  [4, 3],
  "3:4":  [3, 4],
  "2:1":  [2, 1],
};

/** Width/height for an aspect ratio at a given megapixel budget. */
export function dimensionsForRatio(
  ratio: AspectRatio,
  megapixels = 1.5
): { width: number; height: number } | null {
  if (ratio === "custom") return null;
  const [w, h] = RATIO_SIDES[ratio];
  const scale = Math.sqrt((megapixels * 1_000_000) / (w * h));
  const snap = (v: number) => Math.max(256, Math.round((v * scale) / 32) * 32);
  return { width: snap(w), height: snap(h) };
}

type WorkflowNode = { inputs?: Record<string, unknown>; class_type?: string };
type Workflow = Record<string, unknown>;

export class ComfyUIProvider {
  readonly baseUrl: string;
  private clientId = "";

  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  /** Proxy URL for a ComfyUI endpoint (same-origin, so no CORS). */
  private proxied(path: string, params?: Record<string, string>): string {
    const search = new URLSearchParams({ ...params, base: this.baseUrl });
    return `/api/comfyui/${path}?${search}`;
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(this.proxied("system_stats"), {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * LoRA filenames installed on the ComfyUI host. Read from core LoraLoader's
   * enum, which lists models/loras regardless of which LoRA nodes a workflow
   * actually uses. Returns [] when ComfyUI is unreachable — the picker falls
   * back to free-text entry rather than showing invented names.
   */
  async listLoras(): Promise<string[]> {
    try {
      const res = await fetch(this.proxied("object_info/LoraLoader"), {
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!res.ok) return [];
      const data = await res.json() as {
        LoraLoader?: { input?: { required?: { lora_name?: unknown[] } } };
      };
      const enumValues = data.LoraLoader?.input?.required?.lora_name?.[0];
      return Array.isArray(enumValues) ? enumValues.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  /** Load a workflow template by slug via the app's API route. */
  async loadWorkflowTemplate(name: string): Promise<Workflow> {
    const res = await fetch(`/api/workflows/${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? `Failed to load workflow "${name}" (${res.status})`);
    }
    return res.json();
  }

  /**
   * Load the named template and inject `settings` into it. The injection rules
   * stay private to this module; callers get a ready-to-queue workflow.
   */
  async prepareWorkflow(settings: ImageGenerationSettings): Promise<Workflow> {
    const wf = applySettingsToWorkflow(await this.loadWorkflowTemplate(settings.workflow), settings);
    // Reference pictures go into the inputs the workflow's mapping names
    // (detected Load Image nodes); a workflow without any simply ignores them.
    const meta = (wf._meta as { fablechat?: { referenceImageNodes?: string[] } } | undefined)?.fablechat;
    await injectReferences(wf, meta?.referenceImageNodes, settings.referenceImages, (url) => this.uploadImage(url));
    return wf;
  }

  /** Copy a stored picture into ComfyUI's input folder; returns the name to put in a Load Image node. */
  async uploadImage(url: string): Promise<string> {
    const src = await fetch(url, { cache: "no-store" });
    if (!src.ok) throw new Error(`Could not read reference picture ${url} (HTTP ${src.status}).`);
    const blob = await src.blob();
    const ext = (blob.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
    const form = new FormData();
    // Named by content so the same picture is stored once in ComfyUI's input folder
    form.append("image", blob, `fablechat-${url.split("/").pop()?.slice(0, 16) ?? "ref"}.${ext}`);
    form.append("overwrite", "true");
    const res = await fetch(this.proxied("upload/image"), { method: "POST", body: form });
    const j = await res.json().catch(() => null) as { name?: string; subfolder?: string; error?: string } | null;
    if (!res.ok || !j?.name) throw new Error(`ComfyUI did not accept the reference picture: ${j?.error ?? `HTTP ${res.status}`}`);
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  }

  /**
   * Queue a workflow. The top-level _meta key (FableChat's own metadata) is
   * stripped first — ComfyUI treats every top-level key as a node.
   * @returns The ComfyUI prompt ID
   */
  async queuePrompt(workflowJson: Workflow): Promise<string> {
    const prompt: Workflow = { ...workflowJson };
    delete prompt._meta;

    const res = await fetch(this.proxied("prompt"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: this.clientIdLazy() }),
    });

    if (!res.ok) {
      // ComfyUI returns a structured node_errors body on validation failure
      const data = await res.json().catch(() => null) as
        { error?: { message?: string }; node_errors?: Record<string, unknown> } | null;
      const detail = data?.error?.message ?? `HTTP ${res.status}`;
      const missing = missingFiles(data?.node_errors);
      if (missing.length > 0) {
        throw new Error(`ComfyUI does not have ${missing.length === 1 ? "this model file" : "these model files"}: ${missing.join(", ")}. Put ${missing.length === 1 ? "it" : "them"} in ComfyUI's models folders, or pick another workflow.`);
      }
      const nodes = data?.node_errors ? ` (nodes: ${Object.keys(data.node_errors).join(", ")})` : "";
      throw new Error(`ComfyUI rejected the workflow: ${detail}${nodes}`);
    }
    // A 200 with no prompt_id would otherwise poll history/undefined until the timeout.
    const data = (await res.json().catch(() => null)) as { prompt_id?: unknown } | null;
    const promptId = data?.prompt_id;
    if (typeof promptId !== "string" || !promptId) {
      throw new Error("ComfyUI accepted the workflow but returned no prompt_id.");
    }
    return promptId;
  }

  /**
   * Poll /history until the prompt completes; returns direct output URLs
   * (images, or the clip a video workflow saved). `signal` stops the wait,
   * for Cancel; it does not stop ComfyUI (that is `cancel`).
   */
  async waitForImages(promptId: string, timeoutMs = GENERATION_TIMEOUT_MS, signal?: AbortSignal): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("Cancelled.");
      const res = await fetch(this.proxied(`history/${promptId}`), { cache: "no-store" });
      if (res.ok) {
        const history = await res.json() as Record<string, {
          status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
          outputs?: Record<string, NodeOutput>;
        }>;
        const entry = history[promptId];
        if (entry) {
          if (entry.status?.status_str === "error") {
            const interrupted = (entry.status.messages ?? []).some((m) => Array.isArray(m) && m[0] === "execution_interrupted");
            throw new Error(interrupted ? "Cancelled." : "ComfyUI reported an execution error — check the ComfyUI console.");
          }
          const urls = this.collectImageUrls(entry.outputs);
          if (entry.status?.completed || urls.length > 0) {
            if (urls.length === 0) {
              throw new Error("Workflow finished but produced no images (no SaveImage output?).");
            }
            return urls;
          }
        }
      }
      await sleep(POLL_INTERVAL_MS, signal);
    }
    throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ComfyUI.`);
  }

  /**
   * Stop a prompt: take it out of the queue if it is waiting, and interrupt it
   * if it is the one running. Best-effort; ComfyUI answers both even when the
   * prompt is already gone.
   */
  async cancel(promptId: string): Promise<void> {
    const post = (path: string, body: unknown) => fetch(this.proxied(path), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    await post("queue", { delete: [promptId] });
    // prompt_id limits the interrupt to this prompt, so someone else's render is left alone
    await post("interrupt", { prompt_id: promptId });
  }

  /** URL to a generated image, proxied through the app. */
  imageUrl(filename: string, subfolder = "", type = "output"): string {
    return this.proxied("view", { filename, subfolder, type });
  }

  private collectImageUrls(outputs?: Record<string, NodeOutput>): string[] {
    if (!outputs) return [];
    const urls: string[] = [];
    for (const node of Object.values(outputs)) {
      for (const img of [...(node.images ?? []), ...(node.videos ?? []), ...(node.gifs ?? [])]) {
        // temp-type images are previews, not final outputs
        if (img.type === "temp") continue;
        urls.push(this.imageUrl(img.filename, img.subfolder, img.type));
      }
    }
    return urls;
  }

  // crypto.randomUUID only exists in secure contexts; lazy so constructing the
  // provider during SSR/module-eval never touches it.
  private clientIdLazy(): string {
    if (!this.clientId) {
      this.clientId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `fablechat-${Math.random().toString(36).slice(2)}`;
    }
    return this.clientId;
  }
}

// ─── Settings injection ───────────────────────────────────────────────────────

/**
 * Inject generation settings into a workflow template. Uses the template's
 * _meta.fablechat node-path mapping first ("6.inputs.text" style), then a
 * class_type sweep for the knobs the mapping doesn't cover (sampler name,
 * scheduler, batch size). Returns a modified copy.
 */
function applySettingsToWorkflow(
  workflow: Workflow,
  settings: ImageGenerationSettings
): Workflow {
  const result = structuredClone(workflow);
  const meta = (result._meta as { fablechat?: FableWorkflowMeta } | undefined)?.fablechat ?? {};
  const seed = settings.seed === -1 ? Math.floor(Math.random() * 0xffffffff) : settings.seed;

  const setPath = (nodePath: string | null | undefined, value: unknown) => {
    if (!nodePath) return;
    // Paths look like "6.inputs.text" or "6.text" — node id first, input key last
    const parts = nodePath.split(".");
    const nodeId = parts[0];
    const inputKey = parts[parts.length - 1];
    const node = result[nodeId] as WorkflowNode | undefined;
    if (node?.inputs && inputKey) node.inputs[inputKey] = value;
  };

  setPath(meta.promptNode, settings.prompt);
  setPath(meta.negativePromptNode, settings.negativePrompt);
  // LoRA Manager pipelines take a free-text `<lora:name:weight>` line; without
  // a node to put it in, selected LoRAs would silently never load.
  if (meta.loraSyntaxNode) {
    setPath(
      meta.loraSyntaxNode,
      settings.loras.map((l) => `<lora:${l.name}:${l.weight}>`).join(" ")
    );
  }
  const ownSampling = meta.ownSampling === true;
  if (!ownSampling) {
    setPath(meta.stepsNode, settings.steps);
    setPath(meta.cfgNode, settings.cfg);
  }
  setPath(meta.seedNode, seed);
  if (settings.videoLength && settings.videoLength > 0) setPath(meta.videoLengthNode, Math.round(settings.videoLength));
  // A cleared dimension input stores 0 — never inject a 0-px latent
  setPath(meta.widthNode, settings.width >= 64 ? settings.width : 1024);
  setPath(meta.heightNode, settings.height >= 64 ? settings.height : 1024);

  // class_type sweep for everything the mapping can't express
  const samplerCfg = SAMPLER_MAP[settings.sampler] ?? { sampler: settings.sampler };
  for (const [key, value] of Object.entries(result)) {
    if (key === "_meta") continue;
    const node = value as WorkflowNode;
    const inputs = node.inputs;
    if (!inputs || !node.class_type) continue;
    switch (node.class_type) {
      case "KSampler":
      case "KSamplerAdvanced":
        if (ownSampling) break;
        inputs.sampler_name = samplerCfg.sampler;
        if (samplerCfg.scheduler) inputs.scheduler = samplerCfg.scheduler;
        break;
      case "KSamplerSelect": // Flux-style split samplers
        if (ownSampling) break;
        inputs.sampler_name = samplerCfg.sampler;
        break;
      case "EmptyLatentImage":
      case "EmptySD3LatentImage":
        inputs.batch_size = Math.max(1, settings.batchCount);
        break;
    }
  }

  return result;
}


/**
 * The model files a refused workflow names but ComfyUI lacks. ComfyUI reports
 * them as `value_not_in_list` with details like "unet_name: 'x.safetensors' not
 * in [...]"; node numbers alone told nobody what to download.
 */
export function missingFiles(nodeErrors: unknown): string[] {
  if (!nodeErrors || typeof nodeErrors !== "object") return [];
  const out = new Set<string>();
  for (const node of Object.values(nodeErrors as Record<string, { errors?: Array<{ type?: string; details?: string }> }>)) {
    for (const e of node?.errors ?? []) {
      if (e?.type !== "value_not_in_list" || typeof e.details !== "string") continue;
      const m = /^\s*[\w.]+:\s*'([^']+\.(?:safetensors|ckpt|pt|pth|bin|gguf|sft))'\s+not in/i.exec(e.details);
      if (m) out.add(m[1]);
    }
  }
  return [...out];
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
