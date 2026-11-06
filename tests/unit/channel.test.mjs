// Texts and attachments in the story: how each message reaches the model.

import { test } from "node:test";
import assert from "node:assert/strict";

const { replyChannel, historyContent, hasHistoryContent, attachmentNote, parseTextIntent } = await import("../../lib/chat/channel.ts");

test("a reply goes out the way your last message came in; errors are not counted", () => {
  assert.equal(replyChannel([]), "scene");
  assert.equal(replyChannel([{ role: "user" }, { role: "assistant" }]), "scene", "old messages have no channel: in person");
  assert.equal(replyChannel([{ role: "user", channel: "text" }, { role: "assistant", channel: "text" }]), "text");
  assert.equal(replyChannel([{ role: "user", channel: "text" }, { role: "user" }]), "scene", "the latest one decides");
  assert.equal(replyChannel([{ role: "user", channel: "text" }, { role: "user", channel: "call", callEvent: { kind: "ended", seconds: 30 } }]), "text",
    "hanging up is not something you said: the reply after a call goes the way your last line did");
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

test("phone calls: lines said on a call and the call's start, end and misses reach the model", async () => {
  const { callNote, callLength } = await import("../../lib/chat/channel.ts");
  assert.equal(historyContent({ content: "Hey. You up?", channel: "call" }), "(on the phone) Hey. You up?");
  assert.equal(historyContent({ content: "", channel: "call", callEvent: { kind: "started" } }), "[phone call starts]");
  assert.equal(historyContent({ content: "", callEvent: { kind: "ended", seconds: 151 } }), "[phone call ends after 3 min]");
  assert.equal(callNote({ kind: "missed" }), "[missed phone call: no answer]");
  assert.equal(callNote({ kind: "declined" }), "[phone call declined]");
  assert.ok(hasHistoryContent({ content: "", callEvent: { kind: "missed" } }), "a missed call is part of the story even with no words");
  assert.equal(replyChannel([{ role: "user", channel: "call", content: "" }]), "call", "a call you started is answered on the call");
  assert.deepEqual([callLength(0), callLength(42), callLength(151), callLength(725)], ["0:00", "0:42", "2:31", "12:05"]);
});

test("a line saying you text someone becomes that text; anything else stays as written", () => {
  const P = [{ id: "r", name: "Ronan" }, { id: "f", name: "Fenna Vale" }];
  const t = (s) => parseTextIntent(s, P);
  assert.deepEqual(t('i text ronan "hi thinking of you"'), { to: "r", text: "hi thinking of you" });
  assert.deepEqual(t('*I pull out my phone and text Ronan* "you up?"'), { to: "r", text: "you up?" });
  assert.deepEqual(t("I text him: on my way"), { to: null, text: "on my way" }, "him/her/them: the chat decides who");
  assert.deepEqual(t('I send Ronan a text: "miss you"'), { to: "r", text: "miss you" });
  assert.deepEqual(t('I send a text to Ronan saying "running late"'), { to: "r", text: "running late" });
  assert.deepEqual(t('I texted Fenna "see you at the gate"'), { to: "f", text: "see you at the gate" }, "a first name is enough");
  assert.deepEqual(t("text Ronan: on my way"), { to: "r", text: "on my way" });
  for (const s of [
    '"Hi," I say, smiling at Ronan.',
    "I think about texting Ronan later.",
    "Ronan, text me when you get there.",
    'I text Ronan "hi" and then put my phone away.',
    'I text Kaspar "hi"',
    "",
  ]) assert.equal(t(s), null, s || "(empty)");
});
