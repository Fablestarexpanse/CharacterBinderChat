import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError } from "@/lib/api";
import type { PersistedAppState } from "@/lib/types";
import { APP_COLLECTIONS } from "@/lib/db/appState";

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
    return routeError("[state GET]", err);
  }
}

// ─── PUT /api/state ───────────────────────────────────────────────────────────
// Full-replace sync from the client store.
// Body: { characters, chats, personas?, lorebooks?, scenarios?, presets?,
//         defaultPresetId?, globalInstructions? } — characters and chats required.
// Refuses an empty payload when data already exists — a client-side bug must
// not be able to silently wipe the durable copy.

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;

    // Only the ids are checked — the client is the only writer and the durable
    // copy mirrors its store — so an array of things with ids is taken at its
    // declared type. Chats carry nested messages; every other collection is
    // flat and comes from APP_COLLECTIONS.
    const asRows = (v: unknown) => (Array.isArray(v) ? v as Array<{ id?: string }> : null);

    const chats = asRows(body.chats) as PersistedAppState["chats"] | null;
    const collections = Object.fromEntries(
      APP_COLLECTIONS.map(([field]) => [field, asRows(body[field]) ?? []])
    ) as { [K in (typeof APP_COLLECTIONS)[number][0]]: PersistedAppState[K] };

    if (!chats || !Array.isArray(body.characters)) {
      return Response.json({ ok: false, error: "characters and chats arrays are required" }, { status: 400 });
    }
    const missingId =
      chats.some((c) => !c?.id) ||
      APP_COLLECTIONS.some(([field]) => collections[field].some((row) => !row?.id));
    if (missingId) {
      return Response.json(
        { ok: false, error: "every chat and every characters/personas/lorebooks/scenarios/presets entry needs an id" },
        { status: 400 }
      );
    }

    // Singletons: absent means "leave alone", so distinguish undefined from null
    const defaultPresetId =
      body.defaultPresetId === undefined ? undefined
      : typeof body.defaultPresetId === "string" ? body.defaultPresetId
      : null;
    const globalInstructions =
      body.globalInstructions !== undefined && typeof body.globalInstructions === "object" && body.globalInstructions !== null
        ? body.globalInstructions as PersistedAppState["globalInstructions"]
        : undefined;

    const store = getStore();

    // Wipe guard, per collection: a client bug that sends one empty array
    // alongside valid ones would otherwise mass-delete that collection (and
    // purgeOrphanedChatMemory would then destroy the chats' memory too).
    // Deleting the last one-or-two items by hand is legitimate; going from
    // 3+ straight to zero in a single sync is a bug signature.
    const existing = store.getAppState();
    const counts: Array<[string, number, number]> = [
      ["chats", chats.length, existing.chats.length],
      ...APP_COLLECTIONS.map(([field]) =>
        [field, collections[field].length, existing[field].length] as [string, number, number]),
    ];
    const suspicious = counts.find(([, incoming, current]) => incoming === 0 && current >= 3);
    if (suspicious) {
      return Response.json(
        {
          ok: false,
          error: `refusing to wipe all ${suspicious[0]} (${suspicious[2]} exist) in one sync — ` +
                 `if this deletion is intentional, remove the last items individually`,
        },
        { status: 409 }
      );
    }

    store.replaceAppState({ ...collections, chats, defaultPresetId, globalInstructions });
    // Deleting a chat must also delete its memory — orphaned drawer rows would
    // otherwise linger forever and resurface in "continue with memories" lists.
    const purged = store.purgeOrphanedChatMemory();
    return Response.json({
      ok: true,
      ...Object.fromEntries(counts.map(([name, incoming]) => [name, incoming])),
      ...(purged.length > 0 ? { purgedChatMemory: purged } : {}),
    });
  } catch (err) {
    return routeError("[state PUT]", err);
  }
}
