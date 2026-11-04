import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest, guard } from "@/lib/api/server";
import type { PersistedAppState } from "@/lib/types";
import { APP_COLLECTIONS } from "@/lib/db/appState";

export const dynamic = "force-dynamic";

// ─── GET /api/state ───────────────────────────────────────────────────────────
// Returns the durable copy of characters + chats (messages nested).
// ?download=1 serves it as a JSON attachment for backups.

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const store = getStore();
    // Revision first: if a write lands between the two reads the client ends up
    // with data newer than its revision, and the next pull merely re-applies it.
    // The other order would let it claim a revision whose data it never received.
    const rev = store.rev();
    const state = store.getAppState();

    if (req.nextUrl.searchParams.get("download") === "1") {
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(JSON.stringify(state, null, 2), {
        headers: {
          "Content-Type":        "application/json",
          "Content-Disposition": `attachment; filename="fablechat-export-${stamp}.json"`,
        },
      });
    }

    return Response.json({ ...state, rev, epoch: store.epoch() });
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
    const denied = guard(req);
    if (denied) return denied;
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
      return badRequest("characters and chats arrays are required");
    }
    const missingId =
      chats.some((c) => !c?.id) ||
      APP_COLLECTIONS.some(([field]) => collections[field].some((row) => !row?.id));
    if (missingId) {
      return badRequest("every chat and every characters/personas/lorebooks/scenarios/presets entry needs an id");
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
      rev: store.rev(),
      ...Object.fromEntries(counts.map(([name, incoming]) => [name, incoming])),
      ...(purged.length > 0 ? { purgedChatMemory: purged } : {}),
    });
  } catch (err) {
    return routeError("[state PUT]", err);
  }
}

// ─── PATCH /api/state ─────────────────────────────────────────────────────────
// Incremental sync: only the rows that changed since the client's last save.
// Body: { upserts?, removals?, order?, defaultPresetId?, globalInstructions? },
// each keyed by collection name (characters, chats, personas, lorebooks,
// scenarios, presets). PUT stays for first-run seeding.

const PATCH_NAMES = ["chats", ...APP_COLLECTIONS.map(([f]) => f)];

export async function PATCH(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = await req.json() as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return badRequest("patch body must be an object");

    const isMap = (v: unknown): v is Record<string, unknown> =>
      v === undefined || (typeof v === "object" && v !== null && !Array.isArray(v));
    const { upserts, removals, order } = body;
    if (!isMap(upserts) || !isMap(removals) || !isMap(order)) {
      return badRequest("upserts, removals and order must be objects keyed by collection");
    }
    for (const map of [upserts, removals, order]) {
      for (const [name, rows] of Object.entries(map ?? {})) {
        if (!PATCH_NAMES.includes(name)) return badRequest(`unknown collection "${name}"`);
        if (!Array.isArray(rows)) return badRequest(`${name} must be an array`);
      }
    }
    for (const [name, rows] of Object.entries(upserts ?? {})) {
      if ((rows as Array<{ id?: unknown }>).some((r) => !r || typeof r.id !== "string" || !r.id)) {
        return badRequest(`every ${name} entry needs an id`);
      }
    }
    for (const map of [removals, order]) {
      for (const [name, ids] of Object.entries(map ?? {})) {
        if ((ids as unknown[]).some((id) => typeof id !== "string")) return badRequest(`${name} ids must be strings`);
      }
    }

    const patch = {
      upserts, removals, order,
      defaultPresetId:
        body.defaultPresetId === undefined ? undefined
        : typeof body.defaultPresetId === "string" ? body.defaultPresetId : null,
      globalInstructions:
        typeof body.globalInstructions === "object" && body.globalInstructions !== null
          ? body.globalInstructions as PersistedAppState["globalInstructions"] : undefined,
    } as Parameters<ReturnType<typeof getStore>["patchAppState"]>[0];

    const store = getStore();

    // Same wipe guard as PUT, applied to what the collection would become.
    const { before, after } = store.countAfterPatch(patch);
    const suspicious = PATCH_NAMES.find((n) => after[n] === 0 && before[n] >= 3);
    if (suspicious) {
      return Response.json(
        {
          ok: false,
          error: `refusing to wipe all ${suspicious} in one sync — ` +
                 `if this deletion is intentional, remove the last items individually`,
        },
        { status: 409 }
      );
    }

    // baseRev: the revision this client last synced to. Present, it turns a write
    // over a row someone else changed into a reported conflict (server wins for
    // shared content) instead of a silent overwrite.
    const baseRev = typeof body.baseRev === "number" && Number.isInteger(body.baseRev) ? body.baseRev : undefined;
    const result = store.patchAppState(patch, { baseRev });
    const purged = store.purgeOrphanedChatMemory();
    return Response.json({
      ok: true,
      rev: result.rev,
      prevRev: result.prevRev,
      conflicts: result.conflicts,
      ...(purged.length > 0 ? { purgedChatMemory: purged } : {}),
    });
  } catch (err) {
    return routeError("[state PATCH]", err);
  }
}
