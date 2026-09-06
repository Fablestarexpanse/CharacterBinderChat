import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError } from "@/lib/api/server";
import { findDuplicateClusters } from "@/lib/server/entityDedupe";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const store  = getStore();
    const chatId = req.nextUrl.searchParams.get("chatId");
    if (!chatId) {
      return Response.json({ ok: false, error: "chatId param required" }, { status: 400 });
    }
    const entities = store.listEntities(chatId);

    // Fact count per entity (as subject) using live facts
    const enriched = entities.map((e) => ({
      id:          e.id,
      type:        e.type,
      name:        e.name,
      description: e.description,
      createdAt:   e.createdAt,
      factCount:   store.queryFacts(chatId, e.id).length,
    }));

    const possibleDuplicates = findDuplicateClusters(entities);

    return Response.json({ entities: enriched, possibleDuplicates });
  } catch (err) {
    return routeError("[entities/overview]", err);
  }
}
