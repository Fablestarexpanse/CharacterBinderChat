// ─── Reading a ComfyUI workflow ───────────────────────────────────────────────
// Given a workflow exported from ComfyUI in API format, find the inputs
// FableChat needs to fill (prompt, negative, seed, steps, CFG, size, LoRA
// line, reference images, video length) so nobody has to hand-write
// "_meta.fablechat" node paths. Pure: the Workflows screen, the server and the
// tests share it.
//
// It walks the graph rather than guessing from node names: the prompt is the
// text that feeds the sampler's *positive* input, following conditioning
// pass-through nodes (FluxGuidance, ConditioningCombine, …) and primitive/string
// nodes that hold the actual value. Every guess is also offered as a dropdown
// of alternatives, so a workflow the walk misreads is fixed with two clicks.

export type WorkflowRole =
  | "promptNode" | "negativePromptNode" | "seedNode" | "stepsNode" | "cfgNode"
  | "widthNode" | "heightNode" | "loraSyntaxNode" | "videoLengthNode";

export type WorkflowPurpose = "portrait" | "photo" | "scene" | "video";

/** What a workflow's `_meta.fablechat` holds. All optional: old templates keep working. */
export interface WorkflowMapping extends Partial<Record<WorkflowRole, string | null>> {
  purpose?: WorkflowPurpose;
  /** LoadImage inputs that receive reference images, in order */
  referenceImageNodes?: string[];
}

export const ROLE_INFO: ReadonlyArray<{ role: WorkflowRole; label: string; kind: "text" | "number"; video?: boolean }> = [
  { role: "promptNode", label: "Prompt", kind: "text" },
  { role: "negativePromptNode", label: "Negative prompt", kind: "text" },
  { role: "loraSyntaxNode", label: "LoRA line (<lora:name:weight>)", kind: "text" },
  { role: "seedNode", label: "Seed", kind: "number" },
  { role: "stepsNode", label: "Steps", kind: "number" },
  { role: "cfgNode", label: "CFG / guidance", kind: "number" },
  { role: "widthNode", label: "Width", kind: "number" },
  { role: "heightNode", label: "Height", kind: "number" },
  { role: "videoLengthNode", label: "Video length (frames)", kind: "number", video: true },
];

type Link = [string, number];
interface Node { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }
export type ApiWorkflow = Record<string, unknown>;

export interface Candidate { path: string; label: string }

export interface WorkflowReading {
  ok: true;
  mapping: WorkflowMapping;
  /** Alternatives per role, for the dropdowns */
  candidates: Record<WorkflowRole, Candidate[]>;
  /** Every LoadImage input, for reference images */
  imageInputs: Candidate[];
  classTypes: string[];
  nodeCount: number;
  isVideo: boolean;
  /** A title found in the file, if any */
  title?: string;
}

export type WorkflowReadResult = WorkflowReading | { ok: false; error: string };

const isLink = (v: unknown): v is Link => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

const SAMPLERS = new Set(["KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced"]);
const GUIDERS = new Set(["CFGGuider", "BasicGuider", "DualCFGGuider"]);
// Case-sensitive on purpose: /wan/i matched "PreviewAny" ("previe-wAn-y")
// and called an image workflow a video one.
const VIDEO_HINT = /Video|^Wan[A-Z]|Hunyuan|^LTXV|AnimateDiff|^VHS_|Mochi|CogVideo|^SVD_/;
const TEXT_KEYS = ["text", "t5xxl", "clip_l", "value", "string", "prompt", "text_g"];

function nodesOf(wf: ApiWorkflow): Array<[string, Node]> {
  return Object.entries(wf).filter((e): e is [string, Node] => {
    const n = e[1] as Node;
    return e[0] !== "_meta" && !!n && typeof n === "object" && typeof n.class_type === "string" && !!n.inputs && typeof n.inputs === "object";
  });
}

const labelFor = (id: string, n: Node, input: string) =>
  `#${id} ${n._meta?.title && n._meta.title !== n.class_type ? `${n._meta.title} (${n.class_type})` : n.class_type} · ${input}`;

/**
 * Parse and read a workflow. Refuses ComfyUI's UI-format save (it has a
 * "nodes" array and cannot be queued) with a message saying how to get the
 * API-format export instead.
 */
export function readWorkflow(input: unknown): WorkflowReadResult {
  let wf: unknown = input;
  if (typeof input === "string") {
    try { wf = JSON.parse(input); } catch { return { ok: false, error: "That is not valid JSON." }; }
  }
  if (!wf || typeof wf !== "object" || Array.isArray(wf)) return { ok: false, error: "That is not a ComfyUI workflow." };
  const obj = wf as Record<string, unknown>;
  if (Array.isArray(obj.nodes) && Array.isArray(obj.links)) {
    return { ok: false, error: "This is ComfyUI's normal save (UI format), which cannot be run from outside ComfyUI. In ComfyUI use Workflow → Export (API) and import that file instead." };
  }
  const nodes = nodesOf(obj);
  if (nodes.length === 0) return { ok: false, error: "No ComfyUI nodes found. Export the workflow with Export (API)." };
  const byId = new Map(nodes);

  /** Follow a link to where a value really lives: a primitive's own input. */
  const valuePath = (id: string, key: string, kind: "text" | "number", depth = 0): string | null => {
    const n = byId.get(id);
    if (!n || depth > 6) return null;
    const v = n.inputs[key];
    if (isLink(v)) {
      const src = byId.get(v[0]);
      if (!src) return null;
      const typed = Object.keys(src.inputs).filter((k) => {
        const x = src.inputs[k];
        return kind === "text" ? typeof x === "string" : typeof x === "number";
      });
      // A node with several outputs (a resolution helper giving width on 0 and
      // height on 1): prefer the input named like the one asking, then the one
      // at the linked output's position, then the first.
      const srcKey = typed.find((k) => k === key) ?? typed[v[1]] ?? typed[0]
        ?? Object.keys(src.inputs).find((k) => isLink(src.inputs[k]));
      return srcKey ? valuePath(v[0], srcKey, kind, depth + 1) : null;
    }
    if (kind === "text" ? typeof v === "string" : typeof v === "number") return `${id}.inputs.${key}`;
    return null;
  };

  /** From a conditioning link, find the text that produced it. */
  const textBehind = (link: unknown, side: "positive" | "negative" | "any", depth = 0): string | null => {
    if (!isLink(link) || depth > 8) return null;
    const n = byId.get(link[0]);
    if (!n) return null;
    for (const k of TEXT_KEYS) {
      if (k in n.inputs) {
        const p = valuePath(link[0], k, "text");
        if (p) return p;
      }
    }
    // A pass-through (guidance, combine, zero-out…): keep walking its
    // conditioning input. Nodes that pass BOTH sides through (WanImageToVideo,
    // InstructPix2Pix…) must be followed on the side we came from, or the
    // negative prompt resolves to the positive text.
    const conds = Object.entries(n.inputs).filter(([k, v]) => isLink(v) && /conditioning|positive|negative|cond/i.test(k));
    const ordered = side === "any" ? conds : [
      ...conds.filter(([k]) => new RegExp(side, "i").test(k)),
      ...conds.filter(([k]) => !/positive|negative/i.test(k)),
    ];
    for (const [, v] of ordered) {
      const p = textBehind(v, side, depth + 1);
      if (p) return p;
    }
    return null;
  };

  const samplers = nodes.filter(([, n]) => SAMPLERS.has(n.class_type));
  const guiders = nodes.filter(([, n]) => GUIDERS.has(n.class_type));
  const first = <T,>(xs: Array<T | null | undefined>): T | null => xs.find((x) => x != null) ?? null;

  const mapping: WorkflowMapping = {};
  mapping.promptNode = first([
    ...samplers.map(([, n]) => textBehind(n.inputs.positive, "positive")),
    ...guiders.map(([, n]) => textBehind(n.inputs.positive ?? n.inputs.conditioning, "positive")),
  ]);
  mapping.negativePromptNode = first([
    ...samplers.map(([, n]) => textBehind(n.inputs.negative, "negative")),
    ...guiders.map(([, n]) => textBehind(n.inputs.negative, "negative")),
  ]);
  if (mapping.negativePromptNode === mapping.promptNode) mapping.negativePromptNode = null;

  const numberAt = (classes: RegExp, keys: string[]) => first(nodes.flatMap(([id, n]) =>
    classes.test(n.class_type) ? keys.filter((k) => k in n.inputs).map((k) => valuePath(id, k, "number")) : []));
  mapping.seedNode = first([
    ...samplers.map(([id, n]) => ("seed" in n.inputs ? valuePath(id, "seed", "number") : "noise_seed" in n.inputs ? valuePath(id, "noise_seed", "number") : null)),
    numberAt(/^RandomNoise$/, ["noise_seed"]),
  ]);
  mapping.stepsNode = first([...samplers.map(([id, n]) => ("steps" in n.inputs ? valuePath(id, "steps", "number") : null)), numberAt(/Scheduler$/, ["steps"])]);
  mapping.cfgNode = first([...samplers.map(([id, n]) => ("cfg" in n.inputs ? valuePath(id, "cfg", "number") : null)), ...guiders.map(([id, n]) => ("cfg" in n.inputs ? valuePath(id, "cfg", "number") : null)), numberAt(/^FluxGuidance$/, ["guidance"])]);
  const sizeClass = /Empty.*Latent|LatentImage|ImageToVideo|ImgToVideo|Latent.*Video/i;
  mapping.widthNode = numberAt(sizeClass, ["width"]);
  mapping.heightNode = numberAt(sizeClass, ["height"]);
  mapping.videoLengthNode = numberAt(VIDEO_HINT, ["length", "num_frames", "video_frames", "frames"]);
  mapping.loraSyntaxNode = null; // only by choice: no reliable way to tell a LoRA text box from any other

  const imageInputs: Candidate[] = nodes
    .filter(([, n]) => n.class_type === "LoadImage" && typeof n.inputs.image === "string")
    .map(([id, n]) => ({ path: `${id}.inputs.image`, label: labelFor(id, n, "image") }));
  mapping.referenceImageNodes = imageInputs.map((c) => c.path);

  const classTypes = [...new Set(nodes.map(([, n]) => n.class_type))].sort();
  const isVideo = classTypes.some((c) => VIDEO_HINT.test(c));
  mapping.purpose = isVideo ? "video" : "scene";

  // Dropdown alternatives: every literal input of the right kind
  const all = (kind: "text" | "number"): Candidate[] => nodes.flatMap(([id, n]) =>
    Object.entries(n.inputs)
      .filter(([, v]) => (kind === "text" ? typeof v === "string" && !/\.(safetensors|ckpt|pt|pth|bin|gguf|png|jpe?g|webp)$/i.test(v) : typeof v === "number"))
      .map(([k]) => ({ path: `${id}.inputs.${k}`, label: labelFor(id, n, k) })));
  const textC = all("text"), numC = all("number");
  const candidates = Object.fromEntries(ROLE_INFO.map((r) => [r.role, r.kind === "text" ? textC : numC])) as Record<WorkflowRole, Candidate[]>;

  const meta = obj._meta as { title?: string } | undefined;
  return { ok: true, mapping, candidates, imageInputs, classTypes, nodeCount: nodes.length, isVideo, title: typeof meta?.title === "string" ? meta.title : undefined };
}

/** Node types this workflow needs that the ComfyUI server does not have. */
export function missingNodeTypes(classTypes: string[], objectInfo: Record<string, unknown>): string[] {
  return classTypes.filter((c) => !(c in objectInfo));
}

/** The workflow with its mapping stored where FableChat reads it (`_meta.fablechat`). */
export function withMapping(wf: ApiWorkflow, mapping: WorkflowMapping, title: string, description?: string): ApiWorkflow {
  const meta = (wf._meta && typeof wf._meta === "object" ? wf._meta : {}) as Record<string, unknown>;
  return { ...wf, _meta: { ...meta, title, ...(description ? { description } : {}), fablechat: mapping } };
}
