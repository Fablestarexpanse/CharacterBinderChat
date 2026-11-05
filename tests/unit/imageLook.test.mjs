// A character's image look: cleaned from untrusted input, and applied to every
// image so the tags lead the prompt word for word.

import { test } from "node:test";
import assert from "node:assert/strict";

const { cleanImageLook, applyImageLook, hasImageLook } = await import("../../lib/media/imageLook.ts");
const base = { provider: "comfyui", workflow: "w", prompt: "standing in the rain, neon light", negativePrompt: "blurry", aspectRatio: "1:1", width: 1024, height: 1024, steps: 20, cfg: 6, sampler: "euler", seed: -1, batchCount: 1, loras: [] };

test("cleaning keeps well-formed parts and drops the rest", () => {
  assert.equal(cleanImageLook(null), undefined);
  assert.equal(cleanImageLook({ tags: "  ", seed: "x" }), undefined, "nothing usable, nothing stored");
  assert.deepEqual(cleanImageLook({ tags: " silver hair ", avoid: "", lora: { name: "r", weight: 7 }, seed: 42 }),
    { tags: "silver hair", lora: { name: "r", weight: 2 }, seed: 42 }, "weight clamped to ±2");
  assert.deepEqual(cleanImageLook({ lora: { name: "r", weight: 1 } }), { lora: { name: "r" } }, "weight 1 is the default, not stored");
  assert.equal(cleanImageLook({ seed: -1 }), undefined);
  assert.equal(cleanImageLook({ seed: 2 ** 33 }), undefined);
  assert.equal(cleanImageLook({ tags: "x".repeat(5000) }).tags.length, 1000);
});

test("applying: trigger and tags lead the prompt, avoid joins the negative, LoRA added once, seed fixed", () => {
  const look = { tags: "silver hair, scar on jaw", avoid: "glasses", lora: { name: "ronan_v2", trigger: "r0nan", weight: 0.8 }, seed: 99 };
  const out = applyImageLook(base, look);
  assert.equal(out.prompt, "r0nan, silver hair, scar on jaw, standing in the rain, neon light");
  assert.equal(out.negativePrompt, "blurry, glasses");
  assert.deepEqual(out.loras, [{ name: "ronan_v2", weight: 0.8 }]);
  assert.equal(out.seed, 99);
  const twice = applyImageLook(out, look);
  assert.equal(twice.prompt, out.prompt, "applying again does not repeat the tags");
  assert.equal(twice.loras.length, 1, "nor the LoRA");
  assert.deepEqual(base.loras, [], "the input settings are not changed");
});

test("no look changes nothing; an empty negative takes just the avoid-tags", () => {
  assert.equal(applyImageLook(base, undefined), base);
  assert.equal(applyImageLook({ ...base, negativePrompt: "" }, { avoid: "hats" }).negativePrompt, "hats");
  assert.equal(applyImageLook(base, { tags: "x" }).seed, -1, "no fixed seed keeps random");
  assert.equal(hasImageLook(undefined), false);
  assert.equal(hasImageLook({ tags: "x" }), true);
});
