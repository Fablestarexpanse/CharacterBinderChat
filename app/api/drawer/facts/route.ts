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
    const subject           = params.get("subject");
    if (!subject) {
      return Response.json({ error: "subject param required" }, { status: 400 });
    }
    const asOf              = params.get("asOf") ? Number(params.get("asOf")) : undefined;
    const includeSuperseded = params.get("includeSuperseded") === "1";
    const store             = getStore();

    const facts = includeSuperseded
      ? store.queryFactsIncludingSuperseded(subject)
      : store.queryFacts(subject, asOf);

    // Enrich with object display and expose bi-temporal columns the inspector needs
    const enriched = facts.map((f) => ({
      id:            f.id,
      predicate:     f.predicate,
      objectDisplay: store.factObjectDisplay(f),
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
// Body: { subjectId, predicate, objectId?, objectLiteral?, confidence?, knownTo? }
// Applies the same dedup + supersession logic as the extract route so the
// single-valued predicate invariant is enforced regardless of call path.
export async function POST(req: NextRequest) {
  try {
    const body  = await req.json();
    const store = getStore();

    const { subjectId, predicate, objectId, objectLiteral, confidence, knownTo } = body as {
      subjectId:     string;
      predicate:     string;
      objectId?:     string | null;
      objectLiteral?:string | null;
      confidence?:   number;
      knownTo?:      string[];
    };

    if (!subjectId || !predicate) {
      return Response.json({ error: "subjectId and predicate are required" }, { status: 400 });
    }
    if (confidence !== undefined && (typeof confidence !== "number" || confidence < 0 || confidence > 1)) {
      return Response.json({ error: "confidence must be a number between 0 and 1" }, { status: 400 });
    }
    // The facts table has FK constraints on subject_id/object_id — surface a
    // clear 400 instead of an opaque SQL 500.
    store.ensureEntity(subjectId, "character", subjectId);
    if (objectId && !store.getEntity(objectId)) {
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

    const existingFacts = store.queryFacts(subjectId);

    // Skip if an equivalent live fact already exists
    const isDuplicate = existingFacts.some((ex) => {
      if (predicateFamily(ex.predicate) !== incomingFamily) return false;
      const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
      return exKey === newObjectKey;
    });
    if (isDuplicate) {
      const existing = existingFacts.find((ex) => predicateFamily(ex.predicate) === incomingFamily);
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

    const factId = store.insertFact({
      subjectId,
      predicate:     incomingNorm,
      objectId:      objectId      ?? null,
      objectLiteral: objectLiteral ?? null,
      confidence:    confidence    ?? 1.0,
      knownTo:       knownTo       ?? [],
    });

    for (const old of toSupersede) {
      store.supersedeFact(old.id, factId);
    }

    return Response.json({ factId, superseded: toSupersede.map((o) => o.id) });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
