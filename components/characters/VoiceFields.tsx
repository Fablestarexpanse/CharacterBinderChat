"use client";

// ─── How they sound (character and persona editors) ───────────────────────────
// Upload a short sample of their voice to their profile, or pick a demo voice.
// The sample is stored as an asset with the character (so backups keep it)
// and the voice server copies it the first time they speak, cleaned of music
// and noise. Uploading asks you to confirm the voice is yours, one you have
// permission to use, or a made-up one. Preview speaks a line in that voice.

import { useEffect, useRef, useState } from "react";
import { AudioLines, Play, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEMO_VOICES, type CharacterVoice } from "@/lib/media/voice";

const MAX_BYTES = 25 * 1024 * 1024;

async function uploadSample(file: File): Promise<string> {
  const res = await fetch("/api/assets?kind=audio", { method: "POST", body: file });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
  if (!res.ok || !body?.ok || !body.url) throw new Error(body?.error ?? `upload failed (HTTP ${res.status})`);
  return body.url;
}

export function VoiceFields({ value, onChange, who }: { value: CharacterVoice | undefined; onChange: (v: CharacterVoice | undefined) => void; who: string }) {
  const v = value ?? {};
  const fileRef = useRef<HTMLInputElement>(null);
  const [consent, setConsent] = useState(!!v.sample);
  const [busy, setBusy] = useState<"upload" | "preview" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // The last preview's address is released when a new one replaces it or the editor closes
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const [line, setLine] = useState(`Hi. It's ${who === "them" ? "me" : who}. Did you miss me?`);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!consent) { setError("Tick the box first: the voice must be yours, one you have permission to use, or a made-up one."); return; }
    if (file.size > MAX_BYTES) { setError("That file is over 25 MB. A clean 10 to 30 second clip is plenty."); return; }
    setBusy("upload");
    try {
      const url = await uploadSample(file);
      onChange({ ...v, sample: url, sampleName: file.name, consent: true });
      setPreviewUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const preview = async () => {
    setError(null);
    setBusy("preview");
    try {
      const res = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: line, voice: v }) });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setPreviewUrl(URL.createObjectURL(await res.blob()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="rounded-lg border border-[var(--border)] px-3 py-2" open={!!v.sample || !!v.demo}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
        <AudioLines className="h-3.5 w-3.5" />Voice <span className="font-normal text-[var(--muted-fg)]">— how {who} sounds when read aloud, in voice notes and on calls</span>
      </summary>
      <div className="mt-2 space-y-3 text-xs">
        <div className="space-y-1.5">
          <div className="font-medium">A sample of their voice</div>
          {v.sample ? (
            <div className="flex flex-wrap items-center gap-2">
              <audio controls src={v.sample} className="h-8 max-w-[16rem]" aria-label="Their voice sample" />
              <span className="text-[11px] text-[var(--muted-fg)] truncate max-w-[10rem]" title={v.sampleName}>{v.sampleName ?? "sample"}</span>
              <Button variant="ghost" size="sm" onClick={() => { onChange(v.demo ? { demo: v.demo } : undefined); setPreviewUrl(null); }}><X className="h-3 w-3 mr-1" />Remove</Button>
            </div>
          ) : (
            <>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-label="I may use this voice" className="mt-0.5 accent-[var(--purple)]" />
                <span>This is my voice, a voice I have permission to use, or a made-up one.<span className="block text-[11px] text-[var(--muted-fg)]">Not a real person who has not agreed to it.</span></span>
              </label>
              <input ref={fileRef} type="file" accept="audio/wav,audio/x-wav,audio/mpeg,audio/ogg,audio/flac,.wav,.mp3,.ogg,.flac" className="hidden" aria-label="Voice sample file"
                onChange={(e) => void pick(e.target.files?.[0])} />
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                <Upload className="h-3 w-3 mr-1" />{busy === "upload" ? "Uploading…" : "Upload a voice sample"}
              </Button>
              <div className="text-[11px] text-[var(--muted-fg)]">10 to 30 seconds of one person talking, WAV, MP3, Ogg or FLAC. Background music is removed for you.</div>
            </>
          )}
        </div>

        <label className="block"><span className="font-medium">{v.sample ? "Or a demo voice (used if the sample is removed)" : "Or a demo voice"}</span>
          <select value={v.demo ?? ""} onChange={(e) => onChange({ ...v, demo: e.target.value || undefined })} aria-label="Demo voice"
            className="mt-1 h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs">
            <option value="">None</option>
            {DEMO_VOICES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>

        {(v.sample || v.demo) && (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input value={line} onChange={(e) => setLine(e.target.value)} aria-label="Line to preview"
                className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs" />
              <Button variant="purple" size="sm" disabled={busy !== null || !line.trim()} onClick={() => void preview()}>
                <Play className="h-3 w-3 mr-1" />{busy === "preview" ? "Speaking…" : "Preview"}
              </Button>
            </div>
            {busy === "preview" && <div className="text-[11px] text-[var(--muted-fg)]">The first line also starts the voice server and loads the model; that takes a little longer.</div>}
            {previewUrl && <audio controls autoPlay src={previewUrl} className="h-8 w-full" aria-label="Preview" />}
          </div>
        )}
        {error && <div role="alert" className="text-[11px] text-red-600">{error}</div>}
      </div>
    </details>
  );
}
