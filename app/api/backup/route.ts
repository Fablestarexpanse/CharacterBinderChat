import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { getStore, dbFilePath } from "@/lib/db";
import { routeError, guard } from "@/lib/api/server";

export const dynamic = "force-dynamic";

// ─── GET /api/backup ──────────────────────────────────────────────────────────
// A complete, consistent snapshot of the database, memory included, as one file.
// Safe to take while the app is running (SQLite's online backup). API keys are
// stripped from the copy. Restore it from Settings → Backup & restore.
//
// Written to a temp file beside the database, streamed, and removed when the
// download ends — including when the browser abandons it.

const STALE_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;

    const dir = path.dirname(dbFilePath());
    // A crash mid-download would leave its temp file behind; sweep old ones
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(".backup-")) continue;
      try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > STALE_MS) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* raced */ }
    }

    const tmp = path.join(dir, `.backup-${randomBytes(8).toString("hex")}.db`);
    await getStore().backupTo(tmp);

    const stream = fs.createReadStream(tmp);
    stream.on("close", () => fs.rm(tmp, { force: true }, () => {}));
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type":        "application/vnd.sqlite3",
        "Content-Length":      String(fs.statSync(tmp).size),
        "Content-Disposition": `attachment; filename="fablechat-backup-${stamp}.db"`,
        "Cache-Control":       "no-store",
      },
    });
  } catch (err) {
    return routeError("[backup GET]", err);
  }
}
