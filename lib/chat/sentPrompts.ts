// ─── Last prompt sent, per chat ───────────────────────────────────────────────
// Peek Prompt's "what was actually sent" view. Held in memory only: a full
// prompt is thousands of tokens, and persisting one per message would bloat the
// durable copy for something only useful while debugging the latest reply.
// Gone on reload by design.

import type { MessageRole } from "@/lib/types";

export interface SentPrompt {
  messages:    Array<{ role: MessageRole; content: string }>;
  providerId:  string;
  modelId:     string;
  speakerName: string | null;
  usedTokens:  number;
  contextMax:  number;
  /** Oldest messages dropped to fit the window. */
  dropped:     number;
  sentAt:      number;
}

/** Chats remembered at once; the oldest is evicted past this. */
const MAX_CHATS = 20;

const sent = new Map<string, SentPrompt>();

interface RecordInput {
  history: SentPrompt["messages"];
  providerId: string;
  modelId: string;
  speakerName: string | null;
  fit: { usedTokens: number; contextMax: number; dropped: number };
}

export function recordSentPrompt(chatId: string, a: RecordInput): void {
  sent.delete(chatId); // re-insert so Map order is recency order
  sent.set(chatId, {
    messages: a.history.map((m) => ({ ...m })),
    providerId: a.providerId, modelId: a.modelId, speakerName: a.speakerName,
    usedTokens: a.fit.usedTokens, contextMax: a.fit.contextMax, dropped: a.fit.dropped,
    sentAt: Date.now(),
  });
  while (sent.size > MAX_CHATS) sent.delete(sent.keys().next().value as string);
}

export function getSentPrompt(chatId: string): SentPrompt | null {
  return sent.get(chatId) ?? null;
}
