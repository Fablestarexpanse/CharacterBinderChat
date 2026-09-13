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
