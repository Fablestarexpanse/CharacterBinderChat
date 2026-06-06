// ─── Shared LLM caller functions ─────────────────────────────────────────────
// Used by both the Drawer-2 extraction route and the Core Memory rewriter.
// Keep all LLM transport logic here; do not duplicate across route files.

export async function callOllama(
  baseUrl:    string,
  modelId:    string,
  prompt:     string,
  timeoutMs = 45_000
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model: modelId, prompt, stream: false, format: "json" }),
    signal:  AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { response: string };
  return data.response;
}

export async function callOpenAICompat(
  baseUrl:    string,
  modelId:    string,
  prompt:     string,
  apiKey?:    string,
  timeoutMs = 45_000
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method:  "POST",
    headers,
    body:    JSON.stringify({
      model:    modelId,
      stream:   false,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? "{}";
}

/** Parse an LLM response that should be JSON, stripping markdown fences. */
export function parseLLMJson<T>(text: string, fallback: T): T {
  const clean = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { /* fall through */ }
    }
    return fallback;
  }
}
