// Reading ComfyUI workflows: the detector must find what the bundled
// templates' hand-written mappings say, read video and Flux graphs, refuse the
// UI-format save with a useful message, and list missing node types.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { readWorkflow, missingNodeTypes, withMapping } = await import("../../lib/media/workflowDetect.ts");
const dir = new URL("../../workflows/", import.meta.url);

test("every bundled template is read exactly as its hand-written mapping says", () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const wf = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
    const r = readWorkflow(wf);
    assert.ok(r.ok, f);
    for (const [k, v] of Object.entries(wf._meta.fablechat)) {
      if (k === "loraSyntaxNode" || k === "purpose" || k === "ownSampling" || k === "loraChain") continue; // chosen by hand, never guessed
      assert.deepEqual(r.mapping[k] ?? null, v ?? null, `${f}: ${k}`);
    }
    assert.equal(r.isVideo, wf._meta.fablechat.purpose === "video", `${f}: video is detected exactly when it is a video workflow`);
  }
});

// A minimal WAN image-to-video graph in API format: WanImageToVideo passes BOTH
// conditionings through, and takes the start frame from a LoadImage.
const wan = {
  "1": { class_type: "CLIPLoader", inputs: { clip_name: "umt5.safetensors", type: "wan" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "a woman turns to the camera", clip: ["1", 0] } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "blurry, static", clip: ["1", 0] } },
  "4": { class_type: "LoadImage", inputs: { image: "start.png" } },
  "5": { class_type: "WanImageToVideo", inputs: { positive: ["2", 0], negative: ["3", 0], vae: ["9", 0], start_image: ["4", 0], width: 832, height: 480, length: 81, batch_size: 1 } },
  "6": { class_type: "KSampler", inputs: { seed: 7, steps: 20, cfg: 6, sampler_name: "uni_pc", scheduler: "simple", denoise: 1, model: ["8", 0], positive: ["5", 0], negative: ["5", 1], latent_image: ["5", 2] } },
  "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["9", 0] } },
  "8": { class_type: "UNETLoader", inputs: { unet_name: "wan2.1_i2v.safetensors", weight_dtype: "default" } },
  "9": { class_type: "VAELoader", inputs: { vae_name: "wan_vae.safetensors" } },
  "10": { class_type: "CreateVideo", inputs: { images: ["7", 0], fps: 16 } },
  "11": { class_type: "SaveVideo", inputs: { video: ["10", 0], filename_prefix: "clip", format: "mp4", codec: "h264" } },
};

test("a WAN image-to-video graph: both prompts on the right side, size, length, start frame", () => {
  const r = readWorkflow(wan);
  assert.ok(r.ok);
  assert.equal(r.isVideo, true);
  assert.equal(r.mapping.purpose, "video");
  assert.equal(r.mapping.promptNode, "2.inputs.text");
  assert.equal(r.mapping.negativePromptNode, "3.inputs.text", "the negative is followed on the negative side");
  assert.deepEqual([r.mapping.seedNode, r.mapping.stepsNode, r.mapping.cfgNode], ["6.inputs.seed", "6.inputs.steps", "6.inputs.cfg"]);
  assert.deepEqual([r.mapping.widthNode, r.mapping.heightNode, r.mapping.videoLengthNode], ["5.inputs.width", "5.inputs.height", "5.inputs.length"]);
  assert.deepEqual(r.mapping.referenceImageNodes, ["4.inputs.image"]);
  assert.ok(!r.candidates.promptNode.some((c) => c.path === "8.inputs.unet_name"), "model file names are not offered as prompts");
});

test("a prompt held in a separate string node is found through the link", () => {
  const r = readWorkflow({
    "1": { class_type: "PrimitiveStringMultiline", inputs: { value: "" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: ["1", 0], clip: ["5", 0] } },
    "3": { class_type: "FluxGuidance", inputs: { conditioning: ["2", 0], guidance: 3.5 } },
    "4": { class_type: "KSampler", inputs: { seed: ["6", 0], steps: 25, cfg: 1, positive: ["3", 0], negative: ["2", 0], latent_image: ["7", 0] } },
    "6": { class_type: "PrimitiveInt", inputs: { value: 42 } },
    "7": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  });
  assert.equal(r.mapping.promptNode, "1.inputs.value");
  assert.equal(r.mapping.seedNode, "6.inputs.value");
  assert.equal(r.mapping.negativePromptNode, null, "a negative that resolves to the same text as the prompt is no negative");
});

test("the UI-format save is refused with how to get the right export; junk is refused", () => {
  const ui = readWorkflow({ nodes: [{ id: 1, type: "KSampler" }], links: [], version: 0.4 });
  assert.equal(ui.ok, false);
  assert.match(ui.error, /Export \(API\)/);
  assert.equal(readWorkflow("{not json").ok, false);
  assert.equal(readWorkflow({ a: 1 }).ok, false);
});

test("missing node types are named; the mapping is stored where FableChat reads it", () => {
  const r = readWorkflow(wan);
  assert.deepEqual(missingNodeTypes(r.classTypes, { KSampler: {}, CLIPTextEncode: {}, LoadImage: {}, VAEDecode: {}, CLIPLoader: {}, UNETLoader: {}, VAELoader: {} }),
    ["CreateVideo", "SaveVideo", "WanImageToVideo"]);
  const saved = withMapping(wan, r.mapping, "WAN clip");
  assert.equal(saved._meta.title, "WAN clip");
  assert.equal(saved._meta.fablechat.videoLengthNode, "5.inputs.length");
  assert.equal(saved["6"].class_type, "KSampler", "the graph itself is untouched");
});

test("a size measured from a picture is not mapped onto the picture scaler's settings", () => {
  const r = readWorkflow({
    "1": { class_type: "LoadImage", inputs: { image: "start.png" } },
    "2": { class_type: "ImageScaleToTotalPixels", inputs: { upscale_method: "lanczos", megapixels: 1, resolution_steps: 32, image: ["1", 0] } },
    "3": { class_type: "GetImageSize", inputs: { image: ["2", 0] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: ["3", 0], height: ["3", 1], batch_size: 1 } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: "a street", clip: ["9", 0] } },
    "6": { class_type: "KSampler", inputs: { seed: 1, steps: 8, cfg: 1, positive: ["5", 0], negative: ["5", 0], latent_image: ["4", 0] } },
  });
  assert.ok(r.ok);
  assert.equal(r.mapping.widthNode, null, "width follows the picture, it is not 2.inputs.megapixels");
  assert.equal(r.mapping.heightNode, null);
});

test("a value behind a Reroute is still found", () => {
  const r = readWorkflow({
    "1": { class_type: "PrimitiveInt", inputs: { value: 768 } },
    "2": { class_type: "Reroute", inputs: { "": ["1", 0] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: ["2", 0], height: 1344, batch_size: 1 } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: "a street", clip: ["9", 0] } },
    "6": { class_type: "KSampler", inputs: { seed: 1, steps: 8, cfg: 1, positive: ["5", 0], negative: ["5", 0], latent_image: ["4", 0] } },
  });
  assert.ok(r.ok);
  assert.equal(r.mapping.widthNode, "1.inputs.value");
  assert.equal(r.mapping.heightNode, "4.inputs.height");
});
