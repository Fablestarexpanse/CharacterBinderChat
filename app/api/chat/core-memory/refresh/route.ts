import { NextRequest } from "next/server";
import type { ExtractionRequest } from "@/lib/types";
import { getStore } from "@/lib/db";
import { rewriteCoreMemory } from "@/lib/chat/memoryRewriter";
import { routeError } from "@/lib/api";
import { isProviderType, PROVIDER_TYPES, parseProviderBase } from "@/lib/llm/callers";

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

    if (!chatId || !characterId || !messages?.length || !providerBaseUrl || !modelId) {
      return Response.json(
        { ok: false, error: "chatId, characterId, messages, providerBaseUrl and modelId are required" },
        { status: 400 }
      );
    }
    if (!isProviderType(providerType)) {
      return Response.json(
        { ok: false, error: `providerType must be one of: ${PROVIDER_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    const baseUrl = parseProviderBase(providerBaseUrl);
    if (!baseUrl) {
      return Response.json(
        { ok: false, error: "providerBaseUrl must be an http(s) URL" },
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
      providerBaseUrl: baseUrl,
      modelId,
      apiKey,
    });

    // Match the sibling extraction routes: an upstream model failure is a 502,
    // not a 200 with a false flag.
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return routeError("[core-memory/refresh]", err);
  }
}
