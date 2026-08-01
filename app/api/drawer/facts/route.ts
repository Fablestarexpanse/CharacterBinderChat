import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { normPredicate, predicateFamily, isSingleValued } from "@/lib/db/predicates";

export const dynamic = "force-dynamic";

// GET /api/drawer/facts?subject=<id>&asOf=<unix_ts>&includeSuperseded=1
// Default (no flag): returns live facts only — backward-compatible with MemoryTab.
// With includeSuperseded=1: returns all facts including superseded (bi-temporal view).
export async function GET(req: NextRequest) {
  try {
    const params            = req.nextUrl.searchParams;
    const chatId            = params.get("chat");
    const subject           = params.get("subject");
    if (!chatId || !subject) {
      return Response.json({ error: "chat and subject params required" }, { status: 400 });
    }
    const asOfRaw           = params.get("asOf");
    const asOf              = asOfRaw ? Number(asOfRaw) : undefined;
    if (asOf !== undefined && !Number.isFinite(asOf)) {
      return Response.json({ error: "asOf must be a unix timestamp" }, { status: 400 });
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
      objectDisplay: store.factObjectDisplay(chatId, f),
      confidence:    f.confidence,
      tValidStart:   f.tValidStart,
      tValidEnd:     f.tValidEnd,
      supersededBy:  f.supersededBy,
    }));
    return Response.json({ facts: enriched });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/drawer/facts
// Body: { subjectId, predicate, objectId?, objectLiteral?, confidence?, importance? }
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
      return Response.json({ error: "chatId, subjectId and predicate are required" }, { status: 400 });
    }
    // NaN passes < and > checks — require a finite number in range
    const bad01 = (v: unknown) =>
      v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1);
    if (bad01(confidence)) {
      return Response.json({ error: "confidence must be a number between 0 and 1" }, { status: 400 });
    }
    if (bad01(importance)) {
      return Response.json({ error: "importance must be a number between 0 and 1" }, { status: 400 });
    }
    if (objectLiteral !== undefined && objectLiteral !== null && typeof objectLiteral !== "string") {
      return Response.json({ error: "objectLiteral must be a string" }, { status: 400 });
    }
    // The facts table has FK constraints on subject_id/object_id — surface a
    // clear 400 instead of an opaque SQL 500.
    store.ensureEntity(chatId, subjectId, "character", subjectId);
    if (objectId && !store.getEntity(chatId, objectId)) {
      return Response.json(
        { error: `objectId "${objectId}" does not exist — create the entity first or pass objectLiteral` },
        { status: 400 }
      );
    }

    const incomingNorm   = normPredicate(predicate);
    // Compare by family so drift between equivalent predicates still supersedes
    const incomingFamily = predicateFamily(predicate);
    const singleValued   = isSingleValued(predicate);
    const newObjectKey   = objectId ?? (objectLiteral ?? "").toLowerCase().trim();

    const existingFacts = store.queryFacts(chatId, subjectId);

    // Skip if an equivalent live fact already exists
    const isDuplicate = existingFacts.some((ex) => {
      if (predicateFamily(ex.predicate) !== incomingFamily) return false;
      const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
      return exKey === newObjectKey;
    });
    if (isDuplicate) {
      // Match on family AND object key — family alone returned the id of a
      // sibling fact for multi-valued predicates ("knows kael" for "knows elen")
      const existing = existingFacts.find((ex) => {
        if (predicateFamily(ex.predicate) !== incomingFamily) return false;
        const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
        return exKey === newObjectKey;
      });
      return Response.json({ factId: existing?.id ?? null, duplicate: true });
    }

    // Collect prior contradicting facts to supersede (single-valued families only)
    const toSupersede = singleValued
      ? existingFacts.filter((ex) => {
          if (predicateFamily(ex.predicate) !== incomingFamily) return false;
          const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
          return exKey !== newObjectKey;
        })
      : [];

    // Hand-entered facts default to HIGH importance: the user bothered to
    // type it, so it must not rank below incidental extractor output.
    const factId = store.insertFact(chatId, {
      subjectId,
      predicate:     incomingNorm,
      objectId:      objectId      ?? null,
      objectLiteral: objectLiteral ?? null,
      confidence:    confidence    ?? 1.0,
      importance:    importance    ?? 0.8,
    });

    for (const old of toSupersede) {
      store.supersedeFact(old.id, factId);
    }

    return Response.json({ ok: true, factId, superseded: toSupersede.map((o) => o.id) });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/drawer/facts?chat=<id>&id=<factId>
// Removes a fact the extractor got wrong. Hard delete, not a retraction:
// these were never true, so keeping them as closed history would be a lie of
// a different shape. Predecessors this fact superseded come back.
export async function DELETE(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const chatId = params.get("chat");
    const idRaw  = params.get("id");
    if (!chatId || !idRaw) {
      return Response.json({ error: "chat and id params required" }, { status: 400 });
    }
    const factId = Number(idRaw);
    if (!Number.isInteger(factId)) {
      return Response.json({ error: "id must be an integer fact id" }, { status: 400 });
    }

    const result = getStore().deleteFact(chatId, factId);
    if (!result.deleted) {
      return Response.json({ error: `fact ${factId} not found in this chat` }, { status: 404 });
    }
    return Response.json({ ok: true, revived: result.revived });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
