// ─── Workflow templates: bundled files and imported ones ──────────────────────
// Server-only. Bundled templates are the JSON files in workflows/ (read-only,
// shipped with the app). Imported ones are stored in the database (app_kv
// `workflow:<slug>`, listed under `workflows:imported`) so they are in backups
// and survive updates, and are served from the same routes, so the Image
// Studio and everything else uses them with no special case.

import { promises as fs } from "fs";
import path from "path";
import { getStore } from "@/lib/db";
import type { WorkflowSummary } from "@/lib/api/dto";
import { readWorkflow, withMapping, type ApiWorkflow, type WorkflowMapping } from "@/lib/media/workflowDetect";

const INDEX_KEY = "workflows:imported";
const itemKey = (slug: string) => `workflow:${slug}`;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const dir = () => path.join(process.cwd(), "workflows");

type Node = { class_type?: string; inputs?: Record<string, unknown> };

function importedSlugs(): string[] {
  try {
    const v = JSON.parse(getStore().getKv(INDEX_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && SLUG.test(s)) : [];
  } catch { return []; }
}

async function bundledSlugs(): Promise<string[]> {
  try { return (await fs.readdir(dir())).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")); }
  catch { return []; }
}

export function getImported(slug: string): ApiWorkflow | null {
  const raw = getStore().getKv(itemKey(slug));
  if (!raw) return null;
  try { return JSON.parse(raw) as ApiWorkflow; } catch { return null; }
}

/** The template for a slug: an imported one first, then a bundled file. */
export async function getWorkflow(slug: string): Promise<ApiWorkflow | null> {
  if (!SLUG.test(slug)) return null;
  const imported = getImported(slug);
  if (imported) return imported;
  try { return JSON.parse(await fs.readFile(path.join(dir(), `${slug}.json`), "utf8")) as ApiWorkflow; }
  catch { return null; }
}

export function summarise(slug: string, json: ApiWorkflow, source: "bundled" | "imported"): WorkflowSummary {
  const meta = (json._meta as { title?: string; description?: string; fablechat?: WorkflowMapping } | undefined) ?? {};
  const nodes = Object.entries(json).filter(([k]) => k !== "_meta");
  const sampler = nodes.map(([, v]) => v as Node).find((n) => n.class_type === "KSampler" || n.class_type === "KSamplerAdvanced");
  const mapping = meta.fablechat ?? {};
  return {
    slug, source,
    title: meta.title ?? slug,
    description: meta.description ?? null,
    nodeCount: nodes.length,
    purpose: mapping.purpose ?? null,
    controls: Object.entries(mapping)
      .filter(([k, v]) => k !== "purpose" && k !== "ownSampling" && (Array.isArray(v) ? v.length > 0 : !!v))
      .map(([k]) => k.replace(/Nodes?$/, "")),
    classTypes: [...new Set(nodes.map(([, v]) => (v as Node).class_type).filter((c): c is string => !!c))].sort(),
    steps: typeof sampler?.inputs?.steps === "number" ? sampler.inputs.steps as number : null,
    cfg: typeof sampler?.inputs?.cfg === "number" ? sampler.inputs.cfg as number : null,
    ...(mapping.ownSampling === true ? { ownSampling: true } : {}),
  };
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const out: WorkflowSummary[] = [];
  for (const slug of (await bundledSlugs()).sort()) {
    try {
      out.push(summarise(slug, JSON.parse(await fs.readFile(path.join(dir(), `${slug}.json`), "utf8")) as ApiWorkflow, "bundled"));
    } catch (e) {
      // A malformed template should show up as broken, not vanish silently
      out.push({ slug, source: "bundled", title: slug, description: null, nodeCount: 0, purpose: null, controls: [], classTypes: [], steps: null, cfg: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const slug of importedSlugs()) {
    const wf = getImported(slug);
    if (wf) out.push(summarise(slug, wf, "imported"));
  }
  return out;
}

const slugify = (title: string) => title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workflow";

export type SaveResult = { ok: true; slug: string } | { ok: false; error: string };

/**
 * Store an imported workflow with its mapping. `slug` updates an existing
 * imported one; without it a new slug is made from the title, never clashing
 * with a bundled file or another import. Bundled templates cannot be changed.
 */
export async function saveImported(opts: { slug?: string; title: string; description?: string; workflow: unknown; mapping: WorkflowMapping }): Promise<SaveResult> {
  const title = opts.title.trim();
  if (!title) return { ok: false, error: "Give the workflow a name." };
  const read = readWorkflow(opts.workflow);
  if (!read.ok) return { ok: false, error: read.error };
  const bundled = await bundledSlugs();
  const existing = importedSlugs();
  let slug = opts.slug;
  if (slug !== undefined) {
    if (bundled.includes(slug)) return { ok: false, error: "Bundled workflows cannot be changed. Import a copy to change it." };
    if (!existing.includes(slug)) return { ok: false, error: "No such imported workflow." };
  } else {
    const base = slugify(title);
    slug = base;
    for (let i = 2; bundled.includes(slug) || existing.includes(slug); i++) slug = `${base}-${i}`;
  }
  const wf = typeof opts.workflow === "string" ? JSON.parse(opts.workflow) as ApiWorkflow : opts.workflow as ApiWorkflow;
  const store = getStore();
  store.setKv(itemKey(slug), JSON.stringify(withMapping(wf, cleanMapping(opts.mapping), title, opts.description?.trim() || undefined)));
  if (!existing.includes(slug)) store.setKv(INDEX_KEY, JSON.stringify([...existing, slug]));
  return { ok: true, slug };
}

export function deleteImported(slug: string): boolean {
  const existing = importedSlugs();
  if (!existing.includes(slug)) return false;
  const store = getStore();
  store.setKv(itemKey(slug), null);
  store.setKv(INDEX_KEY, JSON.stringify(existing.filter((s) => s !== slug)));
  return true;
}

const PATH = /^[A-Za-z0-9_:.-]+\.inputs\.[A-Za-z0-9_ ]+$/;
const PURPOSES = new Set(["portrait", "photo", "scene", "video"]);

/** Only well-formed node paths and known keys are stored. */
function cleanMapping(m: WorkflowMapping): WorkflowMapping {
  const out: WorkflowMapping = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (k === "purpose") { if (typeof v === "string" && PURPOSES.has(v)) out.purpose = v as WorkflowMapping["purpose"]; continue; }
    if (k === "ownSampling") { if (v === true) out.ownSampling = true; continue; }
    if (k === "referenceImageNodes") { if (Array.isArray(v)) out.referenceImageNodes = v.filter((p): p is string => typeof p === "string" && PATH.test(p)).slice(0, 4); continue; }
    if (/Node$/.test(k)) (out as Record<string, unknown>)[k] = typeof v === "string" && PATH.test(v) ? v : null;
  }
  return out;
}
