#!/usr/bin/env node
// ─── FableChat: start ─────────────────────────────────────────────────────────
// Runs the app; installs and builds nothing (that is install and update):
//   • checks Node is new enough, and says where to get it if not
//   • refuses, saying what to run, when FableChat was never installed
//   • says so when there is code here that is not built yet (run update)
//   • starts it on 127.0.0.1, or, if FableChat is already running, just opens it
//   • opens your browser
//
// Used by start.sh and start.bat; also fine to run directly:  node scripts/start.mjs
// Options: --port N   --no-open
//
// Node is spawned directly, never through a shell: a shell wrapper around the server
// orphaned real servers three separate times (see AGENTS.md), and Next refuses to
// start while an orphan owns .next.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { choosePort, openCommand } from "./launcher-lib.mjs";
import { buildCurrent, buildPresent, checkNode, depsCurrent, depsPresent, fail, root, say, script } from "./setup-steps.mjs";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

// ── 1. Node ──────────────────────────────────────────────────────────────────
checkNode();

// ── 2. Installed and built? Never fixed here: install and update do that ───────
if (!depsPresent() || !buildPresent()) {
  fail(`FableChat is not installed yet. Run ${script("install")} first (once), then ${script("start")}.`);
}
if (!depsCurrent() || !buildCurrent()) {
  say(`Note: there are changes here that are not built yet, so you get the last build. Run ${script("update")} to build them.`);
}

// ── 3. Where to serve ────────────────────────────────────────────────────────
const wanted = Number(valueOf("--port") ?? process.env.PORT ?? 3000);

/** What is listening on a port: nothing, FableChat, or something else. */
async function probe(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/state/changes?since=999999999`, { signal: AbortSignal.timeout(1500) });
    // FableChat answers with its revision, or (behind a password) a challenge that names it
    if (res.status === 401 && /FableChat/.test(res.headers.get("www-authenticate") ?? "")) return "fablechat";
    const body = await res.json().catch(() => null);
    return body && typeof body.rev === "number" && typeof body.epoch === "string" ? "fablechat" : "other";
  } catch (e) {
    // Refused: nothing is there. Anything else (a timeout, a reset): something is, and it is not ours.
    return e?.cause?.code === "ECONNREFUSED" ? "free" : "other";
  }
}

const picked = await choosePort(wanted, probe);
if (!picked) fail(`Could not find a free port starting at ${wanted}. Close something using it, or pick another with --port.`);
const url = `http://localhost:${picked.port}`;

function openBrowser() {
  if (flag("--no-open")) return;
  const { cmd, args: a } = openCommand(url);
  try { spawn(cmd, a, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* the URL is printed anyway */ }
}

if (picked.running) {
  say(`FableChat is already running at ${url}. Opening it.`);
  openBrowser();
  process.exit(0);
}
if (picked.port !== wanted) say(`Port ${wanted} is in use by something else, so FableChat will use ${picked.port}.`);

// ── 4. Run ───────────────────────────────────────────────────────────────────
const nextBin = require.resolve("next/dist/bin/next", { paths: [root] });
const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(picked.port)], { cwd: root, stdio: "inherit", env: process.env });

// Take the server down with us. An orphaned server keeps the port and the database.
let stopping = false;
const stop = (signal) => { if (stopping) return; stopping = true; child.kill(signal); };
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(sig));
process.on("exit", () => { if (!child.killed) child.kill(); });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : 1)));

// Open the browser only once it answers: a tab opened too early shows a connection error.
const deadline = Date.now() + 60_000;
for (;;) {
  if (stopping) break;
  if ((await probe(picked.port)) === "fablechat") break;
  if (Date.now() > deadline) fail("FableChat did not start within a minute. The messages above should say why.");
  await new Promise((r) => setTimeout(r, 400));
}
say("");
say(`  FableChat is running at ${url}`);
say(`  Your data is in ${path.join(root, "data")}. Back it up from Settings → Backup & restore.`);
say("  Keep this window open while you use it. Press Ctrl+C to stop.");
say("");
openBrowser();
