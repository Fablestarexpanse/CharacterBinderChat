// ─── Chat provider factory ────────────────────────────────────────────────────
// Which settings field feeds which provider is stated once, here. The mapping
// was inlined in generation.ts and the chat header, and getting it wrong
// (e.g. handing OpenRouter a baseUrl instead of an apiKey) fails at request
// time rather than compile time.

import { OllamaProvider } from "./ollama";
import { LMStudioProvider } from "./lmstudio";
import { OpenRouterProvider } from "./openrouter";
import type { ChatProvider, ProviderSettings } from "@/lib/types";

/**
 * Build the chat provider for a provider id.
 * Returns null when the provider can't be used yet — currently only
 * OpenRouter without an API key, which callers surface as a user-facing error.
 */
export function createChatProvider(
  providerId: string | undefined,
  settings: ProviderSettings
): ChatProvider | null {
  switch (providerId) {
    case "lmstudio":
      return new LMStudioProvider(settings.lmstudio.baseUrl);
    case "openrouter":
      if (!settings.openrouter.apiKey) return null;
      return new OpenRouterProvider(settings.openrouter.apiKey);
    case "ollama":
    default:
      return new OllamaProvider(settings.ollama.baseUrl);
  }
}

/** Every chat provider that can currently be reached, for model discovery. */
export function allChatProviders(settings: ProviderSettings): ChatProvider[] {
  return [
    new OllamaProvider(settings.ollama.baseUrl),
    new LMStudioProvider(settings.lmstudio.baseUrl),
    ...(settings.openrouter.apiKey ? [new OpenRouterProvider(settings.openrouter.apiKey)] : []),
  ];
}
