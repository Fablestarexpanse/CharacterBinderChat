// ─── Shared LLM caller functions ─────────────────────────────────────────────
// Used by both the Drawer-2 extraction route and the Core Memory rewriter.
// Keep all LLM transport logic here; do not duplicate across route files.

// ─── Caller-supplied provider input ──────────────────────────────────────────
// Routes take the provider and its base URL from the request body, because
// generation is client-side and the user configures both in Settings. Both
// therefore need the same gate in every route that forwards them to fetch.

export type ProviderType = "ollama" | "lmstudio" | "openrouter";

export const PROVIDER_TYPES: ProviderType[] = ["ollama", "lmstudio", "openrouter"];

// OpenRouter's host is fixed, so it is derived here rather than taken from the
// request body. Forwarding a caller-supplied base URL alongside the caller's
// key meant a hand-crafted body could name any host and receive that key in an
// Authorization header. The two local providers still need their configured
// base. An OpenAI-compatible local backend is sent only a key that came with
// the backend itself (the built-in model's per-start key, made on the server);
// no route fills a server-held key in for one.
const OPENROUTER_API_BASE = "https://openrouter.ai/api";

export function isProviderType(v: unknown): v is ProviderType {
  return typeof v === "string" && (PROVIDER_TYPES as string[]).includes(v);
}

/** What a server-side memory task needs to reach a model. */
export interface LlmBackend {
  providerType:    ProviderType;
  providerBaseUrl: string;
  modelId:         string;
  apiKey?:         string;
}

/**
 * Call whichever backend the request named. The ollama-vs-OpenAI-compatible
 * branch was written out at three call sites, all of them one shape.
 *
 * The branches are not equivalent in one respect: callOllama asks for
 * `format: "json"`, while callOpenAICompat sends no `response_format` — some
 * OpenAI-compatible backends reject it. So an LM Studio or OpenRouter caller
 * can get prose with the JSON embedded in it, which is why every caller goes
 * through parseLLMJson rather than JSON.parse.
 */
export function callLLM(backend: LlmBackend, prompt: string, opts: { maxTokens?: number } = {}): Promise<string> {
  const { providerType, providerBaseUrl, modelId, apiKey } = backend;
  if (providerType === "ollama") return callOllama(providerBaseUrl, modelId, prompt);
  if (providerType === "openrouter") {
    // Without a key OpenRouter answers 401; say what is missing instead
    if (!apiKey) return Promise.reject(new Error("no OpenRouter key: add it in Settings → Chat models"));
    return callOpenAICompat(OPENROUTER_API_BASE, modelId, prompt, apiKey, undefined, opts.maxTokens);
  }
  // Local models can run on the CPU, which is slower than any cloud model
  return callOpenAICompat(providerBaseUrl, modelId, prompt, apiKey, 180_000, opts.maxTokens);
}

/**
 * The longest answer a behind-the-scenes call may produce. Without a limit
 * OpenRouter reserves credit for the model's whole output window (tens of
 * thousands of tokens on large models) and refuses with 402 when the balance
 * cannot cover that, even though the answer is a few hundred tokens.
 */
export const DEFAULT_MAX_TOKENS = 2048;

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
  timeoutMs = 45_000,
  maxTokens = DEFAULT_MAX_TOKENS,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method:  "POST",
    headers,
    body:    JSON.stringify({
      model:    modelId,
      stream:   false,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`the provider refused the API key (HTTP ${res.status}): check it in Settings → Chat models`);
  }
  if (res.status === 402) {
    throw new Error("the provider wants more credit for this request (HTTP 402): top up, or choose a cheaper model for this chat");
  }
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

/**
 * Parse an LLM response that should be a JSON object, stripping markdown
 * fences. Returns `fallback` for anything that is not a plain object.
 *
 * Every caller wants an object with named fields, and a model that emits
 * valid-but-wrong JSON — a bare array, a number, `null` — used to sail
 * through the `as T` cast and fail later as a property access on a number.
 * Rejecting it here makes the declared `T` true for all callers.
 */
export function parseLLMJson<T>(text: string, fallback: T): T {
  const clean = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const asObject = (raw: string): T | undefined => {
    try {
      const v: unknown = JSON.parse(raw);
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as T;
    } catch { /* not JSON, or not an object */ }
    return undefined;
  };
  const direct = asObject(clean);
  if (direct !== undefined) return direct;
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    const embedded = asObject(match[0]);
    if (embedded !== undefined) return embedded;
  }
  return fallback;
}
