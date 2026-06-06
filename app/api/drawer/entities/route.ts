import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import type { EntityType } from "@/lib/db/models";

export const dynamic = "force-dynamic";

// GET /api/drawer/entities?type=character
export async function GET(req: NextRequest) {
  try {
    const store = getStore();
    const type  = req.nextUrl.searchParams.get("type") as EntityType | null;
    const entities = store.listEntities(type ?? undefined);
    return Response.json({ entities });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/drawer/entities
// Body: { id, type, name, description? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, type, name, description = "" } = body as {
      id: string; type: EntityType; name: string; description?: string;
    };
    if (!id || !type || !name) {
      return Response.json({ error: "id, type and name are required" }, { status: 400 });
    }
    const store = getStore();
    const entity = store.ensureEntity(id, type, name, description);
    return Response.json({ entity });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
