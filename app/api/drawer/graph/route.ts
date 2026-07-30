import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── GET /api/drawer/graph?chat=X&character=Y ────────────────────────────────
// Everything the mind map needs in one payload: entities as nodes, live facts
// as edges (literal objects become lightweight text nodes), episodic scene
// cards and reflections as event nodes linked to their participants, the
// character↔player emotional bond, and the character's current mood.

export async function GET(req: NextRequest) {
  try {
    const chatId      = req.nextUrl.searchParams.get("chat");
    const characterId = req.nextUrl.searchParams.get("character");
    if (!chatId) {
      return Response.json({ error: "chat param required" }, { status: 400 });
    }

    const store = getStore();

    const entities = store.listEntities(chatId).map((e) => ({
      id:   e.id,
      name: e.name,
      type: e.type,
      kind: "entity" as const,
      isCharacter: e.id === characterId,
      isPlayer:    e.id === "player",
    }));

    const facts = store.queryAllLiveFacts(chatId);

    // Literal fact objects ("safehouse sector 4") get small text nodes so the
    // fact is visible as an edge instead of dangling
    const literalNodes = new Map<string, { id: string; name: string }>();
    const links: Array<{ source: string; target: string; predicate: string; importance: number }> = [];
    for (const f of facts) {
      let target: string;
      if (f.objectId) {
        target = f.objectId;
      } else {
        const text = (f.objectLiteral ?? "").trim();
        if (!text) continue;
        const key = `lit:${text.toLowerCase()}`;
        if (!literalNodes.has(key)) {
          literalNodes.set(key, { id: key, name: text.length > 34 ? text.slice(0, 32) + "…" : text });
        }
        target = key;
      }
      links.push({ source: f.subjectId, target, predicate: f.predicate, importance: f.importance });
    }

    const cards = store.listMemoryCards(chatId).map((c) => ({
      id:         `card:${c.id}`,
      name:       c.title,
      content:    c.content,
      kind:       c.tags.includes("reflection") ? ("insight" as const) : ("episode" as const),
      importance: c.importance,
      entityIds:  c.entityIds,
    }));

    const bond = characterId
      ? Object.fromEntries(
          Object.entries(store.queryStats(chatId, characterId, "player"))
            .map(([k, v]) => [k, v ? Math.round(v.value) : null])
        )
      : {};

    const mood = characterId
      ? store.getCoreMemory(chatId, characterId)?.data.mood ?? null
      : null;

    const commitments = store.allCommitments(chatId).map((c) => ({
      id:          `commit:${c.id}`,
      name:        c.description.length > 40 ? c.description.slice(0, 38) + "…" : c.description,
      description: c.description,
      status:      c.status,
      promisorId:  c.promisorId,
      promiseeId:  c.promiseeId,
      kind:        "commitment" as const,
    }));

    return Response.json({
      entities,
      literals: [...literalNodes.values()],
      links,
      cards,
      commitments,
      bond,
      mood,
    });
  } catch (err) {
    console.error("[drawer/graph]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
