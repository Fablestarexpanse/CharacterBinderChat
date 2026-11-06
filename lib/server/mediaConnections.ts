// ─── Media connections: storage and the real calls ────────────────────────────
// Server-only. The list and the per-purpose defaults are plain JSON in app_kv;
// each connection's key is encrypted (lib/server/secrets.ts) under
// `secret:media:<id>`, so backups strip it like every other secret and the
// browser never receives it: media requests are made from here.

import path from "node:path";
import { getStore } from "@/lib/db";
import { decryptSecret, encryptSecret, loadKey } from "@/lib/server/secrets";
import { testVideoClip } from "@/lib/server/videoTest";
import { ensureRunning, voiceHeaders } from "@/lib/server/voiceRuntime";
import { MAX_UPLOAD_BYTES, isWebUrl, readBodyCapped, readJsonCapped } from "@/lib/server/assets";
import {
  cleanDefaults, providerInfo, validateConnection,
  type MediaConnection, type MediaConnectionView, type MediaDefaults,
} from "@/lib/media/connections";

const LIST_KEY = "media:connections";
const DEFAULTS_KEY = "media:defaults";
const secretKey = (id: string) => `secret:media:${id}`;
const keyDir = () => path.dirname(process.env.FABLE_DB_PATH ?? path.join(process.cwd(), "data", "x"));

function readJson<T>(k: string, fallback: T): T {
  const raw = getStore().getKv(k);
  if (raw === null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function listConnections(): MediaConnection[] {
  const raw = readJson<unknown[]>(LIST_KEY, []);
  return (Array.isArray(raw) ? raw : []).flatMap((c) => {
    const v = validateConnection(c);
    return v.ok ? [v.value] : [];
  });
}

export function getDefaults(): MediaDefaults {
  return cleanDefaults(readJson<unknown>(DEFAULTS_KEY, {}), listConnections());
}

export function listForClient(): { connections: MediaConnectionView[]; defaults: MediaDefaults } {
  const store = getStore();
  return {
    connections: listConnections().map((c) => ({ ...c, hasKey: store.getKv(secretKey(c.id)) !== null })),
    defaults: getDefaults(),
  };
}

/**
 * Add or replace a connection. `key`: undefined keeps the stored key, "" removes
 * it, any other string replaces it. Returns the refusal reasons when invalid.
 */
export function saveConnection(raw: unknown, key?: string): { ok: true; connection: MediaConnection } | { ok: false; errors: string[] } {
  const v = validateConnection(raw);
  if (!v.ok) return v;
  const store = getStore();
  const list = listConnections().filter((c) => c.id !== v.value.id);
  list.push(v.value);
  store.setKv(LIST_KEY, JSON.stringify(list));
  if (key !== undefined) {
    const k = key.trim();
    store.setKv(secretKey(v.value.id), k ? encryptSecret(k, loadKey(keyDir())) : null);
  }
  // A connection whose kind changed must not stay the default for the old kind
  store.setKv(DEFAULTS_KEY, JSON.stringify(cleanDefaults(readJson<unknown>(DEFAULTS_KEY, {}), list)));
  return { ok: true, connection: v.value };
}

export function removeConnection(id: string): void {
  const store = getStore();
  const list = listConnections().filter((c) => c.id !== id);
  store.setKv(LIST_KEY, JSON.stringify(list));
  store.setKv(secretKey(id), null);
  store.setKv(DEFAULTS_KEY, JSON.stringify(cleanDefaults(readJson<unknown>(DEFAULTS_KEY, {}), list)));
}

/**
 * Change some defaults, keeping the rest: `{ photo: "id" }` sets one, `{ photo: null }`
 * clears it. A patch rather than a replacement, so two quick changes in the
 * settings screen cannot overwrite each other with a stale copy.
 */
export function setDefaults(patch: unknown): MediaDefaults {
  const merged: Record<string, unknown> = { ...getDefaults() };
  for (const [k, v] of Object.entries((patch ?? {}) as Record<string, unknown>)) {
    if (v === null || v === "") delete merged[k]; else merged[k] = v;
  }
  const clean = cleanDefaults(merged, listConnections());
  getStore().setKv(DEFAULTS_KEY, JSON.stringify(clean));
  return clean;
}

export function connectionKey(id: string): string | null {
  const blob = getStore().getKv(secretKey(id));
  return blob ? decryptSecret(blob, loadKey(keyDir())) : null;
}

// ─── Testing a connection ─────────────────────────────────────────────────────

export interface TestOutcome {
  ok: boolean;
  /** One line for the UI: what worked, or what the service said was wrong */
  label: string;
  /** A real sample to show: an image or a playable clip */
  sample?: { type: "image" | "audio" | "video"; dataUrl: string };
}

const TEST_PROMPT = "A small red apple on a wooden table, soft window light";
const TEST_SPEECH = "Hello. This is a test of your voice connection in FableChat.";

/** The service's own words when it refuses, not just a status code. */
async function upstreamMessage(res: Response): Promise<string> {
  const text = await readBodyCapped(res, 64 * 1024, "the error").then((b) => new TextDecoder().decode(b)).catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; detail?: unknown; message?: string };
    const msg = typeof j.error === "string" ? j.error : j.error?.message ?? j.message
      ?? (typeof j.detail === "string" ? j.detail : j.detail ? JSON.stringify(j.detail) : "");
    if (msg) return `${res.status}: ${msg}`;
  } catch { /* not JSON */ }
  return `${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
}

/** ComfyUI reports "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync"; keep the card's name. */
export const gpuName = (raw: string) => raw.replace(/^[a-z]+:\d+\s*/i, "").split(" : ")[0].trim();

const toDataUrl = (bytes: Uint8Array, type: string) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

/** A half-second 440 Hz tone as a 16 kHz mono WAV: something a transcriber must accept. */
export function testTone(): Uint8Array {
  const rate = 16000, n = rate / 2, out = new Uint8Array(44 + n * 2), v = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), true);
  return out;
}

export async function testConnection(c: MediaConnection, key: string | null): Promise<TestOutcome> {
  const info = providerInfo(c.provider)!;
  if (info.keyRequired && !key) return { ok: false, label: `${info.label} needs an API key.` };
  const auth: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  try {
    switch (c.provider) {
      case "comfyui": {
        const res = await fetch(`${c.baseUrl}/system_stats`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return { ok: false, label: `ComfyUI answered ${await upstreamMessage(res)}` };
        const s = ((await readJsonCapped(res)) ?? {}) as { system?: { comfyui_version?: string }; devices?: Array<{ name?: string; vram_total?: number }> };
        const gpu = s.devices?.[0];
        const vram = gpu?.vram_total ? ` · ${(gpu.vram_total / 2 ** 30).toFixed(0)} GB` : "";
        const version = s.system?.comfyui_version ? ` ${s.system.comfyui_version}` : "";
        // For video, answering is not enough: make a real short clip with your video workflow
        if (c.kind === "video") {
          const clip = await testVideoClip(c.baseUrl);
          return clip.ok ? { ...clip, label: `Connected to ComfyUI${version}. ${clip.label}` } : clip;
        }
        return {
          ok: true,
          label: `Connected to ComfyUI${version}${gpu?.name ? ` · ${gpuName(gpu.name)}${vram}` : ""}.`,
        };
      }
      case "openai-image": {
        const res = await fetch(`${c.baseUrl}/images/generations`, {
          method: "POST", headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({ model: c.model || "gpt-image-1", prompt: TEST_PROMPT, size: "1024x1024", n: 1 }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) return { ok: false, label: `The image service answered ${await upstreamMessage(res)}` };
        const j = ((await readJsonCapped(res, 64 * 1024 * 1024)) ?? {}) as { data?: Array<{ b64_json?: string; url?: string }> };
        const first = j.data?.[0];
        if (first?.b64_json) return { ok: true, label: "Made a test image.", sample: { type: "image", dataUrl: `data:image/png;base64,${first.b64_json}` } };
        if (first?.url) {
          if (!isWebUrl(first.url)) return { ok: false, label: "The service answered with an image address FableChat will not fetch." };
          const img = await fetch(first.url, { signal: AbortSignal.timeout(30_000) });
          if (!img.ok) return { ok: false, label: `The image was made but could not be downloaded (${img.status}).` };
          return { ok: true, label: "Made a test image.", sample: { type: "image", dataUrl: toDataUrl(await readBodyCapped(img, MAX_UPLOAD_BYTES, "the image"), img.headers.get("content-type") ?? "image/png") } };
        }
        return { ok: false, label: "The service answered, but with no image in the reply." };
      }
      case "vibevoice": {
        // FableChat's own server: start it if it is not running, then speak a real sentence
        try { await ensureRunning(); } catch (e) { return { ok: false, label: e instanceof Error ? e.message : String(e) }; }
        const started = Date.now();
        const res = await fetch(`${c.baseUrl}/audio/speech`, {
          method: "POST", headers: voiceHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ input: TEST_SPEECH, voice: c.voice || "demo:en-Alice_woman", response_format: "wav" }),
          signal: AbortSignal.timeout(900_000),
        });
        if (!res.ok) return { ok: false, label: `The voice server answered ${await upstreamMessage(res)}` };
        const bytes = await readBodyCapped(res, MAX_UPLOAD_BYTES, "the audio");
        if (bytes.length < 1000) return { ok: false, label: "The voice server answered, but sent no audio." };
        return { ok: true, label: `Spoke a test sentence in ${Math.round((Date.now() - started) / 1000)} s (the first one also loads the model).`, sample: { type: "audio", dataUrl: toDataUrl(bytes, "audio/wav") } };
      }
      case "openai-speech": {
        const res = await fetch(`${c.baseUrl}/audio/speech`, {
          method: "POST", headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({ model: c.model || "tts-1", voice: c.voice || "alloy", input: TEST_SPEECH, response_format: "mp3" }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) return { ok: false, label: `The voice service answered ${await upstreamMessage(res)}` };
        const bytes = await readBodyCapped(res, MAX_UPLOAD_BYTES, "the audio");
        if (bytes.length < 100) return { ok: false, label: "The voice service answered, but sent no audio." };
        return { ok: true, label: "Spoke a test sentence.", sample: { type: "audio", dataUrl: toDataUrl(bytes, res.headers.get("content-type") ?? "audio/mpeg") } };
      }
      case "elevenlabs": {
        if (!c.voice) return { ok: false, label: "Choose a voice id first (from your ElevenLabs voice library)." };
        const res = await fetch(`${c.baseUrl}/text-to-speech/${encodeURIComponent(c.voice)}`, {
          method: "POST", headers: { "Content-Type": "application/json", "xi-api-key": key ?? "" },
          body: JSON.stringify({ text: TEST_SPEECH, model_id: c.model || "eleven_multilingual_v2" }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) return { ok: false, label: `ElevenLabs answered ${await upstreamMessage(res)}` };
        return { ok: true, label: "Spoke a test sentence.", sample: { type: "audio", dataUrl: toDataUrl(await readBodyCapped(res, MAX_UPLOAD_BYTES, "the audio"), res.headers.get("content-type") ?? "audio/mpeg") } };
      }
      case "openai-stt": {
        const form = new FormData();
        form.append("file", new Blob([testTone() as BlobPart], { type: "audio/wav" }), "test.wav");
        form.append("model", c.model || "whisper-1");
        const res = await fetch(`${c.baseUrl}/audio/transcriptions`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) return { ok: false, label: `The transcription service answered ${await upstreamMessage(res)}` };
        return { ok: true, label: "Transcribed a test clip (a short tone, so the text is expected to be empty)." };
      }
    }
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    if (err.name === "TimeoutError") return { ok: false, label: "No answer in time. Is the service running, and is the address right?" };
    if (err.cause?.code === "ECONNREFUSED") return { ok: false, label: `Nothing is listening at ${c.baseUrl}. Is the service running?` };
    if (err.cause?.code === "ENOTFOUND") return { ok: false, label: `The address ${new URL(c.baseUrl).hostname} could not be found. Check it for typos.` };
    if (err.cause?.message === "bad port") return { ok: false, label: "That port is one web software refuses to use for safety. Run the service on another port." };
    return { ok: false, label: `Could not reach the service: ${err.cause?.message ?? err.message}` };
  }
}
