// What a reply says out loud, and the key its audio is kept under.

import { test } from "node:test";
import assert from "node:assert/strict";
const { spokenText, speechKey, voiceKey } = await import("../../lib/chat/speech.ts");

test("a story reply speaks its quoted words only; without quotes, the narration without its actions", () => {
  assert.equal(
    spokenText({ content: '*She smooths her skirt.* "Either this is the universe\'s cruelest joke," *she whispers,* "or..."' }),
    "Either this is the universe's cruelest joke, or...",
  );
  assert.equal(spokenText({ content: "“You took the long way.” He folds the map." }), "You took the long way.");
  assert.equal(spokenText({ content: "*He nods slowly.* The rain keeps falling on the roof." }), "The rain keeps falling on the roof.");
});

test("a text or a call line is all words; markers and markdown are never read", () => {
  assert.equal(spokenText({ content: "already did. look [photo: by the gate]", channel: "text" }), "already did. look");
  assert.equal(spokenText({ content: "**Don't** stand under the light.", channel: "call" }), "Don't stand under the light.");
  assert.equal(spokenText({ content: "*waves*" }), "", "nothing to say");
  assert.equal(spokenText({ content: "x".repeat(5000), channel: "text" }).length, 4000, "capped at what the voice server takes");
});

test("the audio key changes with the words and with the voice, and only then", () => {
  const sample = "/api/assets/" + "a".repeat(64);
  const v1 = { sample, consent: true };
  const v2 = { demo: "demo:en-Carter_man" };
  assert.equal(speechKey("hello", v1), speechKey("hello", { ...v1 }), "same words, same voice: the same audio");
  assert.notEqual(speechKey("hello", v1), speechKey("hello!", v1), "an edited reply is spoken afresh");
  assert.notEqual(speechKey("hello", v1), speechKey("hello", v2), "a changed voice is spoken afresh");
  assert.equal(voiceKey(v1), "sample:aaaaaaaaaaaaaaaa");
  assert.equal(voiceKey({ sample }), "none", "a sample without the consent tick is not their voice");
  assert.equal(voiceKey(v2), "demo:en-Carter_man");
});
