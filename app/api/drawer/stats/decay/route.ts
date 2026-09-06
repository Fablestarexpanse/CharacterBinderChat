import { getStore } from "@/lib/db";
import { routeError } from "@/lib/api/server";

export const dynamic = "force-dynamic";

// POST /api/drawer/stats/decay
// Applies Ebbinghaus decay across ALL chats — deliberately unscoped, because
// it runs once per app session (lazy decay on first mount) and elapsed time
// has passed for every chat equally. Decay is computed per-row from each
// stat's own last_updated timestamp, so no body parameters are needed.
export async function POST() {
  try {
    const store   = getStore();
    const changes = store.applyDecay();
    return Response.json({ ok: true, changes });
  } catch (err) {
    return routeError("[drawer/stats/decay POST]", err);
  }
}
