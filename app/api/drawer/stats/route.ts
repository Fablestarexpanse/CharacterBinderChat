import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { STAT_NAMES } from "@/lib/db/models";
import { routeError } from "@/lib/api";

export const dynamic = "force-dynamic";

// GET /api/drawer/stats?observer=<id>&target=<id>
export async function GET(req: NextRequest) {
  try {
    const params   = req.nextUrl.searchParams;
    const chatId   = params.get("chatId");
    const observer = params.get("observer");
    const target   = params.get("target");
    if (!chatId || !observer || !target) {
      return Response.json({ ok: false, error: "chatId, observer and target params required" }, { status: 400 });
    }
    const store = getStore();
    const statsMap = store.queryStats(chatId, observer, target);

    // Return all five axes (null value for axes not yet set)
    const stats = STAT_NAMES.map((name) => ({
      name,
      ...(statsMap[name]
        ? {
            value:       statsMap[name]!.value,
            decayRate:   statsMap[name]!.decayRate,
            lastUpdated: statsMap[name]!.lastUpdated,
          }
        : { value: null, decayRate: null, lastUpdated: null }),
    }));

    return Response.json({ stats });
  } catch (err) {
    return routeError("[drawer/stats GET]", err);
  }
}

// There was a POST here that wrote stats directly, including an absolute-set
// path through setStat. Nothing ever called it, and it bypassed deltaStat's
// headroom scaling, loss aversion and rupture refractory — exactly the
// footgun AGENTS.md warns against. Stats are written by extraction only; if
// manual adjustment is wanted later it must go through deltaStat.
