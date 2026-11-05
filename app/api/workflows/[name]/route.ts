import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { deleteImported, getWorkflow, saveImported, SLUG } from "@/lib/server/workflows";
import type { WorkflowMapping } from "@/lib/media/workflowDetect";

export const dynamic = "force-dynamic";

// GET    /api/workflows/<name> — the template, imported or bundled. Name is
//        whitelisted to a slug so the route can never read outside workflows/.
// PUT    { title, description?, mapping } — change an imported workflow's name or mapping
// DELETE — remove an imported workflow (bundled ones cannot be deleted)

type Ctx = { params: Promise<{ name: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { name } = await params;
    if (!SLUG.test(name)) return badRequest("invalid workflow name");
    const wf = await getWorkflow(name);
    if (!wf) return Response.json({ ok: false, error: `workflow "${name}" not found` }, { status: 404 });
    return Response.json(wf);
  } catch (err) {
    return routeError("[workflows/[name] GET]", err);
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const { name } = await params;
    if (!SLUG.test(name)) return badRequest("invalid workflow name");
    const current = await getWorkflow(name);
    if (!current) return Response.json({ ok: false, error: `workflow "${name}" not found` }, { status: 404 });
    const body = (await req.json()) as { title?: unknown; description?: unknown; mapping?: unknown };
    if (typeof body.title !== "string") return badRequest("title is required");
    const { _meta: _old, ...graph } = current;
    void _old;
    const r = await saveImported({
      slug: name, title: body.title, description: typeof body.description === "string" ? body.description : undefined,
      workflow: graph, mapping: (body.mapping ?? {}) as WorkflowMapping,
    });
    if (!r.ok) return badRequest(r.error);
    return Response.json({ ok: true, slug: r.slug });
  } catch (err) {
    return routeError("[workflows/[name] PUT]", err);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const { name } = await params;
    if (!SLUG.test(name) || !deleteImported(name)) return badRequest("only an imported workflow can be removed");
    return Response.json({ ok: true });
  } catch (err) {
    return routeError("[workflows/[name] DELETE]", err);
  }
}
