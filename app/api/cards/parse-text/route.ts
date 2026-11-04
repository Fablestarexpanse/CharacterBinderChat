import { NextRequest } from "next/server";
import { routeError, badRequest } from "@/lib/api/server";
import { parseCardText, toCharacterFields } from "@/lib/cards/textParser";

export const dynamic = "force-dynamic";

// POST /api/cards/parse-text   body: { text }
// Quick Import's parser as a service: sorts pasted character text into card
// fields without writing anything. Pure, so it is safe to call speculatively.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { text?: unknown } | null;
    if (!body || typeof body.text !== "string") return badRequest("text (a string) is required");
    if (body.text.length > 500_000) return badRequest("text is too long (limit 500,000 characters)");
    const parsed = parseCardText(body.text);
    return Response.json({ method: parsed.method, notes: parsed.notes, fields: toCharacterFields(parsed), tags: parsed.tags });
  } catch (err) {
    return routeError("[cards/parse-text POST]", err);
  }
}
