"use client";

// ─── Trading-card export ──────────────────────────────────────────────────────
// Preview of the drawn card face and what goes inside it: the full card (always),
// the lorebook (when linked), reference pictures, and the saved first messages
// you tick (they are not tied to a character, so they are chosen here). The
// download is a PNG any card reader opens as an ordinary SillyTavern V2 card;
// FableChat also reads its bundle back (lib/import/applyCards.ts).

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useFableStore } from "@/lib/store";
import { drawTradingCardFace, exportTradingCard } from "@/lib/cards/export";
import type { Character } from "@/lib/types";

export function TradingCardDialog({ character, onClose }: { character: Character | null; onClose: () => void }) {
  return (
    <Dialog open={!!character} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        {character && <Body key={character.id} character={character} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ character, onClose }: { character: Character; onClose: () => void }) {
  const openers = useFableStore((s) => s.openers);
  const book = useFableStore((s) => s.lorebooks.find((b) => b.id === character.lorebookId));
  const [preview, setPreview] = useState<{ key: string; url: string | null; error?: string } | null>(null);
  const [withRefs, setWithRefs] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  // Re-drawn when anything on the face changes
  const faceKey = JSON.stringify([character.name, character.description, character.tags, character.creator, character.characterVersion, character.avatar]);
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void drawTradingCardFace(character).then(
      (bytes) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
        setPreview({ key: faceKey, url });
      },
      (e: unknown) => { if (!cancelled) setPreview({ key: faceKey, url: null, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
    // faceKey stands for the character fields drawn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceKey]);
  const loading = preview?.key !== faceKey;
  const refCount = character.referenceImages?.length ?? 0;

  const download = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await exportTradingCard(character, {
        book,
        references: withRefs,
        openers: openers.filter((o) => picked.has(o.id)).map((o) => ({ name: o.name, text: o.text })),
      });
      const notes = [
        r.usedAvatar ? null : `${character.name} has no portrait, so the card shows their initial.`,
        r.referencesSkipped ? `${r.referencesSkipped} reference picture${r.referencesSkipped === 1 ? "" : "s"} could not be read and ${r.referencesSkipped === 1 ? "was" : "were"} left out.` : null,
      ].filter(Boolean);
      const carried = [book ? "the lorebook" : null, r.references ? `${r.references} reference picture${r.references === 1 ? "" : "s"}` : null,
        r.openers ? `${r.openers} first message${r.openers === 1 ? "" : "s"}` : null].filter(Boolean);
      setNotice({ kind: notes.length ? "error" : "info", text: `Saved ${character.name}'s card${carried.length ? ` with ${carried.join(", ")}` : ""}. ${notes.join(" ")}`.trim() });
    } catch (e) {
      setNotice({ kind: "error", text: `Could not make the card: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="px-5 pt-4 pb-2 pr-12">
        <DialogTitle>Export {character.name} as a card</DialogTitle>
        <p className="mt-1 text-xs text-[var(--muted-fg)]">
          A PNG card with everything inside it. Any SillyTavern-style reader opens it as a normal character card; FableChat also brings back the extras below.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col sm:flex-row gap-4">
        <div className="sm:w-[260px] flex-shrink-0">
          <div className="aspect-[5/7] w-full max-w-[260px] mx-auto rounded-xl bg-[var(--muted)] flex items-center justify-center overflow-hidden">
            {loading ? <Loader2 className="h-6 w-6 animate-spin text-[var(--purple-fg)]" />
              : preview?.url
                // eslint-disable-next-line @next/next/no-img-element -- a blob URL drawn in the browser
                ? <img src={preview.url} alt={`${character.name} as a card`} className="w-full h-full object-contain" />
                : <span className="px-3 text-center text-xs text-red-600">{preview?.error ?? "No preview"}</span>}
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-3 text-sm">
          <div>
            <div className="font-medium">Inside the card</div>
            <ul className="mt-1 text-xs text-[var(--muted-fg)] list-disc pl-4 space-y-0.5">
              <li>Every card field: description, personality, scenario, greetings, examples, prompts, creator notes, tags</li>
              <li>How images draw them (tags, LoRAs, comic LoRA, seed)</li>
              <li>{book ? <>Lorebook &quot;{book.name}&quot; ({book.entries.length} entries)</> : "No lorebook linked"}</li>
              <li>The plain portrait, so importing gives back the picture rather than the card face</li>
            </ul>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={withRefs && refCount > 0} disabled={refCount === 0} onChange={(e) => setWithRefs(e.target.checked)} />
            {refCount ? `Reference pictures (${refCount})` : "No reference pictures"}
          </label>
          <div>
            <div className="text-xs font-medium">Saved first messages</div>
            {openers.length === 0 ? (
              <p className="text-xs text-[var(--muted-fg)]">None saved in the Library.</p>
            ) : (
              <div className="mt-1 max-h-40 overflow-y-auto space-y-1 rounded-lg border border-[var(--border)] p-2">
                {openers.map((o) => (
                  <label key={o.id} className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={picked.has(o.id)}
                      onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })} />
                    <span className="min-w-0"><span className="font-medium">{o.name}</span> <span className="text-[var(--muted-fg)] line-clamp-1">{o.text}</span></span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-[var(--muted-fg)]">Not carried: their voice sample and contact settings.</p>
        </div>
      </div>
      {notice && <div role="status" className={`px-5 pb-2 text-xs ${notice.kind === "error" ? "text-red-600" : "text-[var(--muted-fg)]"}`}>{notice.text}</div>}
      <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        <Button variant="purple" size="sm" disabled={busy} onClick={() => void download()}>
          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}Download card
        </Button>
      </div>
    </>
  );
}
