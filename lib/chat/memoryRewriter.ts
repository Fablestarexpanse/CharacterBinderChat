// ─── Memory Rewriter (Drawer 1 Sleep Consolidation) ──────────────────────────
// Calls a local LLM to reflect on recent events and rewrite the Core Memory
// Block — persona, mood, narrative summary, internal thoughts.
// Intended to be called server-side after a batch of messages.

import { getStore } from "@/lib/db";
import type { CoreMemory } from "@/lib/db/models";

// ─── LLM callers (re-use same pattern as extract route) ──────────────────────

async function callOllama(baseUrl: string, modelId: string, prompt: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model: modelId, prompt, stream: false, format: "json" }),
    signal:  AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { response: string };
  return data.response;
}

async function callOpenAICompat(
  baseUrl:  string,
  modelId:  string,
  prompt:   string,
  apiKey?:  string
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method:  "POST",
    headers,
    body:    JSON.stringify({
      model:    modelId,
      stream:   false,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? "{}";
}

// ─── Rewrite prompt ───────────────────────────────────────────────────────────

function buildRewritePrompt(
  characterName: string,
  currentMemory: CoreMemory,
  recentMessages: Array<{ role: string; content: string }>
): string {
  const conversation = recentMessages
    .slice(-16)
    .map((m) => `${m.role === "user" ? "User" : characterName}: ${m.content}`)
    .join("\n\n");

  return `You are helping maintain a character's "Core Memory Block" — their conscious internal state for a roleplay story.

Character: ${characterName}

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
- Mood should reflect the emotional arc of the recent conversation
- Internal thoughts are unspoken — feelings, suspicions, desires the character wouldn't say aloud
- Narrative summary accumulates; include prior events AND what just happened
- Return ONLY the JSON. No explanation.`;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

interface RewriteResult {
  persona:          string;
  mood:             { valence: number; arousal: number; dominance: number };
  internal_thoughts:string[];
  narrative_summary:string;
  persona_changed:  boolean;
}

function parseRewriteResult(text: string): RewriteResult | null {
  const clean = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try {
    return JSON.parse(clean) as RewriteResult;
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as RewriteResult; } catch { /* fall through */ }
    }
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RewriteOptions {
  characterId:     string;
  characterName:   string;
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
  const current = store.getCoreMemory(opts.characterId);
  if (!current) {
    return { ok: false, changed: false, error: "No core memory found for character" };
  }

  const prompt = buildRewritePrompt(
    opts.characterName,
    current.data,
    opts.recentMessages
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

  const result = parseRewriteResult(rawText);
  if (!result) {
    return { ok: false, changed: false, error: "LLM returned unparseable JSON" };
  }

  // Clamp mood values
  const mood = {
    valence:   Math.max(-1, Math.min(1, result.mood?.valence   ?? current.data.mood.valence)),
    arousal:   Math.max(0,  Math.min(1, result.mood?.arousal   ?? current.data.mood.arousal)),
    dominance: Math.max(0,  Math.min(1, result.mood?.dominance ?? current.data.mood.dominance)),
  };

  store.patchCoreMemory(opts.characterId, {
    persona:           result.persona ?? current.data.persona,
    mood,
    internal_thoughts: result.internal_thoughts ?? current.data.internal_thoughts,
    narrative_summary: result.narrative_summary ?? current.data.narrative_summary,
  });

  return { ok: true, changed: result.persona_changed ?? false };
}
