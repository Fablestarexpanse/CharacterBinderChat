// Texts and attachments in the story: how each message reaches the model.

import { test } from "node:test";
import assert from "node:assert/strict";

const { replyChannel, historyContent, hasHistoryContent, attachmentNote } = await import("../../lib/chat/channel.ts");

test("a reply goes out the way your last message came in; errors are not counted", () => {
  assert.equal(replyChannel([]), "scene");
  assert.equal(replyChannel([{ role: "user" }, { role: "assistant" }]), "scene", "old messages have no channel: in person");
  assert.equal(replyChannel([{ role: "user", channel: "text" }, { role: "assistant", channel: "text" }]), "text");
  assert.equal(replyChannel([{ role: "user", channel: "text" }, { role: "user" }]), "scene", "the latest one decides");
  assert.equal(replyChannel([{ role: "user", channel: "text" }, { role: "user", error: true }]), "text");
});

test("history marks texts and describes ready attachments only", () => {
  assert.equal(historyContent({ content: "Hello." }), "Hello.", "an in-person line is unchanged");
  assert.equal(historyContent({ content: "on my way", channel: "text" }), "(by text) on my way");
  const photo = { id: "a", kind: "image", status: "ready", url: "/api/assets/x", prompt: "the river at dusk" };
  assert.equal(historyContent({ content: "look", channel: "text", attachments: [photo] }), "(by text) look\n[sent a photo: the river at dusk]");
  assert.equal(historyContent({ content: "", attachments: [{ ...photo, kind: "audio", prompt: undefined }] }), "[sent a voice note]");
  assert.equal(attachmentNote({ ...photo, status: "pending" }), null, "nothing is claimed before it exists");
  assert.equal(attachmentNote({ ...photo, status: "failed" }), null);
  assert.equal(hasHistoryContent({ content: "", attachments: [{ ...photo, status: "pending" }] }), false);
  assert.equal(hasHistoryContent({ content: "", attachments: [photo] }), true);
});
