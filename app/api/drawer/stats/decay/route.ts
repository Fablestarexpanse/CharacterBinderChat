import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/drawer/stats/decay
// Body: { days: number }
export async function POST(req: NextRequest) {
  try {
    const { days } = (await req.json()) as { days: number };
    if (typeof days !== "number" || days < 0) {
      return Response.json({ error: "days must be a non-negative number" }, { status: 400 });
    }
    const store   = getStore();
    const changes = store.applyDecay(days);
    return Response.json({ changes });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
