// The built-in memory model: llama.cpp and the memory model run by FableChat
// for people without Ollama. Nothing is downloaded or started here: the files
// are stand-ins, and the "running server" is a stubbed fetch that accepts the
// key the state records, which is how a running one is recognised.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-builtin-"));
process.env.FABLE_DB_PATH = path.join(dir, "t.db");
const M = await import("../../lib/server/builtinModel.ts");
const B = await import("../../lib/server/backgroundModel.ts");
const { getStore, closeStore } = await import("../../lib/db/index.ts");
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; closeStore(); fs.rmSync(dir, { recursive: true, force: true }); });

const OLLAMA = "http://ollama.test:11434";
const chat = { providerType: "openrouter", providerBaseUrl: "https://openrouter.ai/api", modelId: "anthropic/x", apiKey: "k" };
const exe = process.platform === "win32" ? "llama-server.exe" : "llama-server";

test("every platform with a download is pinned to a hash, and others have none", () => {
  for (const [p, a] of [["win32", "x64"], ["linux", "x64"], ["darwin", "arm64"]]) {
    const asset = M.assetForHere(p, a);
    assert.ok(asset, `${p}-${a}`);
    assert.match(asset.sha256, /^[0-9a-f]{64}$/);
    assert.ok(asset.file.includes(M.LLAMA_BUILD));
  }
  assert.equal(M.assetForHere("freebsd", "x64"), null);
  assert.match(M.GGUF.sha256, /^[0-9a-f]{64}$/);
  assert.match(M.GGUF.revision, /^[0-9a-f]{40}$/, "the model is fetched at a commit, not a branch");
});

test("llama-server is found however deep the archive nests it", () => {
  const root = path.join(dir, "find");
  fs.mkdirSync(path.join(root, "a", "build", "bin"), { recursive: true });
  assert.equal(M.findServer(root), null);
  fs.writeFileSync(path.join(root, "a", "build", "bin", exe), "");
  assert.equal(M.findServer(root), path.join(root, "a", "build", "bin", exe));
});

test("not set up: a memory job says so instead of spending the chat model", async () => {
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  B.setBackground({ fallbackToChat: false });
  await assert.rejects(B.backgroundModel({ ollamaBaseUrl: OLLAMA }, chat), /built-in model is not set up/);
});

test("set up and running: memory uses it, with its own key, when Ollama is not there", async () => {
  const folder = path.join(dir, "model");
  fs.mkdirSync(path.join(folder, `llama-${M.LLAMA_BUILD}`, "bin"), { recursive: true });
  fs.writeFileSync(path.join(folder, `llama-${M.LLAMA_BUILD}`, "bin", exe), "");
  fs.writeFileSync(path.join(folder, M.GGUF.file), "");
  getStore().setKv("builtin:model", JSON.stringify({ folder, installed: true, port: 45999, token: "tok" }));
  assert.equal(M.builtinReady(), true);

  globalThis.fetch = async (url, init) => {
    if (String(url) === "http://127.0.0.1:45999/v1/models") {
      return new Response("{}", { status: init?.headers?.Authorization === "Bearer tok" ? 200 : 401 });
    }
    throw new TypeError("fetch failed");
  };
  B.setBackground({ fallbackToChat: true });
  assert.deepEqual(await B.backgroundModel({ ollamaBaseUrl: OLLAMA }, chat),
    { providerType: "lmstudio", providerBaseUrl: "http://127.0.0.1:45999", modelId: "fable-memory", apiKey: "tok" },
    "the built-in model comes before the chat's model, even with the fallback on");
  await M.stopBuiltin();
});

test("its state is a machine key: never in a backup, never restored", async () => {
  const { MACHINE_KEYS } = await import("../../lib/db/backup.ts");
  assert.ok(MACHINE_KEYS.includes("builtin:model"));
});
