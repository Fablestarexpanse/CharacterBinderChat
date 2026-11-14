"use client";

// ─── Export as a card ─────────────────────────────────────────────────────────
// The card face is drawn by ComfyUI from options you pick here (lib/cards/
// cardArt.ts: how it's drawn, art style, border, text, background, anything
// else); Generate art makes it (lib/chat/cardArt.ts) and keeps it on the
// character with its options (`cardFace`), so a later export reuses it. Until
// there is art, the portrait stands in. Below: what goes inside the file (the
// full card, lorebook, portrait, reference pictures, and first messages you
// tick, since those are not tied to a character). The download is a PNG any
// SillyTavern-style reader opens as an ordinary card; FableChat also reads its
// bundle back (lib/import/applyCards.ts).

import { useEffect, useState } from "react";
import { Download, Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFableStore } from "@/lib/store";
import { drawTradingCardFace, exportTradingCard } from "@/lib/cards/export";
import { generateCardArt } from "@/lib/chat/cardArt";
import { CARD_FRAMES, CARD_STYLES, DEFAULT_CARD_OPTIONS, cleanCardOptions, type CardArtOptions } from "@/lib/cards/cardArt";
import type { Character } from "@/lib/types";

export function TradingCardDialog({ characterId, onClose }: { characterId: string | null; onClose: () => void }) {
  const character = useFableStore((s) => s.characters.find((c) => c.id === characterId));
  return (
    <Dialog open={!!character} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        {character && <Body key={character.id} character={character} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

const selectCls = "h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs";

function Body({ character, onClose }: { character: Character; onClose: () => void }) {
  const openers = useFableStore((s) => s.openers);
  const book = useFableStore((s) => s.lorebooks.find((b) => b.id === character.lorebookId));
  const updateCharacter = useFableStore((s) => s.updateCharacter);
  const [opts, setOpts] = useState<CardArtOptions>(() => cleanCardOptions(character.cardFace?.options ?? DEFAULT_CARD_OPTIONS));
  const [preview, setPreview] = useState<{ key: string; url: string | null; error?: string } | null>(null);
  const [withRefs, setWithRefs] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"art" | "download" | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const set = (patch: Partial<CardArtOptions>) => setOpts((o) => ({ ...o, ...patch }));

  // Re-drawn when anything on the face changes: the art, the portrait, the text choices
  const faceKey = JSON.stringify([character.name, character.description, character.avatar, character.cardFace?.art, character.cardFace?.options.engine, opts.text, opts.nameAt]);
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void drawTradingCardFace(character, opts).then(
      (bytes) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
        setPreview({ key: faceKey, url });
      },
      (e: unknown) => { if (!cancelled) setPreview({ key: faceKey, url: null, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
    // faceKey stands for everything drawn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceKey]);
  const loading = preview?.key !== faceKey;
  const refCount = character.referenceImages?.length ?? 0;
  const art = character.cardFace?.art;
  const lettered = !!art && character.cardFace?.options.engine === "moss";

  const generate = async () => {
    setBusy("art");
    setNotice(null);
    try {
      const url = await generateCardArt(character, opts);
      updateCharacter(character.id, { cardFace: { art: url, options: opts } });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    setNotice(null);
    try {
      const r = await exportTradingCard(character, {
        book, references: withRefs, face: opts,
        openers: openers.filter((o) => picked.has(o.id)).map((o) => ({ name: o.name, text: o.text })),
      });
      // The text choices are remembered with the art
      updateCharacter(character.id, { cardFace: { ...(art ? { art } : {}), options: { ...(character.cardFace?.options ?? opts), text: opts.text, nameAt: opts.nameAt } } });
      const notes = [
        art || r.usedAvatar ? null : `${character.name} has no card art or portrait, so the card shows their initial.`,
        r.referencesSkipped ? `${r.referencesSkipped} reference picture${r.referencesSkipped === 1 ? "" : "s"} could not be read and ${r.referencesSkipped === 1 ? "was" : "were"} left out.` : null,
      ].filter(Boolean);
      const carried = [book ? "the lorebook" : null, r.references ? `${r.references} reference picture${r.references === 1 ? "" : "s"}` : null,
        r.openers ? `${r.openers} first message${r.openers === 1 ? "" : "s"}` : null].filter(Boolean);
      setNotice({ kind: notes.length ? "error" : "info", text: `Saved ${character.name}'s card${carried.length ? ` with ${carried.join(", ")}` : ""}. ${notes.join(" ")}`.trim() });
    } catch (e) {
      setNotice({ kind: "error", text: `Could not make the card: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="px-5 pt-4 pb-2 pr-12">
        <DialogTitle>Export {character.name} as a card</DialogTitle>
        <p className="mt-1 text-xs text-[var(--muted-fg)]">
          Pick how the card looks and let ComfyUI draw it. The file is a PNG with the whole character inside: any SillyTavern-style reader opens it as a normal card.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col sm:flex-row gap-4">
        <div className="sm:w-[250px] flex-shrink-0 space-y-2">
          <div className="aspect-[5/7] w-full max-w-[250px] mx-auto rounded-xl bg-[var(--muted)] flex items-center justify-center overflow-hidden">
            {busy === "art" ? (
              <div className="flex flex-col items-center gap-2 text-xs text-[var(--muted-fg)]"><Loader2 className="h-6 w-6 animate-spin text-[var(--purple-fg)]" />Drawing the card…</div>
            ) : loading ? <Loader2 className="h-6 w-6 animate-spin text-[var(--purple-fg)]" />
              : preview?.url
                // eslint-disable-next-line @next/next/no-img-element -- a blob URL drawn in the browser
                ? <img src={preview.url} alt={`${character.name} as a card`} className="w-full h-full object-contain" />
                : <span className="px-3 text-center text-xs text-red-600">{preview?.error ?? "No preview"}</span>}
          </div>
          <p className="text-[11px] text-center text-[var(--muted-fg)]">
            {art ? (lettered ? "Card art by MOSS, name lettered in." : "Card art from your picture settings, name laid over.") : "No card art yet: showing their portrait."}
          </p>
        </div>
        <div className="flex-1 min-w-0 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
            <label className="space-y-1 sm:col-span-2">
              <span className="block font-medium">Drawn with</span>
              <select className={selectCls} value={opts.engine} onChange={(e) => set({ engine: e.target.value as CardArtOptions["engine"] })}>
                <option value="moss">MOSS-Image: letters the name into the art</option>
                <option value="look">Your picture settings: looks most like them, name laid over</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block font-medium">Art style</span>
              <select className={selectCls} value={opts.style} onChange={(e) => set({ style: e.target.value })}>
                {CARD_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                <option value="custom">Your own…</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block font-medium">Border</span>
              <select className={selectCls} value={opts.frame} onChange={(e) => set({ frame: e.target.value })}>
                {CARD_FRAMES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                <option value="custom">Your own…</option>
              </select>
            </label>
            {opts.style === "custom" && (
              <Input className="h-8 text-xs" placeholder="Art style, e.g. ukiyo-e woodblock print" value={opts.customStyle ?? ""} onChange={(e) => set({ customStyle: e.target.value })} aria-label="Your own art style" />
            )}
            {opts.frame === "custom" && (
              <Input className={`h-8 text-xs ${opts.style === "custom" ? "" : "sm:col-start-2"}`} placeholder="Border, e.g. a ring of cherry blossoms" value={opts.customFrame ?? ""} onChange={(e) => set({ customFrame: e.target.value })} aria-label="Your own border" />
            )}
            <label className="space-y-1">
              <span className="block font-medium">Text on the card</span>
              <select className={selectCls} value={opts.text} onChange={(e) => set({ text: e.target.value as CardArtOptions["text"] })}>
                <option value="name">Name</option>
                <option value="name-tagline">Name and a line about them</option>
                <option value="none">No text</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block font-medium">Name goes</span>
              <select className={selectCls} value={opts.nameAt} disabled={opts.text === "none"} onChange={(e) => set({ nameAt: e.target.value as CardArtOptions["nameAt"] })}>
                <option value="bottom">At the bottom</option>
                <option value="top">At the top</option>
              </select>
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="block font-medium">Behind them <span className="font-normal text-[var(--muted-fg)]">optional</span></span>
              <Input className="h-8 text-xs" placeholder="e.g. a tower of glass under the stars" value={opts.background ?? ""} onChange={(e) => set({ background: e.target.value })} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="block font-medium">Anything else <span className="font-normal text-[var(--muted-fg)]">optional</span></span>
              <Input className="h-8 text-xs" placeholder="e.g. holding her staff, dramatic low angle" value={opts.extra ?? ""} onChange={(e) => set({ extra: e.target.value })} />
            </label>
          </div>
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void generate()}>
            {busy === "art" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}{art ? "Generate again" : "Generate art"}
          </Button>
          {lettered && <p className="text-[11px] text-[var(--muted-fg)]">This art has its text drawn in; changing the text choices needs it generated again.</p>}

          <div className="border-t border-[var(--border)] pt-3 space-y-2">
            <div className="font-medium">Inside the file</div>
            <p className="text-[var(--muted-fg)]">
              Every card field, how images draw them, {book ? <>the lorebook &quot;{book.name}&quot;</> : "no lorebook (none linked)"}, and their plain portrait (so importing gives back the picture, not the card).
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={withRefs && refCount > 0} disabled={refCount === 0} onChange={(e) => setWithRefs(e.target.checked)} />
              {refCount ? `Reference pictures (${refCount})` : "No reference pictures"}
            </label>
            <div>
              <div className="font-medium">Saved first messages</div>
              {openers.length === 0 ? (
                <p className="text-[var(--muted-fg)]">None saved in the Library.</p>
              ) : (
                <div className="mt-1 max-h-32 overflow-y-auto space-y-1 rounded-lg border border-[var(--border)] p-2">
                  {openers.map((o) => (
                    <label key={o.id} className="flex items-start gap-2">
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
      </div>
      {notice && <div role="status" className={`px-5 pb-2 text-xs break-words ${notice.kind === "error" ? "text-red-600" : "text-[var(--muted-fg)]"}`}>{notice.text}</div>}
      <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        <Button variant="purple" size="sm" disabled={!!busy} onClick={() => void download()}>
          {busy === "download" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}Download card
        </Button>
      </div>
    </>
  );
}
