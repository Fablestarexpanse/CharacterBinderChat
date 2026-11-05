import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { listWorkflows, saveImported } from "@/lib/server/workflows";
import type { WorkflowMapping } from "@/lib/media/workflowDetect";

export const dynamic = "force-dynamic";

// ─── /api/workflows ───────────────────────────────────────────────────────────
// GET  → { workflows }: the bundled files in workflows/ and the user's imports.
//        Read from the truth each time (the picker was once a hand-kept array).
// POST { title, description?, workflow, mapping } → import a ComfyUI API-format
//        export; refused with the reason if it is not one.

export async function GET() {
  try {
    return Response.json({ workflows: await listWorkflows() });
  } catch (err) {
    return routeError("[workflows GET]", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await req.json()) as { title?: unknown; description?: unknown; workflow?: unknown; mapping?: unknown };
    if (typeof body.title !== "string") return badRequest("title is required");
    if (body.workflow === undefined) return badRequest("workflow is required");
    if (JSON.stringify(body.workflow).length > 2_000_000) return badRequest("that workflow is too large (2 MB at most)");
    const r = await saveImported({
      title: body.title, description: typeof body.description === "string" ? body.description : undefined,
      workflow: body.workflow, mapping: (body.mapping ?? {}) as WorkflowMapping,
    });
    if (!r.ok) return badRequest(r.error);
    return Response.json({ ok: true, slug: r.slug });
  } catch (err) {
    return routeError("[workflows POST]", err);
  }
}
