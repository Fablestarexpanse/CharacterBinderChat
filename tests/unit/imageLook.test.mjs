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

test("references: the chosen set (stored assets only, at most four), else the portrait", async () => {
  const { referencesFor, withReferences, MAX_REFERENCES } = await import("../../lib/media/imageLook.ts");
  const a = (n) => `/api/assets/${String(n).repeat(64).slice(0, 64)}`;
  assert.deepEqual(referencesFor({ avatar: a(1) + "?w=96" }), [a(1)], "no set: the portrait, without its size suffix");
  assert.deepEqual(referencesFor({ avatar: "https://example.com/x.png" }), [], "an outside URL is never sent");
  assert.deepEqual(referencesFor({ avatar: a(1), referenceImages: [a(2), "data:image/png;base64,xx", a(3)] }), [a(2), a(3)], "a set replaces the portrait; inline data is skipped");
  assert.equal(referencesFor({ referenceImages: [a(1), a(2), a(3), a(4), a(5), a(6)] }).length, MAX_REFERENCES);
  assert.deepEqual(referencesFor({ referenceImages: [a(2), a(2)] }), [a(2)], "no duplicates");
  const s = { prompt: "x", loras: [] };
  assert.equal(withReferences(s, []), s, "nothing to add, settings unchanged");
  assert.deepEqual(withReferences(s, [a(1)]).referenceImages, [a(1)]);
});

test("injecting: each picture is uploaded into the next image input; extras are not sent", async () => {
  const { injectReferences } = await import("../../lib/media/imageLook.ts");
  const wf = { "4": { inputs: { image: "start.png" } }, "7": { inputs: { image: "ref.png" } }, "9": { inputs: { x: 1 } } };
  const uploaded = [];
  const n = await injectReferences(wf, ["7.inputs.image", "4.inputs.image"], ["/api/assets/a", "/api/assets/b", "/api/assets/c"],
    async (u) => { uploaded.push(u); return `up-${u.slice(-1)}.png`; });
  assert.equal(n, 2);
  assert.deepEqual(uploaded, ["/api/assets/a", "/api/assets/b"], "the third has no input to go to, so it is not uploaded");
  assert.deepEqual([wf["7"].inputs.image, wf["4"].inputs.image], ["up-a.png", "up-b.png"], "the primary goes to the first input");
  const wf2 = { "4": { inputs: { image: "start.png" } } };
  assert.equal(await injectReferences(wf2, ["4.inputs.image"], [], async () => { throw new Error("must not upload"); }), 0);
  assert.equal(wf2["4"].inputs.image, "start.png", "no pictures: the workflow's own image stays");
  assert.equal(await injectReferences(wf2, undefined, ["/api/assets/a"], async () => { throw new Error("must not upload"); }), 0, "a workflow without image inputs ignores references");
});
