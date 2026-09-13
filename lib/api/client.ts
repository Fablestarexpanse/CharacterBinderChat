"use client";

// ─── Browser-side API reads ───────────────────────────────────────────────────
// One place that decides what "the request failed" means, because the views
// were each deciding for themselves: some checked `res.ok`, some checked the
// body's `error` field, some checked neither and rendered an empty state
// instead of a failure.

/**
 * GET JSON, throwing on anything but a successful response carrying no
 * `error`. The route envelope guarantees `{ ok: false, error }` on a non-2xx,
 * so the thrown message is the server's own words wherever it has them.
 *
 * Also the shared core: `sendJson` is this with a method and a body.
 */
export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res  = await fetch(url, { cache: "no-store", ...init });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || data === null) {
    throw new Error(data?.error ?? `${url} — HTTP ${res.status}`);
  }
  if (data.error) throw new Error(data.error);
  return data;
}

/**
 * POST/PATCH/DELETE JSON under the same rule, for the mutation half.
 *
 * Five write sites were each checking the envelope their own way — one read
 * `result.ok`, one read `res.ok`, one parsed the body unguarded (so an HTML
 * error page surfaced as "SyntaxError: Unexpected token <"), and one never
 * looked at the response at all, reporting success for a failed write.
 */
export async function sendJson<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  return getJson<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
