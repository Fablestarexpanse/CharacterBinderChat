// The launcher's decisions. The things that go wrong for a first-time user are the
// ones tested: a Node that is too old, deciding wrongly to skip a rebuild, grabbing a
// port that something else owns, and starting a second copy of an app already running.

import { test } from "node:test";
import assert from "node:assert/strict";

const { parseVersion, minimumNode, nodeIsNewEnough, stamp, choosePort, openCommand, installAdvice } =
  await import("../../scripts/launcher-lib.mjs");

test("versions are compared numerically, not as text", () => {
  assert.equal(nodeIsNewEnough("22.18.0", "22.18.0"), true);
  assert.equal(nodeIsNewEnough("24.1.0", "22.18.0"), true);
  assert.equal(nodeIsNewEnough("22.18.1", "22.18.0"), true);
  assert.equal(nodeIsNewEnough("22.9.0", "22.18.0"), false, "9 < 18 although '9' > '18' as text");
  assert.equal(nodeIsNewEnough("20.19.5", "22.18.0"), false);
  assert.equal(nodeIsNewEnough("v22.18.0", "22.18.0"), true, "a leading v is accepted");
});

test("an unparseable version counts as too old rather than being waved through", () => {
  assert.deepEqual(parseVersion("banana"), [0, 0, 0]);
  assert.equal(nodeIsNewEnough("banana", "22.18.0"), false);
});

test("the minimum comes out of the engines range, and an unknown range yields none", () => {
  assert.equal(minimumNode(">=22.18.0"), "22.18.0");
  assert.equal(minimumNode(">= 20.9"), "20.9");
  assert.equal(minimumNode("^22"), null);
  assert.equal(minimumNode(undefined), null);
});

test("the build stamp changes when any input changes, and not otherwise", () => {
  const base = stamp("0.1.0", "lockhash", 1000);
  assert.equal(stamp("0.1.0", "lockhash", 1000), base);
  assert.notEqual(stamp("0.1.0", "lockhash", 1001), base, "a source file was edited");
  assert.notEqual(stamp("0.1.0", "otherlock", 1000), base, "dependencies changed");
  assert.notEqual(stamp("0.2.0", "lockhash", 1000), base, "version bumped");
  assert.notEqual(stamp("ab", "c"), stamp("a", "bc"), "parts are not run together");
});

const probeFrom = (map) => async (port) => map[port] ?? "free";

test("a free port is used as asked", async () => {
  assert.deepEqual(await choosePort(3000, probeFrom({})), { port: 3000, running: false });
});

test("FableChat already running means: use that, start nothing", async () => {
  assert.deepEqual(await choosePort(3000, probeFrom({ 3000: "fablechat" })), { port: 3000, running: true });
});

test("a port owned by something else is skipped; the next free one is used", async () => {
  assert.deepEqual(await choosePort(3000, probeFrom({ 3000: "other", 3001: "other" })), { port: 3002, running: false });
});

test("a running FableChat is found even when the first port is someone else's", async () => {
  assert.deepEqual(await choosePort(3000, probeFrom({ 3000: "other", 3001: "fablechat" })), { port: 3001, running: true });
});

test("when every port in range is taken it gives up instead of looping", async () => {
  const all = new Proxy({}, { get: () => "other" });
  assert.equal(await choosePort(3000, probeFrom(all), 5), null);
});

test("the browser is opened with the right command on each platform", () => {
  assert.deepEqual(openCommand("http://x", "darwin"), { cmd: "open", args: ["http://x"] });
  assert.deepEqual(openCommand("http://x", "linux"), { cmd: "xdg-open", args: ["http://x"] });
  const win = openCommand("http://x", "win32");
  assert.equal(win.cmd, "cmd");
  assert.deepEqual(win.args, ["/c", "start", "", "http://x"], "the empty title argument stops start treating the URL as one");
});

test("install advice names the platform's real fix", () => {
  assert.match(installAdvice("win32"), /Visual Studio Build Tools/);
  assert.match(installAdvice("darwin"), /xcode-select/);
  assert.match(installAdvice("linux"), /build-essential/);
  for (const p of ["win32", "darwin", "linux"]) assert.match(installAdvice(p), /network/);
});
