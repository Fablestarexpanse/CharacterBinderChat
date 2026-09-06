import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { rewriteCoreMemory } from "@/lib/server/memoryRewriter";
import { parseMemoryTaskRequest, routeError } from "@/lib/api/server";

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
    const parsed = parseMemoryTaskRequest(await req.json());
    if (!parsed.ok) return parsed.response;
    const {
      chatId, characterId, characterName, personaName, characterAnchor,
      messages, providerType, providerBaseUrl, modelId, apiKey,
    } = parsed.value;

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

    // Match the sibling extraction routes: an upstream model failure is a 502,
    // not a 200 with a false flag.
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return routeError("[core-memory/refresh]", err);
  }
}
