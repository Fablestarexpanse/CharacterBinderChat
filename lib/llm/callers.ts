// ─── Shared LLM caller functions ─────────────────────────────────────────────
// Used by both the Drawer-2 extraction route and the Core Memory rewriter.
// Keep all LLM transport logic here; do not duplicate across route files.

// ─── Caller-supplied provider input ──────────────────────────────────────────
// Routes take the provider and its base URL from the request body, because
// generation is client-side and the user configures both in Settings. Both
// therefore need the same gate in every route that forwards them to fetch.

export type ProviderType = "ollama" | "lmstudio" | "openrouter";

export const PROVIDER_TYPES: ProviderType[] = ["ollama", "lmstudio", "openrouter"];

export function isProviderType(v: unknown): v is ProviderType {
  return typeof v === "string" && (PROVIDER_TYPES as string[]).includes(v);
}

/**
 * Validate a caller-supplied provider base URL and return it without its
 * trailing slash, or null when it is not a usable http(s) URL.
 *
 * Concatenating an unchecked string into `fetch` let a body choose the scheme
 * as well as the host — file:, data: and friends — so the parse and the
 * protocol check are not optional.
 */
export function parseProviderBase(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString().replace(/\/$/, "");
}

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
  const data = (await res.json()) as { response?: string; error?: string };
  // Ollama can 200 with an error body (e.g. model failed to load) — surface
  // it instead of returning undefined into JSON parsing.
  if (typeof data.response !== "string") {
    throw new Error(`Ollama returned no response${data.error ? `: ${data.error}` : ""}`);
  }
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
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?:   { message?: string } | string;
  };
  const content = data.choices?.[0]?.message?.content;
  // A 200 with no choices (LM Studio error bodies do this) must fail loudly:
  // returning "{}" here made provider failures indistinguishable from a
  // genuinely quiet turn.
  if (typeof content !== "string") {
    const detail = typeof data.error === "string" ? data.error : data.error?.message;
    throw new Error(`LLM returned no completion${detail ? `: ${detail}` : ""}`);
  }
  return content;
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
