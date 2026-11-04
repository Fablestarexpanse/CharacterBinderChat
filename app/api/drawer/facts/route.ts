import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest } from "@/lib/api/server";
import type { DrawerFact } from "@/lib/api/dto";
import { embedText, vecToBuffer } from "@/lib/llm/embeddings";

export const dynamic = "force-dynamic";

// GET /api/drawer/facts?chatId=<id>&subject=<id>&asOf=<unix_ts>&includeSuperseded=1
// Default (no flag): returns live facts only — backward-compatible with MemoryTab.
// With includeSuperseded=1: returns all facts including superseded (bi-temporal view).
export async function GET(req: NextRequest) {
  try {
    const params            = req.nextUrl.searchParams;
    const chatId            = params.get("chatId");
    const subject           = params.get("subject");
    if (!chatId || !subject) {
      return badRequest("chatId and subject params required");
    }
    const asOfRaw           = params.get("asOf");
    const asOf              = asOfRaw ? Number(asOfRaw) : undefined;
    if (asOf !== undefined && !Number.isFinite(asOf)) {
      return badRequest("asOf must be a unix timestamp");
    }
    const includeSuperseded = params.get("includeSuperseded") === "1";
    const store             = getStore();

    const facts = includeSuperseded
      ? store.queryFactsIncludingSuperseded(chatId, subject)
      : store.queryFacts(chatId, subject, asOf);

    // Enrich with object display and expose bi-temporal columns the inspector needs
    const enriched = facts.map((f) => ({
      id:            f.id,
      predicate:     f.predicate,
      objectDisplay: store.formatFactObject(chatId, f),
      confidence:    f.confidence,
      tValidStart:   f.tValidStart,
      tValidEnd:     f.tValidEnd,
      supersededBy:  f.supersededBy,
      pinned:        f.pinned,
      locked:        f.locked,
      editable:      f.objectId === null,
    }));
    return Response.json({ facts: enriched } satisfies { facts: DrawerFact[] });
  } catch (err) {
    return routeError("[drawer/facts GET]", err);
  }
}

// POST /api/drawer/facts
// Body:     { chatId, subjectId, predicate, objectId?, objectLiteral?, confidence?, importance? }
// Response: { ok, factId, duplicate, superseded } — one shape whether the fact
// was inserted or matched an existing one.
// Applies the same dedup + supersession logic as the extract route so the
// single-valued predicate invariant is enforced regardless of call path.
export async function POST(req: NextRequest) {
  try {
    const body  = await req.json();
    const store = getStore();

    const { chatId, subjectId, predicate, objectId, objectLiteral, confidence, importance } = body as {
      chatId:        string;
      subjectId:     string;
      predicate:     string;
      objectId?:     string | null;
      objectLiteral?:string | null;
      confidence?:   number;
      importance?:   number;
    };

    if (!chatId || !subjectId || !predicate) {
      return badRequest("chatId, subjectId and predicate are required");
    }
    // NaN passes < and > checks — require a finite number in range
    const bad01 = (v: unknown) =>
      v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1);
    if (bad01(confidence)) {
      return badRequest("confidence must be a number between 0 and 1");
    }
    if (bad01(importance)) {
      return badRequest("importance must be a number between 0 and 1");
    }
    if (objectLiteral !== undefined && objectLiteral !== null && typeof objectLiteral !== "string") {
      return badRequest("objectLiteral must be a string");
    }
    // The facts table has FK constraints on subject_id/object_id — surface a
    // clear 400 instead of an opaque SQL 500.
    store.ensureEntity(chatId, subjectId, "character", subjectId);
    if (objectId && !store.getEntity(chatId, objectId)) {
      return badRequest(`objectId "${objectId}" does not exist — create the entity first or pass objectLiteral`);
    }

    // Hand-entered facts default to HIGH importance: the user bothered to
    // type it, so it must not rank below incidental extractor output.
    const result = store.assertFact(chatId, {
      subjectId,
      predicate,
      objectId:      objectId      ?? null,
      objectLiteral: objectLiteral ?? null,
      confidence:    confidence    ?? 1.0,
      importance:    importance    ?? 0.8,
      // The user typing a fact is the one overruling a locked value
      respectLocks:  false,
    });

    return Response.json({ ok: true, ...result });
  } catch (err) {
    return routeError("[drawer/facts POST]", err);
  }
}

// DELETE /api/drawer/facts?chatId=<id>&factId=<factId>
// Removes a fact the extractor got wrong. Hard delete, not a retraction:
// these were never true, so keeping them as closed history would be a lie of
// a different shape. Predecessors this fact superseded come back.
export async function DELETE(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const chatId = params.get("chatId");
    const idRaw  = params.get("factId");
    if (!chatId || !idRaw) {
      return badRequest("chatId and factId params required");
    }
    const factId = Number(idRaw);
    if (!Number.isInteger(factId)) {
      return badRequest("factId must be an integer fact id");
    }

    const result = getStore().deleteFact(chatId, factId);
    if (!result.deleted) {
      return Response.json({ ok: false, error: `fact ${factId} not found in this chat` }, { status: 404 });
    }
    return Response.json({ ok: true, revived: result.revived });
  } catch (err) {
    return routeError("[drawer/facts DELETE]", err);
  }
}

// PATCH /api/drawer/facts
// Body: { chatId, factId, predicate?, objectLiteral?, pinned?, locked? }
// Curate a live fact. Editing its wording locks it (and ranks it up) unless
// `locked` is sent explicitly — see FableStore.updateFact. Pin and lock are
// plain booleans; anything else is refused rather than coerced.
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { chatId, factId, predicate, objectLiteral, pinned, locked } = body;
    if (typeof chatId !== "string" || !chatId || !Number.isInteger(factId)) {
      return badRequest("chatId and an integer factId are required");
    }
    for (const [name, v] of [["predicate", predicate], ["objectLiteral", objectLiteral]] as const) {
      if (v !== undefined && typeof v !== "string") return badRequest(`${name} must be a string`);
    }
    for (const [name, v] of [["pinned", pinned], ["locked", locked]] as const) {
      if (v !== undefined && typeof v !== "boolean") return badRequest(`${name} must be a boolean`);
    }
    if ([predicate, objectLiteral, pinned, locked].every((v) => v === undefined)) {
      return badRequest("nothing to change");
    }

    const store = getStore();
    const result = store.updateFact(chatId, factId as number, {
      predicate:     predicate as string | undefined,
      objectLiteral: objectLiteral as string | undefined,
      pinned:        pinned as boolean | undefined,
      locked:        locked as boolean | undefined,
    });
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ ok: false, error: result.error }, { status });
    }

    // The wording changed, so its vector is stale. Re-embed best-effort: with
    // Ollama down the fact simply ranks lexically until it next comes back.
    if (objectLiteral !== undefined || predicate !== undefined) {
      try {
        const vec = await embedText(`${result.fact.predicate} ${result.fact.objectLiteral ?? ""}`);
        if (vec) store.setFactEmbedding(chatId, result.fact.id, vecToBuffer(vec));
      } catch { /* embeddings are optional infrastructure */ }
    }
    return Response.json({ ok: true, pinned: result.fact.pinned, locked: result.fact.locked });
  } catch (err) {
    return routeError("[drawer/facts PATCH]", err);
  }
}
