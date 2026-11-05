"use client";

// ─── Settings → Contact & media ───────────────────────────────────────────────
// The master switch for characters sending photos (and, later, reaching out,
// video and voice). Off until you turn it on.

import { useEffect, useState } from "react";
import { getJson, sendJson } from "@/lib/api/client";
import { cleanContactSettings, type ContactSettings } from "@/lib/media/contact";
import { forgetContactSettings } from "@/lib/chat/photos";
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

  return (
    <Card>
      <CardHeader>
        <div className="font-semibold text-sm">Contact &amp; media</div>
        <div className="text-xs text-[var(--muted-fg)]">
          Lets characters send you photos. Off by default: while it is off nothing is generated or sent, and no character
          is told it could. Each character also needs “May send you photos” turned on in their editor.
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {result?.error && <div role="alert" className="text-xs text-red-600">{result.error}</div>}
        {!v ? <div className="text-xs text-[var(--muted-fg)]">Loading…</div> : (
          <>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={v.enabled} onChange={(e) => change({ enabled: e.target.checked })}
                aria-label="Contact and media" className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer" />
              <span>
                <span className="block text-xs font-medium text-[var(--foreground)]">Allow photos from characters</span>
                <span className="block text-[11px] text-[var(--muted-fg)] mt-0.5">
                  A character you allow can choose to send a photo in a reply, and you can ask for one from the message box.
                  Each photo is one image generation (through ComfyUI).
                </span>
              </span>
            </label>
            <label className={`flex items-start gap-3 cursor-pointer ${v.enabled ? "" : "opacity-50"}`}>
              <input type="checkbox" checked={v.reviewMedia} disabled={!v.enabled} onChange={(e) => change({ reviewMedia: e.target.checked })}
                aria-label="Review before generating" className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer" />
              <span>
                <span className="block text-xs font-medium text-[var(--foreground)]">Review before generating</span>
                <span className="block text-[11px] text-[var(--muted-fg)] mt-0.5">
                  Show each photo&apos;s prompt first, to change or skip it. Turn off to have photos made straight away.
                </span>
              </span>
            </label>
          </>
        )}
      </CardBody>
    </Card>
  );
}
