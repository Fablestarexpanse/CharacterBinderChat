"use client";

// ─── Settings → Memory: the model that runs memory and image prompts ──────────
// Memory updates after every reply and the image scene director run on a small
// local model (lib/server/backgroundModel.ts), not the chat's model, so a paid
// chat model is not charged for them. Here: whether Ollama and the memory model
// are there, a button to download the model into Ollama, and the switch that
// allows the chat's model as a fallback (off by default).

import { useEffect, useState } from "react";
import { Cpu, Download, Loader2 } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFableStore } from "@/lib/store";
import { getJson, sendJson } from "@/lib/api/client";

interface Status {
  settings: { fallbackToChat: boolean; ollamaModel?: string };
  memoryModel: { id: string; label: string; gb: number };
  ollama: { installed: boolean; running: boolean; models: string[] };
  pull: { running: boolean; status: string; done: number; total: number; error?: string };
}

export function BackgroundModelCard() {
  const ollamaBase = useFableStore((s) => s.providerSettings.ollama.baseUrl);
  const utility = useFableStore((s) => s.providerSettings.ollama.utilityModel);
  const [st, setSt] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Load, and keep polling while a download runs
  useEffect(() => {
    let cancelled = false;
    void getJson<Status>(`/api/background?ollama=${encodeURIComponent(ollamaBase)}`)
      .then((s) => { if (!cancelled) { setSt(s); if (s.pull.running) setTimeout(() => setTick((t) => t + 1), 1500); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [ollamaBase, tick]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setTick((t) => t + 1);
  };

  const has = (m?: string) => !!m && !!st?.ollama.models.some((h) => h === m || h === `${m}:latest`);
  const inUse = st ? [st.settings.ollamaModel, st.memoryModel.id, utility].find(has) : undefined;
  const pct = st?.pull.total ? Math.round((st.pull.done / st.pull.total) * 100) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 font-semibold text-sm"><Cpu className="h-4 w-4" />Memory model (on this computer)</div>
        <div className="text-xs text-[var(--muted-fg)]">
          Memory updates after every reply and the prompts for scene pictures run on a small local model, so your chat
          model (which may cost money) is not used for them.
        </div>
      </CardHeader>
      <CardBody className="space-y-3 text-xs">
        {!st ? (
          <div className="text-[var(--muted-fg)]">{error ?? "Checking…"}</div>
        ) : (
          <>
            <div className="space-y-1">
              <div>
                <span className="font-medium">Ollama: </span>
                {st.ollama.running ? <span className="text-green-600">running</span>
                  : st.ollama.installed ? <span>installed, not running (FableChat starts it when needed)</span>
                  : <span>not installed. <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="underline">Get Ollama</a>, then come back here.</span>}
              </div>
              <div>
                <span className="font-medium">Model in use: </span>
                {inUse ? <code>{inUse}</code> : <span className="text-[var(--muted-fg)]">none yet</span>}
              </div>
            </div>

            {st.ollama.installed && !has(st.memoryModel.id) && (
              <div className="space-y-1.5">
                <Button variant="purple" size="sm" disabled={st.pull.running}
                  onClick={() => void act(() => sendJson("POST", "/api/background", { action: "pull", ollama: ollamaBase }))}>
                  {st.pull.running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                  {st.pull.running ? `${st.pull.status}${pct !== null ? ` · ${pct}%` : ""}` : `Download ${st.memoryModel.label} (${st.memoryModel.gb} GB)`}
                </Button>
                <div className="text-[11px] text-[var(--muted-fg)]">Into Ollama, as <code>{st.memoryModel.id}</code>. Small enough to run beside ComfyUI and voice.</div>
              </div>
            )}
            {st.pull.error && <div role="alert" className="text-red-600">Download stopped: {st.pull.error}</div>}

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={st.settings.fallbackToChat} aria-label="Use my chat model when no local model is running"
                onChange={(e) => void act(() => sendJson("PUT", "/api/background", { fallbackToChat: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer" />
              <span>
                <span className="block font-medium">Use my chat model when no local model is running</span>
                <span className="block text-[11px] text-[var(--muted-fg)]">Off: memory and scene pictures wait until a local model is there. On: they use the chat&apos;s model instead, which costs money on a paid model.</span>
              </span>
            </label>
            {error && <div role="alert" className="text-red-600">{error}</div>}
          </>
        )}
      </CardBody>
    </Card>
  );
}
