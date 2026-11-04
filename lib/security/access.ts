// ─── Local access rules ───────────────────────────────────────────────────────
// Pure decision logic for proxy.ts, kept apart so it can be unit tested without
// a running server. Three threats, in the order they were real for this app:
//
//  1. Another device on the network. `next dev`/`next start` bind every
//     interface by default, and every route here — including the full state
//     export and the ComfyUI/Ollama relays — was open. The npm scripts now bind
//     127.0.0.1; this is the second line, for someone who rebinds on purpose.
//  2. DNS rebinding: a web page that makes its own hostname resolve to
//     127.0.0.1 to read the API as "same origin". The Host header gives it away.
//  3. Cross-site requests from a page open in the same browser. The routes parse
//     JSON from the body whatever the Content-Type, so a plain-text POST from any
//     website could write state. Browsers always send Origin on those.
//
// Opting in to other devices means setting FABLE_PASSWORD, which turns on HTTP
// Basic auth for everything. Without it, anything not addressed to localhost is
// refused. Limit: Host is client-supplied, so when the server is bound to all
// interfaces with no password, a LAN peer who sends `Host: localhost` is not
// stopped — the loopback bind is what prevents that, not this file.

export interface AccessInput {
  method:         string;
  host:           string | null;
  origin:         string | null;
  secFetchSite:   string | null;
  authorization:  string | null;
  /** FABLE_PASSWORD, if set. */
  password:       string | undefined;
}

export type AccessDecision =
  | { allow: true }
  | { allow: false; status: 401 | 403; message: string; challenge?: boolean };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Hostname of a Host header value, port stripped, IPv6 brackets kept. */
export function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

export function isLoopbackHost(host: string | null): boolean {
  return !!host && LOOPBACK.has(hostnameOf(host));
}

/** Constant-time string comparison, so response timing leaks nothing about the password. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Password from an `Authorization: Basic …` header; any username is accepted. */
export function basicPassword(header: string | null): string | null {
  const m = /^Basic\s+(.+)$/i.exec(header ?? "");
  if (!m) return null;
  try {
    const decoded = atob(m[1]);
    const at = decoded.indexOf(":");
    return at === -1 ? null : decoded.slice(at + 1);
  } catch {
    return null;
  }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function checkAccess(i: AccessInput): AccessDecision {
  if (i.password) {
    const given = basicPassword(i.authorization);
    if (given === null || !safeEqual(given, i.password)) {
      return { allow: false, status: 401, message: "Authentication required", challenge: true };
    }
  } else if (!isLoopbackHost(i.host)) {
    return {
      allow: false, status: 403,
      message: "FableChat only answers on localhost. To use it from another device, set FABLE_PASSWORD and start the server bound to that device's network.",
    };
  }

  if (MUTATING.has(i.method.toUpperCase())) {
    if (i.secFetchSite === "cross-site") {
      return { allow: false, status: 403, message: "Cross-site request refused" };
    }
    if (i.origin !== null) {
      // "null" is what sandboxed/redirected contexts send; it is never our own page.
      let originHost: string | null = null;
      try { originHost = new URL(i.origin).host; } catch { /* malformed */ }
      if (originHost === null || !i.host || originHost.toLowerCase() !== i.host.trim().toLowerCase()) {
        return { allow: false, status: 403, message: "Cross-origin request refused" };
      }
    }
  }
  return { allow: true };
}
