// The picture reader: a picture you send is described by a model that can see
// images, through Ollama (`images` on the message) or an OpenAI-compatible
// server (an image_url part), and a reasoning model's thinking is not the
// description. A model that answers with nothing is an error, not "".

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-vision-"));
process.env.FABLE_DB_PATH = path.join(dir, "t.db");
const { describeImage, cleanDescription } = await import("../../lib/server/vision.ts");

const seen = [];
let answer = "A red apple on a wooden table.";
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    seen.push({ url: req.url, body });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/chat") return res.end(JSON.stringify({ message: { content: answer } }));
    if (req.url === "/v1/chat/completions") return res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    res.statusCode = 404; res.end("{}");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const hash = "a".repeat(64);

test("an OpenAI-compatible server gets the picture as an image part next to the prompt", async () => {
  seen.length = 0;
  const d = await describeImage({ providerType: "lmstudio", providerBaseUrl: base, modelId: "qwen3-vl" }, hash, png, "image/png", "Describe it.");
  assert.equal(d, "A red apple on a wooden table.");
  const parts = seen[0].body.messages[0].content;
  assert.equal(seen[0].url, "/v1/chat/completions");
  assert.deepEqual(parts[0], { type: "text", text: "Describe it." });
  assert.equal(parts[1].type, "image_url");
  assert.match(parts[1].image_url.url, /^data:image\/(png|webp);base64,/);
  assert.equal(seen[0].body.model, "qwen3-vl");
});

test("Ollama gets the picture in the message's images", async () => {
  seen.length = 0;
  await describeImage({ providerType: "ollama", providerBaseUrl: base, modelId: "qwen2.5vl:7b" }, hash, png, "image/png", "Describe it.");
  const m = seen[0].body.messages[0];
  assert.equal(seen[0].url, "/api/chat");
  assert.equal(m.content, "Describe it.");
  assert.equal(typeof m.images[0], "string");
  assert.equal(seen[0].body.stream, false);
});

test("thinking and labels are not the description; nothing at all is an error", async () => {
  assert.equal(cleanDescription("<think>hmm, an apple?</think>\nDescription:  A red   apple."), "A red apple.");
  assert.equal(cleanDescription("reasoning without an opening tag</think> A cat."), "A cat.");
  answer = "<think>only thinking</think>";
  await assert.rejects(() => describeImage({ providerType: "lmstudio", providerBaseUrl: base, modelId: "m" }, hash, png, "image/png", "x"), /answered with nothing/);
  answer = "A red apple on a wooden table.";
});
