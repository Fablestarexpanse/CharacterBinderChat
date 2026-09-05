import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { embedText } from "@/lib/llm/embeddings";
import type { CoreMemory } from "@/lib/db/models";
import { routeError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * What the GET returns. Declared here rather than at each call site: it was
 * hand-typed twice on the client with different field sets, so a change to the
 * route only ever broke one of them.
 */
export interface CoreMemoryGetResponse {
  coreMemory: CoreMemory;
  version:    number;
  updatedAt:  number;
  knownFacts: string[];
  episodes:   string[];
  insights:   string[];
  bits:       string[];
}

// ─── GET /api/chat/core-memory ───────────────────────────────────────────────
// ?chatId=X&characterId=Y&name=Z&context=<recent text, optional>
// Returns the Core Memory Block for a character, creating defaults if needed.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chatId        = searchParams.get("chatId");
  const characterId   = searchParams.get("characterId");
  const characterName = searchParams.get("name") ?? characterId ?? "Unknown";
  // Recent conversation text, used to rank non-durable facts by relevance.
  // Optional: without it, retrieval falls back to confidence/recency order.
  const context       = searchParams.get("context") ?? "";

  if (!chatId || !characterId) {
    return Response.json({ ok: false, error: "chatId and characterId are required" }, { status: 400 });
  }

  try {
    const store = getStore();
    const cm    = store.ensureCoreMemory(chatId, characterId, characterName);
    // Semantic query vector for retrieval — null when Ollama embeddings are
    // unavailable, in which case ranking falls back to keyword overlap
    const queryVec   = context ? await embedText(context) : null;
    const knownFacts = store.retrieveFactsForPrompt(chatId, characterId, 20, context, queryVec);
    // Episodic layer: scenes remembered as events, and reflective insights.
    // Kept separate from facts because they read differently in the prompt.
    const cards    = store.retrieveEpisodesForPrompt(chatId, 5, context, queryVec);
    const episodes = cards.filter((c) => c.tags.includes("episode"))
      .slice(0, 3).map((c) => `${c.title} — ${c.content}`);
    const insights = cards.filter((c) => c.tags.includes("reflection"))
      .slice(0, 2).map((c) => c.content);
    // Shared language: nicknames / running jokes / rituals, strongest first
    const bits = store.listBondCards(chatId, 6).map((c) => c.content);
    const body: CoreMemoryGetResponse = {
      coreMemory: cm.data, version: cm.version, updatedAt: cm.updatedAt,
      knownFacts, episodes, insights, bits,
    };
    return Response.json(body);
  } catch (err) {
    return routeError("[core-memory GET]", err);
  }
}

// ─── PATCH validation ─────────────────────────────────────────────────────────
// The patch is spread into the stored document, so unvalidated input can
// permanently poison it (e.g. { mood: null } would crash every later
// formatCoreMemoryBlock). Whitelist keys and shape-check every value.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const strArray = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every(isStr) ? v : null;

/** Returns a sanitized patch, or a string describing the first invalid field. */
function sanitizePatch(raw: Record<string, unknown>): Partial<CoreMemory> | string {
  const patch: Partial<CoreMemory> = {};

  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case "persona":
      case "narrative_summary":
        if (!isStr(value)) return `${key} must be a string`;
        patch[key] = value;
        break;

      case "relationship_note":
        if (value !== null && !isStr(value)) return "relationship_note must be a string or null";
        patch.relationship_note = value as string | null;
        break;

      case "story_time":
        if (value !== null && !isStr(value)) return "story_time must be a string or null";
        patch.story_time = value as string | null;
        break;

      case "mood": {
        const m = value as Record<string, unknown> | null;
        if (!m || typeof m !== "object" || !isNum(m.valence) || !isNum(m.arousal) || !isNum(m.dominance)) {
          return "mood must be { valence, arousal, dominance } with finite numbers";
        }
        patch.mood = {
          valence:   clamp(m.valence as number, -1, 1),
          arousal:   clamp(m.arousal as number, 0, 1),
          dominance: clamp(m.dominance as number, 0, 1),
        };
        break;
      }

      case "relationship_with_user": {
        const r = value as Record<string, unknown> | null;
        const axes = ["affection", "trust", "desire", "connection", "mood"] as const;
        if (!r || typeof r !== "object" || axes.some((a) => !isNum(r[a]))) {
          return "relationship_with_user must contain finite numbers for all five axes";
        }
        patch.relationship_with_user = {
          affection:  clamp(r.affection  as number, 0, 100),
          trust:      clamp(r.trust      as number, 0, 100),
          desire:     clamp(r.desire     as number, 0, 100),
          connection: clamp(r.connection as number, 0, 100),
          mood:       clamp(r.mood       as number, 0, 100),
        };
        break;
      }

      case "active_commitments":
      case "internal_thoughts": {
        const arr = strArray(value);
        if (!arr) return `${key} must be an array of strings`;
        patch[key] = arr;
        break;
      }

      case "recent_emotional_events": {
        if (!Array.isArray(value)) return "recent_emotional_events must be an array";
        const events: CoreMemory["recent_emotional_events"] = [];
        for (const e of value as Array<Record<string, unknown>>) {
          if (!e || !isStr(e.description)) return "each emotional event needs a description string";
          events.push({
            timestamp:   isStr(e.timestamp) ? e.timestamp : new Date().toISOString(),
            description: e.description,
            impact:      e.impact === "positive" || e.impact === "negative" ? e.impact : "neutral",
            intensity:   isNum(e.intensity) ? clamp(e.intensity, 0, 1) : 0.5,
          });
        }
        patch.recent_emotional_events = events;
        break;
      }

      default:
        return `unknown field "${key}"`;
    }
  }

  return patch;
}

// ─── PATCH /api/chat/core-memory ──────────────────────────────────────────────
// Partial update. Body: { chatId, characterId, ...fields to merge }

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { chatId?: string; characterId?: string } & Record<string, unknown>;
    const { chatId, characterId, ...rawPatch } = body;

    if (!chatId || typeof chatId !== "string" || !characterId || typeof characterId !== "string") {
      return Response.json({ ok: false, error: "chatId and characterId are required" }, { status: 400 });
    }

    // Ensure the record exists before patching
    const store    = getStore();
    const existing = store.getCoreMemory(chatId, characterId);
    if (!existing) {
      return Response.json({ ok: false, error: "Core memory not found — call GET first to initialise" }, { status: 404 });
    }

    const patch = sanitizePatch(rawPatch);
    if (typeof patch === "string") {
      return Response.json({ ok: false, error: patch }, { status: 400 });
    }

    const updated = store.patchCoreMemory(chatId, characterId, patch);
    return Response.json({ ok: true, coreMemory: updated?.data, version: updated?.version });
  } catch (err) {
    return routeError("[core-memory PATCH]", err);
  }
}
