/**
 * LM Studio provider adapter.
 * LM Studio exposes an OpenAI-compatible endpoint on port 1234 by default;
 * the SSE stream format matches OpenAI exactly.
 */

import type { ChatProvider, GenerationParams, MessageRole, ModelInfo } from "@/lib/types";
import { buildRequestParams } from "./params";
import { parseOpenAIStream } from "./openaiStream";

export class LMStudioProvider implements ChatProvider {
  id = "lmstudio" as const;
  name = "LM Studio";
  private baseUrl: string;

  constructor(baseUrl = "http://127.0.0.1:1234") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data ?? []).map((m: { id: string }) => ({
        id: m.id,
        name: m.id,
        providerId: this.id,
      }));
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
    const { root } = buildRequestParams("lmstudio", params ?? {});
    const body = {
      model: modelId,
      messages,
      stream: true,
      ...root,
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`LM Studio error: ${res.status}`);
    }

    yield* parseOpenAIStream(res.body);
  }
}

// Shared SSE parser for OpenAI-compatible streams
