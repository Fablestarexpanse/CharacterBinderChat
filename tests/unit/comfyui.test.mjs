// The ComfyUI adapter, driven against a stubbed fetch. Everything here talks
// to a machine that is often not running and, when it is, answers with shapes
// nothing validates — which is exactly why the queue response now gets
// checked: a 200 with no prompt_id used to hand undefined to the poller, which
// then asked for history/undefined until the five-minute timeout and reported
// a generic failure with no cause.

import { test } from "node:test";
import assert from "node:assert/strict";

const { ComfyUIProvider, dimensionsForRatio } = await import("../../lib/providers/comfyui.ts");

/** Answer each request from a list of [urlSubstring, response] rules. */
function stubFetch(rules) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    for (const [match, respond] of rules) {
      if (url.includes(match)) return respond(url, init);
    }
    throw new Error(`unstubbed request: ${url}`);
  };
  return calls;
}

const json = (body, status = 200) =>
  () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("every aspect ratio resolves to real dimensions, custom to null", () => {
  for (const ratio of ["1:1", "16:9", "9:16", "4:3", "3:4", "2:1"]) {
    const size = dimensionsForRatio(ratio);
    assert.ok(size, `${ratio} should resolve`);
    assert.equal(size.width % 32, 0, `${ratio} width should snap to 32px`);
    assert.equal(size.height % 32, 0, `${ratio} height should snap to 32px`);
    assert.ok(size.width >= 256 && size.height >= 256);
  }
  assert.equal(dimensionsForRatio("custom"), null, "custom means the user typed their own");
});

test("a wide ratio is wider than tall, and its mirror is the reverse", () => {
  const wide = dimensionsForRatio("16:9");
  const tall = dimensionsForRatio("9:16");
  assert.ok(wide.width > wide.height);
  assert.equal(wide.width, tall.height);
  assert.equal(wide.height, tall.width);
});

test("queuePrompt returns the prompt id and strips FableChat's own _meta", async () => {
  let sentBody = null;
  stubFetch([["comfyui/prompt", (_url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ prompt_id: "abc-123" }), { status: 200 });
  }]]);

  const id = await new ComfyUIProvider("http://127.0.0.1:8188")
    .queuePrompt({ "6": { class_type: "CLIPTextEncode" }, _meta: { fablechat: {} } });

  assert.equal(id, "abc-123");
  assert.equal("_meta" in sentBody.prompt, false, "ComfyUI reads every top-level key as a node");
  assert.ok("6" in sentBody.prompt);
});

test("a 200 with no prompt_id throws instead of returning undefined", async () => {
  stubFetch([["comfyui/prompt", json({ ok: true })]]);

  await assert.rejects(
    () => new ComfyUIProvider().queuePrompt({}),
    /returned no prompt_id/,
    "undefined here used to be polled for five minutes before failing",
  );
});

test("a rejected workflow reports ComfyUI's own reason and the offending nodes", async () => {
  stubFetch([["comfyui/prompt", json(
    { error: { message: "Prompt has no outputs" }, node_errors: { "9": {} } }, 400)]]);

  await assert.rejects(
    () => new ComfyUIProvider().queuePrompt({}),
    (err) => err.message.includes("Prompt has no outputs") && err.message.includes("9"),
  );
});

test("checkConnection answers false rather than throwing when ComfyUI is down", async () => {
  stubFetch([["system_stats", () => { throw new Error("ECONNREFUSED"); }]]);
  assert.equal(await new ComfyUIProvider().checkConnection(), false);

  stubFetch([["system_stats", json({ system: {} })]]);
  assert.equal(await new ComfyUIProvider().checkConnection(), true);
});

test("listLoras returns [] when ComfyUI is unreachable rather than inventing names", async () => {
  stubFetch([["object_info", () => { throw new Error("ECONNREFUSED"); }]]);
  assert.deepEqual(await new ComfyUIProvider().listLoras(), []);

  stubFetch([["object_info", json({ LoraLoader: { input: { required: { lora_name: [["a.safetensors", 7, null]] } } } })]]);
  assert.deepEqual(await new ComfyUIProvider().listLoras(), ["a.safetensors"],
    "non-string enum members are dropped, not stringified");
});

test("waitForImages returns the proxied URLs once the prompt completes", async () => {
  const promptId = "p1";
  stubFetch([[`history/${promptId}`, json({
    [promptId]: {
      status: { completed: true },
      outputs: { "9": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } },
    },
  })]]);

  const urls = await new ComfyUIProvider().waitForImages(promptId, 5000);

  assert.equal(urls.length, 1);
  assert.ok(urls[0].startsWith("/api/comfyui/view?"), "images go through the app's proxy, not direct");
  assert.ok(urls[0].includes("filename=out.png"));
});

test("a workflow that finishes with no images says so", async () => {
  const promptId = "p2";
  stubFetch([[`history/${promptId}`, json({ [promptId]: { status: { completed: true }, outputs: {} } })]]);

  await assert.rejects(
    () => new ComfyUIProvider().waitForImages(promptId, 5000),
    /produced no images/,
  );
});

test("an execution error surfaces as an error rather than a timeout", async () => {
  const promptId = "p3";
  stubFetch([[`history/${promptId}`, json({ [promptId]: { status: { status_str: "error" } } })]]);

  await assert.rejects(
    () => new ComfyUIProvider().waitForImages(promptId, 5000),
    /execution error/,
  );
});

test("the base URL loses its trailing slash and falls back to the local default", () => {
  assert.equal(new ComfyUIProvider("http://host:8188/").baseUrl, "http://host:8188");
  assert.equal(new ComfyUIProvider("").baseUrl, "http://127.0.0.1:8188");
});

// Distilled and tuned workflows (Krea2 at 8 steps, MOSS at CFG 3 with
// dpmpp_2m_sde, H3 with res_multistep) keep their own sampling: Image Studio's
// numbers pushed into them produce noise or mush.
const tuned = {
  "4": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "6": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216, batch_size: 1 } },
  "7": { class_type: "KSampler", inputs: { seed: 0, steps: 30, cfg: 3, sampler_name: "dpmpp_2m_sde", scheduler: "beta" } },
  "9": { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "", length: 124 } },
  "_meta": { fablechat: { promptNode: "4.inputs.text", seedNode: "7.inputs.seed", stepsNode: "7.inputs.steps", cfgNode: "7.inputs.cfg", widthNode: "6.inputs.width", heightNode: "6.inputs.height", videoLengthNode: "9.inputs.length" } },
};
const studio = { workflow: "t", prompt: "a street", negativePrompt: "", width: 1024, height: 1024, steps: 8, cfg: 1, sampler: "euler", seed: 5, batchCount: 1, loras: [] };

test("a workflow that keeps its own sampling gets the prompt, seed and size but not steps, CFG or sampler", async () => {
  const wf = structuredClone(tuned);
  wf._meta.fablechat.ownSampling = true;
  stubFetch([["/api/workflows/t", json(wf)]]);
  const out = await new ComfyUIProvider().prepareWorkflow(studio);
  assert.equal(out["4"].inputs.text, "a street");
  assert.equal(out["7"].inputs.seed, 5);
  assert.equal(out["6"].inputs.width, 1024);
  assert.deepEqual([out["7"].inputs.steps, out["7"].inputs.cfg, out["7"].inputs.sampler_name, out["7"].inputs.scheduler], [30, 3, "dpmpp_2m_sde", "beta"]);

  stubFetch([["/api/workflows/t", json(structuredClone(tuned))]]);
  const plain = await new ComfyUIProvider().prepareWorkflow(studio);
  assert.deepEqual([plain["7"].inputs.steps, plain["7"].inputs.cfg, plain["7"].inputs.sampler_name], [8, 1, "euler"], "without the flag Image Studio's settings still apply");
});

test("a clip's length goes into the video length input, and only when asked", async () => {
  stubFetch([["/api/workflows/t", json(structuredClone(tuned))]]);
  assert.equal((await new ComfyUIProvider().prepareWorkflow({ ...studio, videoLength: 175 }))["9"].inputs.length, 175);
  stubFetch([["/api/workflows/t", json(structuredClone(tuned))]]);
  assert.equal((await new ComfyUIProvider().prepareWorkflow(studio))["9"].inputs.length, 124, "no length asked: the workflow's own stays");
});

test("a saved clip is returned like an image, and an interrupted prompt says Cancelled", async () => {
  stubFetch([["history/v1", json({ v1: { status: { completed: true }, outputs: { "18": { images: [{ filename: "h3_00001_.mp4", subfolder: "FableChat", type: "output" }], animated: [true] } } } })]]);
  const urls = await new ComfyUIProvider().waitForImages("v1", 5000);
  assert.ok(urls[0].includes("filename=h3_00001_.mp4"));
  stubFetch([["history/v2", json({ v2: { status: { completed: true }, outputs: { "5": { videos: [{ filename: "c.webm", subfolder: "", type: "output" }] } } } })]]);
  assert.ok((await new ComfyUIProvider().waitForImages("v2", 5000))[0].includes("filename=c.webm"), "a `videos` output counts too");
  stubFetch([["history/v3", json({ v3: { status: { status_str: "error", messages: [["execution_interrupted", {}]] } } })]]);
  await assert.rejects(() => new ComfyUIProvider().waitForImages("v3", 5000), /Cancelled/);
});

test("cancel takes the prompt out of the queue and interrupts only that prompt", async () => {
  const bodies = [];
  const calls = stubFetch([["comfyui/", (_u, init) => { bodies.push(JSON.parse(init.body)); return new Response("{}"); }]]);
  await new ComfyUIProvider().cancel("p9");
  assert.deepEqual(calls.map((c) => [c.url.split("?")[0], c.method]), [["/api/comfyui/queue", "POST"], ["/api/comfyui/interrupt", "POST"]]);
  assert.deepEqual(bodies, [{ delete: ["p9"] }, { prompt_id: "p9" }]);
});

test("Cancel stops the wait at once rather than at the timeout", async () => {
  stubFetch([["history/slow", json({})]]);
  const abort = new AbortController();
  const started = Date.now();
  setTimeout(() => abort.abort(), 50);
  await assert.rejects(() => new ComfyUIProvider().waitForImages("slow", 60_000, abort.signal), /Cancelled/);
  assert.ok(Date.now() - started < 3000);
});

test("a workflow refused for missing model files names the files, not node numbers", async () => {
  stubFetch([["comfyui/prompt", json({
    error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
    node_errors: {
      "4": { errors: [{ type: "value_not_in_list", message: "Value not in list", details: "unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors' not in ['a.safetensors']" }] },
      "7": { errors: [{ type: "value_not_in_list", message: "Value not in list", details: "vae_name: 'minimax_h3_video_vae_int8_convrot.safetensors' not in ['b.safetensors']" }] },
      "9": { errors: [{ type: "value_not_in_list", message: "Value not in list", details: "sampler_name: 'nope' not in ['euler']" }] },
    },
  }, 400)]]);
  await assert.rejects(() => new ComfyUIProvider().queuePrompt({ "4": {} }),
    (e) => e.message.includes("minimax_h3_fl2va_pruned_int8_convrot.safetensors, minimax_h3_video_vae_int8_convrot.safetensors") && !e.message.includes("nope"));
  stubFetch([["comfyui/prompt", json({ error: { message: "Prompt outputs failed validation" }, node_errors: { "3": { errors: [{ type: "required_input_missing", details: "model" }] } } }, 400)]]);
  await assert.rejects(() => new ComfyUIProvider().queuePrompt({ "3": {} }), /rejected the workflow: Prompt outputs failed validation \(nodes: 3\)/);
});
