import { promises as fs } from "fs";
import path from "path";
import { routeError } from "@/lib/api/server";
import type { WorkflowSummary } from "@/lib/api/dto";

export const dynamic = "force-dynamic";

// ─── GET /api/workflows ───────────────────────────────────────────────────────
// Index the workflows/ directory. The picker used to be a hand-maintained
// array in the Image Studio, so dropping a template into the folder never
// surfaced it and deleting one left a dead option. This reads the truth.

type Node = { class_type?: string; inputs?: Record<string, unknown> };

export async function GET() {
  try {
    const dir = path.join(process.cwd(), "workflows");
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return Response.json({ workflows: [] });
    }

    const workflows: WorkflowSummary[] = [];
    for (const file of files.sort()) {
      const slug = file.replace(/\.json$/, "");
      try {
        const raw  = await fs.readFile(path.join(dir, file), "utf8");
        const json = JSON.parse(raw) as Record<string, unknown>;
        const meta = (json._meta as {
          title?: string;
          description?: string;
          fablechat?: Record<string, string | null>;
        } | undefined) ?? {};

        const nodes = Object.entries(json).filter(([k]) => k !== "_meta");
        const sampler = nodes
          .map(([, v]) => v as Node)
          .find((n) => n.class_type === "KSampler" || n.class_type === "KSamplerAdvanced");

        workflows.push({
          slug,
          title:       meta.title ?? slug,
          description: meta.description ?? null,
          nodeCount:   nodes.length,
          controls: Object.entries(meta.fablechat ?? {})
            .filter(([, v]) => !!v)
            .map(([k]) => k.replace(/Node$/, "")),
          steps: typeof sampler?.inputs?.steps === "number" ? sampler.inputs.steps as number : null,
          cfg:   typeof sampler?.inputs?.cfg   === "number" ? sampler.inputs.cfg   as number : null,
        });
      } catch (e) {
        // A malformed template should show up as broken, not vanish silently
        workflows.push({
          slug, title: slug, description: null, nodeCount: 0, controls: [],
          steps: null, cfg: null, error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return Response.json({ workflows });
  } catch (err) {
    return routeError("[workflows GET]", err);
  }
}
