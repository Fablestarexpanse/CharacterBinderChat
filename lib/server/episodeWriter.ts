// ─── Episode and reflection writing ───────────────────────────────────────────
// The pipeline behind POST /api/drawer/episode: build the prompt, call the
// model, decode the reply, write the cards and their embeddings. It lives here
// rather than in the route for the same reason extractMemory does — the route
// then only validates its envelope and maps a result onto a status, and the
// pipeline can be exercised without a server.

import { getStore } from "@/lib/db";
import { callLLM, parseLLMJson } from "@/lib/llm/callers";
import { embedText, vecToBuffer } from "@/lib/llm/embeddings";
import { episodePrompt, reflectPrompt } from "@/lib/server/episodePrompts";
import { retrieveFactsForPrompt } from "@/lib/server/retrieval";
import type { MemoryTaskRequest } from "@/lib/types";

export interface EpisodeResult {
  ok:    boolean;
  mode:  "episode" | "reflect";
  cards: number[];
  /** Set only when ok is false: the model replied but the reply was unusable. */
  error?: string;
}

/**
 * Write an episode card, or a reflection insight when `mode` is "reflect".
 *
 * A transport failure propagates: the caller distinguishes "the model was
 * unreachable" (502 via upstreamError) from "the model answered with something
 * we could not parse" (ok:false), and only the caller knows how to say so.
 */
export async function writeEpisode(task: MemoryTaskRequest): Promise<EpisodeResult> {
  const {
    chatId, characterId, characterName, personaName, messages,
    providerType, providerBaseUrl, modelId, apiKey,
  } = task;
  const mode = task.mode ?? "episode";
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
    const conversation = (messages ?? [])
      .slice(-16)
      .map((m) => `${m.role === "user" ? userLabel : characterName}: ${m.content}`)
      .join("\n\n");
    const entityIds = store.listEntities(chatId).map((e) => e.id);
    prompt = episodePrompt(conversation, characterName ?? characterId, userLabel, entityIds);
  }

  const rawText = await callLLM({ providerType, providerBaseUrl, modelId, apiKey }, prompt);

  if (mode === "reflect") {
    const parsed = parseLLMJson<{ insights?: Array<{ title?: string; content?: string; importance?: number }> } | null>(rawText, null);
    if (!parsed) return { ok: false, mode, cards: [], error: "unparseable reflection output" };

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
      if (vec) store.setCardEmbedding(chatId, id, vecToBuffer(vec));
      written.push(id);
    }
    return { ok: true, mode, cards: written };
  }

  const parsed = parseLLMJson<{ title?: string; content?: string; importance?: number; entities?: string[] } | null>(rawText, null);
  if (!parsed || !parsed.content?.trim()) {
    return { ok: false, mode, cards: [], error: "unparseable episode output" };
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
  if (vec) store.setCardEmbedding(chatId, cardId, vecToBuffer(vec));
  return { ok: true, mode, cards: [cardId] };
}
