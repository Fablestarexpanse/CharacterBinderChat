"use client";

// ─── Your status, and Pause all ───────────────────────────────────────────────
// Shown in the sidebar only while Contact & media is on: who you are to the
// characters right now (available, away, do not disturb) and one click to
// stop everything at once.

import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { getJson, sendJson } from "@/lib/api/client";
import { cleanContactSettings, type ContactSettings } from "@/lib/media/contact";
import { forgetContactSettings } from "@/lib/chat/photos";

export function ContactPill() {
  const [v, setV] = useState<ContactSettings | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => getJson<unknown>("/api/contact-settings").then((x) => { if (!cancelled) setV(cleanContactSettings(x)); }).catch(() => {});
    void load();
    // Settings changed elsewhere (the Settings screen) show up here within seconds
    const t = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  if (!v?.enabled) return null;

  const change = async (patch: Partial<ContactSettings>) => {
    setV({ ...v, ...patch });
    try { setV(cleanContactSettings(await sendJson<unknown>("PUT", "/api/contact-settings", patch))); forgetContactSettings(); }
    catch { setV(v); }
  };

  return (
    <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-[var(--sidebar-border)] px-2 py-1.5" role="group" aria-label="Your status">
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${v.paused ? "bg-gray-400" : v.userStatus === "dnd" ? "bg-red-500" : v.userStatus === "away" ? "bg-amber-400" : "bg-green-500"}`} />
      <select aria-label="Your status" value={v.userStatus} onChange={(e) => change({ userStatus: e.target.value as ContactSettings["userStatus"] })}
        className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--foreground)] cursor-pointer focus:outline-none">
        <option value="available">Available</option>
        <option value="away">Away</option>
        <option value="dnd">Do not disturb</option>
      </select>
      <button onClick={() => change({ paused: !v.paused })} aria-pressed={v.paused} aria-label={v.paused ? "Resume" : "Pause all"}
        title={v.paused ? "Resume: characters may reach out and send photos again" : "Pause all: no messages, photos or outreach until you resume"}
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] cursor-pointer ${v.paused ? "bg-[var(--purple)] text-white" : "text-[var(--muted-fg)] hover:bg-[var(--muted)]"}`}>
        {v.paused ? <><Play className="h-3 w-3" />Resume</> : <><Pause className="h-3 w-3" />Pause all</>}
      </button>
    </div>
  );
}
