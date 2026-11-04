import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { closeStore, dbFilePath } from "@/lib/db";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { inspectBackup, swapInDatabase } from "@/lib/db/backup";

export const dynamic = "force-dynamic";

// ─── POST /api/backup/restore ─────────────────────────────────────────────────
// Two steps, so a person sees what is in a file before it replaces anything:
//
//   POST ?stage=1          body: the backup file (raw bytes)
//        → { ok, token, summary }   the file is checked and held, nothing replaced
//   POST                   body: { token }, header X-Confirm-Restore: replace-everything
//        → { ok, summary, safetyCopy }   the database is swapped; tabs reload
//
// The database being replaced is renamed, never deleted, and the last few are kept
// beside it (fablestore.db.pre-restore-…) so a mistake can be undone by hand.

const MAX_BYTES = 2 * 1024 * 1024 * 1024;     // 2 GB: a heavy library is tens of MB
const STAGED_TTL_MS = 15 * 60 * 1000;
const TOKEN = /^[0-9a-f]{32}$/;

const stagedPath = (dir: string, token: string) => path.join(dir, `.staged-${token}.db`);

function sweepStaged(dir: string) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith(".staged-")) continue;
    try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > STAGED_TTL_MS) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* raced */ }
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;

    const livePath = dbFilePath();
    const dir = path.dirname(livePath);
    sweepStaged(dir);

    // ── Step 1: receive and inspect ────────────────────────────────────────
    if (req.nextUrl.searchParams.get("stage") === "1") {
      if (!req.body) return badRequest("send the backup file as the request body");
      const declared = Number(req.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_BYTES) return badRequest("that file is larger than the 2 GB limit");

      const token = randomBytes(16).toString("hex");
      const dest = stagedPath(dir, token);
      let received = 0;
      const cap = new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          // Counted as it arrives: a missing or false Content-Length does not get around the cap
          if (received > MAX_BYTES) cb(new Error("that file is larger than the 2 GB limit")); else cb(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(req.body as never), cap, fs.createWriteStream(dest));
      } catch (e) {
        fs.rmSync(dest, { force: true });
        return badRequest(e instanceof Error ? e.message : "the upload failed");
      }
      const result = inspectBackup(dest);
      if (!result.ok) {
        fs.rmSync(dest, { force: true });
        return badRequest(result.error);
      }
      return Response.json({ ok: true, token, summary: result.summary });
    }

    // ── Step 2: confirm and swap ───────────────────────────────────────────
    if (req.headers.get("x-confirm-restore") !== "replace-everything") {
      return badRequest("restoring replaces everything; confirm with the X-Confirm-Restore: replace-everything header");
    }
    const body = await req.json().catch(() => null) as { token?: unknown } | null;
    if (!body || typeof body.token !== "string" || !TOKEN.test(body.token)) return badRequest("token (from the staging step) is required");
    const staged = stagedPath(dir, body.token);
    if (!fs.existsSync(staged)) return badRequest("that upload has expired or was already used; choose the file again");

    const result = swapInDatabase({ livePath, stagedPath: staged, closeLive: closeStore });
    return Response.json({ ok: true, summary: result.summary, safetyCopy: path.basename(result.preRestorePath) });
  } catch (err) {
    return routeError("[backup/restore POST]", err);
  }
}
