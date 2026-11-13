// ─── The built-in memory model ────────────────────────────────────────────────
// Server-only. For people without Ollama: FableChat downloads llama.cpp's own
// server program and the memory model (the same Qwen3 4B Instruct that Ollama
// would use, as one GGUF file) into a folder, and runs it itself.
//
// Nothing is downloaded until you press Set up (Settings → Memory). Both
// downloads are pinned (a fixed llama.cpp build, a fixed model revision) and
// checked against their SHA-256 before anything is used, so a change upstream
// cannot change what runs here.
//
// The server binds 127.0.0.1 on a free port and answers only requests carrying
// a key FableChat makes for each start (llama-server's --api-key). It is
// started when a memory job needs it and stopped after IDLE_MS without one, so
// its memory goes back. A server left running by an earlier FableChat (one
// that was closed, or restarted by the dev server) is recognised by its key
// and used rather than started twice.

import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { getStore } from "@/lib/db";
import type { LlmBackend } from "@/lib/llm/callers";
import { MEMORY_MODEL } from "@/lib/llm/memoryModel";

const KEY = "builtin:model";

/** llama.cpp build b11938 (27 Oct 2026); digests as GitHub publishes them for the release assets */
export const LLAMA_BUILD = "b11938";
const LLAMA_ASSETS: Record<string, { file: string; sha256: string; mb: number }> = {
  "win32-x64":    { file: `llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`,     sha256: "9ecd072c6e785fa2b932229c86f845695198195c4f29b99b85ed42dccb022aa6", mb: 37 },
  "win32-arm64":  { file: `llama-${LLAMA_BUILD}-bin-win-vulkan-arm64.zip`,   sha256: "5de32ff0a4cca93c3b81c6a01489cd66259650228efe1ad8f80b63904bf6e91c", mb: 25 },
  "linux-x64":    { file: `llama-${LLAMA_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`, sha256: "9d78c8eae0be03d36665753d1a1a7f360fd18186265f1064e07d8f64eff71f3c", mb: 35 },
  "linux-arm64":  { file: `llama-${LLAMA_BUILD}-bin-ubuntu-vulkan-arm64.tar.gz`, sha256: "96562ade9975a4aa305213f60ee121957eee467f016076a6ed5494413aa88cc0", mb: 29 },
  "darwin-arm64": { file: `llama-${LLAMA_BUILD}-bin-macos-arm64.tar.gz`,     sha256: "b1ed33aacd0927eaa69644e6b15e3206115f7f80dfc7501de86df89dab853e9f", mb: 16 },
  "darwin-x64":   { file: `llama-${LLAMA_BUILD}-bin-macos-x64.tar.gz`,       sha256: "c3b337022a7744ca459fa04cc36c890089af774cff9d1a35921b0db9011ac7dd", mb: 12 },
};
const llamaUrl = (file: string) => `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${file}`;

/** The memory model as one GGUF file, at a fixed revision of its repository */
export const GGUF = {
  repo: "unsloth/Qwen3-4B-Instruct-2507-GGUF",
  revision: "a06e946bb6b655725eafa393f4a9745d460374c9",
  file: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
  bytes: 2_497_281_120,
};
const ggufUrl = () => `https://huggingface.co/${GGUF.repo}/resolve/${GGUF.revision}/${GGUF.file}`;

/** The model name the server answers to */
const ALIAS = "fable-memory";
/** Stopped after this long without a memory job */
const IDLE_MS = 10 * 60_000;
/** Context window: memory prompts are a few thousand tokens */
const CONTEXT = 8192;

export interface BuiltinState {
  folder: string | null;
  installed: boolean;
  installedAt?: string;
  build?: string;
  /** The running server, as last started (it may outlive a FableChat restart) */
  port?: number;
  token?: string;
  pid?: number;
}

const DEFAULT: BuiltinState = { folder: null, installed: false };

export function getBuiltin(): BuiltinState {
  const raw = getStore().getKv(KEY);
  if (!raw) return DEFAULT;
  try { return { ...DEFAULT, ...(JSON.parse(raw) as Partial<BuiltinState>) }; } catch { return DEFAULT; }
}
function saveBuiltin(s: BuiltinState) { getStore().setKv(KEY, JSON.stringify(s)); }

/** The llama.cpp download for this computer, or null when there is none */
export function assetForHere(platform: string = process.platform, arch: string = process.arch) {
  return LLAMA_ASSETS[`${platform}-${arch}`] ?? null;
}

/** The default folder: next to the database, outside git (see .gitignore) */
export const defaultFolder = () => path.join(process.cwd(), "data", "local-model");

const exeName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
const llamaDir = (folder: string) => path.join(folder, `llama-${LLAMA_BUILD}`);
const ggufPath = (folder: string) => path.join(folder, GGUF.file);

/** llama-server inside the unpacked build (the archives nest it at different depths) */
export function findServer(dir: string, depth = 0): string | null {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const hit = entries.find((e) => e.isFile() && e.name === exeName);
  if (hit) return path.join(dir, hit.name);
  if (depth >= 3) return null;
  for (const e of entries) if (e.isDirectory()) {
    const found = findServer(path.join(dir, e.name), depth + 1);
    if (found) return found;
  }
  return null;
}

// ── Install ──────────────────────────────────────────────────────────────────

export interface InstallState {
  running: boolean;
  step: string;
  /** Bytes of the current download */
  done: number;
  total: number;
  error?: string;
  finishedAt?: string;
}
let install: InstallState = { running: false, step: "", done: 0, total: 0 };
export const installState = () => install;

/** Download `url` to `dest`, hashing as it goes; refuses (and deletes) a file whose SHA-256 is not `sha256`. */
async function download(url: string, dest: string, sha256: string, size?: number): Promise<void> {
  if (fs.existsSync(dest) && (!size || fs.statSync(dest).size === size)) {
    install.step += " (checking the copy already here)";
    if (await hashFile(dest) === sha256) return;
    fs.rmSync(dest, { force: true });
  }
  const part = `${dest}.part`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status}): ${url}`);
  install.total = Number(res.headers.get("content-length")) || size || 0;
  install.done = 0;
  const hash = createHash("sha256");
  const out = fs.createWriteStream(part);
  try {
    for await (const chunk of Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>)) {
      const buf = chunk as Buffer;
      hash.update(buf);
      install.done += buf.length;
      if (!out.write(buf)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw e;
  }
  const got = hash.digest("hex");
  if (got !== sha256) {
    fs.rmSync(part, { force: true });
    throw new Error(`${path.basename(dest)} is not the file FableChat expects (sha256 ${got}); it was deleted, not used`);
  }
  fs.renameSync(part, dest);
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

/** The system's tar (bsdtar on Windows 10+ also reads .zip), by absolute path, run without a shell */
function tarExe(): string {
  if (process.platform === "win32") return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return fs.existsSync("/usr/bin/tar") ? "/usr/bin/tar" : "/bin/tar";
}

function unpack(archive: string, into: string): Promise<void> {
  fs.mkdirSync(into, { recursive: true });
  return new Promise((resolve, reject) => {
    const p = spawn(tarExe(), ["-xf", archive, "-C", into], { shell: false, windowsHide: true });
    let err = "";
    p.stderr.on("data", (d: Buffer) => { err += d.toString("utf8"); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`could not unpack llama.cpp (tar exited ${code}): ${err.slice(0, 300)}`))));
  });
}

/**
 * Download llama.cpp and the model into `folder`, then check the model answers.
 * Returns at once; follow it with installState(). Running it again only fetches
 * what is missing.
 */
export function startInstall(folderIn: string): { ok: true } | { ok: false; error: string } {
  if (install.running) return { ok: true };
  if (!path.isAbsolute(folderIn)) return { ok: false, error: "Use a full folder path." };
  const asset = assetForHere();
  if (!asset) return { ok: false, error: `There is no built-in model for this computer (${process.platform} ${process.arch}). Install Ollama instead.` };
  const folder = path.resolve(folderIn);
  install = { running: true, step: "Getting ready", done: 0, total: 0 };
  void (async () => {
    try {
      await stopBuiltin();
      fs.mkdirSync(folder, { recursive: true });
      saveBuiltin({ ...getBuiltin(), folder, installed: false });

      install.step = `Downloading llama.cpp (${asset.mb} MB)`;
      const archive = path.join(folder, asset.file);
      await download(llamaUrl(asset.file), archive, asset.sha256);
      install.step = "Unpacking llama.cpp";
      if (!findServer(llamaDir(folder))) await unpack(archive, llamaDir(folder));
      if (!findServer(llamaDir(folder))) throw new Error("llama-server was not in the download");
      fs.rmSync(archive, { force: true });

      install.step = `Downloading ${MEMORY_MODEL.label} (${(GGUF.bytes / 1e9).toFixed(1)} GB)`;
      await download(ggufUrl(), ggufPath(folder), GGUF.sha256, GGUF.bytes);

      install.step = "Checking it answers";
      install.done = install.total = 0;
      saveBuiltin({ ...getBuiltin(), folder, installed: true, installedAt: new Date().toISOString(), build: LLAMA_BUILD });
      const backend = await ensureBuiltin();
      const res = await fetch(`${backend.providerBaseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${backend.apiKey}` },
        body: JSON.stringify({ model: ALIAS, max_tokens: 8, messages: [{ role: "user", content: "Reply with the word ready." }] }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`the model did not answer (HTTP ${res.status})`);
      install.step = "Ready";
    } catch (e) {
      install.error = e instanceof Error ? e.message : String(e);
      const s = getBuiltin();
      if (install.step !== "Checking it answers") saveBuiltin({ ...s, installed: false });
    } finally {
      install.running = false;
      install.finishedAt = new Date().toISOString();
    }
  })();
  return { ok: true };
}

/** Whether the files are there, without starting anything */
export function builtinReady(s: BuiltinState = getBuiltin()): boolean {
  return !!s.installed && !!s.folder && !!findServer(llamaDir(s.folder)) && fs.existsSync(ggufPath(s.folder));
}

// ── Running ──────────────────────────────────────────────────────────────────

let child: ChildProcess | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let starting: Promise<LlmBackend> | null = null;
let lastLog = "";

const backendFor = (port: number, token: string): LlmBackend =>
  ({ providerType: "lmstudio", providerBaseUrl: `http://127.0.0.1:${port}`, modelId: ALIAS, apiKey: token });

/** "ours" when the server on `port` accepts `token`, "loading" while it loads, "foreign" for anything else answering, null for nothing */
async function probe(port: number, token: string): Promise<"ours" | "loading" | "foreign" | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1500) });
    if (res.ok) return "ours";
    if (res.status === 503) return "loading";
    return "foreign";
  } catch { return null; }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (addr && typeof addr === "object" ? resolve(addr.port) : reject(new Error("no free port"))));
    });
  });
}

function touch() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { void stopBuiltin(); }, IDLE_MS);
  idleTimer.unref?.();
}

/** Start the server if it is not running, wait until the model is loaded, and return how to reach it. */
export function ensureBuiltin(): Promise<LlmBackend> {
  if (starting) return starting;
  starting = (async () => {
    const s = getBuiltin();
    if (!builtinReady(s)) throw new Error("the built-in model is not set up (Settings → Memory)");
    if (s.port && s.token) {
      const p = await probe(s.port, s.token);
      if (p === "ours") { touch(); return backendFor(s.port, s.token); }
    }
    const exe = findServer(llamaDir(s.folder!))!;
    // GPU first (Vulkan / Metal); if it will not start that way, the CPU
    for (const gpu of [true, false]) {
      const port = await freePort();
      const token = randomBytes(24).toString("hex");
      lastLog = "";
      const args = ["-m", ggufPath(s.folder!), "--host", "127.0.0.1", "--port", String(port), "--api-key", token,
        "--alias", ALIAS, "-c", String(CONTEXT), "-ngl", gpu ? "99" : "0"];
      const proc = spawn(exe, args, { cwd: path.dirname(exe), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const keep = (d: Buffer) => { lastLog = (lastLog + d.toString("utf8")).slice(-4000); };
      proc.stdout?.on("data", keep);
      proc.stderr?.on("data", keep);
      let exited = false;
      proc.on("exit", () => { exited = true; if (child === proc) child = null; });
      child = proc;
      saveBuiltin({ ...getBuiltin(), port, token, pid: proc.pid });
      for (let i = 0; i < 240 && !exited; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const p = await probe(port, token);
        if (p === "ours") { touch(); return backendFor(port, token); }
        if (p === "foreign") { proc.kill(); throw new Error("something else answered on the built-in model's port"); }
      }
      if (!exited) { proc.kill(); throw new Error("the built-in model took too long to load"); }
    }
    const tail = lastLog.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 300);
    throw new Error(`the built-in model would not start${tail ? `: ${tail}` : ""}`);
  })().finally(() => { starting = null; });
  return starting;
}

/** Stop the server (ours from this run, or one an earlier FableChat left, recognised by its key). */
export async function stopBuiltin(): Promise<void> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (child) { child.kill(); child = null; }
  const s = getBuiltin();
  if (s.pid && s.port && s.token && (await probe(s.port, s.token)) === "ours") {
    try { process.kill(s.pid); } catch { /* already gone */ }
  }
  if (s.port || s.token || s.pid) saveBuiltin({ ...s, port: undefined, token: undefined, pid: undefined });
}

/** Is it running right now (without starting it)? */
export async function builtinRunning(): Promise<boolean> {
  const s = getBuiltin();
  return !!(s.port && s.token) && (await probe(s.port, s.token)) === "ours";
}

/** Stop it and delete its files. */
export async function removeBuiltin(): Promise<void> {
  await stopBuiltin();
  const s = getBuiltin();
  if (s.folder) {
    fs.rmSync(llamaDir(s.folder), { recursive: true, force: true });
    fs.rmSync(ggufPath(s.folder), { force: true });
    fs.rmSync(`${ggufPath(s.folder)}.part`, { force: true });
  }
  saveBuiltin({ folder: s.folder, installed: false });
}
