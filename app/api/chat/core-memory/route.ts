import { NextRequest } from "next/server";
import { ensureCoreMemory, getCoreMemory, patchCoreMemory } from "@/lib/chat/coreMemoryStore";
import { getStore } from "@/lib/db";
import type { CoreMemory } from "@/lib/db/models";

export const dynamic = "force-dynamic";

// ─── GET /api/chat/core-memory?characterId=X&name=Y ──────────────────────────
// Returns the Core Memory Block for a character, creating defaults if needed.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const characterId   = searchParams.get("characterId");
  const characterName = searchParams.get("name") ?? characterId ?? "Unknown";

  if (!characterId) {
    return Response.json({ error: "characterId is required" }, { status: 400 });
  }

  try {
    const cm         = ensureCoreMemory(characterId, characterName);
    const store      = getStore();
    const knownFacts = store.retrieveFactsForPrompt(characterId);
    return Response.json({ ok: true, coreMemory: cm.data, version: cm.version, updatedAt: cm.updatedAt, knownFacts });
  } catch (err) {
    console.error("[core-memory GET]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// ─── PATCH /api/chat/core-memory ──────────────────────────────────────────────
// Partial update. Body: { characterId, ...fields to merge }

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { characterId?: string } & Partial<CoreMemory>;
    const { characterId, ...patch } = body;

    if (!characterId) {
      return Response.json({ error: "characterId is required" }, { status: 400 });
    }

    // Ensure the record exists before patching
    const existing = getCoreMemory(characterId);
    if (!existing) {
      return Response.json({ error: "Core memory not found — call GET first to initialise" }, { status: 404 });
    }

    const updated = patchCoreMemory(characterId, patch);
    return Response.json({ ok: true, coreMemory: updated?.data, version: updated?.version });
  } catch (err) {
    console.error("[core-memory PATCH]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
