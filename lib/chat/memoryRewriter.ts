// ─── Memory Rewriter (Drawer 1 Sleep Consolidation) ──────────────────────────
// Calls a local LLM to reflect on recent events and rewrite the Core Memory
// Block — persona, mood, narrative summary, internal thoughts.
// Intended to be called server-side after a batch of messages.

import { getStore } from "@/lib/db";
import { callOllama, callOpenAICompat, parseLLMJson } from "@/lib/llm/callers";
import type { CoreMemory } from "@/lib/db/models";

// ─── Rewrite prompt ───────────────────────────────────────────────────────────

function buildRewritePrompt(
  characterName: string,
  currentMemory: CoreMemory,
  recentMessages: Array<{ role: string; content: string }>,
  userLabel = "User",
  characterAnchor = ""
): string {
  const conversation = recentMessages
    .slice(-16)
    .map((m) => `${m.role === "user" ? userLabel : characterName}: ${m.content}`)
    .join("\n\n");

  // The anchor is the authored character definition. Without it the persona is
  // rewritten every turn with nothing tying it back to who the character IS,
  // and it slowly drifts (measured: shrank 433c → 272c over one long run).
  const anchorBlock = characterAnchor
    ? `\nWHO THIS CHARACTER FUNDAMENTALLY IS (fixed — persona may grow from this, never contradict it):\n${characterAnchor}\n`
    : "";

  return `You are helping maintain a character's "Core Memory Block" — their conscious internal state for a roleplay story.

Character: ${characterName}
${anchorBlock}

CURRENT STATE:
Persona: ${currentMemory.persona}
Mood: valence=${currentMemory.mood.valence}, arousal=${currentMemory.mood.arousal}, dominance=${currentMemory.mood.dominance}
Narrative: ${currentMemory.narrative_summary}

RECENT CONVERSATION:
${conversation}

Based on the conversation above, update the Core Memory Block. Return ONLY valid JSON with these exact keys:

{
  "persona": "Updated one-paragraph first-person self-description reflecting any growth/change",
  "mood": {
    "valence": <number -1 to 1>,
    "arousal": <number 0 to 1>,
    "dominance": <number 0 to 1>
  },
  "internal_thoughts": ["thought 1", "thought 2", "thought 3"],
  "narrative_summary": "2-3 sentence summary of what has happened in the story so far",
  "persona_changed": <true|false>
}

Rules:
- Only change persona if something significant happened that would alter the character's sense of self
- Mood should reflect the emotional arc of the recent conversation. Values near
  the extremes (±1.0 valence, 1.0 arousal) represent once-in-a-story peaks —
  ordinary good or bad scenes belong in the middle of the range.
- Internal thoughts are unspoken — feelings, suspicions, desires the character wouldn't say aloud
- Narrative summary accumulates; include prior events AND what just happened
- Return ONLY the JSON. No explanation.`;
}

// ─── Result shape ─────────────────────────────────────────────────────────────

interface RewriteResult {
  persona:          string;
  mood:             { valence: number; arousal: number; dominance: number };
  internal_thoughts:string[];
  narrative_summary:string;
  persona_changed:  boolean;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RewriteOptions {
  chatId:          string;
  characterId:     string;
  characterName:   string;
  personaName?:    string;
  /** Authored character definition — the drift anchor for persona rewrites */
  characterAnchor?: string;
  recentMessages:  Array<{ role: string; content: string }>;
  providerType:    "ollama" | "lmstudio" | "openrouter";
  providerBaseUrl: string;
  modelId:         string;
  apiKey?:         string;
}

export async function rewriteCoreMemory(opts: RewriteOptions): Promise<{
  ok:      boolean;
  changed: boolean;
  error?:  string;
}> {
  const store   = getStore();
  const current = store.getCoreMemory(opts.chatId, opts.characterId);
  if (!current) {
    return { ok: false, changed: false, error: "No core memory found for character" };
  }

  const prompt = buildRewritePrompt(
    opts.characterName,
    current.data,
    opts.recentMessages,
    opts.personaName ?? "User",
    opts.characterAnchor ?? ""
  );

  let rawText: string;
  try {
    if (opts.providerType === "ollama") {
      rawText = await callOllama(opts.providerBaseUrl, opts.modelId, prompt);
    } else {
      rawText = await callOpenAICompat(opts.providerBaseUrl, opts.modelId, prompt, opts.apiKey);
    }
  } catch (err) {
    return { ok: false, changed: false, error: String(err) };
  }

  const result = parseLLMJson<RewriteResult | null>(rawText, null);
  if (!result) {
    return { ok: false, changed: false, error: "LLM returned unparseable JSON" };
  }

  // Mood homeostasis: blend the LLM's reading with the prior instead of
  // replacing it wholesale. Wholesale replacement pinned valence at ±1.0 under
  // sustained tone and produced 0.99 → 0.00 → 1.00 whiplash at scene changes
  // (measured in the 200-exchange soak). The blend gives mood inertia in both
  // directions while still letting sustained scenes move it.
  const blend = (llm: number | undefined, prior: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, llm === undefined || !Number.isFinite(llm)
      ? prior
      : 0.6 * llm + 0.4 * prior));
  const mood = {
    valence:   blend(result.mood?.valence,   current.data.mood.valence,   -1, 1),
    arousal:   blend(result.mood?.arousal,   current.data.mood.arousal,    0, 1),
    dominance: blend(result.mood?.dominance, current.data.mood.dominance,  0, 1),
  };

  // While a rupture's refractory window is open, mood can't be euphoric: the
  // Tilly soak hit valence 0.99 during "cold aftermath" with trust at 28,
  // which reads as emotional amnesia. Warm scenes may still lift valence to
  // mildly positive; genuine sunshine has to wait until the wound closes.
  if (store.isRecentlyRuptured(opts.chatId, opts.characterId, "player")) {
    mood.valence = Math.min(mood.valence, 0.35);
  }

  store.patchCoreMemory(opts.chatId, opts.characterId, {
    persona:           result.persona ?? current.data.persona,
    mood,
    internal_thoughts: result.internal_thoughts ?? current.data.internal_thoughts,
    narrative_summary: result.narrative_summary ?? current.data.narrative_summary,
  });

  return { ok: true, changed: result.persona_changed ?? false };
}
