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
