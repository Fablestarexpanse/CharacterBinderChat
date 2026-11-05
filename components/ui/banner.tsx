"use client";

// ─── Banner pictures (lorebooks, scenarios) ───────────────────────────────────
// A 770 × 110 picture behind a card's header. Everything drawn on it must stay
// readable on any picture in either theme: text sits on a dark fade from the
// left (white, with a shadow), and buttons sit on a solid frosted pill. One
// place for these rules so the Lorebooks, Scenarios and Library screens agree.

import { useRef, useState, type CSSProperties } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadImage, sizedSrc } from "@/lib/chat/assets";

/** The shape a banner is shown at */
export const BANNER_RATIO = "770 / 110";

/**
 * Style for an element that shows the banner. The width is pinned so the
 * height follows the 7:1 shape; min-height only grows it when the content
 * needs more room (a phone), never the width.
 */
export function bannerStyle(url: string, minHeight = "3.5rem"): CSSProperties {
  return { backgroundImage: `url("${sizedSrc(url, 770)}")`, aspectRatio: BANNER_RATIO, width: "100%", minHeight, backgroundSize: "cover", backgroundPosition: "center" };
}

/** The dark fade from the left that keeps the name readable. Put it first inside a `relative` banner. */
export function BannerFade() {
  return <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/10" />;
}

/** Text on a banner */
export const BANNER_TEXT = "text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]";
export const BANNER_SUBTEXT = "text-white/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]";
/** An editable name on a banner: no white box, a faint outline that brightens on hover and focus */
export const BANNER_INPUT = "bg-transparent border-white/25 text-white placeholder:text-white/60 [text-shadow:0_1px_3px_rgb(0_0_0/0.9)] hover:border-white/50 focus:border-white/80 focus:bg-black/30";
/** Buttons and badges on a banner sit on this */
export const BANNER_PILL = "rounded-lg bg-[var(--card)]/90 px-1.5 py-1 text-[var(--foreground)] shadow-sm backdrop-blur-sm";

/**
 * Add, change or remove a banner. The picture is stored as an asset (original
 * kept); anything not 7:1 is cropped to fit, from the middle.
 */
export function BannerControl({ banner, onChange }: { banner?: string; onChange: (banner: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setState({ busy: true });
    try {
      onChange(await uploadImage(file));
      setState({ busy: false });
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-label="Banner picture"
        onChange={(e) => void pick(e.target.files?.[0])} />
      <Button variant="outline" size="sm" disabled={state.busy} onClick={() => input.current?.click()}>
        <ImagePlus className="h-3.5 w-3.5 mr-1" />{state.busy ? "Adding…" : banner ? "Change banner" : "Add banner"}
      </Button>
      {banner && <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>Remove banner</Button>}
      <span className="text-[11px] text-[var(--muted-fg)]">Best at 770 × 110. Other sizes are cropped to fit.</span>
      {state.error && <span role="alert" className="text-[11px] text-red-600">{state.error}</span>}
    </div>
  );
}
