import { NextRequest } from "next/server";
import { extractMemory } from "@/lib/server/memoryExtractor";
import { parseMemoryTaskRequest, routeError } from "@/lib/api/server";

export const dynamic = "force-dynamic";

// ─── POST /api/drawer/extract ─────────────────────────────────────────────────
// Runs a turn of Drawer 2 extraction. The pipeline itself lives in
// lib/server/memoryExtractor.ts; this handler validates the envelope and maps
// the result onto a status, the way the core-memory refresh route does.

export async function POST(req: NextRequest) {
  try {
    const task = parseMemoryTaskRequest(await req.json());
    if (!task.ok) return task.response;

    const result = await extractMemory(task.value);
    // An upstream model failure is a 502, matching the sibling memory routes.
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return routeError("[drawer/extract]", err);
  }
}
