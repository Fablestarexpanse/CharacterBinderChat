import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { guard, routeError } from "@/lib/api/server";
import { readJsonCapped } from "@/lib/server/assets";

export const dynamic = "force-dynamic";

// ─── /api/comic ───────────────────────────────────────────────────────────────
// The Comic-it switch (off by default) and the page style, kept by the server
// (app_kv "comic:settings"), and an optional style LoRA (a MOSS-Image LoRA, chained in front of the sampler).
// GET → { enabled, style, styleLora? }; PUT { enabled?, style?, styleLora? (null clears) } → { ok: true, ...settings }

const KEY = "comic:settings";
const DEFAULT_COMIC_STYLE = "Full-colour graphic-novel page, clean confident ink lines and soft painted colour";

type StyleLora = { name: string; weight: number };
const cleanLora = (v: unknown): StyleLora | undefined => {
  const l = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const name = typeof l.name === "string" ? l.name.trim().slice(0, 300) : "";
  const w = Number(l.weight);
  return name ? { name, weight: Number.isFinite(w) ? Math.min(2, Math.max(-2, w)) : 1 } : undefined;
};

function read(): { enabled: boolean; style: string; styleLora?: StyleLora } {
  try {
    const r = JSON.parse(getStore().getKv(KEY) ?? "{}") as Record<string, unknown>;
    const styleLora = cleanLora(r.styleLora);
    return {
      enabled: r.enabled === true,
      style: typeof r.style === "string" && r.style.trim() ? r.style.trim().slice(0, 400) : DEFAULT_COMIC_STYLE,
      ...(styleLora ? { styleLora } : {}),
    };
  } catch {
    return { enabled: false, style: DEFAULT_COMIC_STYLE };
  }
}

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    return Response.json(read());
  } catch (err) {
    return routeError("[comic GET]", err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = ((await readJsonCapped(req, 8 * 1024, "the request").catch(() => null)) ?? {}) as Record<string, unknown>;
    const cur = read();
    const styleLora = body.styleLora === null ? undefined : body.styleLora !== undefined ? cleanLora(body.styleLora) : cur.styleLora;
    const next = {
      enabled: typeof body.enabled === "boolean" ? body.enabled : cur.enabled,
      style: typeof body.style === "string" ? (body.style.trim().slice(0, 400) || DEFAULT_COMIC_STYLE) : cur.style,
      ...(styleLora ? { styleLora } : {}),
    };
    getStore().setKv(KEY, JSON.stringify(next));
    return Response.json({ ok: true, ...next });
  } catch (err) {
    return routeError("[comic PUT]", err);
  }
}
