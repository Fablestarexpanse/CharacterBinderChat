import { NextRequest } from "next/server";
import { parseProviderBase } from "@/lib/llm/callers";

export const dynamic = "force-dynamic";

// Same-origin proxy to the user's ComfyUI instance. ComfyUI doesn't send CORS
// headers unless launched with --enable-cors-header, so the browser can't call
// it directly — but this server process can. The client passes the configured
// base URL as ?base=…; everything else is forwarded verbatim.
async function proxy(
  req: NextRequest,
  params: Promise<{ path: string[] }>
): Promise<Response> {
  const { path } = await params;

  // Through the same guard the LLM routes use, rather than a second hand-rolled
  // copy of it — and using its parsed result, so the string that reaches fetch
  // is the one that was checked.
  const base = parseProviderBase(
    req.nextUrl.searchParams.get("base") ?? "http://127.0.0.1:8188");
  if (!base) {
    return Response.json({ ok: false, error: "base must be an http(s) URL" }, { status: 400 });
  }

  const search = new URLSearchParams(req.nextUrl.searchParams);
  search.delete("base");
  const query = search.size > 0 ? `?${search}` : "";
  const target = `${base}/${path.map(encodeURIComponent).join("/")}${query}`;

  try {
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const res = await fetch(target, {
      method: req.method,
      headers: hasBody
        ? { "Content-Type": req.headers.get("Content-Type") ?? "application/json" }
        : undefined,
      body: hasBody ? await req.arrayBuffer() : undefined,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    // Buffer the body before responding: streaming it kept the timeout signal
    // armed, which could abort a large /view image mid-transfer past the
    // catch block. Local transfers finish well within the window.
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: `ComfyUI unreachable at ${base}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, ctx.params);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, ctx.params);
}
