// ─── OpenAI-style SSE ─────────────────────────────────────────────────────────
// The wire format LM Studio and OpenRouter both speak. It lived inside
// lmstudio.ts, so openrouter.ts imported a sibling adapter to reach it — which
// says LM Studio owns the format when neither does.

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
