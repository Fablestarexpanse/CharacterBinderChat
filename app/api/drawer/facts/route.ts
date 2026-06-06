import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";

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
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const store = getStore();
    const factId = store.insertFact({
      subjectId:     body.subjectId,
      predicate:     body.predicate,
      objectId:      body.objectId      ?? null,
      objectLiteral: body.objectLiteral ?? null,
      confidence:    body.confidence    ?? 1.0,
      knownTo:       body.knownTo       ?? [],
    });
    return Response.json({ factId });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
