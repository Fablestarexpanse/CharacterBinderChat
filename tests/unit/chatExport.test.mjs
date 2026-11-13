// Exporting a chat: what goes in each format, and what is left out.

import { test } from "node:test";
import assert from "node:assert/strict";

const E = await import("../../lib/chat/chatExport.ts");

const T = "2026-11-13T08:45:00.000Z";
const chat = {
  id: "c1", name: "Rain <night>", characterId: "june", createdAt: T, updatedAt: T,
  messages: [
    { id: "m1", chatId: "c1", role: "assistant", content: "*She looks up.* \"You're late.\"", timestamp: T,
      speech: { url: "/api/assets/aaa", key: "k" } },
    { id: "m2", chatId: "c1", role: "user", content: "Sorry", channel: "text", timestamp: T },
    { id: "m3", chatId: "c1", role: "user", content: "", timestamp: T,
      attachments: [{ id: "a1", kind: "image", status: "ready", url: "/api/assets/bbb", prompt: "a rainy street", fromUser: true },
                    { id: "a2", kind: "image", status: "failed", url: "/api/assets/ccc" }] },
    { id: "m4", chatId: "c1", role: "assistant", content: "", imageJobId: "j1", timestamp: T },
    { id: "m5", chatId: "c1", role: "assistant", content: "Provider error", error: true, timestamp: T },
    { id: "m6", chatId: "c1", role: "assistant", content: "", callEvent: { kind: "ended", seconds: 180 }, channel: "call", timestamp: T },
  ],
};
const ctx = {
  chat, userName: "Nora",
  characters: [{ id: "june", name: "June" }],
  imageJobs: [{ id: "j1", prompt: "June at the mic", status: "complete", outputUrls: ["http://127.0.0.1:8188/view?filename=x.png&type=output"], settings: {}, createdAt: T }],
};
const all = { pictures: true, clips: true };

test("the transcript skips errors and failed media, keeps calls and texts", () => {
  const lines = E.transcript(ctx, all);
  assert.deepEqual(lines.map((l) => l.id), ["m1", "m2", "m3", "m4", "m6"]);
  assert.equal(lines[1].how, "by text");
  assert.equal(lines[2].media.length, 1, "the failed picture is left out");
  assert.match(lines[4].event, /^Phone call ends after 3 min$/);
  assert.equal(lines[0].who, "June");
  assert.equal(lines[1].who, "Nora");
});

test("without pictures, a picture-only message and an image card drop out; spoken replies never go", () => {
  const lines = E.transcript(ctx, { pictures: false, clips: true });
  assert.deepEqual(lines.map((l) => l.id), ["m1", "m2", "m6"]);
  assert.equal(lines[0].media.length, 0);
  assert.equal(E.mediaOf(E.transcript(ctx, all)).length, 2, "a photo and an image card; the spoken reply is not exported");
});

test("a ComfyUI picture is fetched through the server's proxy; our own assets directly", () => {
  assert.equal(E.fetchableUrl("/api/assets/bbb"), "/api/assets/bbb");
  assert.equal(E.fetchableUrl("http://127.0.0.1:8188/view?filename=x.png&type=output"),
    "/api/comfyui/view?filename=x.png&type=output&base=http%3A%2F%2F127.0.0.1%3A8188");
});

test("the web page escapes what the chat says and carries pictures inside it", () => {
  const lines = E.transcript(ctx, all);
  const media = new Map(E.mediaOf(lines).map((m) => [m.url, { ...m, dataUrl: "data:image/png;base64,AAAA" }]));
  const html = E.toHtml(ctx, lines, media);
  assert.match(html, /<title>Rain &lt;night&gt;<\/title>/);
  assert.match(html, /<em>She looks up.<\/em>/);
  assert.match(html, /src="data:image\/png;base64,AAAA"/);
  assert.ok(!html.includes("Provider error"));
});

test("markdown links media files; a picture not fetched says so", () => {
  const lines = E.transcript(ctx, all);
  const media = new Map(E.mediaOf(lines).map((m, i) => [m.url, { ...m, file: i === 0 ? "media/001.png" : undefined }]));
  const md = E.toMarkdown(ctx, lines, media);
  assert.match(md, /^# Rain <night>/);
  assert.match(md, /!\[a rainy street\]\(media\/001\.png\)/);
  assert.match(md, /\*\[picture not included\]\*/);
});

test("SillyTavern: a header line, then the spoken lines only", () => {
  const rows = E.toSillyTavern(ctx, E.transcript(ctx, all)).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows[0].character_name, "June");
  assert.equal(rows[0].user_name, "Nora");
  assert.deepEqual(rows.slice(1).map((r) => [r.name, r.is_user, r.mes]), [["June", false, "*She looks up.* \"You're late.\""], ["Nora", true, "Sorry"]]);
});

test("FableChat's own file holds the whole chat, its media files and the memory", () => {
  const media = new Map([["/api/assets/bbb", { url: "/api/assets/bbb", kind: "image", file: "media/001.png" }]]);
  const j = JSON.parse(E.toFableJson(ctx, media, { facts: { facts: [] }, coreMemory: null }));
  assert.equal(j.format, "fablechat-chat");
  assert.equal(j.chat.messages.length, 6, "everything as stored, errors included");
  assert.deepEqual(j.characters, { june: "June" });
  assert.deepEqual(j.mediaFiles, { "/api/assets/bbb": "media/001.png" });
  assert.ok("memory" in j);
});
