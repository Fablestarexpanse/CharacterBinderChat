/**
 * LM Studio provider adapter.
 * LM Studio exposes an OpenAI-compatible endpoint on port 1234 by default.
 * Wire real streaming: the SSE format matches OpenAI exactly.
 */

import type { ChatProvider, ChatSettings, MessageRole, ModelInfo } from "@/lib/types";

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
    settings?: Partial<ChatSettings>,
    signal?: AbortSignal
  ): AsyncIterable<string> {
    const body = {
      model: modelId,
      messages,
      stream: true,
      temperature: settings?.temperature ?? 0.8,
      max_tokens: settings?.maxTokens ?? 2048,
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
export async function* parseOpenAIStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // skip malformed SSE chunks
      }
    }
  }
}
