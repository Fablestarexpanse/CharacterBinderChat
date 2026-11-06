"use client";

// ─── Settings → Media: the local voice (VibeVoice) ────────────────────────────
// Nothing is downloaded until you press Download and set up. The card shows
// what it will fetch and how big it is, installs into a folder you choose,
// shows progress, and then lets you start or stop the voice server. When setup
// finishes it adds a "VibeVoice (local)" voice connection (and makes it the
// voice default if there was none). See lib/server/voiceRuntime.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { sendJson } from "@/lib/api/client";

interface RuntimeView {
  runtime: { folder: string | null; model: string; port: number; installed: boolean; installedAt?: string };
  setup: { running: boolean; step: string; steps: string[]; done: number; log: string[]; error?: string };
  health: { ok: boolean; worker?: string; device?: string; voices?: number } | null;
  models: Array<{ id: string; label: string; gb: number; vramGb: number; note: string }>;
  extraGb: number;
  suggestedFolder: string;
}

/** After setup: a voice connection to the local server, the voice default if there was none. False when one exists. */
async function addVoiceConnection(): Promise<boolean> {
  const list = await fetch("/api/media/connections", { cache: "no-store" }).then((r) => r.json()) as { connections?: Array<{ id: string; provider: string }>; defaults?: Record<string, string> };
  if ((list.connections ?? []).some((c) => c.provider === "vibevoice")) return false;
  await sendJson("PUT", "/api/media/connections", {
    connection: { id: "vibevoice-local", name: "VibeVoice (local)", kind: "voice", provider: "vibevoice", baseUrl: "http://127.0.0.1:7861/v1", model: "", voice: "demo:en-Alice_woman" },
    ...(list.defaults?.voice ? {} : { defaults: { voice: "vibevoice-local" } }),
  });
  return true;
}

export function VoiceSetupCard() {
  const [view, setView] = useState<RuntimeView | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/voice/runtime", { cache: "no-store" });
    if (r.ok) return (await r.json()) as RuntimeView;
    return null;
  }, []);

  // Poll while setup runs; otherwise read once
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const v = await load().catch(() => null);
      if (cancelled) return;
      if (v) {
        setView(v);
        if (wasRunning.current && !v.setup.running && v.runtime.installed && !v.setup.error) {
          void addVoiceConnection().then((added) => { if (!cancelled && added) setNote({ ok: true, text: "Voice is ready. A “VibeVoice (local)” voice connection was added under Media connections; its Test speaks a sentence." }); });
        }
        wasRunning.current = v.setup.running;
      }
      timer = setTimeout(tick, v?.setup.running ? 1500 : 10_000);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [load]);

  if (!view) return null;
  const chosenModel = model ?? view.runtime.model;
  const info = view.models.find((m) => m.id === chosenModel) ?? view.models[0];
  const target = folder ?? view.runtime.folder ?? view.suggestedFolder;
  const s = view.setup;
  const installed = view.runtime.installed;
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setNote(null);
    try {
      const r = await sendJson<{ ok?: boolean; error?: string }>("POST", "/api/voice/runtime", { action, ...extra });
      if (r.ok === false) setNote({ ok: false, text: r.error ?? "That did not work." });
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    const v = await load().catch(() => null);
    if (v) { setView(v); wasRunning.current = v.setup.running; }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 font-semibold text-sm"><AudioLines className="h-4 w-4" />Voice (VibeVoice, on this computer)</div>
        <div className="text-xs text-[var(--muted-fg)]">
          Characters speak in a voice of your choosing: one of the demo voices, or a short sample you add on their profile.
          Runs on your graphics card, built from <a className="underline" href="https://github.com/SanDiegoDude/VibeVoice" target="_blank" rel="noreferrer">SanDiegoDude/VibeVoice</a>.
          Nothing is downloaded until you press <strong>Download and set up</strong>.
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {!installed && !s.running && (
          <>
            <div className="grid gap-2">
              {view.models.map((m) => (
                <label key={m.id} className={`flex items-start gap-2 rounded-lg border p-2 text-xs cursor-pointer ${chosenModel === m.id ? "border-[var(--purple)] bg-[var(--purple-light)]" : "border-[var(--border)]"}`}>
                  <input type="radio" name="voice-model" checked={chosenModel === m.id} onChange={() => setModel(m.id)} className="mt-0.5 accent-[var(--purple)]" />
                  <span><span className="font-medium">{m.label}</span> · {m.gb} GB download · about {m.vramGb} GB of graphics memory while speaking
                    <span className="block text-[11px] text-[var(--muted-fg)]">{m.note}</span></span>
                </label>
              ))}
            </div>
            <label className="block text-xs"><span className="font-medium">Install into</span>
              <Input className="mt-1 h-8 text-xs" value={target} onChange={(e) => setFolder(e.target.value)} aria-label="Voice install folder" />
            </label>
            <div className="text-[11px] text-[var(--muted-fg)]">
              Downloads about <strong>{(info.gb + view.extraGb).toFixed(1)} GB</strong>: the model ({info.gb} GB), PyTorch for your graphics card, the
              voice engine, a vocal-isolation model (0.9 GB, cleans the voice samples you add), plus six demo voices. It takes a while; you can keep using FableChat.
              VibeVoice is Microsoft research software: only use voices you have the right to use.
            </div>
            <Button variant="purple" size="sm" onClick={() => void act("setup", { folder: target, model: chosenModel })}>Download and set up</Button>
          </>
        )}

        {s.running && (
          <div className="space-y-2" role="status">
            <div className="flex items-center gap-2 text-xs font-medium"><Loader2 className="h-3.5 w-3.5 animate-spin" />{s.step} ({Math.min(s.done + 1, s.steps.length)} of {s.steps.length})</div>
            <ol className="space-y-0.5 text-[11px]">
              {s.steps.map((st, i) => (
                <li key={st} className={i < s.done ? "text-green-700 dark:text-green-400" : i === s.done ? "text-[var(--foreground)]" : "text-[var(--muted-fg)]"}>
                  {i < s.done ? "✓" : i === s.done ? "…" : "·"} {st}
                </li>
              ))}
            </ol>
            <pre className="max-h-32 overflow-auto rounded-lg bg-[var(--muted)] p-2 text-[10px] leading-snug">{s.log.slice(-8).join("\n")}</pre>
          </div>
        )}

        {s.error && !s.running && (
          <div role="alert" className="space-y-1 text-xs text-red-600">
            <div>Setup stopped at “{s.step}”: {s.error}</div>
            <button className="underline cursor-pointer" onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide" : "Show"} the log</button>
            {showLog && <pre className="max-h-48 overflow-auto rounded-lg bg-[var(--muted)] p-2 text-[10px] text-[var(--foreground)]">{s.log.join("\n")}</pre>}
          </div>
        )}

        {installed && !s.running && (
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" />Installed in {view.runtime.folder} · {view.models.find((m) => m.id === view.runtime.model)?.label}</div>
            <div className="text-[11px] text-[var(--muted-fg)]">
              Server: {view.health ? `running (${view.health.device ?? "?"}), model ${view.health.worker === "ready" ? "loaded" : view.health.worker === "loading" ? "loading" : "not loaded (loads on the next line)"} · ${view.health.voices ?? 0} voices` : "stopped (starts by itself when something speaks)"}
            </div>
            <div className="flex flex-wrap gap-2">
              {view.health
                ? <Button variant="outline" size="sm" onClick={() => void act("stop")}>Stop and free the GPU</Button>
                : <Button variant="outline" size="sm" onClick={() => void act("start")}>Start now</Button>}
              <Button variant="ghost" size="sm" onClick={() => void act("forget")} title="The files stay in the folder; delete it yourself if you want the space back">Uninstall</Button>
            </div>
          </div>
        )}
        {note && <div role={note.ok ? "status" : "alert"} className={`text-xs ${note.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{note.text}</div>}
      </CardBody>
    </Card>
  );
}
