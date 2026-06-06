import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { SINGLE_VALUED_PREDICATES, normPredicate } from "@/lib/db/predicates";

export const dynamic = "force-dynamic";

// GET /api/drawer/facts?subject=<id>&asOf=<unix_ts>
export async function GET(req: NextRequest) {
  try {
    const params  = req.nextUrl.searchParams;
    const subject = params.get("subject");
    if (!subject) {
      return Response.json({ error: "subject param required" }, { status: 400 });
    }
    const asOf  = params.get("asOf") ? Number(params.get("asOf")) : undefined;
    const store = getStore();
    const facts = store.queryFacts(subject, asOf);

    // Enrich with object display strings
    const enriched = facts.map((f) => ({
      ...f,
      objectDisplay: store.factObjectDisplay(f),
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

    const incomingNorm   = normPredicate(predicate);
    const isSingleValued = SINGLE_VALUED_PREDICATES.has(incomingNorm);
    const newObjectKey   = objectId ?? (objectLiteral ?? "").toLowerCase().trim();

    const existingFacts = store.queryFacts(subjectId);

    // Skip if identical live fact already exists
    const isDuplicate = existingFacts.some((ex) => {
      if (normPredicate(ex.predicate) !== incomingNorm) return false;
      const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
      return exKey === newObjectKey;
    });
    if (isDuplicate) {
      const existing = existingFacts.find((ex) => normPredicate(ex.predicate) === incomingNorm);
      return Response.json({ factId: existing?.id ?? null, duplicate: true });
    }

    // Collect prior contradicting facts to supersede (single-valued predicates only)
    const toSupersede = isSingleValued
      ? existingFacts.filter((ex) => {
          if (normPredicate(ex.predicate) !== incomingNorm) return false;
          const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
          return exKey !== newObjectKey;
        })
      : [];

    const factId = store.insertFact({
      subjectId,
      predicate,
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
