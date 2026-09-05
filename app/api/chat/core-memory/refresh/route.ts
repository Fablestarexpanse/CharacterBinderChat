import { NextRequest } from "next/server";
import type { ExtractionRequest } from "@/lib/types";
import { getStore } from "@/lib/db";
import { rewriteCoreMemory } from "@/lib/chat/memoryRewriter";
import { routeError } from "@/lib/api";

export const dynamic = "force-dynamic";

// ─── POST /api/chat/core-memory/refresh ───────────────────────────────────────
// Trigger an LLM-driven "sleep consolidation" rewrite of the Core Memory Block.
//
// Body: {
//   characterId, characterName,
//   messages: [{ role, content }],
//   providerType: "ollama" | "lmstudio" | "openrouter",
//   providerBaseUrl, modelId, apiKey?
// }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Pick<ExtractionRequest,
      "chatId" | "characterId" | "characterName" | "personaName" |
      "characterAnchor" | "messages" | "providerType" | "providerBaseUrl" |
      "modelId" | "apiKey">;

    const {
      chatId, characterId, characterName, personaName, characterAnchor,
      messages, providerType, providerBaseUrl, modelId, apiKey,
    } = body;

    const validProviders = new Set(["ollama", "lmstudio", "openrouter"]);
    if (!chatId || !characterId || !messages?.length || !providerBaseUrl || !modelId || !validProviders.has(providerType)) {
      return Response.json(
        { error: "chatId, characterId, messages, providerBaseUrl and modelId are required" },
        { status: 400 }
      );
    }

    // Ensure core memory exists before trying to rewrite it
    getStore().ensureCoreMemory(chatId, characterId, characterName ?? characterId);

    const result = await rewriteCoreMemory({
      chatId,
      characterId,
      characterName: characterName ?? characterId,
      personaName,
      characterAnchor,
      recentMessages: messages,
      providerType,
      providerBaseUrl,
      modelId,
      apiKey,
    });

    return Response.json(result);
  } catch (err) {
    return routeError("[core-memory/refresh]", err);
  }
}
