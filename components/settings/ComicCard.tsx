"use client";

// ─── Settings → Media → Comic-it ──────────────────────────────────────────────
// The switch that adds "Comic it" to the message box (off by default), the
// art style every page is drawn in, and an optional style LoRA (a MOSS-Image
// LoRA; the MOSS ones ComfyUI has are offered first). Kept by the server (/api/comic).
// A character's own comic LoRA is in their look (How images draw them).

import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson, sendJson } from "@/lib/api/client";
import { forgetComicSettings, type ComicSettings } from "@/lib/chat/comic";
import { useFableStore } from "@/lib/store";
import { ComfyUIProvider } from "@/lib/providers/comfyui";

export function ComicCard() {
  const [st, setSt] = useState<ComicSettings | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const comfyBase = useFableStore((s) => s.providerSettings.comfyui.baseUrl);

  useEffect(() => {
    let cancelled = false;
    void getJson<ComicSettings>("/api/comic")
      .then((s) => { if (!cancelled) setSt(s); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);
  // The LoRAs ComfyUI has; MOSS ones first, since others won't work on MOSS-Image
  useEffect(() => {
    let cancelled = false;
    void new ComfyUIProvider(comfyBase).listLoras().then((names) => {
      if (!cancelled) setLoras([...names.filter((n) => /moss/i.test(n)), ...names.filter((n) => !/moss/i.test(n))]);
    });
    return () => { cancelled = true; };
  }, [comfyBase]);

  const save = async (patch: { enabled?: boolean; style?: string; styleLora?: { name: string; weight: number } | null }) => {
    setError(null);
    try {
      const r = await sendJson<ComicSettings>("PUT", "/api/comic", patch);
      setSt({ enabled: r.enabled, style: r.style, ...(r.styleLora ? { styleLora: r.styleLora } : {}) });
      setStyle(null);
      forgetComicSettings();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 font-semibold text-sm"><LayoutGrid className="h-4 w-4" />Comic-it</div>
        <div className="text-xs text-[var(--muted-fg)]">
          A comic page of the story so far, with speech balloons and narration, drawn by MOSS-Image. Each press covers what
          happened since the last page.
        </div>
      </CardHeader>
      <CardBody className="space-y-3 text-xs">
        {!st ? <div className="text-[var(--muted-fg)]">{error ?? "Loading…"}</div> : (
          <>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={st.enabled} onChange={(e) => void save({ enabled: e.target.checked })}
                aria-label="Show Comic it in chats" className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer" />
              <span>
                <span className="block font-medium">Show “Comic it” in chats</span>
                <span className="block text-[11px] text-[var(--muted-fg)]">
                  The memory model writes the panels and lines; FableChat lays out the page; MOSS-Image draws it (1024 × 1536).
                  Needs ComfyUI with the MOSS photo workflow&apos;s models.
                </span>
              </span>
            </label>
            <label className="block space-y-1">
              <span className="block font-medium">Art style</span>
              <div className="flex gap-2">
                <Input value={style ?? st.style} onChange={(e) => setStyle(e.target.value)} aria-label="Comic art style" className="h-8 text-xs"
                  onBlur={() => { if (style !== null && style !== st.style) void save({ style }); }} />
              </div>
              <span className="block text-[11px] text-[var(--muted-fg)]">For example: black-and-white manga with screentones; or a 1960s pulp comic in four-colour print.</span>
            </label>
            <div className="space-y-1">
              <span className="block font-medium">Style LoRA <span className="font-normal text-[var(--muted-fg)]">optional</span></span>
              <div className="flex gap-2">
                <select value={st.styleLora?.name ?? ""} aria-label="Comic style LoRA"
                  onChange={(e) => void save({ styleLora: e.target.value ? { name: e.target.value, weight: st.styleLora?.weight ?? 1 } : null })}
                  className="h-8 flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs">
                  <option value="">None</option>
                  {st.styleLora && !loras.includes(st.styleLora.name) && <option value={st.styleLora.name}>{st.styleLora.name}</option>}
                  {loras.map((n) => <option key={n} value={n}>{/moss/i.test(n) ? "" : "(not MOSS) "}{n}</option>)}
                </select>
                <Input type="number" step={0.05} min={0} max={2} aria-label="Style LoRA weight" className="h-8 w-20 text-xs" disabled={!st.styleLora}
                  value={st.styleLora?.weight ?? 1}
                  onChange={(e) => st.styleLora && setSt({ ...st, styleLora: { ...st.styleLora, weight: Number(e.target.value) } })}
                  onBlur={() => st.styleLora && void save({ styleLora: st.styleLora })} />
              </div>
              <span className="block text-[11px] text-[var(--muted-fg)]">
                Only LoRAs made for MOSS-Image work here. A character&apos;s own comic LoRA goes in their look (How images draw them → LoRA for comic pages).
                Speed LoRAs (4- or 8-step) need the workflow&apos;s steps changed to match.
              </span>
            </div>
            {error && <div role="alert" className="text-red-600">{error}</div>}
          </>
        )}
      </CardBody>
    </Card>
  );
}
