import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { validateConnection } from "@/lib/media/connections";
import { connectionKey, listConnections, testConnection } from "@/lib/server/mediaConnections";

export const dynamic = "force-dynamic";

// ─── POST /api/media/test ─────────────────────────────────────────────────────
// { id }                       → test a saved connection
// { connection, key? }         → test the form before saving (key omitted: the
//                                stored key for that id, if any)
// Always 200 with { ok, label, sample? }: a failing service is a result to show,
// not an error in FableChat. A real call is made, so a cloud test may cost a
// little (one small image or one sentence of speech).

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await req.json()) as { id?: unknown; connection?: unknown; key?: unknown };
    let conn;
    if (body.connection !== undefined) {
      const v = validateConnection(body.connection);
      if (!v.ok) return badRequest(v.errors.join(" "));
      conn = v.value;
    } else if (typeof body.id === "string") {
      conn = listConnections().find((c) => c.id === body.id);
      if (!conn) return badRequest("no such connection");
    } else {
      return badRequest("id or connection is required");
    }
    const key = typeof body.key === "string" && body.key.trim() ? body.key.trim() : connectionKey(conn.id);
    return Response.json(await testConnection(conn, key));
  } catch (err) {
    return routeError("[media/test POST]", err);
  }
}
