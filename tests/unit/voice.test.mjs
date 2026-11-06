// A character's voice: only a stored sample you said you may use, or a known
// demo voice, is kept; sound files go into the asset store only where audio
// was asked for (an avatar can never be a WAV), and the voice server's line
// cleaning drops actions and tags before anything is spoken.

import { test } from "node:test";
import assert from "node:assert/strict";

const { cleanVoice, hasVoice, DEMO_VOICES } = await import("../../lib/media/voice.ts");
const { FableStore } = await import("../../lib/db/store.ts");
const { sniffAudio } = await import("../../lib/db/assets.ts");

const asset = "/api/assets/" + "c".repeat(64);

test("a voice keeps a stored sample only with consent, and only known demo voices", () => {
  assert.deepEqual(cleanVoice({ sample: asset, consent: true, sampleName: "ronan.wav" }), { sample: asset, consent: true, sampleName: "ronan.wav" });
  assert.equal(cleanVoice({ sample: asset }), undefined, "no consent, no sample");
  assert.equal(cleanVoice({ sample: "https://example.com/x.wav", consent: true }), undefined, "an outside URL is never a voice");
  assert.deepEqual(cleanVoice({ demo: DEMO_VOICES[0].id }), { demo: DEMO_VOICES[0].id });
  assert.equal(cleanVoice({ demo: "demo:someone-else" }), undefined);
  assert.equal(cleanVoice(null), undefined);
  assert.ok(hasVoice({ demo: DEMO_VOICES[1].id }));
  assert.ok(!hasVoice({}));
});

test("sound files are recognised by their bytes and stored only where audio was asked for", () => {
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4]);
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  assert.equal(sniffAudio(wav), "audio/wav");
  assert.equal(sniffAudio(mp3), "audio/mpeg");
  assert.equal(sniffAudio(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0])), "audio/ogg");
  assert.equal(sniffAudio(new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0])), "audio/flac");
  const s = new FableStore(":memory:");
  assert.throws(() => s.putAsset(wav), /not an image/, "an avatar upload refuses a WAV");
  assert.equal(s.putAsset(wav, { audio: true }).mime, "audio/wav");
  assert.throws(() => s.putAsset(new TextEncoder().encode("not sound at all"), { audio: true }), /not a sound file/);
});
