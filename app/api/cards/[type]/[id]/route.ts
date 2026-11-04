import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest } from "@/lib/api/server";
import { isCardType, getCard, updateCard, deleteCard, cleanSource, CardError, CARD_TYPES } from "@/lib/server/cards";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ type: string; id: string }> };

const fail = (err: unknown, label: string) =>
  err instanceof CardError ? Response.json({ ok: false, error: err.message }, { status: err.status }) : routeError(label, err);

// GET /api/cards/<type>/<id>  → the card in its interchange format
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { type, id } = await params;
    if (!isCardType(type)) return badRequest(`type must be one of: ${CARD_TYPES.join(", ")}`);
    return Response.json({ card: getCard(getStore(), type, id) });
  } catch (err) { return fail(err, "[cards/id GET]"); }
}

// PATCH /api/cards/<type>/<id>   body: { changes: {...} }
// Shallow-merge card-format fields. Unknown fields are refused with the list of
// allowed ones. The previous version is kept so the change can be undone.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { type, id } = await params;
    if (!isCardType(type)) return badRequest(`type must be one of: ${CARD_TYPES.join(", ")}`);
    const body = await req.json().catch(() => null) as { changes?: unknown } | null;
    if (!body || body.changes === undefined) return badRequest("body must be { changes: {...} }");
    const updated = updateCard(getStore(), type, id, body.changes, cleanSource(req.headers.get("x-fable-source")));
    return Response.json({ ok: true, ...updated });
  } catch (err) { return fail(err, "[cards/id PATCH]"); }
}

// DELETE /api/cards/<type>/<id>  — reversible: the card is kept in history
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const { type, id } = await params;
    if (!isCardType(type)) return badRequest(`type must be one of: ${CARD_TYPES.join(", ")}`);
    const removed = deleteCard(getStore(), type, id, cleanSource(req.headers.get("x-fable-source")));
    return Response.json({ ok: true, ...removed });
  } catch (err) { return fail(err, "[cards/id DELETE]"); }
}
