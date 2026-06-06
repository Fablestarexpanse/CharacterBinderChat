import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/drawer/summary/<entityId>
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  try {
    const { entityId } = await params;
    const store   = getStore();
    const summary = store.characterSummary(entityId);
    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
