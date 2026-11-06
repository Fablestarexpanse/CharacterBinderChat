// ─── Speaking with someone's voice ────────────────────────────────────────────
// Server-only. A character's voice is a sample stored as an asset (or a demo
// voice). The voice server keeps its own copy of each sample it has been given,
// named after the asset's hash, so the first line in a new voice registers it
// (cleaned by vocal isolation once) and every later line reuses it.

import { getStore } from "@/lib/db";
import { cleanVoice, DEMO_VOICES, type CharacterVoice } from "@/lib/media/voice";
import { ensureRunning, getRuntime, voiceHeaders } from "@/lib/server/voiceRuntime";

const base = () => `http://127.0.0.1:${getRuntime().port}`;
const sampleId = (hash: string) => `yours:asset-${hash.slice(0, 16)}`;

/** The voice server's id for this voice, registering an uploaded sample on first use. */
export async function voiceIdFor(raw: CharacterVoice | undefined): Promise<string> {
  const v = cleanVoice(raw);
  const hash = v?.sample ? /([0-9a-f]{64})$/.exec(v.sample)?.[1] : undefined;
  if (!hash) return v?.demo ?? DEMO_VOICES[0].id;
  await ensureRunning();
  const id = sampleId(hash);
  const list = (await fetch(`${base()}/v1/voices`, { headers: voiceHeaders(), signal: AbortSignal.timeout(10_000) }).then((r) => r.json())) as { voices?: Array<{ id: string }> };
  if (list.voices?.some((x) => x.id === id)) return id;
  const asset = getStore().getAsset(hash);
  if (!asset || !asset.mime.startsWith("audio/")) throw new Error("their voice sample is missing; upload it again in their editor");
  const res = await fetch(`${base()}/v1/voices?${new URLSearchParams({ name: `asset-${hash.slice(0, 16)}`, consent: "1", isolate: "1" })}`, {
    method: "POST", headers: voiceHeaders(), body: new Uint8Array(asset.bytes), signal: AbortSignal.timeout(300_000),
  });
  const j = (await res.json().catch(() => null)) as { voice?: { id: string }; error?: string } | null;
  if (!res.ok || !j?.voice) throw new Error(j?.error ?? `the voice server would not take the sample (HTTP ${res.status})`);
  return j.voice.id;
}

export interface SpeakLine { text: string; voice?: CharacterVoice }

/** Speak one line, or a dialogue of up to four voices. Returns WAV bytes. */
export async function speak(lines: SpeakLine[]): Promise<{ wav: Buffer; seconds: number }> {
  await ensureRunning();
  const resolved = [];
  for (const l of lines) resolved.push({ text: l.text, voice: await voiceIdFor(l.voice) });
  const single = resolved.length === 1;
  const res = await fetch(`${base()}/v1/${single ? "audio/speech" : "dialogue"}`, {
    method: "POST", headers: voiceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(single ? { input: resolved[0].text, voice: resolved[0].voice, response_format: "wav" } : { lines: resolved, response_format: "wav" }),
    signal: AbortSignal.timeout(1_800_000),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `the voice server answered HTTP ${res.status}`);
  }
  return { wav: Buffer.from(await res.arrayBuffer()), seconds: Number(res.headers.get("X-Generation-Seconds") ?? 0) };
}
