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

test("the likeness switch: your own photo workflow with an image input first, else the bundled one, else unchanged", async () => {
  const { likenessWorkflow, settingsForPerson, BUNDLED_LIKENESS, cleanImageLook } = await import("../../lib/media/imageLook.ts");
  const wf = (slug, source, purpose, controls) => ({ slug, source, purpose, controls });
  const bundled = wf(BUNDLED_LIKENESS, "bundled", "photo", ["prompt", "referenceImage"]);
  const mine = wf("my-faces", "imported", "portrait", ["prompt", "referenceImage"]);
  const noInput = wf("my-scenes", "imported", "photo", ["prompt"]);
  assert.equal(likenessWorkflow([noInput, bundled, mine]), "my-faces");
  assert.equal(likenessWorkflow([noInput, bundled]), BUNDLED_LIKENESS);
  assert.equal(likenessWorkflow([noInput]), null);
  assert.equal(cleanImageLook({ likeness: "yes" }), undefined, "only a real true turns it on");

  const ref = "/api/assets/" + "a".repeat(64);
  const who = { image: { tags: "grey coat", likeness: true }, referenceImages: [ref] };
  const s = settingsForPerson(base, who, [bundled]);
  assert.equal(s.workflow, BUNDLED_LIKENESS);
  assert.deepEqual(s.referenceImages, [ref]);
  assert.match(s.prompt, /^grey coat, /);
  assert.equal(settingsForPerson(base, { image: { likeness: true } }, [bundled]).workflow, "w", "no pictures to keep a face from: the usual workflow");
  assert.equal(settingsForPerson(base, { ...who, image: { tags: "grey coat" } }, [bundled]).workflow, "w", "switch off: the usual workflow");
  assert.equal(settingsForPerson(base, undefined, [bundled]), base);
});

test("an unfilled picture slot that only feeds an optional reference input is taken out", async () => {
  const { injectReferences } = await import("../../lib/media/imageLook.ts");
  const wf = {
    "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
    "2": { class_type: "LoadImage", inputs: { image: "example.png" } },
    "3": { class_type: "LoadImage", inputs: { image: "example.png" } },
    "5": { class_type: "ImageScaleToTotalPixels", inputs: { image: ["1", 0] } },
    "11": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { prompt: "", "ref_images.ref_image_0": ["1", 0], "ref_images.ref_image_1": ["2", 0], "ref_images.ref_image_2": ["3", 0] } },
    "20": { class_type: "LoadImage", inputs: { image: "face.png" } },
    "21": { class_type: "IPAdapterFaceID", inputs: { image: ["20", 0] } },
  };
  const n = await injectReferences(wf, ["1.inputs.image", "2.inputs.image", "3.inputs.image", "20.inputs.image"], ["/api/assets/a", "/api/assets/b"], async (u) => `up-${u.slice(-1)}.png`);
  assert.equal(n, 2);
  assert.deepEqual(Object.keys(wf["11"].inputs), ["prompt", "ref_images.ref_image_0", "ref_images.ref_image_1"], "H3 is not told about a third person");
  assert.equal(wf["3"], undefined, "the empty slot is gone, so ComfyUI does not look for example.png");
  assert.equal(wf["1"].inputs.image, "up-a.png");
  assert.equal(wf["20"].inputs.image, "face.png", "a slot feeding a required input keeps the workflow's own picture");
});

test("a clip's people: the sender first, each once, only with a picture; labels follow H3's reference format", async () => {
  const { clipPeople, referenceLines, isReferenceWorkflow } = await import("../../lib/media/clipRefs.ts");
  const people = clipPeople([
    { name: "Ronan", picture: "/api/assets/r" },
    { name: "Kira", picture: "/api/assets/k" },
    { name: "Fenna" },
    { name: "Ronan", picture: "/api/assets/r" },
    { name: "Ash", picture: "/api/assets/a" },
    { name: "Bo", picture: "/api/assets/b" },
  ]);
  assert.deepEqual(people.map((p) => p.name), ["Ronan", "Kira", "Ash"], "no picture, no reference; nobody twice; three at most beside the photo");
  const r = referenceLines(people);
  assert.match(r.subjects, /^<Picture 1> is the first frame of \[Shot 1\]/);
  assert.match(r.subjects, /<Subject 1> is Ronan, .*<Picture 2>/);
  assert.match(r.subjects, /<Subject 3> is Ash, .*<Picture 4>/);
  assert.equal(r.retention.split("\n").length, 4);
  assert.equal(r.names, "Ronan (<Subject 1>), Kira (<Subject 2>), Ash (<Subject 3>)");
  assert.equal(referenceLines([]).names, "the people in the photo");
  assert.ok(isReferenceWorkflow(["CLIPLoader", "MiniMaxH3ReferenceToVideo"]));
  assert.ok(!isReferenceWorkflow(["MiniMaxH3ImageToVideo"]));
});
