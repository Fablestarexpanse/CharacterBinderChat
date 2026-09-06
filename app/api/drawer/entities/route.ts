import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
// Validated against the runtime list, not trusted from the caller: an invalid
// value hits the schema CHECK as an opaque SQL 500 on write, or silently
// queries for a type that cannot exist on read.
import { ENTITY_TYPES, isEntityType } from "@/lib/db/models";
import type { EntityType } from "@/lib/db/models";
import { routeError } from "@/lib/api/server";

export const dynamic = "force-dynamic";


// GET /api/drawer/entities?chatId=<chatId>&type=character
export async function GET(req: NextRequest) {
  try {
    const store  = getStore();
    const chatId = req.nextUrl.searchParams.get("chatId");
    if (!chatId) {
      return Response.json({ ok: false, error: "chatId param required" }, { status: 400 });
    }
    const type = req.nextUrl.searchParams.get("type");
    if (type !== null && !isEntityType(type)) {
      return Response.json({ ok: false, error: `type must be one of: ${ENTITY_TYPES.join(", ")}` }, { status: 400 });
    }
    const entities = store.listEntities(chatId, type ?? undefined);
    return Response.json({ entities });
  } catch (err) {
    return routeError("[drawer/entities GET]", err);
  }
}

// POST /api/drawer/entities
// Body: { chatId, id, type, name, description? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { chatId, id, type, name, description = "" } = body as {
      chatId: string; id: string; type: EntityType; name: string; description?: string;
    };
    if (!chatId || !id || !type || !name) {
      return Response.json({ ok: false, error: "chatId, id, type and name are required" }, { status: 400 });
    }
    if (!isEntityType(type)) {
      return Response.json({ ok: false, error: `type must be one of: ${ENTITY_TYPES.join(", ")}` }, { status: 400 });
    }
    const store = getStore();
    const entity = store.ensureEntity(chatId, id, type, name, description);
    return Response.json({ ok: true, entity });
  } catch (err) {
    return routeError("[drawer/entities POST]", err);
  }
}
