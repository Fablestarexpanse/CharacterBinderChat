// Speaking with someone's voice (lib/server/voiceSpeak.ts) against a stand-in
// voice server: a demo voice needs no server, an uploaded sample is registered
// once (named after its asset) and reused after, every request carries the
// token, and a server holding a different token is refused as "something else".
// Also the in-flight marks that tell an interrupted photo from one being made.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-voice-"));
process.env.FABLE_DB_PATH = path.join(dir, "t.db");
const { getStore } = await import("../../lib/db/index.ts");
const { voiceIdFor } = await import("../../lib/server/voiceSpeak.ts");
const { DEMO_VOICES } = await import("../../lib/media/voice.ts");
const { whileMaking, isMaking } = await import("../../lib/chat/inflight.ts");

const TOKEN = "t".repeat(48);
const seen = [];
const registered = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    seen.push({ method: req.method, url: req.url, token: req.headers["x-fable-voice-token"], bytes: Buffer.concat(chunks).length });
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-fable-voice-token"] !== TOKEN) { res.statusCode = 403; return res.end(JSON.stringify({ ok: false, error: "forbidden" })); }
    if (req.url === "/health") return res.end(JSON.stringify({ ok: true, worker: "idle" }));
    if (req.method === "GET" && req.url === "/v1/voices") return res.end(JSON.stringify({ voices: registered.map((id) => ({ id })) }));
    if (req.method === "POST" && req.url.startsWith("/v1/voices?")) {
      const name = new URL(req.url, "http://x").searchParams.get("name");
      registered.push(`yours:${name}`);
      return res.end(JSON.stringify({ ok: true, voice: { id: `yours:${name}` } }));
    }
    res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: "no such route" }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
after(() => { server.close(); getStore().close?.(); fs.rmSync(dir, { recursive: true, force: true }); });

getStore().setKv("voice:runtime", JSON.stringify({ folder: dir, model: "microsoft/VibeVoice-1.5B", port, installed: true, idleSeconds: 120 }));
fs.writeFileSync(path.join(dir, ".server-token"), TOKEN);

const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4, 5, 6, 7, 8]);
const { hash } = getStore().putAsset(wav, { audio: true });
const sample = `/api/assets/${hash}`;

test("a demo voice, or no voice, needs no server", async () => {
  const before = seen.length;
  assert.equal(await voiceIdFor({ demo: DEMO_VOICES[2].id }), DEMO_VOICES[2].id);
  assert.equal(await voiceIdFor(undefined), DEMO_VOICES[0].id);
  assert.equal(await voiceIdFor({ sample }), DEMO_VOICES[0].id, "a sample without the consent tick is not used");
  assert.equal(seen.length, before);
});

test("an uploaded sample is registered once, named after its asset, then reused", async () => {
  const id = await voiceIdFor({ sample, consent: true });
  assert.equal(id, `yours:asset-${hash.slice(0, 16)}`);
  const posts = seen.filter((s) => s.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].bytes, wav.length, "the sample's bytes come from the asset store");
  assert.match(posts[0].url, /consent=1/);
  assert.match(posts[0].url, /isolate=1/);
  assert.equal(await voiceIdFor({ sample, consent: true }), id);
  assert.equal(seen.filter((s) => s.method === "POST").length, 1, "the second line reuses it");
  assert.ok(seen.every((s) => s.token === TOKEN), "every request carries the token");
});

test("a sample whose asset is gone says so", async () => {
  await assert.rejects(voiceIdFor({ sample: `/api/assets/${"e".repeat(64)}`, consent: true }), /voice sample is missing/);
});

test("a server that does not know our token is refused, not used", async () => {
  fs.writeFileSync(path.join(dir, ".server-token"), "not-the-servers-token-at-all");
  await assert.rejects(voiceIdFor({ sample, consent: true }), /Something else is using port/);
  fs.writeFileSync(path.join(dir, ".server-token"), TOKEN);
});

test("an attachment is marked as being made only while its work runs, even when the work fails", async () => {
  let inside = false;
  await whileMaking("att-1", async () => { inside = isMaking("att-1"); });
  assert.ok(inside);
  assert.ok(!isMaking("att-1"));
  await assert.rejects(whileMaking("att-2", async () => { throw new Error("boom"); }), /boom/);
  assert.ok(!isMaking("att-2"), "a failed take is not left spinning");
});
