"use client";

// ─── Settings → Media → Comic-it ──────────────────────────────────────────────
// The switch that adds "Comic it" to the message box (off by default), and the
// art style every page is drawn in. Kept by the server (/api/comic).

import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson, sendJson } from "@/lib/api/client";
import { forgetComicSettings } from "@/lib/chat/comic";

export function ComicCard() {
  const [st, setSt] = useState<{ enabled: boolean; style: string } | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getJson<{ enabled: boolean; style: string }>("/api/comic")
      .then((s) => { if (!cancelled) setSt(s); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const save = async (patch: { enabled?: boolean; style?: string }) => {
    setError(null);
    try {
      const r = await sendJson<{ enabled: boolean; style: string }>("PUT", "/api/comic", patch);
      setSt({ enabled: r.enabled, style: r.style });
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
            {error && <div role="alert" className="text-red-600">{error}</div>}
          </>
        )}
      </CardBody>
    </Card>
  );
}
