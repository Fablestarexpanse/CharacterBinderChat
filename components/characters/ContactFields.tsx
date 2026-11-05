"use client";

// ─── Contact: what a character may do on their own ────────────────────────────
// Both switches are off until you turn them on, and do nothing while
// Settings → Contact & media is off.

import { STORY_TRIGGERS, type CharacterContact } from "@/lib/media/contact";
import type { ContactMode, StoryTrigger } from "@/lib/outreach/rules";

const WAITS = [30, 60, 120, 240, 480, 1440];
const waitLabel = (m: number) => (m < 60 ? `${m} minutes` : m === 1440 ? "a day" : `${m / 60} hour${m === 60 ? "" : "s"}`);

export function ContactFields({ value, onChange, who }: { value: CharacterContact; onChange: (v: CharacterContact) => void; who: string }) {
  const set = (patch: Partial<CharacterContact>) => onChange({ ...value, ...patch });
  const off = new Set(value.off ?? []);
  const toggle = (t: StoryTrigger) => { const n = new Set(off); if (n.has(t)) n.delete(t); else n.add(t); set({ off: [...n] }); };
  const mode = value.mode ?? "story";
  const sel = "h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs";
  return (
    <div className="rounded-lg border border-[var(--border)] px-3 py-2 space-y-3" role="group" aria-label="Contact">
      <div className="text-xs font-medium text-[var(--foreground)]">Contact <span className="font-normal text-[var(--muted-fg)]">— needs Contact &amp; media on in Settings; until then {who} is never told</span></div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={!!value.photos} onChange={(e) => set({ photos: e.target.checked })} aria-label="May send you photos" className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer" />
        <span><span className="block text-xs font-medium">May send you photos</span><span className="block text-[11px] text-[var(--muted-fg)]">{who} may choose to send a photo in a reply, drawn as set above.</span></span>
      </label>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={!!value.canContact} onChange={(e) => set({ canContact: e.target.checked })} aria-label="May contact you" className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer" />
        <span><span className="block text-xs font-medium">May contact you</span><span className="block text-[11px] text-[var(--muted-fg)]">{who} may text you first after you have been quiet a while, in your latest chat with them, while a FableChat tab is open.</span></span>
      </label>
      {value.canContact && (
        <div className="space-y-3 border-l-2 border-[var(--border)] pl-4">
          <label className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">When</span>
            <select aria-label="When they reach out" value={mode} onChange={(e) => set({ mode: e.target.value as ContactMode })} className={sel}>
              <option value="story">When something in the story calls for it</option>
              <option value="timed">On a routine (morning, evening, after a while)</option>
              <option value="both">Both</option>
            </select>
          </label>
          {mode !== "timed" && (
            <div className="space-y-1">
              {STORY_TRIGGERS.map((t) => (
                <label key={t.id} className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={!off.has(t.id)} onChange={() => toggle(t.id)} aria-label={t.label} className="mt-0.5 accent-[var(--purple)]" />
                  <span><span className="font-medium">{t.label}</span> <span className="text-[var(--muted-fg)]">— {t.hint}</span></span>
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-2"><span>Wait at least</span>
              <select aria-label="Wait before reaching out" value={value.waitMinutes ?? 120} onChange={(e) => set({ waitMinutes: Number(e.target.value) })} className={sel}>
                {WAITS.map((w) => <option key={w} value={w}>{waitLabel(w)}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2"><span>Follow-ups</span>
              <select aria-label="Follow-ups" value={value.maxFollowUps ?? 2} onChange={(e) => set({ maxFollowUps: Number(e.target.value) })} className={sel}>
                <option value={0}>none</option><option value={1}>1</option><option value={2}>2</option>
              </select>
            </label>
            <label className="flex items-center gap-2"><span>Their daily limit</span>
              <select aria-label="Their daily limit" value={value.dailyLimit ?? ""} onChange={(e) => set({ dailyLimit: e.target.value === "" ? undefined : Number(e.target.value) })} className={sel}>
                <option value="">the overall one</option>{[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-[var(--muted-fg)]">Each follow-up waits twice as long as the last; when you reply, the count starts again. Quiet hours and the overall daily limit are in Settings → Contact &amp; media.</p>
        </div>
      )}
    </div>
  );
}
