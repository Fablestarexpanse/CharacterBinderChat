import { NextRequest } from "next/server";
import { routeError, guard } from "@/lib/api/server";
import { getContactSettings, setContactSettings } from "@/lib/server/contactSettings";

export const dynamic = "force-dynamic";

// GET → the Contact & media switches. PUT { enabled?, reviewMedia? } → change some, keep the rest.
export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    return Response.json(getContactSettings());
  } catch (err) {
    return routeError("[contact-settings GET]", err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    return Response.json({ ok: true, ...setContactSettings(await req.json()) });
  } catch (err) {
    return routeError("[contact-settings PUT]", err);
  }
}
