import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { callLLM, parseLLMJson } from "@/lib/llm/callers";
import { embedText, vecToBuffer } from "@/lib/llm/embeddings";
import { parseMemoryTaskRequest, routeError, upstreamError } from "@/lib/api/server";
import { episodePrompt, reflectPrompt } from "@/lib/server/episodePrompts";
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

    let rawText: string;
    try {
      rawText = await callLLM({ providerType, providerBaseUrl, modelId, apiKey }, prompt);
    } catch (err) {
      return upstreamError("[drawer/episode]", err);
    }

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
