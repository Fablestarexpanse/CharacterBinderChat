// ─── The background model ─────────────────────────────────────────────────────
// Server-only. Memory (extraction, the Core Memory rewrite, episodes) and the
// image scene director are jobs nobody reads directly, so they run on a small
// local model rather than the chat's model, which may be a paid cloud one.
//
// Which one, in order:
//   1. Ollama on this computer, with the memory model (or the utility model you
//      chose). FableChat starts Ollama itself if it is installed but not running.
//   2. The chat's own model, ONLY if you allowed it (Settings → Memory →
//      "Use my chat model when no local model is running"). Off by default, so
//      nothing is spent without you choosing it.
// Otherwise the job fails with a reason that says what to do.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getStore } from "@/lib/db";
import { parseProviderBase, type LlmBackend } from "@/lib/llm/callers";

import { MEMORY_MODEL } from "@/lib/llm/memoryModel";
export { MEMORY_MODEL };

const KEY = "background:model";

export interface BackgroundSettings {
  /** Use the chat's model when no local model is running (costs money on a paid model) */
  fallbackToChat: boolean;
  /** The Ollama model to use; unset = the memory model if it is there, else the utility model */
  ollamaModel?: string;
}

export const DEFAULT_BACKGROUND: BackgroundSettings = { fallbackToChat: false };

export function cleanBackground(raw: unknown): BackgroundSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const model = typeof r.ollamaModel === "string" && /^[\w.:/@-]{1,200}$/.test(r.ollamaModel) ? r.ollamaModel : undefined;
  return { fallbackToChat: r.fallbackToChat === true, ...(model ? { ollamaModel: model } : {}) };
}

export function getBackground(): BackgroundSettings {
  const raw = getStore().getKv(KEY);
  try { return cleanBackground(raw ? JSON.parse(raw) : {}); } catch { return DEFAULT_BACKGROUND; }
}

export function setBackground(patch: unknown): BackgroundSettings {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const next = cleanBackground({ ...getBackground(), ...p });
  getStore().setKv(KEY, JSON.stringify(next));
  return next;
}

// ── Ollama ───────────────────────────────────────────────────────────────────

const isLocal = (base: string) => { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname); } catch { return false; } };

/** The models Ollama holds, or null when it does not answer */
export async function ollamaModels(base: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    return (j.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
  } catch { return null; }
}

/** The Ollama program, if it is installed (on PATH, or where its Windows installer puts it) */
export function ollamaExecutable(): string | null {
  const names = process.platform === "win32" ? ["ollama.exe"] : ["ollama"];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter((d) => d && path.isAbsolute(d));
  if (process.platform === "win32" && process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "Programs", "Ollama"));
  if (process.platform === "darwin") dirs.push("/Applications/Ollama.app/Contents/Resources", "/usr/local/bin", "/opt/homebrew/bin");
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* keep looking */ }
  }
  return null;
}

let starting: Promise<boolean> | null = null;

/**
 * Make sure Ollama answers at `base`: when it does not and it is installed here,
 * start `ollama serve` (detached, so it outlives a FableChat restart like the
 * Ollama app would) and wait for it. Only for an Ollama on this computer.
 */
export function ensureOllama(base: string): Promise<boolean> {
  if (starting) return starting;
  starting = (async () => {
    if (await ollamaModels(base)) return true;
    const exe = isLocal(base) ? ollamaExecutable() : null;
    if (!exe) return false;
    const port = (() => { try { return new URL(base).port || "11434"; } catch { return "11434"; } })();
    const child = spawn(exe, ["serve"], {
      detached: true, stdio: "ignore", windowsHide: true, shell: false,
      env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}` },
    });
    child.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await ollamaModels(base)) return true;
    }
    return false;
  })().finally(() => { starting = null; });
  return starting;
}

// ── Choosing ─────────────────────────────────────────────────────────────────

export interface BackgroundRequest {
  /** Where Ollama is (Settings → Chat models) */
  ollamaBaseUrl?: string;
  /** The utility model chosen in Settings, if any */
  utilityModel?: string;
}

export class NoBackgroundModel extends Error {}

/**
 * The model a background job runs on. `chat` is the chat's own backend, used
 * only when allowed. Throws NoBackgroundModel with what to do when none fits.
 */
export async function backgroundModel(req: BackgroundRequest, chat: LlmBackend | null): Promise<LlmBackend> {
  const settings = getBackground();
  const reasons: string[] = [];
  const base = parseProviderBase(req.ollamaBaseUrl || "http://127.0.0.1:11434");
  if (base) {
    if (await ensureOllama(base)) {
      const have = (await ollamaModels(base)) ?? [];
      const wanted = [settings.ollamaModel, MEMORY_MODEL.id, req.utilityModel].filter((m): m is string => !!m);
      const pick = wanted.find((m) => have.some((h) => h === m || h === `${m}:latest`));
      if (pick) return { providerType: "ollama", providerBaseUrl: base, modelId: pick };
      reasons.push(`Ollama is running but has no memory model (download ${MEMORY_MODEL.label} in Settings → Memory)`);
    } else {
      reasons.push(ollamaExecutable() ? "Ollama did not start" : "Ollama is not installed");
    }
  }
  if (settings.fallbackToChat && chat) return chat;
  if (chat) reasons.push("using your chat model for this is switched off (Settings → Memory)");
  throw new NoBackgroundModel(`No local model for memory: ${reasons.join("; ")}.`);
}

// ── Downloading the memory model into Ollama ─────────────────────────────────

export interface PullState { running: boolean; status: string; done: number; total: number; error?: string; finishedAt?: string }
let pull: PullState = { running: false, status: "", done: 0, total: 0 };
export const pullState = () => pull;

/** Start downloading the memory model into Ollama (starting Ollama first). Progress is in pullState(). */
export function startPull(base: string): { ok: true } | { ok: false; error: string } {
  if (pull.running) return { ok: true };
  pull = { running: true, status: "Starting Ollama", done: 0, total: 0 };
  void (async () => {
    try {
      if (!(await ensureOllama(base))) throw new Error(ollamaExecutable() ? "Ollama did not start" : "Ollama is not installed: get it from ollama.com, or let FableChat run its own model");
      pull.status = `Downloading ${MEMORY_MODEL.label}`;
      const res = await fetch(`${base}/api/pull`, { method: "POST", body: JSON.stringify({ model: MEMORY_MODEL.id, stream: true }) });
      if (!res.ok || !res.body) throw new Error(`Ollama answered HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const j = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
          if (j.error) throw new Error(j.error);
          // Ollama names each layer it fetches ("pulling 85e4a5b7…"); say what it means
          if (j.status) pull.status = /^pulling [0-9a-f]{6,}/.test(j.status) ? "Downloading" : j.status;
          if (j.total) { pull.total = j.total; pull.done = j.completed ?? 0; }
        }
      }
      setBackground({ ollamaModel: MEMORY_MODEL.id });
      pull.status = "Ready";
    } catch (e) {
      pull.error = e instanceof Error ? e.message : String(e);
    } finally {
      pull.running = false;
      pull.finishedAt = new Date().toISOString();
    }
  })();
  return { ok: true };
}

/**
 * For the memory routes: when the request asks for the background model, swap
 * its backend for that one. Returns the request to use, or a 502 Response
 * saying why no model could run it.
 */
export async function withBackground<T extends LlmBackend & { background?: BackgroundRequest }>(task: T): Promise<T | Response> {
  if (!task.background) return task;
  const chat: LlmBackend = { providerType: task.providerType, providerBaseUrl: task.providerBaseUrl, modelId: task.modelId, apiKey: task.apiKey };
  try {
    return { ...task, ...(await backgroundModel(task.background, chat)) };
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
