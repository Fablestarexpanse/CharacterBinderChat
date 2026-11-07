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

test("with a narrator, a story reply alternates narration and quoted speech, in order", async () => {
  const { speechParts, partsKey, speechKey } = await import("../../lib/chat/speech.ts");
  const m = { content: '*She smooths her skirt one final time.* "Either this is the universe\'s cruelest joke," *she whispered to herself,* "or..."\n\n*She didn\'t finish the thought.*' };
  assert.deepEqual(speechParts(m, true), [
    { by: "narrator", text: "She smooths her skirt one final time." },
    { by: "character", text: "Either this is the universe's cruelest joke," },
    { by: "narrator", text: "she whispered to herself," },
    { by: "character", text: "or..." },
    { by: "narrator", text: "She didn't finish the thought." },
  ]);
  // Neighbours of one voice join; a bare comma between two quotes is not a narrator line
  assert.deepEqual(speechParts({ content: '"Hi." , "Sit down."' }, true), [{ by: "character", text: "Hi. Sit down." }]);
  // Without a narrator, or for a text or a call, it is the character alone
  assert.deepEqual(speechParts(m, false), [{ by: "character", text: "Either this is the universe's cruelest joke, or..." }]);
  assert.deepEqual(speechParts({ content: "on my way", channel: "text" }, true), [{ by: "character", text: "on my way" }]);
  // A reply that is all speech keeps the key it had before the narrator, so its audio is reused
  const v = { demo: "demo:en-Carter_man" }, n = { demo: "demo:en-Alice_woman" };
  assert.equal(partsKey([{ by: "character", text: "Hi." }], v, n), speechKey("Hi.", v));
  assert.notEqual(partsKey(speechParts(m, true), v, n), partsKey(speechParts(m, true), v, { demo: "demo:en-Maya_woman" }), "a new narrator voice is spoken afresh");
});

test("the narrator is on only with a voice, and its sample is kept by the asset sweep", async () => {
  const { cleanNarrator } = await import("../../lib/media/voice.ts");
  const alice = { demo: "demo:en-Alice_woman" }, carter = { demo: "demo:en-Carter_man" };
  assert.deepEqual(cleanNarrator({ enabled: true }), { enabled: false, use: "female" }, "no voice: off");
  assert.deepEqual(cleanNarrator({ enabled: true, female: alice, male: carter, use: "male" }),
    { enabled: true, use: "male", female: alice, male: carter, voice: carter }, "the narrator in use reads");
  assert.equal(cleanNarrator({ enabled: true, female: alice, use: "male" }).enabled, false, "the male narrator has no voice: off");
  assert.deepEqual(cleanNarrator({ enabled: true, voice: alice }).female, alice, "a narrator saved before the two slots becomes the female one");
  assert.equal(cleanNarrator({ enabled: true, female: { sample: "/api/assets/" + "b".repeat(64) } }).enabled, false, "a sample without consent is not a voice");
  const { FableStore } = await import("../../lib/db/store.ts");
  const s = new FableStore(":memory:");
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 9, 9, 9, 9]);
  const { hash } = s.putAsset(wav, { audio: true });
  s.db.prepare("UPDATE app_assets SET created_at = 0").run(); // old enough to be swept
  s.setKv("voice:narrator", JSON.stringify({ enabled: true, use: "male", male: { sample: `/api/assets/${hash}`, consent: true } }));
  assert.equal(s.gcAssets(), 0, "the narrator's sample is in use");
  s.setKv("voice:narrator", JSON.stringify({ enabled: false }));
  assert.equal(s.gcAssets(), 1, "once nothing uses it, it is swept");
});
