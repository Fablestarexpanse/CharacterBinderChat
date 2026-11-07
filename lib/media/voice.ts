// ─── A character's (or persona's) voice ───────────────────────────────────────
// Client-safe. Who speaks how: a short sample of their voice (an audio asset on
// their profile, uploaded in the editor) or one of VibeVoice's demo voices. The
// sample is the source of truth and lives in FableChat's database like the
// portrait, so backups keep it and reinstalling the voice server loses nothing;
// the server is handed a copy the first time it is needed. Not a card field:
// voices are not exported with cards.

export interface CharacterVoice {
  /** An uploaded sample (asset URL, audio) */
  sample?: string;
  /** Its original file name, for showing */
  sampleName?: string;
  /** One of the demo voices, used when there is no sample */
  demo?: string;
  /** You confirmed the sample is your voice, one you may use, or a made-up one */
  consent?: boolean;
}

/** VibeVoice's demo voices (shipped by the fork, downloaded at setup) */
export const DEMO_VOICES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "demo:en-Alice_woman", label: "Alice (woman)" },
  { id: "demo:en-Maya_woman", label: "Maya (woman)" },
  { id: "demo:en-Mary_woman_bgm", label: "Mary (woman)" },
  { id: "demo:en-Carter_man", label: "Carter (man)" },
  { id: "demo:en-Frank_man", label: "Frank (man)" },
  { id: "demo:in-Samuel_man", label: "Samuel (man)" },
];

export const hasVoice = (v: CharacterVoice | undefined) => !!v && (!!v.sample || !!v.demo);

/** Only well-formed values are kept (from the editor, a backup, an agent). */
export function cleanVoice(raw: unknown): CharacterVoice | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: CharacterVoice = {};
  if (typeof r.sample === "string" && /^\/api\/assets\/[0-9a-f]{64}$/.test(r.sample) && r.consent === true) {
    out.sample = r.sample;
    out.consent = true;
    if (typeof r.sampleName === "string") out.sampleName = r.sampleName.slice(0, 80);
  }
  if (typeof r.demo === "string" && DEMO_VOICES.some((d) => d.id === r.demo)) out.demo = r.demo;
  return Object.keys(out).length ? out : undefined;
}

/**
 * The narrator: a voice that reads a story reply's narration while the
 * character speaks their quoted lines, as one clip with two voices. Settings →
 * Media → Narrator; stored on the server (`voice:narrator`, so backups keep it).
 */
export interface NarratorSettings {
  enabled: boolean;
  voice?: CharacterVoice;
}

export const DEFAULT_NARRATOR: NarratorSettings = { enabled: false };

export function cleanNarrator(raw: unknown): NarratorSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const voice = cleanVoice(r.voice);
  return { enabled: r.enabled === true && hasVoice(voice), ...(voice ? { voice } : {}) };
}
