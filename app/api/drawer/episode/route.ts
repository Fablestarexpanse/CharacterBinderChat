import { NextRequest } from "next/server";
import { badRequest, parseMemoryTaskRequest, routeError, upstreamError } from "@/lib/api/server";
import { writeEpisode } from "@/lib/server/episodeWriter";

export const dynamic = "force-dynamic";

// ─── POST /api/drawer/episode ─────────────────────────────────────────────────
// Writes an EPISODIC memory: a scene card capturing what just happened as an
// event, not a fact. Facts hold "Kira fears deep water"; only an episode can
// hold "the night the crossing flooded and she froze on the bank" — and
// "remember when we…" is the texture of a relationship. Called by the client
// every ~8 exchanges. Stored in memory_cards (tag "episode").
//
// mode: "reflect" instead synthesizes an INSIGHT — a pattern the character has
// noticed across recent events ("Kira consistently avoids water routes") —
// stored with tag "reflection". Called every ~24 exchanges.
//
// The pipeline itself is lib/server/episodeWriter.ts; this route validates the
// envelope and maps the result onto a status.

export async function POST(req: NextRequest) {
  try {
    const task = parseMemoryTaskRequest(await req.json(), { requireMessages: false });
    if (!task.ok) return task.response;

    const mode = task.value.mode ?? "episode";
    if (mode !== "reflect" && !task.value.messages?.length) {
      return badRequest("messages required for episode mode");
    }

    let result;
    try {
      result = await writeEpisode(task.value);
    } catch (err) {
      // The model was unreachable — distinct from a reply we could not parse.
      return upstreamError("[drawer/episode]", err);
    }

    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return routeError("[drawer/episode]", err);
  }
}
