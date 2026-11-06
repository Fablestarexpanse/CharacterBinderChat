// ─── The local voice server: install, start, stop ─────────────────────────────
// Server-only. FableChat installs and runs its own VibeVoice server (voice/,
// built from SanDiegoDude/VibeVoice's engine), but only after you press
// "Download and set up" in Settings → Media: nothing is fetched before that.
//
// Install (into a folder you choose, because it is several GB):
//   uv (found on PATH, else downloaded) → a Python 3.11 venv → PyTorch (CUDA
//   when an NVIDIA GPU is present) → the VibeVoice engine pinned to one commit
//   of the fork → the model from Hugging Face → the fork's demo voices.
// Run: `python -m fable_voice.server` from this repo's voice/ folder, started on
// the first request and kept as a child of the Next server. The model itself
// loads in a worker that exits after an idle time, so the GPU is given back.
// Processes are spawned directly (never through a shell), as AGENTS.md asks.

import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { DEMO_VOICES } from "@/lib/media/voice";
import fs from "node:fs";
import path from "node:path";
import { getStore } from "@/lib/db";

/** The fork, pinned: its engine fixes (delayed end-of-speech, vocal isolation) are what we use */
export const ENGINE_GIT = "git+https://github.com/SanDiegoDude/VibeVoice@6cd02ae62dc722bc616c893fed8c7aebecfcc02b";
/** What the engine itself imports (its pyproject also lists gradio, av, aiortc, openai for the demo app) */
// Pinned to the versions setup was proven with (2026-11-05, Windows 11, CUDA 12.8): a new release of
// any of them cannot change what gets installed. Raise them together, after a run.
const ENGINE_NEEDS = [
  "accelerate==1.6.0", "transformers==4.51.3", "diffusers==0.39.0", "tqdm==4.70.1", "numpy==2.4.6", "scipy==1.17.1",
  "librosa==0.11.0", "soundfile==0.14.0", "huggingface_hub==0.36.2", "ml-collections==1.1.0", "absl-py==2.5.1",
  "rotary-embedding-torch==0.9.1", "einops==0.8.2",
];
/** PyTorch, pinned the same way (`==2.11.0` also matches the CUDA build, 2.11.0+cu128) */
const TORCH = ["torch==2.11.0", "torchaudio==2.11.0"];
/** uv, when it is not already installed: its official installer at a fixed version, checked before it runs */
const UV_VERSION = "0.6.14";
const UV_INSTALLER = process.platform === "win32"
  ? { url: `https://astral.sh/uv/${UV_VERSION}/install.ps1`, sha256: "fe542676776660e2db520f3b428274530c2c258b9ba3acfdc7aa80bd992eabfe", file: "install.ps1" }
  : { url: `https://astral.sh/uv/${UV_VERSION}/install.sh`, sha256: "de3669cd810357c33a9737c4ba4dc10f3c2ac9152ea5703438b06f942345b761", file: "install.sh" };
const DEMO_VOICES_BASE = "https://raw.githubusercontent.com/SanDiegoDude/VibeVoice/6cd02ae62dc722bc616c893fed8c7aebecfcc02b/demo/voices";
/** The demo voice files to fetch: one list, the one the editors offer (lib/media/voice.ts) */
const DEMO_FILES = DEMO_VOICES.map((d) => d.id.replace(/^demo:/, ""));

export const VOICE_MODELS = [
  { id: "microsoft/VibeVoice-1.5B", revision: "c00898d257e6b46004e3e2866a47534085fb685a", label: "VibeVoice 1.5B", gb: 5.4, vramGb: 7, note: "Recommended: good quality, fits beside ComfyUI on a 24 GB card." },
  { id: "vibevoice/VibeVoice-7B", revision: "505114ae6ad17be74df98e6939707434ec49c187", label: "VibeVoice 7B", gb: 18.7, vramGb: 18, note: "Best quality; needs about 18 GB of graphics memory, so other GPU work has to be idle." },
] as const;
/** Besides the model: PyTorch with CUDA (~3 GB), the engine and its libraries (~1 GB), vocal isolation (~0.9 GB) */
export const RUNTIME_EXTRA_GB = 5.4;

const KEY = "voice:runtime";
export const DEFAULT_PORT = 7861;

export interface VoiceRuntime {
  folder: string | null;
  model: string;
  port: number;
  installed: boolean;
  installedAt?: string;
  /** Seconds the model stays loaded after the last line */
  idleSeconds: number;
}

export const DEFAULT_RUNTIME: VoiceRuntime = { folder: null, model: VOICE_MODELS[0].id, port: DEFAULT_PORT, installed: false, idleSeconds: 120 };

export function getRuntime(): VoiceRuntime {
  const raw = getStore().getKv(KEY);
  if (!raw) return DEFAULT_RUNTIME;
  try { return { ...DEFAULT_RUNTIME, ...(JSON.parse(raw) as Partial<VoiceRuntime>) }; } catch { return DEFAULT_RUNTIME; }
}
function saveRuntime(r: VoiceRuntime) { getStore().setKv(KEY, JSON.stringify(r)); }

const isWin = process.platform === "win32";
const venvPython = (folder: string) => path.join(folder, "venv", isWin ? "Scripts/python.exe" : "bin/python");
const modelDir = (folder: string, model: string) => path.join(folder, "models", model.replace("/", "--"));
const voicesDir = (folder: string) => path.join(folder, "voices");
/** Hugging Face's cache, inside the voice folder: the model's text tokenizer (Qwen2.5) is read from here */
const hfHome = (folder: string) => path.join(folder, "hf-cache");
/** VibeVoice's processor loads its text tokenizer from this repo; only the tokenizer files are fetched, not the weights */
const TOKENIZER_REPO = "Qwen/Qwen2.5-1.5B";
const TOKENIZER_REVISION = "8faed761d45a263340a0528343f099c05c9a4323";
/** The vocal-isolation model the fork uses (its repo and file), at a fixed revision */
const ISOLATION = { repo: "KimberleyJSN/melbandroformer", file: "MelBandRoformer.ckpt", revision: "ac9b0614ab3cd7f77219e18ba494dfd93956c348" };
const repoVoiceDir = () => path.join(process.cwd(), "voice");

export const baseUrl = (r: VoiceRuntime = getRuntime()) => `http://127.0.0.1:${r.port}/v1`;

// ── Install ───────────────────────────────────────────────────────────────────

export interface SetupState {
  running: boolean;
  step: string;
  steps: string[];
  done: number;
  log: string[];
  error?: string;
  finishedAt?: string;
}

let setup: SetupState = { running: false, step: "", steps: [], done: 0, log: [] };
export const setupState = (): SetupState => setup;

const STEPS = ["Find or get uv", "Create the Python environment", "Install PyTorch", "Install the VibeVoice engine", "Download the model", "Download demo voices", "Check it starts"];

/** Where the setup log is also written, so a restart of FableChat cannot lose it */
let logFile: string | null = null;

function log(raw: string) {
  // uv and pip colour their output; the log is plain text
  const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd();
  if (!line.trim()) return;
  setup.log.push(line.slice(0, 400));
  if (setup.log.length > 400) setup.log.splice(0, setup.log.length - 400);
  if (logFile) { try { fs.appendFileSync(logFile, `${line}\n`); } catch { /* the in-memory log still has it */ } }
}

/** The last lines of the saved setup log, for after a restart */
export function savedSetupLog(): string[] {
  const r = getRuntime();
  if (!r.folder) return [];
  try { return fs.readFileSync(path.join(r.folder, "setup.log"), "utf8").split(/\r?\n/).filter(Boolean).slice(-60); } catch { return []; }
}

/** Run a program (no shell), streaming its output into the setup log. */
function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`$ ${path.basename(cmd)} ${args.join(" ")}`.slice(0, 300));
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, shell: false, windowsHide: true });
    const onData = (d: Buffer) => d.toString("utf8").split(/\r?\n/).filter((l) => l.trim()).forEach((l) => log(l));
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}

function which(name: string): string | null {
  // Only real executables (a .cmd cannot be spawned without a shell), and only from absolute PATH
  // entries: an empty or relative entry would mean "the current folder"
  const exts = isWin ? [".exe"] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const e of exts) {
      const p = path.join(dir, name + e);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* keep looking */ }
    }
  }
  return null;
}

async function getUv(folder: string): Promise<string> {
  const found = which("uv");
  if (found) { log(`using uv at ${found}`); return found; }
  const local = path.join(folder, "uv", isWin ? "uv.exe" : "uv");
  if (fs.existsSync(local)) return local;
  // The official installer script for the platform, run without a shell, into our folder only
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const env = { UV_INSTALL_DIR: path.dirname(local), UV_NO_MODIFY_PATH: "1", INSTALLER_NO_MODIFY_PATH: "1" };
  const res = await fetch(UV_INSTALLER.url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`could not download the uv installer (HTTP ${res.status})`);
  const script = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(script).digest("hex");
  if (got !== UV_INSTALLER.sha256) throw new Error(`the uv ${UV_VERSION} installer is not the one FableChat expects (sha256 ${got}); not running it`);
  const file = path.join(path.dirname(local), UV_INSTALLER.file);
  fs.writeFileSync(file, script);
  if (isWin) await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { env });
  else await run("/bin/sh", [file], { env });
  if (!fs.existsSync(local)) throw new Error("uv could not be installed");
  return local;
}

const hasNvidia = () => !!which("nvidia-smi");

/**
 * Install everything into `folder`. Returns at once; follow it with setupState().
 * Refuses when an install is already running.
 */
export function startSetup(folder: string, model: string): { ok: true } | { ok: false; error: string } {
  if (setup.running) return { ok: false, error: "Setup is already running." };
  if (!path.isAbsolute(folder)) return { ok: false, error: "Use a full folder path." };
  if (!VOICE_MODELS.some((m) => m.id === model)) return { ok: false, error: "Unknown model." };
  setup = { running: true, step: STEPS[0], steps: STEPS, done: 0, log: [] };
  const r = { ...getRuntime(), folder: path.resolve(folder), model, installed: false };
  saveRuntime(r);
  void (async () => {
    const step = (i: number) => { setup.done = i; setup.step = STEPS[i]; log(`── ${STEPS[i]}`); };
    try {
      fs.mkdirSync(r.folder!, { recursive: true });
      logFile = path.join(r.folder!, "setup.log");
      fs.writeFileSync(logFile, `FableChat voice setup ${new Date().toISOString()} (${model})
`);
      step(0); const uv = await getUv(r.folder!);
      step(1);
      // Kept when it is already there, so running setup again only adds what is missing
      if (!fs.existsSync(venvPython(r.folder!))) await run(uv, ["venv", "--python", "3.11", "--seed", path.join(r.folder!, "venv")]);
      const py = venvPython(r.folder!);
      step(2);
      await run(uv, ["pip", "install", "--python", py, ...TORCH,
        ...(hasNvidia() ? ["--index-url", "https://download.pytorch.org/whl/cu128"] : [])]);
      step(3);
      // The engine alone, then only what the model needs: its package also lists the Gradio demo's
      // libraries, and one of them (aiortc) does not build on Windows. Versions are the ones it was made with.
      await run(uv, ["pip", "install", "--python", py, "--no-deps", ENGINE_GIT]);
      await run(uv, ["pip", "install", "--python", py, ...ENGINE_NEEDS]);
      step(4);
      // Every download at a fixed revision: a change upstream cannot change what you get
      const revision = VOICE_MODELS.find((m) => m.id === model)!.revision;
      await run(py, ["-c", "import sys; from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1], revision=sys.argv[3], local_dir=sys.argv[2])", model, modelDir(r.folder!, model), revision]);
      await run(py, ["-c", "import sys; from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1], revision=sys.argv[2], allow_patterns=['tokenizer*', 'vocab.json', 'merges.txt', 'config.json', 'generation_config.json'])", TOKENIZER_REPO, TOKENIZER_REVISION],
        { env: { HF_HOME: hfHome(r.folder!) } });
      // Vocal isolation (cleans voice samples): the fork fetches it on first use, but the server runs
      // offline, so it is fetched here, into the folder the fork looks in
      await run(py, ["-c", [
        "import sys, os; from huggingface_hub import hf_hub_download; import vibevoice.utils.vocal_isolation as v",
        "d = os.path.abspath(v.DEFAULT_MODEL_DIR); os.makedirs(d, exist_ok=True)",
        "assert (v.HUGGINGFACE_MODEL_ID, v.MODEL_FILENAME) == (sys.argv[1], sys.argv[2]), 'the engine expects a different isolation model'",
        "print(hf_hub_download(sys.argv[1], sys.argv[2], revision=sys.argv[3], local_dir=d))",
      ].join("; "), ISOLATION.repo, ISOLATION.file, ISOLATION.revision],
        { env: { HF_HOME: hfHome(r.folder!), PYTHONIOENCODING: "utf-8" } });
      step(5);
      const demo = path.join(voicesDir(r.folder!), "demo");
      fs.mkdirSync(demo, { recursive: true });
      for (const v of DEMO_FILES) {
        const target = path.join(demo, `${v}.wav`);
        if (fs.existsSync(target)) continue;
        const res = await fetch(`${DEMO_VOICES_BASE}/${v}.wav`);
        if (!res.ok) throw new Error(`could not download the demo voice ${v} (HTTP ${res.status})`);
        fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
        log(`demo voice ${v}`);
      }
      step(6);
      saveRuntime({ ...r, installed: true, installedAt: new Date().toISOString() });
      await ensureRunning();
      setup.done = STEPS.length;
      setup.step = "Ready";
      log("Voice is ready.");
    } catch (e) {
      setup.error = e instanceof Error ? e.message : String(e);
      log(`Setup stopped: ${setup.error}`);
    } finally {
      setup.running = false;
      setup.finishedAt = new Date().toISOString();
    }
  })();
  return { ok: true };
}

// ── Run ───────────────────────────────────────────────────────────────────────

let child: ChildProcess | null = null;
let starting: Promise<void> | null = null;
const serverLog: string[] = [];
export const voiceServerLog = () => serverLog.slice(-120);

// ── The token ─────────────────────────────────────────────────────────────────
// The voice server answers only requests that carry this token (and name this
// machine as the Host), so a web page cannot use it. A fresh one is made at each
// start and kept in the voice folder, so FableChat can still reach a server it
// started before a restart. Backups never contain it (it is not in the database).
const tokenFile = (folder: string) => path.join(folder, ".server-token");

function readToken(r: VoiceRuntime = getRuntime()): string | null {
  if (!r.folder) return null;
  try { return fs.readFileSync(tokenFile(r.folder), "utf8").trim() || null; } catch { return null; }
}

/** Headers for a request to the voice server */
export function voiceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, "X-Fable-Voice-Token": readToken() ?? "" };
}

export type Health = { ok: boolean; worker?: string; device?: string; voices?: number };

/** null when nothing answers; "foreign" when something answers that is not our server (or not with our token) */
export async function health(r: VoiceRuntime = getRuntime()): Promise<Health | null> {
  const h = await probe(r);
  return h === "foreign" ? null : h;
}

async function probe(r: VoiceRuntime): Promise<Health | "foreign" | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${r.port}/health`, { headers: voiceHeaders(), signal: AbortSignal.timeout(2000) });
    if (res.ok) return (await res.json()) as Health;
    return "foreign";
  } catch { return null; }
}

/** Start the voice server if it is not answering. Resolves when /health answers. */
export function ensureRunning(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
    const r = getRuntime();
    if (!r.installed || !r.folder) throw new Error("Voice is not set up yet (Settings → Media → Voice).");
    const now = await probe(r);
    if (now === "foreign") throw new Error(`Something else is using port ${r.port}, or an earlier voice server is still running. Stop it, or restart this computer, then try again.`);
    if (now) return;
    const py = venvPython(r.folder);
    if (!fs.existsSync(py)) throw new Error(`The voice environment is missing at ${py}. Run Download and set up again.`);
    const token = randomBytes(24).toString("hex");
    fs.writeFileSync(tokenFile(r.folder), token, { mode: 0o600 });
    child = spawn(py, ["-m", "fable_voice.server", "--model", modelDir(r.folder, r.model), "--voices", voicesDir(r.folder),
      "--port", String(r.port), "--idle", String(r.idleSeconds)], {
      // UTF-8 output: the engine prints emoji, which crash a Windows console encoding (and with it vocal isolation)
      cwd: repoVoiceDir(), env: {
        ...process.env, PYTHONPATH: repoVoiceDir(), PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8",
        HF_HUB_OFFLINE: "1", HF_HOME: hfHome(r.folder), FABLE_VOICE_TOKEN: token,
      },
      shell: false, windowsHide: true,
    });
    // Also written to server.log in the voice folder, so a restart of FableChat does not lose it
    const file = path.join(r.folder, "server.log");
    const keep = (d: Buffer) => {
      for (const l of d.toString("utf8").split(/\r?\n/)) {
        if (!l.trim()) continue;
        serverLog.push(l.slice(0, 400));
        if (serverLog.length > 400) serverLog.shift();
        try { fs.appendFileSync(file, `${l}\n`); } catch { /* the in-memory log still has it */ }
      }
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("exit", () => { child = null; });
    for (let i = 0; i < 120; i++) {
      if (await health(r)) return;
      if (!child) throw new Error(`The voice server stopped while starting: ${serverLog.slice(-3).join(" | ")}`);
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new Error("The voice server did not answer within a minute.");
  })().finally(() => { starting = null; });
  return starting;
}

/**
 * Stop the voice server and the model with it. It is asked to shut down (which
 * also works for a server started before a FableChat restart, when there is no
 * child handle); a child that does not go is killed, and the worker notices its
 * parent is gone and exits rather than holding the GPU.
 */
export async function stopServer(): Promise<void> {
  const r = getRuntime();
  await fetch(`http://127.0.0.1:${r.port}/v1/shutdown`, { method: "POST", headers: voiceHeaders(), signal: AbortSignal.timeout(30_000) }).catch(() => null);
  const c = child;
  if (c) {
    await new Promise<void>((res) => { const t = setTimeout(() => { c.kill(); res(); }, 5000); c.once("exit", () => { clearTimeout(t); res(); }); });
    child = null;
  }
}

/** Forget the install (files are left where they are; the folder is yours to delete). */
export function forgetInstall(): void {
  saveRuntime({ ...getRuntime(), installed: false });
}
