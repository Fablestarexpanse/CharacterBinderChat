// ─── Which workflows ComfyUI can actually run ─────────────────────────────────
// Client-side. A workflow that needs custom nodes ComfyUI does not have is
// refused when queued ("Node 'IPAdapter FaceID loader' not found"). For the
// likeness workflow that happened on every picture of a character with "Make
// pictures look like them" on, so choosing one now first asks ComfyUI which of
// its node types exist (one small request per type, remembered for a while), and
// a workflow it cannot run is left out: the picture is drawn with the normal
// workflow instead (the person's image tags still apply).

import { useFableStore } from "@/lib/store";
import { getJson } from "@/lib/api/client";
import type { WorkflowSummary } from "@/lib/api/dto";

const known = new Map<string, { at: number; has: boolean }>();
const TTL = 5 * 60_000;

async function hasNode(base: string, type: string): Promise<boolean> {
  const key = `${base}|${type}`;
  const k = known.get(key);
  if (k && Date.now() - k.at < TTL) return k.has;
  try {
    const info = await getJson<Record<string, unknown>>(`/api/comfyui/object_info/${encodeURIComponent(type)}?base=${encodeURIComponent(base)}`);
    const has = !!info && Object.keys(info).length > 0;
    known.set(key, { at: Date.now(), has });
    return has;
  } catch {
    return true; // ComfyUI did not answer: do not rule anything out on a guess
  }
}

/** The workflows (from /api/workflows) whose nodes ComfyUI has; only those with an image input are checked */
export async function runnableWorkflows(workflows: WorkflowSummary[]): Promise<WorkflowSummary[]> {
  const base = useFableStore.getState().providerSettings.comfyui.baseUrl;
  const out: WorkflowSummary[] = [];
  for (const w of workflows) {
    if (!w.controls?.includes("referenceImage") || !w.classTypes?.length) { out.push(w); continue; }
    const ok = (await Promise.all(w.classTypes.map((t) => hasNode(base, t)))).every(Boolean);
    if (ok) out.push(w);
  }
  return out;
}

/** The workflow list for a picture of someone, with workflows ComfyUI cannot run left out */
export async function workflowsForLikeness(): Promise<WorkflowSummary[]> {
  const list = await getJson<{ workflows?: WorkflowSummary[] }>("/api/workflows").then((d) => d.workflows ?? []).catch(() => []);
  return runnableWorkflows(list);
}
