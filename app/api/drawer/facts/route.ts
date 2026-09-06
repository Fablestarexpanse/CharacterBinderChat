import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError } from "@/lib/api/server";
import type { DrawerFact } from "@/lib/api/dto";

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
      return Response.json({ ok: false, error: "chatId and subject params required" }, { status: 400 });
    }
    const asOfRaw           = params.get("asOf");
    const asOf              = asOfRaw ? Number(asOfRaw) : undefined;
    if (asOf !== undefined && !Number.isFinite(asOf)) {
      return Response.json({ ok: false, error: "asOf must be a unix timestamp" }, { status: 400 });
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
      return Response.json({ ok: false, error: "chatId, subjectId and predicate are required" }, { status: 400 });
    }
    // NaN passes < and > checks — require a finite number in range
    const bad01 = (v: unknown) =>
      v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1);
    if (bad01(confidence)) {
      return Response.json({ ok: false, error: "confidence must be a number between 0 and 1" }, { status: 400 });
    }
    if (bad01(importance)) {
      return Response.json({ ok: false, error: "importance must be a number between 0 and 1" }, { status: 400 });
    }
    if (objectLiteral !== undefined && objectLiteral !== null && typeof objectLiteral !== "string") {
      return Response.json({ ok: false, error: "objectLiteral must be a string" }, { status: 400 });
    }
    // The facts table has FK constraints on subject_id/object_id — surface a
    // clear 400 instead of an opaque SQL 500.
    store.ensureEntity(chatId, subjectId, "character", subjectId);
    if (objectId && !store.getEntity(chatId, objectId)) {
      return Response.json(
        { ok: false, error: `objectId "${objectId}" does not exist — create the entity first or pass objectLiteral` },
        { status: 400 }
      );
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
      return Response.json({ ok: false, error: "chatId and factId params required" }, { status: 400 });
    }
    const factId = Number(idRaw);
    if (!Number.isInteger(factId)) {
      return Response.json({ ok: false, error: "factId must be an integer fact id" }, { status: 400 });
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
