import { NextRequest } from "next/server";
import path from "node:path";
import { getStore } from "@/lib/db";
import { routeError, badRequest } from "@/lib/api/server";
import { decryptSecret, encryptSecret, loadKey } from "@/lib/server/secrets";

export const dynamic = "force-dynamic";

// ─── /api/secrets ─────────────────────────────────────────────────────────────
// API keys, encrypted at rest (lib/server/secrets.ts). The browser calls
// providers directly, so it does need the plaintext at runtime — it is fetched
// into memory on load and no longer written to localStorage.
//
// A whitelist of names, not arbitrary keys: this must not become a general
// write path into app_kv.

const NAMES = ["openrouterApiKey"] as const;
type Name = (typeof NAMES)[number];

const keyDir = () => path.dirname(process.env.FABLE_DB_PATH ?? path.join(process.cwd(), "data", "x"));
const kvKey = (n: Name) => `secret:${n}`;

export async function GET() {
  try {
    const store = getStore();
    const key = loadKey(keyDir());
    const out: Record<Name, string | null> = { openrouterApiKey: null };
    for (const name of NAMES) {
      const blob = store.getKv(kvKey(name));
      out[name] = blob ? decryptSecret(blob, key) : null;
    }
    return Response.json(out);
  } catch (err) {
    return routeError("[secrets GET]", err);
  }
}

// Body: { openrouterApiKey: string } — an empty string removes it.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const names = NAMES.filter((n) => body[n] !== undefined);
    if (names.length === 0) return badRequest(`one of ${NAMES.join(", ")} is required`);
    for (const n of names) if (typeof body[n] !== "string") return badRequest(`${n} must be a string`);

    const store = getStore();
    const key = loadKey(keyDir());
    for (const n of names) {
      const value = (body[n] as string).trim();
      store.setKv(kvKey(n), value ? encryptSecret(value, key) : null);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return routeError("[secrets PUT]", err);
  }
}
