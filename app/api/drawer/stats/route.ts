import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import type { StatName } from "@/lib/db/models";
import { STAT_NAMES } from "@/lib/db/models";

export const dynamic = "force-dynamic";

// GET /api/drawer/stats?observer=<id>&target=<id>
export async function GET(req: NextRequest) {
  try {
    const params   = req.nextUrl.searchParams;
    const observer = params.get("observer");
    const target   = params.get("target");
    if (!observer || !target) {
      return Response.json({ error: "observer and target params required" }, { status: 400 });
    }
    const store = getStore();
    const statsMap = store.queryStats(observer, target);

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
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/drawer/stats
// Body: { observer, target, stat, value }   (absolute set)
// Body: { observer, target, stat, delta }   (relative delta)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { observer, target, stat } = body as {
      observer: string; target: string; stat: StatName;
    };
    if (!observer || !target || !stat) {
      return Response.json({ error: "observer, target and stat required" }, { status: 400 });
    }
    const store = getStore();
    let updated;
    if (typeof body.delta === "number") {
      updated = store.deltaStat(observer, target, stat, body.delta);
    } else if (typeof body.value === "number") {
      updated = store.setStat(observer, target, stat, body.value);
    } else {
      return Response.json({ error: "Either value or delta is required" }, { status: 400 });
    }
    return Response.json({ stat: updated });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
