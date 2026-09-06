/**
 * OpenRouter provider adapter.
 * OpenRouter exposes an OpenAI-compatible API at https://openrouter.ai/api/v1
 * Docs: https://openrouter.ai/docs
 */

import { parseOpenAIStream } from "./openaiStream";
import type { ChatProvider, GenerationParams, MessageRole, ModelInfo } from "@/lib/types";
import { buildRequestParams } from "./params";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export class OpenRouterProvider implements ChatProvider {
  id = "openrouter" as const;
  name = "OpenRouter";
  private apiKey: string;

  constructor(apiKey = "") {
    this.apiKey = apiKey;
  }

  async checkConnection(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${OPENROUTER_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${OPENROUTER_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      // Return the full catalogue (OpenRouter lists hundreds) sorted by id, so
      // the selector's type-ahead can find any vendor. Previously capped at 50,
      // which silently hid most models.
      return (data.data ?? [])
        .map((m: { id: string; name: string; context_length?: number; supported_parameters?: string[] }) => ({
          id: m.id,
          name: m.name ?? m.id,
          contextLength: m.context_length,
          // Which sampler args this model's upstream actually honours — the
          // advanced controls hide themselves when it doesn't list them.
          supportedParameters: m.supported_parameters,
          providerId: this.id,
        }))
        .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }

  async *streamChat(
    messages: Array<{ role: MessageRole; content: string }>,
    modelId: string,
    params?: Partial<GenerationParams>,
    signal?: AbortSignal
  ): AsyncIterable<string> {
    if (!this.apiKey) throw new Error("OpenRouter API key not set");

    const { root } = buildRequestParams("openrouter", params ?? {});
    const body = {
      model: modelId,
      messages,
      stream: true,
      ...root,
    };

    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "FableChat",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`OpenRouter error: ${res.status}`);
    }

    yield* parseOpenAIStream(res.body);
  }
}
