// ─── Setup steps shared by install, update and start ──────────────────────────
// install.mjs installs and builds, always. update.mjs fetches the new version and
// then redoes only what changed. start.mjs only launches, and says which of the
// other two to run when the app is not ready. They share these steps so "what
// counts as installed" and "what counts as built" are decided in one place.
//
// Node and npm are spawned directly, never through a shell: a shell wrapper
// around the server orphaned real servers three separate times (see AGENTS.md).

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nodeIsNewEnough, minimumNode, stamp, installAdvice } from "./launcher-lib.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export const say = (msg = "") => console.log(msg);
export const fail = (msg, code = 1) => { console.error(`\n${msg}\n`); process.exit(code); };

const readPkg = () => JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const readStamp = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return null; } };

export function checkNode() {
  const need = minimumNode(readPkg().engines?.node);
  if (need && !nodeIsNewEnough(process.versions.node, need)) {
    fail(`FableChat needs Node.js ${need} or newer, and this is ${process.versions.node}.\n` +
         `Get the current version from https://nodejs.org (the "LTS" download is fine), then run this again.`);
  }
}

// ── Dependencies ─────────────────────────────────────────────────────────────
const lockFile = path.join(root, "package-lock.json");
const installStamp = path.join(root, "node_modules", ".fable-install-stamp");
const lockHash = () => (fs.existsSync(lockFile) ? stamp(fs.readFileSync(lockFile)) : "nolock");

/** Installed, and from the lockfile that is here now */
export const depsCurrent = () => fs.existsSync(path.join(root, "node_modules")) && readStamp(installStamp) === lockHash();
export const depsPresent = () => fs.existsSync(path.join(root, "node_modules", "next"));

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

export function installDeps() {
  say("Installing FableChat's dependencies. This takes a minute or two.");
  // npm ci reads the lockfile only, so it never rewrites it: the stamp stays valid
  if (!npm(["ci", "--no-audit", "--no-fund"])) fail(installAdvice());
  fs.mkdirSync(path.dirname(installStamp), { recursive: true });
  fs.writeFileSync(installStamp, lockHash());
}

// ── Build ────────────────────────────────────────────────────────────────────
/** The newest modification time among the files the build is made from. */
function newestSource() {
  let newest = 0;
  const visit = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) if (f !== "node_modules" && f !== ".next") visit(path.join(p, f)); }
    else newest = Math.max(newest, st.mtimeMs);
  };
  for (const p of ["app", "components", "lib", "public", "workflows", "proxy.ts", "next.config.ts", "postcss.config.mjs", "tsconfig.json", "package.json"]) visit(path.join(root, p));
  return Math.floor(newest);
}
const buildStamp = path.join(root, ".next", ".fable-build-stamp");
const wantedBuild = () => stamp(readPkg().version, lockHash(), newestSource());

export const buildPresent = () => fs.existsSync(path.join(root, ".next", "BUILD_ID"));
/** Built, from the source and dependencies that are here now */
export const buildCurrent = () => buildPresent() && readStamp(buildStamp) === wantedBuild();

export function build() {
  say("Building FableChat. This takes about a minute.");
  const nextBin = require.resolve("next/dist/bin/next", { paths: [root] });
  const r = spawnSync(process.execPath, [nextBin, "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) fail("The build failed. The messages above say why; if you have changed the code, that is the place to look.\nIf you have not, delete the .next folder and run install again.");
  fs.writeFileSync(buildStamp, wantedBuild());
}

/** Which script to run, by platform, for messages */
export const script = (name) => (process.platform === "win32" ? `${name}.bat` : `./${name}.sh`);

/** Is FableChat answering on this port? (Used so install/update refuse to rebuild under a running server.) */
export async function fableRunningOn(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/state/changes?since=999999999`, { signal: AbortSignal.timeout(1500) });
    if (res.status === 401 && /FableChat/.test(res.headers.get("www-authenticate") ?? "")) return true;
    const body = await res.json().catch(() => null);
    return !!(body && typeof body.rev === "number" && typeof body.epoch === "string");
  } catch { return false; }
}

/** install and update rebuild .next, which a running server is serving from: stop first. */
export async function refuseWhileRunning() {
  for (let port = 3000; port < 3020; port++) {
    if (await fableRunningOn(port)) {
      fail(`FableChat is running (http://localhost:${port}). Close its window (or press Ctrl+C in it) first, then run this again.`);
    }
  }
}
