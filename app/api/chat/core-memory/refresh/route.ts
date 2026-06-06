import { NextRequest } from "next/server";
import { ensureCoreMemory } from "@/lib/chat/coreMemoryStore";
import { rewriteCoreMemory } from "@/lib/chat/memoryRewriter";

export const dynamic = "force-dynamic";

// ─── POST /api/chat/core-memory/refresh ───────────────────────────────────────
// Trigger an LLM-driven "sleep consolidation" rewrite of the Core Memory Block.
//
// Body: {
//   characterId, characterName,
//   recentMessages: [{ role, content }],
//   providerType: "ollama" | "lmstudio" | "openrouter",
//   providerBaseUrl, modelId, apiKey?
// }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      characterId:      string;
      characterName:    string;
      // Accept either field name: direct callers send recentMessages,
      // triggerExtraction() sends the shared extractionBody which uses messages.
      recentMessages?:  Array<{ role: string; content: string }>;
      messages?:        Array<{ role: string; content: string }>;
      providerType:     "ollama" | "lmstudio" | "openrouter";
      providerBaseUrl:  string;
      modelId:          string;
      apiKey?:          string;
    };

    const {
      characterId, characterName,
      providerType, providerBaseUrl, modelId, apiKey,
    } = body;

    // Normalise: accept either field name so the shared extractionBody works
    const recentMessages = body.recentMessages ?? body.messages;

    if (!characterId || !recentMessages?.length || !providerBaseUrl || !modelId) {
      return Response.json(
        { error: "characterId, recentMessages, providerBaseUrl and modelId are required" },
        { status: 400 }
      );
    }

    // Ensure core memory exists before trying to rewrite it
    ensureCoreMemory(characterId, characterName ?? characterId);

    const result = await rewriteCoreMemory({
      characterId,
      characterName: characterName ?? characterId,
      recentMessages,
      providerType,
      providerBaseUrl,
      modelId,
      apiKey,
    });

    return Response.json(result);
  } catch (err) {
    console.error("[core-memory/refresh]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
