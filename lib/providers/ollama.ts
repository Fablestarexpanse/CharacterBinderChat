/**
 * Ollama provider adapter.
 * Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 */

import type { ChatProvider, GenerationParams, MessageRole, ModelInfo } from "@/lib/types";
import { buildRequestParams } from "./params";
import { streamStartError } from "./streamError";

export class OllamaProvider implements ChatProvider {
  id = "ollama" as const;
  name = "Ollama";
  private baseUrl: string;

  constructor(baseUrl = "http://127.0.0.1:11434") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models ?? []).map((m: { name: string }) => ({
        id: m.name,
        name: m.name,
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
    const { options } = buildRequestParams("ollama", params ?? {});
    const body = {
      model: modelId,
      messages,
      stream: true,
      options,
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      throw await streamStartError("Ollama", res);
    }

    // Ollama streams NDJSON. Network chunks can split a JSON line (or even a
    // multi-byte UTF-8 character) anywhere, so buffer the trailing partial
    // line and use a streaming decoder — same approach as parseOpenAIStream.
    const reader = res.body.getReader();
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
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          if (json.message?.content) yield json.message.content;
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Flush the final line (streams don't always end with a newline)
    const tail = (buffer + decoder.decode()).trim();
    if (tail) {
      try {
        const json = JSON.parse(tail);
        if (json.message?.content) yield json.message.content;
      } catch {
        // ignore trailing partial
      }
    }
  }
}
