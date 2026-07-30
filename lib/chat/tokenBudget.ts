// ─── Token Budget Calculator ──────────────────────────────────────────────────
// Determines how many tokens remain for Drawer 2 retrieval after the fixed
// components (system prompt + core memory + chat history) are allocated.

import { estimateTokens } from "./promptBuilder";
import type { Message } from "@/lib/types";

export interface TokenBudget {
  /** Total context window size of the active model */
  contextMax:      number;
  /** Tokens used by system prompt + core memory block */
  systemTokens:    number;
  /** Tokens used by the current chat history window */
  historyTokens:   number;
  /** Tokens reserved for the model's response */
  reservedOutput:  number;
  /** Tokens remaining for Drawer 2 fact injection */
  availableForRetrieval: number;
}

/** Approximate model context sizes by ID patterns */
const MODEL_CONTEXT_MAP: Array<{ pattern: RegExp; tokens: number }> = [
  { pattern: /128k|128000/i,           tokens: 128_000 },
  { pattern: /32k|32000/i,             tokens:  32_000 },
  { pattern: /claude-3/i,              tokens: 200_000 },
  { pattern: /gpt-4o/i,               tokens: 128_000 },
  { pattern: /gpt-4/i,                tokens:   8_192 },
  { pattern: /llama3\.[12]/i,         tokens:  32_000 },
  { pattern: /mistral/i,              tokens:  32_000 },
  { pattern: /gemini-flash/i,         tokens:  32_000 },
];

export function estimateContextSize(modelId: string): number {
  for (const entry of MODEL_CONTEXT_MAP) {
    if (entry.pattern.test(modelId)) return entry.tokens;
  }
  return 8_192; // conservative default
}

export interface FittedHistory<M> {
  /** Newest-first-preserved suffix of the input that fits the window */
  messages:   M[];
  /** Context window size for the model */
  contextMax: number;
  /** system + kept-history tokens (what the context meter should show) */
  usedTokens: number;
  /** How many old messages were dropped to fit */
  dropped:    number;
}

/**
 * Trim the oldest messages until system prompt + history + reserved output
 * fit the model's context window. The newest message is always kept, even
 * if it alone exceeds the budget.
 */
export function fitHistoryToBudget<M extends { content: string }>(
  systemPrompt:   string,
  messages:       M[],
  modelId:        string,
  reservedOutput  = 1_500
): FittedHistory<M> {
  const contextMax       = estimateContextSize(modelId);
  const systemTokens     = estimateTokens(systemPrompt);
  const budgetForHistory = contextMax - systemTokens - reservedOutput;

  const kept: M[] = [];
  let historyTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i].content) + 4; // +4 ≈ role/format overhead
    if (kept.length > 0 && historyTokens + t > budgetForHistory) break;
    kept.unshift(messages[i]);
    historyTokens += t;
  }

  return {
    messages:   kept,
    contextMax,
    usedTokens: systemTokens + historyTokens,
    dropped:    messages.length - kept.length,
  };
}

export function calculateBudget(
  systemPrompt:   string,
  messages:       Message[],
  modelId:        string,
  reservedOutput  = 1_500
): TokenBudget {
  const contextMax     = estimateContextSize(modelId);
  const systemTokens   = estimateTokens(systemPrompt);
  const historyTokens  = messages.reduce((acc, m) => acc + estimateTokens(m.content) + 4, 0);
  const used           = systemTokens + historyTokens + reservedOutput;
  const availableForRetrieval = Math.max(0, contextMax - used);

  return {
    contextMax,
    systemTokens,
    historyTokens,
    reservedOutput,
    availableForRetrieval,
  };
}
