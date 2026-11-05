"use client";

// ─── Settings → Contact & media ───────────────────────────────────────────────
// The master switch for characters sending photos (and, later, reaching out,
// video and voice). Off until you turn it on.

import { useEffect, useState } from "react";
import { getJson, sendJson } from "@/lib/api/client";
import { cleanContactSettings, type ContactSettings } from "@/lib/media/contact";
import { forgetContactSettings } from "@/lib/chat/photos";
import { fromMinutes, toMinutes } from "@/lib/outreach/rules";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export function ContactCard() {
  const [result, setResult] = useState<{ value?: ContactSettings; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getJson<unknown>("/api/contact-settings")
      .then((v) => { if (!cancelled) setResult({ value: cleanContactSettings(v) }); })
      .catch((e: Error) => { if (!cancelled) setResult({ error: e.message }); });
    return () => { cancelled = true; };
  }, []);

  // Shown at once, saved behind it; put back if the save fails
  const change = async (patch: Partial<ContactSettings>) => {
    const before = result?.value;
    if (before) setResult({ value: { ...before, ...patch } });
    try {
      const v = await sendJson<unknown>("PUT", "/api/contact-settings", patch);
      forgetContactSettings();
      setResult({ value: cleanContactSettings(v) });
    } catch (e) {
      setResult({ value: before, error: `Not saved: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const v = result?.value;

  const askNotifications = async (on: boolean) => {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") { setResult((r) => ({ ...r, error: "The browser did not allow notifications, so they stay off." })); return; }
    }
    void change({ notifications: on });
  };

  const row = (label: string, hint: string, control: React.ReactNode, dim = false) => (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${dim ? "opacity-50" : ""}`}>
      <span className="min-w-[12rem] flex-1">
        <span className="block text-xs font-medium text-[var(--foreground)]">{label}</span>
        <span className="block text-[11px] text-[var(--muted-fg)] mt-0.5">{hint}</span>
      </span>
      {control}
    </div>
  );
  const input = "h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs";

  return (
    <Card>
      <CardHeader>
        <div className="font-semibold text-sm">Contact &amp; media</div>
        <div className="text-xs text-[var(--muted-fg)]">
          Lets characters send you photos and reach out to you on their own. Off by default: while it is off nothing is
          generated or sent, and no character is told it could. Each character also needs it allowed in their editor
          (“May send you photos”, “May contact you”).
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {result?.error && <div role="alert" className="text-xs text-red-600">{result.error}</div>}
        {!v ? <div className="text-xs text-[var(--muted-fg)]">Loading…</div> : (
          <>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={v.enabled} onChange={(e) => change({ enabled: e.target.checked })}
                aria-label="Contact and media" className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer" />
              <span>
                <span className="block text-xs font-medium text-[var(--foreground)]">Allow photos and messages from characters</span>
                <span className="block text-[11px] text-[var(--muted-fg)] mt-0.5">
                  Characters you allow can send a photo in a reply and text you first while a FableChat tab is open. Each
                  photo is one image generation; each message one reply from your chat model.
                </span>
              </span>
            </label>
            <div className={`space-y-4 border-l-2 border-[var(--border)] pl-4 ${v.enabled ? "" : "opacity-50 pointer-events-none"}`} aria-disabled={!v.enabled}>
              {row("Review before generating", "Show each photo's prompt first, to change or skip it.",
                <input type="checkbox" checked={v.reviewMedia} onChange={(e) => change({ reviewMedia: e.target.checked })} aria-label="Review before generating" className="h-4 w-4 accent-[var(--purple)] cursor-pointer" />)}
              {row("Pause all", "Stops photos and messages at once, until you resume. Also in the sidebar.",
                <input type="checkbox" checked={v.paused} onChange={(e) => change({ paused: e.target.checked })} aria-label="Pause all" className="h-4 w-4 accent-[var(--purple)] cursor-pointer" />)}
              {row("Your status", "Do not disturb stops all messages. Characters see your note.",
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Status" value={v.userStatus} onChange={(e) => change({ userStatus: e.target.value as ContactSettings["userStatus"] })} className={input}>
                    <option value="available">Available</option><option value="away">Away</option><option value="dnd">Do not disturb</option>
                  </select>
                  <input aria-label="What you are doing" placeholder="What I'm doing (optional)" maxLength={120} defaultValue={v.userNote}
                    onBlur={(e) => { if (e.target.value.trim() !== v.userNote) change({ userNote: e.target.value }); }} className={`${input} w-48`} />
                </div>)}
              {row("Quiet hours", "No messages from characters between these times.",
                <div className="flex items-center gap-1 text-xs">
                  <input type="time" aria-label="Quiet from" value={fromMinutes(v.quietStart)} onChange={(e) => { const m = toMinutes(e.target.value); if (m !== null) change({ quietStart: m }); }} className={input} />
                  <span>to</span>
                  <input type="time" aria-label="Quiet until" value={fromMinutes(v.quietEnd)} onChange={(e) => { const m = toMinutes(e.target.value); if (m !== null) change({ quietEnd: m }); }} className={input} />
                </div>)}
              {row("Daily limit", "Most messages characters may start in a day, all together. 0 stops them.",
                <input type="number" min={0} max={20} aria-label="Daily limit" value={v.dailyLimit} onChange={(e) => change({ dailyLimit: Number(e.target.value) })} className={`${input} w-20`} />)}
              {row("Notifications", "A browser notification when a character messages you in a chat you are not looking at.",
                <input type="checkbox" checked={v.notifications} onChange={(e) => askNotifications(e.target.checked)} aria-label="Notifications" className="h-4 w-4 accent-[var(--purple)] cursor-pointer" />)}
              {row("Sounds", "A ringtone when a character calls and a chime when a text arrives. The browser plays them only after you have clicked somewhere in FableChat.",
                <input type="checkbox" checked={v.sounds} onChange={(e) => change({ sounds: e.target.checked })} aria-label="Sounds" className="h-4 w-4 accent-[var(--purple)] cursor-pointer" />)}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
