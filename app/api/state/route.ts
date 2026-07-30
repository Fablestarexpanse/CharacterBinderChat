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
    const body = await req.json() as { characters?: unknown; chats?: unknown; personas?: unknown };
    const characters = Array.isArray(body.characters) ? body.characters as Array<{ id: string }> : null;
    const chats      = Array.isArray(body.chats)      ? body.chats      as Array<{ id: string; messages?: Array<{ id: string }> }> : null;
    const personas   = Array.isArray(body.personas)   ? body.personas   as Array<{ id: string }> : [];

    if (!characters || !chats) {
      return Response.json({ error: "characters and chats arrays are required" }, { status: 400 });
    }
    if (characters.some((c) => !c?.id) || chats.some((c) => !c?.id) || personas.some((p) => !p?.id)) {
      return Response.json({ error: "every character, chat and persona needs an id" }, { status: 400 });
    }

    const store = getStore();

    if (characters.length === 0 && chats.length === 0 && personas.length === 0) {
      const existing = store.getAppState();
      if (existing.characters.length > 0 || existing.chats.length > 0 || existing.personas.length > 0) {
        return Response.json(
          { error: "refusing to replace existing data with an empty state" },
          { status: 409 }
        );
      }
    }

    store.replaceAppState(characters, chats, personas);
    // Deleting a chat must also delete its memory — orphaned drawer rows would
    // otherwise linger forever and resurface in "continue with memories" lists.
    const purged = store.purgeOrphanedChatMemory();
    return Response.json({
      ok: true,
      characters: characters.length,
      chats: chats.length,
      personas: personas.length,
      ...(purged.length > 0 ? { purgedChatMemory: purged } : {}),
    });
  } catch (err) {
    console.error("[state PUT]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
