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
 * browser can't call it directly. Use startImageJob() for the full
 * queue-poll-update lifecycle.
 */

import type { ImageJob, ImageGenerationSettings, AspectRatio } from "@/lib/types";

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
}

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
  private baseUrl: string;
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

  /** Poll /history until the prompt completes; returns direct image URLs. */
  async waitForImages(promptId: string, timeoutMs = GENERATION_TIMEOUT_MS): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(this.proxied(`history/${promptId}`), { cache: "no-store" });
      if (res.ok) {
        const history = await res.json() as Record<string, {
          status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
          outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
        }>;
        const entry = history[promptId];
        if (entry) {
          if (entry.status?.status_str === "error") {
            throw new Error("ComfyUI reported an execution error — check the ComfyUI console.");
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
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ComfyUI.`);
  }

  /** URL to a generated image, proxied through the app. */
  imageUrl(filename: string, subfolder = "", type = "output"): string {
    return this.proxied("view", { filename, subfolder, type });
  }

  private collectImageUrls(
    outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>
  ): string[] {
    if (!outputs) return [];
    const urls: string[] = [];
    for (const node of Object.values(outputs)) {
      for (const img of node.images ?? []) {
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
  setPath(meta.stepsNode, settings.steps);
  setPath(meta.cfgNode, settings.cfg);
  setPath(meta.seedNode, seed);
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
        inputs.sampler_name = samplerCfg.sampler;
        if (samplerCfg.scheduler) inputs.scheduler = samplerCfg.scheduler;
        break;
      case "KSamplerSelect": // Flux-style split samplers
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

// ─── Job lifecycle ────────────────────────────────────────────────────────────

/**
 * Create an ImageJob and run the full ComfyUI pipeline for it in the
 * background. Returns the job immediately (status "queued"); progress lands
 * via onUpdate — callers pass the store's updateImageJob.
 */
export function startImageJob(
  baseUrl: string,
  settings: ImageGenerationSettings,
  chatId: string | undefined,
  onUpdate: (id: string, updates: Partial<ImageJob>) => void
): ImageJob {
  const job: ImageJob = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `job-${Math.random().toString(36).slice(2)}`,
    chatId,
    prompt: settings.prompt,
    status: "queued",
    settings,
    outputUrls: [],
    createdAt: new Date().toISOString(),
  };

  void (async () => {
    const comfyui = new ComfyUIProvider(baseUrl);
    try {
      // ComfyUI and Ollama share one GPU: evict Ollama's resident models
      // first or the UNet load thrashes for minutes. Best-effort — Ollama
      // reloads on demand after the render.
      await fetch("/api/ollama/unload", { method: "POST" }).catch(() => {});
      if (!(await comfyui.checkConnection())) {
        throw new Error(
          `ComfyUI is not reachable at ${baseUrl || DEFAULT_BASE_URL}. Start ComfyUI (or fix the URL in Settings) and try again.`
        );
      }
      const template = await comfyui.loadWorkflowTemplate(settings.workflow);
      const workflow = applySettingsToWorkflow(template, settings);
      const promptId = await comfyui.queuePrompt(workflow);
      onUpdate(job.id, { status: "generating", promptId });
      const urls = await comfyui.waitForImages(promptId);
      onUpdate(job.id, {
        status: "complete",
        outputUrls: urls,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      onUpdate(job.id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
      });
    }
  })();

  return job;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
