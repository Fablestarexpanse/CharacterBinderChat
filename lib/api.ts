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
