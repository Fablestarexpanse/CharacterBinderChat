"use client";

// ─── Settings → Media: the narrator ───────────────────────────────────────────
// A voice that reads a story reply's narration while the character speaks what
// is in quotes, like an audiobook: one clip, two voices taking turns. Used by
// Play and Read replies aloud (lib/chat/speech.ts). Texts and call lines are
// the character alone. Saved as you change it.

import { useEffect, useState } from "react";
import { BookOpenText } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { VoiceFields } from "@/components/characters/VoiceFields";
import { getJson, sendJson } from "@/lib/api/client";
import { forgetNarrator } from "@/lib/chat/speech";
import { cleanNarrator, hasVoice, type CharacterVoice, type NarratorSettings } from "@/lib/media/voice";

export function NarratorCard() {
  const [settings, setSettings] = useState<NarratorSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getJson<unknown>("/api/voice/narrator")
      .then((r) => { if (!cancelled) setSettings(cleanNarrator(r)); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const save = async (patch: { enabled?: boolean; voice?: CharacterVoice | null }) => {
    setError(null);
    try {
      const r = await sendJson<NarratorSettings>("PUT", "/api/voice/narrator", patch);
      setSettings(cleanNarrator(r));
      forgetNarrator();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const voiced = hasVoice(settings?.voice);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 font-semibold text-sm"><BookOpenText className="h-4 w-4" />Narrator</div>
        <div className="text-xs text-[var(--muted-fg)]">
          Read story replies like an audiobook: the narrator reads the narration, each character speaks their own lines in
          quotes, and the two voices take turns in one clip. Texts and phone calls are the character alone.
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {!settings ? (
          <div className="text-xs text-[var(--muted-fg)]">{error ?? "Loading…"}</div>
        ) : (
          <>
            <label className={`flex items-start gap-3 ${voiced ? "cursor-pointer" : "opacity-60"}`}>
              <input type="checkbox" checked={settings.enabled} disabled={!voiced} aria-label="Use the narrator"
                onChange={(e) => void save({ enabled: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer" />
              <span>
                <span className="block text-xs font-medium">Use a narrator when replies are played or read aloud</span>
                <span className="block text-[11px] text-[var(--muted-fg)]">
                  {!voiced ? "Choose the narrator's voice below first." : settings.enabled ? "On: the narrator reads the story, the character their quoted lines." : "Off: the character reads only their quoted lines."}
                </span>
              </span>
            </label>
            <VoiceFields who="the narrator" open purpose="who reads the story between the characters' lines" previewLine="The rain had not stopped for three days, and the city had stopped pretending it would."
              // Choosing the first voice turns the narrator on; removing the last turns it off
              value={settings.voice} onChange={(v) => void save({ voice: v ?? null, ...(!hasVoice(v) ? { enabled: false } : !voiced ? { enabled: true } : {}) })} />
            {error && <div role="alert" className="text-[11px] text-red-600">{error}</div>}
          </>
        )}
      </CardBody>
    </Card>
  );
}
