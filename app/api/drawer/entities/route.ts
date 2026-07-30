import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import type { EntityType } from "@/lib/db/models";

export const dynamic = "force-dynamic";

// GET /api/drawer/entities?chat=<chatId>&type=character
export async function GET(req: NextRequest) {
  try {
    const store  = getStore();
    const chatId = req.nextUrl.searchParams.get("chat");
    if (!chatId) {
      return Response.json({ error: "chat param required" }, { status: 400 });
    }
    const type  = req.nextUrl.searchParams.get("type") as EntityType | null;
    const entities = store.listEntities(chatId, type ?? undefined);
    return Response.json({ entities });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
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
      return Response.json({ error: "chatId, id, type and name are required" }, { status: 400 });
    }
    const store = getStore();
    const entity = store.ensureEntity(chatId, id, type, name, description);
    return Response.json({ entity });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
