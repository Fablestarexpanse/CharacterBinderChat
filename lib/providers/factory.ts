// ─── Chat provider factory ────────────────────────────────────────────────────
// Which settings field feeds which provider is stated once, here. The mapping
// was inlined in generation.ts and the chat header, and getting it wrong
// (e.g. handing OpenRouter a baseUrl instead of an apiKey) fails at request
// time rather than compile time.

import { OllamaProvider } from "./ollama";
import { LMStudioProvider } from "./lmstudio";
import { OpenRouterProvider } from "./openrouter";
import type { ChatProvider, ProviderSettings } from "@/lib/types";
import type { ProviderType } from "@/lib/llm/callers";

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

/**
 * The same mapping, for the routes: what a server-side memory task needs to
 * reach the provider a chat is using.
 *
 * Extraction, episodes and the core-memory rewrite all run on the server, so
 * they take the provider as data rather than as a ChatProvider instance. Both
 * callers had their own copy of this ladder, which is the drift this file
 * exists to prevent.
 */
export function resolveRouteCredentials(
  providerId: string | undefined,
  settings: ProviderSettings
): { providerType: ProviderType; providerBaseUrl: string; apiKey?: string } {
  switch (providerId) {
    case "lmstudio":
      return { providerType: "lmstudio", providerBaseUrl: settings.lmstudio.baseUrl };
    case "openrouter":
      return {
        providerType:    "openrouter",
        providerBaseUrl: "https://openrouter.ai/api",
        apiKey:          settings.openrouter.apiKey,
      };
    default:
      return { providerType: "ollama", providerBaseUrl: settings.ollama.baseUrl };
  }
}
