// Media connections: validation, storage (keys encrypted, never sent to the
// browser, stripped from backups), defaults per purpose, and the real test
// calls against stand-in services for every provider.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-media-"));
process.env.FABLE_DB_PATH = path.join(dir, "t.db");
process.env.FABLE_SECRET_KEY = "a".repeat(64);
const { getStore } = await import("../../lib/db/index.ts");
const M = await import("../../lib/server/mediaConnections.ts");
const { validateConnection, connectionFor } = await import("../../lib/media/connections.ts");

// One stand-in server for every provider; records what it was sent.
const seen = [];
let mode = "ok";
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (mode === "refuse") { res.statusCode = 401; res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ error: { message: "Incorrect API key provided" } })); }
    if (req.url === "/system_stats") return res.end(JSON.stringify({ system: { comfyui_version: "0.3.40" }, devices: [{ name: "cuda:0 NVIDIA RTX 4090 : cudaMallocAsync", vram_total: 25757220864 }] }));
    if (req.url === "/v1/images/generations") return res.end(JSON.stringify({ data: [{ b64_json: Buffer.from("PNGDATA").toString("base64") }] }));
    if (req.url === "/v1/audio/speech" || req.url.startsWith("/v1/text-to-speech/")) { res.setHeader("Content-Type", "audio/mpeg"); return res.end(Buffer.alloc(2048, 7)); }
    if (req.url === "/v1/audio/transcriptions") return res.end(JSON.stringify({ text: "" }));
    res.statusCode = 404; res.end("{}");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const conn = (o) => ({ id: "c1", name: "Test", kind: "image", provider: "comfyui", baseUrl: base, ...o });

test("validation refuses a bad id, a wrong kind for the service and a non-http address", () => {
  assert.ok(validateConnection(conn({})).ok);
  const bad = validateConnection(conn({ id: "Bad Id", kind: "voice", baseUrl: "ftp://x" }));
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 3);
  const v = validateConnection(conn({ provider: "openai-speech", kind: "voice", model: " kokoro ", voice: "af_bella", baseUrl: base + "/v1/" }));
  assert.deepEqual([v.value.model, v.value.voice, v.value.baseUrl], ["kokoro", "af_bella", base + "/v1"], "trimmed; trailing slash dropped");
  assert.equal(validateConnection(conn({ model: "x" })).value.model, undefined, "fields a service does not use are dropped");
});

test("keys are stored encrypted, never listed for the browser, and stripped from backups", async () => {
  const r = M.saveConnection(conn({ id: "img", provider: "openai-image", baseUrl: base + "/v1" }), "sk-secret-123");
  assert.ok(r.ok);
  const raw = getStore().getKv("secret:media:img");
  assert.ok(raw && !raw.includes("sk-secret-123"), "encrypted at rest");
  assert.equal(M.connectionKey("img"), "sk-secret-123");
  const listed = JSON.stringify(M.listForClient());
  assert.ok(!listed.includes("sk-secret"), "the browser never sees the key");
  assert.equal(M.listForClient().connections.find((c) => c.id === "img").hasKey, true);
  M.saveConnection(conn({ id: "img", provider: "openai-image", baseUrl: base + "/v1", name: "Renamed" }));
  assert.equal(M.connectionKey("img"), "sk-secret-123", "saving without a key keeps it");
  M.saveConnection(conn({ id: "img", provider: "openai-image", baseUrl: base + "/v1" }), "");
  assert.equal(M.connectionKey("img"), null, "an empty key removes it");
});

test("defaults point only at existing connections of the right kind, and follow removals", () => {
  M.saveConnection(conn({ id: "comfy" }));
  M.saveConnection(conn({ id: "voice1", kind: "voice", provider: "openai-speech", baseUrl: base + "/v1" }));
  const d = M.setDefaults({ scene: "comfy", voice: "voice1", photo: "voice1", stt: "missing" });
  assert.deepEqual(d, { scene: "comfy", voice: "voice1" }, "wrong kind and unknown ids are dropped");
  assert.deepEqual(M.setDefaults({ portrait: "comfy" }), { scene: "comfy", voice: "voice1", portrait: "comfy" }, "a patch keeps the others");
  assert.deepEqual(M.setDefaults({ portrait: null }), { scene: "comfy", voice: "voice1" }, "null clears one");
  const { connections, defaults } = M.listForClient();
  assert.equal(connectionFor("voice", connections, defaults).id, "voice1");
  assert.equal(connectionFor("photo", connections, defaults).kind, "image", "no default: the first of that kind");
  M.removeConnection("voice1");
  assert.equal(M.getDefaults().voice, undefined);
  assert.equal(getStore().getKv("secret:media:voice1"), null);
});

test("each provider's test makes the right request and returns something to show", async () => {
  mode = "ok"; seen.length = 0;
  const comfy = await M.testConnection(conn({}), null);
  assert.ok(comfy.ok); assert.match(comfy.label, /ComfyUI 0\.3\.40 · NVIDIA RTX 4090 · 24 GB/);

  const img = await M.testConnection(conn({ provider: "openai-image", baseUrl: base + "/v1", model: "gpt-image-1" }), "sk-1");
  assert.ok(img.ok); assert.equal(img.sample.type, "image"); assert.match(img.sample.dataUrl, /^data:image\/png;base64,/);
  const imgReq = seen.find((s) => s.url === "/v1/images/generations");
  assert.equal(imgReq.headers.authorization, "Bearer sk-1");
  assert.equal(JSON.parse(imgReq.body).model, "gpt-image-1");

  const tts = await M.testConnection(conn({ kind: "voice", provider: "openai-speech", baseUrl: base + "/v1", model: "kokoro", voice: "af_bella" }), null);
  assert.ok(tts.ok); assert.equal(tts.sample.type, "audio");
  const ttsReq = JSON.parse(seen.find((s) => s.url === "/v1/audio/speech").body);
  assert.deepEqual([ttsReq.model, ttsReq.voice], ["kokoro", "af_bella"]);
  assert.equal(seen.find((s) => s.url === "/v1/audio/speech").headers.authorization, undefined, "no key, no auth header");

  const el = await M.testConnection(conn({ kind: "voice", provider: "elevenlabs", baseUrl: base + "/v1", voice: "v123" }), "xi-key");
  assert.ok(el.ok);
  assert.equal(seen.find((s) => s.url === "/v1/text-to-speech/v123").headers["xi-api-key"], "xi-key");

  const stt = await M.testConnection(conn({ kind: "stt", provider: "openai-stt", baseUrl: base + "/v1" }), null);
  assert.ok(stt.ok);
  const sttReq = seen.find((s) => s.url === "/v1/audio/transcriptions");
  assert.match(sttReq.headers["content-type"], /multipart\/form-data/);
  assert.ok(sttReq.body.includes(Buffer.from("RIFF")), "a real WAV is uploaded");
});

test("failures say what the service said, or that nothing is listening", async () => {
  mode = "refuse";
  const r = await M.testConnection(conn({ provider: "openai-image", baseUrl: base + "/v1" }), "bad");
  assert.equal(r.ok, false);
  assert.match(r.label, /401: Incorrect API key provided/);
  assert.match((await M.testConnection(conn({ provider: "openai-image", baseUrl: base + "/v1" }), null)).label, /needs an API key/);
  assert.match((await M.testConnection(conn({ kind: "voice", provider: "elevenlabs", baseUrl: base }), "k")).label, /voice id/);
  const free = await new Promise((r) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  const dead = await M.testConnection(conn({ baseUrl: `http://127.0.0.1:${free}` }), null);
  assert.match(dead.label, /Nothing is listening at/);
  assert.match((await M.testConnection(conn({ baseUrl: "http://127.0.0.1:9" }), null)).label, /refuses to use for safety/);
  mode = "ok";
});
