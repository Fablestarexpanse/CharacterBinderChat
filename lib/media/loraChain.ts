// ─── LoRAs chained in front of a sampler ──────────────────────────────────────
// For workflows that load their model with a plain loader and have no LoRA node
// of their own (MOSS-Image's photo workflow): when the workflow opts in
// (`_meta.fablechat.loraChain: true`) and LoRAs are asked for, one ComfyUI core
// `LoraLoaderModelOnly` per LoRA is inserted between the model and every
// sampler that reads it. Model-only, because these models' text encoders are
// not trained by the LoRAs people make for them. A LoRA only works with the
// model family it was trained for: a Krea2 or SDXL LoRA on MOSS fails to load
// or does nothing, which is why comic pages take their own LoRAs.
//
// Pure: takes the API-format graph, returns how many LoRA nodes it added.

type Node = { class_type?: string; inputs?: Record<string, unknown> };
export interface ChainLora { name: string; weight: number }

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

export function chainLoras(workflow: Record<string, unknown>, loras: ChainLora[]): number {
  const wanted = loras.filter((l) => l.name.trim()).slice(0, 8);
  if (wanted.length === 0) return 0;
  const samplers = Object.values(workflow).filter((n): n is Node =>
    !!n && typeof n === "object" && /sampler/i.test((n as Node).class_type ?? "") && isLink((n as Node).inputs?.model));
  if (samplers.length === 0) return 0;
  // Every sampler reading the same model gets the same chain
  const source = samplers[0].inputs!.model as [string, number];
  let prev: [string, number] = source;
  wanted.forEach((l, i) => {
    let id = `fablechat_lora_${i + 1}`;
    while (id in workflow) id += "_";
    workflow[id] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { lora_name: l.name, strength_model: Number.isFinite(l.weight) ? l.weight : 1, model: prev },
      _meta: { title: `LoRA ${i + 1} (FableChat)` },
    };
    prev = [id, 0];
  });
  for (const s of samplers) {
    const m = s.inputs!.model as [string, number];
    if (m[0] === source[0] && m[1] === source[1]) s.inputs!.model = prev;
  }
  return wanted.length;
}
