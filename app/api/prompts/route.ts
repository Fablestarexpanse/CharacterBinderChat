import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { isPromptId } from "@/lib/prompts/defaults";
import { clearPromptOverride, listPrompts, setPromptOverride } from "@/lib/server/prompts";

export const dynamic = "force-dynamic";

// ─── /api/prompts ─────────────────────────────────────────────────────────────
// GET    → { prompts }: every editable prompt with its default and any override
// PUT    { id, template } → save an override (checked first; refused with the reasons)
// DELETE ?id=…            → back to the shipped default
// Only ids in the registry are accepted, so this is not a general app_kv writer.

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    return Response.json({ prompts: listPrompts() });
  } catch (err) {
    return routeError("[prompts GET]", err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await req.json()) as { id?: unknown; template?: unknown };
    if (!isPromptId(body.id)) return badRequest("unknown prompt id");
    if (typeof body.template !== "string") return badRequest("template must be a string");
    if (body.template.length > 50_000) return badRequest("template is too long (50,000 characters at most)");
    const check = setPromptOverride(body.id, body.template);
    if (!check.ok) return Response.json({ ok: false, error: check.errors.join(" "), errors: check.errors }, { status: 400 });
    return Response.json({ ok: true, warnings: check.warnings });
  } catch (err) {
    return routeError("[prompts PUT]", err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const id = req.nextUrl.searchParams.get("id");
    if (!isPromptId(id)) return badRequest("unknown prompt id");
    clearPromptOverride(id);
    return Response.json({ ok: true });
  } catch (err) {
    return routeError("[prompts DELETE]", err);
  }
}
