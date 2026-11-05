import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { listForClient, removeConnection, saveConnection, setDefaults } from "@/lib/server/mediaConnections";

export const dynamic = "force-dynamic";

// ─── /api/media/connections ───────────────────────────────────────────────────
// GET    → { connections, defaults }   (keys are never returned, only hasKey)
// PUT    { connection?, key?, defaults? } → save a connection and/or change defaults
//        defaults is a patch: { photo: "id" } sets one, { photo: null } clears it
//        key: omitted keeps the stored one, "" removes it
// DELETE ?id=… → remove a connection, its key, and any default pointing at it

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    return Response.json(listForClient());
  } catch (err) {
    return routeError("[media/connections GET]", err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await req.json()) as { connection?: unknown; key?: unknown; defaults?: unknown };
    if (body.connection === undefined && body.defaults === undefined) return badRequest("connection or defaults is required");
    if (body.key !== undefined && typeof body.key !== "string") return badRequest("key must be a string");
    if (body.connection !== undefined) {
      const r = saveConnection(body.connection, body.key as string | undefined);
      if (!r.ok) return Response.json({ ok: false, error: r.errors.join(" "), errors: r.errors }, { status: 400 });
    }
    if (body.defaults !== undefined) setDefaults(body.defaults);
    return Response.json({ ok: true, ...listForClient() });
  } catch (err) {
    return routeError("[media/connections PUT]", err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return badRequest("id is required");
    removeConnection(id);
    return Response.json({ ok: true, ...listForClient() });
  } catch (err) {
    return routeError("[media/connections DELETE]", err);
  }
}
