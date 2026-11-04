// ─── Launcher decisions ───────────────────────────────────────────────────────
// The choices start.mjs makes, as plain functions so they can be tested without
// installing, building or opening anything.

import { createHash } from "node:crypto";

/** "22.18.0" → [22, 18, 0]. Anything unparseable becomes zeros, i.e. "too old". */
export function parseVersion(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : [0, 0, 0];
}

/** The minimum Node from an `engines.node` range like ">=22.18.0". null if it has none we understand. */
export function minimumNode(range) {
  const m = /^>=\s*(\d+(?:\.\d+){0,2})/.exec(String(range ?? "").trim());
  return m ? m[1] : null;
}

/** true when `have` satisfies `>= need`. */
export function nodeIsNewEnough(have, need) {
  const a = parseVersion(have), b = parseVersion(need);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/**
 * A fingerprint of what a build or install was made from. When it changes, the
 * thing must be redone. `parts` are plain strings (a lockfile's hash, the newest
 * source timestamp, the version): the caller decides what counts, this only combines.
 */
export function stamp(...parts) {
  return createHash("sha1").update(parts.map(String).join("\u0000")).digest("hex").slice(0, 16);
}

/**
 * Pick where to serve. `probe(port)` reports what is listening there:
 *   "free"        nothing: use it
 *   "fablechat"   FableChat is already running: open it, start nothing
 *   "other"       something else owns the port: try the next
 * Returns { port, running } or null if nothing in range is usable.
 */
export async function choosePort(start, probe, span = 20) {
  for (let port = start; port < start + span; port++) {
    const what = await probe(port);
    if (what === "fablechat") return { port, running: true };
    if (what === "free") return { port, running: false };
  }
  return null;
}

/** The command that opens a URL in the user's browser on each platform. */
export function openCommand(url, platform = process.platform) {
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", url] };
  if (platform === "darwin") return { cmd: "open", args: [url] };
  return { cmd: "xdg-open", args: [url] };
}

/** Human-readable advice when `npm ci` fails: the native-module cases are the usual ones. */
export function installAdvice(platform = process.platform) {
  const lines = ["Installing FableChat's dependencies failed."];
  if (platform === "win32") {
    lines.push("If the messages above mention node-gyp, Python or Visual Studio, install the 'Desktop development with C++'",
      "workload from the Visual Studio Build Tools (https://visualstudio.microsoft.com/visual-cpp-build-tools/) and run this again.");
  } else if (platform === "darwin") {
    lines.push("If the messages above mention node-gyp or a compiler, run `xcode-select --install` and try again.");
  } else {
    lines.push("If the messages above mention node-gyp or a compiler, install build tools (for Debian/Ubuntu: `sudo apt install build-essential python3`) and try again.");
  }
  lines.push("If it mentions the network, check your connection: the first run downloads about 300 MB.");
  return lines.join("\n");
}
