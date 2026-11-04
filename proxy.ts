import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkAccess } from "@/lib/security/access";

// Runs before every request. The rules live in lib/security/access.ts so they
// can be tested without a server; this only adapts them to Next.

export function proxy(request: NextRequest) {
  const decision = checkAccess({
    method:        request.method,
    host:          request.headers.get("host"),
    origin:        request.headers.get("origin"),
    secFetchSite:  request.headers.get("sec-fetch-site"),
    authorization: request.headers.get("authorization"),
    password:      process.env.FABLE_PASSWORD || undefined,
  });
  if (decision.allow) return NextResponse.next();

  return Response.json(
    { ok: false, error: decision.message },
    {
      status: decision.status,
      headers: decision.challenge ? { "WWW-Authenticate": 'Basic realm="FableChat", charset="UTF-8"' } : undefined,
    },
  );
}

export const config = {
  // Everything except Next's static assets, which carry no data
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
