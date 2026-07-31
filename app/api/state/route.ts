import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── GET /api/state ───────────────────────────────────────────────────────────
// Returns the durable copy of characters + chats (messages nested).
// ?download=1 serves it as a JSON attachment for backups.

export async function GET(req: NextRequest) {
  try {
    const state = getStore().getAppState();

    if (req.nextUrl.searchParams.get("download") === "1") {
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(JSON.stringify(state, null, 2), {
        headers: {
          "Content-Type":        "application/json",
          "Content-Disposition": `attachment; filename="fablechat-export-${stamp}.json"`,
        },
      });
    }

    return Response.json(state);
  } catch (err) {
    console.error("[state GET]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// ─── PUT /api/state ───────────────────────────────────────────────────────────
// Full-replace sync from the client store. Body: { characters, chats }.
// Refuses an empty payload when data already exists — a client-side bug must
// not be able to silently wipe the durable copy.

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as { characters?: unknown; chats?: unknown; personas?: unknown; lorebooks?: unknown };
    const characters = Array.isArray(body.characters) ? body.characters as Array<{ id: string }> : null;
    const chats      = Array.isArray(body.chats)      ? body.chats      as Array<{ id: string; messages?: Array<{ id: string }> }> : null;
    const personas   = Array.isArray(body.personas)   ? body.personas   as Array<{ id: string }> : [];
    const lorebooks  = Array.isArray(body.lorebooks)  ? body.lorebooks  as Array<{ id: string }> : [];

    if (!characters || !chats) {
      return Response.json({ error: "characters and chats arrays are required" }, { status: 400 });
    }
    if (
      characters.some((c) => !c?.id) || chats.some((c) => !c?.id) ||
      personas.some((p) => !p?.id) || lorebooks.some((l) => !l?.id)
    ) {
      return Response.json({ error: "every character, chat, persona and lorebook needs an id" }, { status: 400 });
    }

    const store = getStore();

    // Wipe guard, per collection: a client bug that sends one empty array
    // alongside valid ones would otherwise mass-delete that collection (and
    // purgeOrphanedChatMemory would then destroy the chats' memory too).
    // Deleting the last one-or-two items by hand is legitimate; going from
    // 3+ straight to zero in a single sync is a bug signature.
    const existing = store.getAppState();
    const suspicious = (
      [
        ["chats", chats.length, existing.chats.length],
        ["characters", characters.length, existing.characters.length],
        ["personas", personas.length, existing.personas.length],
        ["lorebooks", lorebooks.length, existing.lorebooks.length],
      ] as Array<[string, number, number]>
    ).find(([, incoming, current]) => incoming === 0 && current >= 3);
    if (suspicious) {
      return Response.json(
        {
          error: `refusing to wipe all ${suspicious[0]} (${suspicious[2]} exist) in one sync — ` +
                 `if this deletion is intentional, remove the last items individually`,
        },
        { status: 409 }
      );
    }

    store.replaceAppState(characters, chats, personas, lorebooks);
    // Deleting a chat must also delete its memory — orphaned drawer rows would
    // otherwise linger forever and resurface in "continue with memories" lists.
    const purged = store.purgeOrphanedChatMemory();
    return Response.json({
      ok: true,
      characters: characters.length,
      chats: chats.length,
      personas: personas.length,
      lorebooks: lorebooks.length,
      ...(purged.length > 0 ? { purgedChatMemory: purged } : {}),
    });
  } catch (err) {
    console.error("[state PUT]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
