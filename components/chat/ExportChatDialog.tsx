"use client";

// ─── "Export this chat" ───────────────────────────────────────────────────────
// Pick a format (lib/chat/chatExport.ts) and what goes with it: pictures, clips,
// voice, and, for FableChat's own format, the memory. Shown from a chat's row
// in Chats and in Archive.

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FORMATS, exportChat, mediaOf, transcript, type ChatExportOptions } from "@/lib/chat/chatExport";
import type { Chat } from "@/lib/types";

export function ExportChatDialog({ chat, open, onClose }: { chat: Chat; open: boolean; onClose: () => void }) {
  const characters = useFableStore((s) => s.characters);
  const imageJobs = useFableStore((s) => s.imageJobs);
  const personaName = useFableStore((s) => s.personas.find((p) => p.id === s.activePersonaId)?.name);
  const [opts, setOpts] = useState<ChatExportOptions>({ format: "html", pictures: true, clips: true, voice: false, memory: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const ctx = { chat, characters, imageJobs, userName: personaName ?? "You" };
  // What there is to include, so options with nothing behind them are not offered
  const all = mediaOf(transcript(ctx, { pictures: true, clips: true, voice: true }));
  const count = (k: string) => all.filter((m) => m.kind === k).length;
  const has = { image: count("image"), video: count("video"), audio: count("audio") };
  const noMedia = opts.format === "jsonl";
  const fmt = FORMATS.find((f) => f.id === opts.format)!;
  const withFiles = !noMedia && opts.format !== "html" && ((opts.pictures && has.image) || (opts.clips && has.video) || (opts.voice && has.audio));

  const run = async () => {
    setResult(null);
    setBusy("Getting ready");
    try {
      const r = await exportChat(ctx, opts, (done, total) => setBusy(total ? `Collecting media ${done}/${total}` : "Writing the file"));
      setResult({ kind: r.missing ? "error" : "ok", text: `Saved ${r.file}.${r.missing ? ` ${r.missing} picture${r.missing === 1 ? "" : "s"} or clip${r.missing === 1 ? "" : "s"} could not be fetched (an image card's picture needs ComfyUI running) and ${r.missing === 1 ? "is" : "are"} left out.` : ""}` });
    } catch (e) {
      setResult({ kind: "error", text: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const box = (key: "pictures" | "clips" | "voice" | "memory", label: string, n?: number) => (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={opts[key]} onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
        className="h-4 w-4 accent-[var(--purple)]" aria-label={label} />
      <span>{label}{n !== undefined && <span className="text-[11px] text-[var(--muted-fg)]"> ({n})</span>}</span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) { setResult(null); onClose(); } }}>
      <DialogContent className="max-w-md p-5 space-y-4" aria-describedby={undefined} onClick={(e) => e.stopPropagation()}>
        <DialogTitle>Export “{chat.name}”</DialogTitle>

        <div role="radiogroup" aria-label="Format" className="space-y-1.5">
          {FORMATS.map((f) => (
            <label key={f.id} className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer ${opts.format === f.id ? "border-[var(--purple)] bg-[var(--purple-light)]" : "border-[var(--border)]"}`}>
              <input type="radio" name="export-format" checked={opts.format === f.id} onChange={() => setOpts({ ...opts, format: f.id })}
                className="mt-1 accent-[var(--purple)]" aria-label={f.label} />
              <span>
                <span className="block text-sm font-medium">{f.label} <span className="text-[11px] font-normal text-[var(--muted-fg)]">.{f.ext}</span></span>
                <span className="block text-[11px] text-[var(--muted-fg)]">{f.note}</span>
              </span>
            </label>
          ))}
        </div>

        {noMedia ? (
          <p className="text-[11px] text-[var(--muted-fg)]">SillyTavern chat files hold the words only.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="text-xs font-medium">Include</div>
            {has.image > 0 && box("pictures", "Pictures", has.image)}
            {has.video > 0 && box("clips", "Clips", has.video)}
            {has.audio > 0 && box("voice", "Spoken replies (voice)", has.audio)}
            {opts.format === "json" && box("memory", "Memory (facts and Core Memory)")}
            {!has.image && !has.video && !has.audio && opts.format !== "json" && <p className="text-[11px] text-[var(--muted-fg)]">No pictures, clips or voice in this chat.</p>}
            <p className="text-[11px] text-[var(--muted-fg)]">
              {opts.format === "html" ? "One file: pictures and clips are inside the page." : withFiles ? "A .zip: the file plus a media folder." : "One file."}
            </p>
          </div>
        )}

        {result && <div role="status" className={`text-xs ${result.kind === "error" ? "text-red-600" : "text-green-700"}`}>{result.text}</div>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => { setResult(null); onClose(); }}>Close</Button>
          <Button variant="purple" size="sm" disabled={!!busy} onClick={() => void run()}>
            {busy ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Download className="h-3 w-3 mr-1.5" />}
            {busy ?? `Export as ${fmt.label}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
