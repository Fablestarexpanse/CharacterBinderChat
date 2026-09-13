import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { routeError, badRequest } from "@/lib/api/server";

export const dynamic = "force-dynamic";

// GET /api/workflows/<name> — serve a ComfyUI API-format workflow template
// from the repo's workflows/ directory. Name is whitelisted to a slug so the
// route can never read outside that directory.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      return badRequest("invalid workflow name");
    }
    const file = path.join(process.cwd(), "workflows", `${name}.json`);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      return Response.json({ ok: false, error: `workflow "${name}" not found` }, { status: 404 });
    }
    return Response.json(JSON.parse(raw));
  } catch (err) {
    return routeError("[workflows/[name] GET]", err);
  }
}
