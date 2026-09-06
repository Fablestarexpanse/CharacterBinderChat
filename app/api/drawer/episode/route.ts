import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { callLLM, parseLLMJson } from "@/lib/llm/callers";
import { embedText, vecToBuffer } from "@/lib/llm/embeddings";
import { parseMemoryTaskRequest, routeError } from "@/lib/api";
import { retrieveFactsForPrompt } from "@/lib/server/retrieval";

export const dynamic = "force-dynamic";

// ─── POST /api/drawer/episode ─────────────────────────────────────────────────
// Writes an EPISODIC memory: a scene card capturing what just happened as an
// event, not a fact. Facts hold "Kira fears deep water"; only an episode can
// hold "the night the crossing flooded and she froze on the bank" — and
// "remember when we…" is the texture of a relationship. Called by the client
// every ~8 exchanges. Stored in memory_cards (tag "episode").
//
// mode: "reflect" instead synthesizes an INSIGHT — a pattern the character has
// noticed across recent events ("Kira consistently avoids water routes") —
// stored with tag "reflection". Called every ~24 exchanges.

function episodePrompt(
  conversation: string,
  characterName: string,
  userLabel: string,
  entityIds: string[]
): string {
  return `You are the narrative memory of ${characterName}, a roleplay character.
Summarise the scene below as ONE memory ${characterName} will keep — a concrete
event, written from ${characterName}'s perspective, past tense.

Return ONLY valid JSON:
{
  "title": "3-6 word scene title",
  "content": "2-4 sentences. What happened, who did what, and how it felt. Concrete details over generalities.",
  "importance": 0.5,
  "entities": ["ids of entities involved, chosen from the list below"]
}

importance: 0.8-1.0 for confessions, betrayals, rescues, turning points.
0.4-0.7 for meaningful conversations and shared work. 0.1-0.3 for routine travel
and small talk.

KNOWN ENTITY IDS: ${entityIds.slice(0, 40).join(", ") || "(none yet)"}

THE SCENE (${userLabel} is the person ${characterName} is talking to):
${conversation}`;
}

function reflectPrompt(
  facts: string[],
  episodes: string[],
  characterName: string,
  userLabel: string
): string {
  return `You are ${characterName}, a roleplay character, thinking privately about
${userLabel} and everything that has happened. Below are things you know and
scenes you remember.

Synthesise 1-2 INSIGHTS — patterns or conclusions that are not stated in any
single item but emerge across them. An insight sounds like understanding a
person, not listing facts about them: "She jokes hardest when she's most
afraid", not "she is afraid of water".

Return ONLY valid JSON:
{
  "insights": [
    { "title": "3-5 words", "content": "one or two sentences, first person, as ${characterName}", "importance": 0.7 }
  ]
}
Return {"insights": []} if nothing genuinely emerges. Do not restate facts.

WHAT YOU KNOW:
${facts.map((f) => `- ${f}`).join("\n") || "(nothing)"}

SCENES YOU REMEMBER:
${episodes.map((e) => `- ${e}`).join("\n") || "(none)"}`;
}

export async function POST(req: NextRequest) {
  try {
    const task = parseMemoryTaskRequest(await req.json(), { requireMessages: false });
    if (!task.ok) return task.response;
    const {
      chatId, characterId, characterName, personaName, messages,
      providerType, providerBaseUrl, modelId, apiKey,
    } = task.value;
    const mode = task.value.mode ?? "episode";

    const store = getStore();
    const userLabel = personaName ?? "the user";
    let prompt: string;

    if (mode === "reflect") {
      const facts = retrieveFactsForPrompt(store, chatId, characterId, { limit: 24 });
      const episodes = store.listMemoryCards(chatId)
        .filter((c) => c.tags.includes("episode"))
        .slice(0, 10)
        .map((c) => `${c.title}: ${c.content}`);
      prompt = reflectPrompt(facts, episodes, characterName ?? characterId, userLabel);
    } else {
      if (!messages?.length) {
        return Response.json({ ok: false, error: "messages required for episode mode" }, { status: 400 });
      }
      const conversation = messages
        .slice(-16)
        .map((m) => `${m.role === "user" ? userLabel : characterName}: ${m.content}`)
        .join("\n\n");
      const entityIds = store.listEntities(chatId).map((e) => e.id);
      prompt = episodePrompt(conversation, characterName ?? characterId, userLabel, entityIds);
    }

    const rawText = await callLLM({ providerType, providerBaseUrl, modelId, apiKey }, prompt);

    if (mode === "reflect") {
      const parsed = parseLLMJson<{ insights?: Array<{ title?: string; content?: string; importance?: number }> } | null>(rawText, null);
      if (!parsed) {
        return Response.json({ ok: false, error: "unparseable reflection output" }, { status: 502 });
      }
      const written: number[] = [];
      for (const ins of parsed.insights ?? []) {
        if (!ins.content?.trim()) continue;
        const id = store.insertMemoryCard(chatId, {
          title:      ins.title?.trim() || "An understanding",
          content:    ins.content.trim(),
          tags:       ["reflection"],
          entityIds:  [characterId, "player"],
          importance: typeof ins.importance === "number" ? ins.importance : 0.7,
        });
        const vec = await embedText(`${ins.title ?? ""} ${ins.content}`);
        if (vec) store.setCardEmbedding(id, vecToBuffer(vec));
        written.push(id);
      }
      return Response.json({ ok: true, mode, cards: written });
    }

    const parsed = parseLLMJson<{ title?: string; content?: string; importance?: number; entities?: string[] } | null>(rawText, null);
    if (!parsed || !parsed.content?.trim()) {
      return Response.json({ ok: false, error: "unparseable episode output" }, { status: 502 });
    }
    const known = new Set(store.listEntities(chatId).map((e) => e.id));
    const cardId = store.insertMemoryCard(chatId, {
      title:      parsed.title?.trim() || "A scene on the road",
      content:    parsed.content.trim(),
      tags:       ["episode"],
      entityIds:  (parsed.entities ?? []).filter((id) => known.has(id)),
      importance: typeof parsed.importance === "number" ? parsed.importance : 0.5,
    });
    const vec = await embedText(`${parsed.title ?? ""} ${parsed.content}`);
    if (vec) store.setCardEmbedding(cardId, vecToBuffer(vec));
    return Response.json({ ok: true, mode, cards: [cardId] });
  } catch (err) {
    return routeError("[drawer/episode]", err);
  }
}
