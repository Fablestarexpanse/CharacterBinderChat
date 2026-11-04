// ─── Route-side API helpers ───────────────────────────────────────────────────
// Server half of lib/api/: what route handlers share. The browser half is
// client.ts next to it — the directory says which runtime each belongs to,
// the way lib/server and lib/chat do.

// ─── Access check ─────────────────────────────────────────────────────────────

import { checkAccess } from "@/lib/security/access";

/**
 * Refuse a request the access rules do not allow, from inside the route itself.
 *
 * proxy.ts already applies the same rules to every request. This is the second
 * lock, on the routes that expose or change the most (state, secrets, cards,
 * backup): if a bug in the framework ever lets a request skip the proxy — one
 * advisory against this exact mechanism has been published — those routes still
 * refuse it. Returns the response to send, or null to carry on.
 */
export function guard(req: Request): Response | null {
  const d = checkAccess({
    method:        req.method,
    host:          req.headers.get("host"),
    origin:        req.headers.get("origin"),
    secFetchSite:  req.headers.get("sec-fetch-site"),
    authorization: req.headers.get("authorization"),
    password:      process.env.FABLE_PASSWORD || undefined,
  });
  if (d.allow) return null;
  return Response.json(
    { ok: false, error: d.message },
    { status: d.status, headers: d.challenge ? { "WWW-Authenticate": 'Basic realm="FableChat", charset="UTF-8"' } : undefined },
  );
}

// ─── Route error handling ─────────────────────────────────────────────────────

/**
 * Log an unexpected route failure and turn it into the 500 every route returns.
 *
 * Every handler ends in the same `catch`, and half of them used to forget the
 * `console.error`, so a route could fail in the server process and leave no
 * trace anywhere but the client's error toast. The tag identifies the route in
 * the server log — "[drawer/facts POST]" and so on.
 */
export function routeError(tag: string, err: unknown): Response {
  console.error(tag, err);
  return Response.json({ ok: false, error: String(err) }, { status: 500 });
}

// ─── Memory-task request validation ──────────────────────────────────────────

import type { MemoryTaskRequest } from "@/lib/types";
import { PROVIDER_TYPES, isProviderType, parseProviderBase } from "@/lib/llm/callers";

/** A validated body, or the 400 to return instead. */
export type Parsed<T> =
  | { ok: true;  value: T }
  | { ok: false; response: Response };

/** The 400 half of the envelope, so route files stop writing it out by hand. */
export function badRequest(error: string): Response {
  return Response.json({ ok: false, error }, { status: 400 });
}

/**
 * Validate the envelope the three memory-task routes share.
 *
 * They were each re-declaring and re-checking it, which is how one route ended
 * up whitelisting `providerType` while its two siblings accepted anything. The
 * returned `providerBaseUrl` is the parsed, trailing-slash-free form, so
 * callers never touch the raw string.
 *
 * `requireMessages` is false for /api/drawer/episode, which can write a card
 * from stored state alone.
 */
export function parseMemoryTaskRequest(
  raw: unknown,
  { requireMessages = true }: { requireMessages?: boolean } = {}
): Parsed<MemoryTaskRequest> {
  const body = (raw ?? {}) as MemoryTaskRequest;
  const { chatId, characterId, messages, providerType, providerBaseUrl, modelId } = body;

  if (!chatId || !characterId || !providerBaseUrl || !modelId || (requireMessages && !messages?.length)) {
    return { ok: false, response: badRequest(
      requireMessages
        ? "chatId, characterId, messages, providerBaseUrl and modelId are required"
        : "chatId, characterId, providerBaseUrl and modelId are required"
    ) };
  }
  if (!isProviderType(providerType)) {
    return { ok: false, response: badRequest(`providerType must be one of: ${PROVIDER_TYPES.join(", ")}`) };
  }
  const baseUrl = parseProviderBase(providerBaseUrl);
  if (!baseUrl) {
    return { ok: false, response: badRequest("providerBaseUrl must be an http(s) URL") };
  }
  return { ok: true, value: { ...body, providerType, providerBaseUrl: baseUrl } };
}

/**
 * The upstream model is down or refused: 502, not 500.
 *
 * The routes each said so in a comment, but only core-memory/refresh acted on
 * it — extract and episode let the transport error escape into routeError's
 * 500, which reads as "FableChat is broken" rather than "Ollama is not
 * running".
 */
export function upstreamError(tag: string, err: unknown): Response {
  console.error(tag, err);
  return Response.json(
    { ok: false, error: `the model could not be reached: ${String(err)}` },
    { status: 502 }
  );
}
