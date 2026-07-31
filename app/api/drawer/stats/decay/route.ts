import { getStore } from "@/lib/db";

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
    return Response.json({ changes });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
