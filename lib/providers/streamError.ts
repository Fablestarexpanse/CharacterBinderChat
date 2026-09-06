// ─── Stream start failures ────────────────────────────────────────────────────
// All three streaming providers reject the same way: a non-2xx response, or a
// 2xx with no body to read. The status alone is not enough to act on — the
// cause is in the body, and OpenRouter in particular returns quota, model and
// key failures as JSON there, so a bare 400 told the user nothing.

/** Read the error body and build the Error to throw when a stream won't start. */
export async function streamStartError(provider: string, res: Response): Promise<Error> {
  const body = (await res.text().catch(() => "")).trim().slice(0, 300);
  const detail = body ? `: ${body}` : res.body ? "" : " (empty response body)";
  return new Error(`${provider} error: HTTP ${res.status}${detail}`);
}
