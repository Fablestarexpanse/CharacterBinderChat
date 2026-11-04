#!/usr/bin/env node
// ─── FableChat launcher ───────────────────────────────────────────────────────
// One command to run the app, from a fresh download or an old one:
//   • checks Node is new enough, and says where to get it if not
//   • installs dependencies the first time, and again when they change
//   • builds the app the first time, and again when the source changes
//   • starts it on 127.0.0.1, or, if FableChat is already running, just opens it
//   • opens your browser
//
// Used by start.sh and start.bat; also fine to run directly:  node scripts/start.mjs
// Options: --port N   --no-open   --rebuild
//
// Node is spawned directly, never through a shell: a shell wrapper around the server
// orphaned real servers three separate times (see AGENTS.md), and Next refuses to
// start while an orphan owns .next.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nodeIsNewEnough, minimumNode, stamp, choosePort, openCommand, installAdvice } from "./launcher-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const say = (msg = "") => console.log(msg);
const fail = (msg, code = 1) => { console.error(`\n${msg}\n`); process.exit(code); };

// ── 1. Node ──────────────────────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const need = minimumNode(pkg.engines?.node);
if (need && !nodeIsNewEnough(process.versions.node, need)) {
  fail(`FableChat needs Node.js ${need} or newer, and this is ${process.versions.node}.\n` +
       `Get the current version from https://nodejs.org (the "LTS" download is fine), then run this again.`);
}

// ── 2. Dependencies ──────────────────────────────────────────────────────────
const lockFile = path.join(root, "package-lock.json");
const lockHash = fs.existsSync(lockFile) ? stamp(fs.readFileSync(lockFile)) : "nolock";
const installStamp = path.join(root, "node_modules", ".fable-install-stamp");
const readStamp = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return null; } };

/** Run npm without a shell by finding its CLI script next to Node. */
function npm(npmArgs) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((p) => p && /npm-cli\.js$/.test(p) && fs.existsSync(p));
  const r = candidates.length > 0
    ? spawnSync(process.execPath, [candidates[0], ...npmArgs], { cwd: root, stdio: "inherit" })
    // Last resort: npm on PATH. Windows needs the .cmd shim, which needs a shell; this runs
    // to completion and exits, so it is not the long-lived-server case the rule is about.
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  return r.status === 0;
}

if (!fs.existsSync(path.join(root, "node_modules")) || readStamp(installStamp) !== lockHash) {
  say("Installing FableChat's dependencies. This takes a minute or two the first time.");
  if (!npm(["ci", "--no-audit", "--no-fund"])) fail(installAdvice());
  fs.mkdirSync(path.dirname(installStamp), { recursive: true });
  fs.writeFileSync(installStamp, lockHash);
}

// ── 3. Build ─────────────────────────────────────────────────────────────────
/** The newest modification time among the files the build is made from. */
function newestSource() {
  let newest = 0;
  const visit = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) if (f !== "node_modules" && f !== ".next") visit(path.join(p, f)); }
    else newest = Math.max(newest, st.mtimeMs);
  };
  for (const p of ["app", "components", "lib", "public", "proxy.ts", "next.config.ts", "postcss.config.mjs", "tsconfig.json", "package.json"]) visit(path.join(root, p));
  return Math.floor(newest);
}
const buildStamp = path.join(root, ".next", ".fable-build-stamp");
const wantStamp = stamp(pkg.version, lockHash, newestSource());

if (flag("--rebuild") || !fs.existsSync(path.join(root, ".next", "BUILD_ID")) || readStamp(buildStamp) !== wantStamp) {
  say("Building FableChat. This takes about a minute the first time, and again after an update.");
  const nextBin = require.resolve("next/dist/bin/next");
  const r = spawnSync(process.execPath, [nextBin, "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) fail("The build failed. The messages above say why; if you have changed the code, that is the place to look.\nIf you have not, delete the .next folder and try again.");
  fs.writeFileSync(buildStamp, wantStamp);
}

// ── 4. Where to serve ────────────────────────────────────────────────────────
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

// ── 5. Run ───────────────────────────────────────────────────────────────────
const nextBin = require.resolve("next/dist/bin/next");
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
