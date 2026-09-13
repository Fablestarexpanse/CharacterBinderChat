// queueImage is the owner of the image path: it creates the job, registers it
// with the store, frees the GPU, and drives the ComfyUI pipeline in the
// background. It was extracted out of the provider adapter, which had it
// calling one of the app's own routes from inside transport code, so what is
// asserted here is the ownership: the job exists immediately, and every
// outcome — success or failure — lands back on the store rather than escaping
// as an unhandled rejection.

import { test } from "node:test";
import assert from "node:assert/strict";

const { queueImage } = await import("../../lib/chat/imageGen.ts");
const { useFableStore } = await import("../../lib/store/index.ts");

const settings = { prompt: "a grey pebble", workflow: "krea2-lora-pipeline", seed: -1, batchCount: 1 };

/** Wait for the background pipeline to settle the job. */
async function settled(jobId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = useFableStore.getState().imageJobs.find((j) => j.id === jobId);
    if (job && job.status !== "queued" && job.status !== "generating") return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job never left the queued state");
}

test("the job is registered with the store before anything is awaited", () => {
  globalThis.fetch = async () => new Response("{}", { status: 200 });

  const job = queueImage(settings, "c1");

  assert.equal(job.status, "queued", "the caller gets a job it can render straight away");
  assert.equal(job.chatId, "c1");
  assert.equal(job.prompt, settings.prompt);
  assert.ok(useFableStore.getState().imageJobs.some((j) => j.id === job.id),
    "queueImage registers the job itself — three call sites used to do it by hand");
});

test("an unreachable ComfyUI fails the job with a reason rather than throwing", async () => {
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("ollama/unload")) return new Response("{}", { status: 200 });
    throw new Error("ECONNREFUSED");
  };

  const job = await settled(queueImage(settings).id);

  assert.equal(job.status, "failed");
  assert.match(job.error, /not reachable|ECONNREFUSED/);
  assert.ok(job.completedAt, "a finished job carries when it finished, however it ended");
});

test("a queue response with no prompt_id fails the job instead of hanging", async () => {
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("system_stats")) return new Response("{}", { status: 200 });
    if (url.includes("workflows/")) return new Response(JSON.stringify({ "6": {} }), { status: 200 });
    if (url.includes("comfyui/prompt")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response("{}", { status: 200 });
  };

  const job = await settled(queueImage(settings).id);

  assert.equal(job.status, "failed");
  assert.match(job.error, /prompt_id/,
    "this used to poll history/undefined for five minutes and then report a timeout");
});

test("the GPU-free step runs before the connection check", async () => {
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);
    if (url.includes("system_stats")) throw new Error("stop here");
    return new Response("{}", { status: 200 });
  };

  await settled(queueImage(settings).id);

  const unloadAt = calls.findIndex((u) => u.includes("ollama/unload"));
  const checkAt  = calls.findIndex((u) => u.includes("system_stats"));
  assert.ok(unloadAt !== -1, "the unload call belongs to this owner, not to the provider adapter");
  assert.ok(unloadAt < checkAt, "evicting Ollama has to happen before the render starts");
});
