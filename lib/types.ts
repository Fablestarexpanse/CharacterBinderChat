// ─── Core Data Models ────────────────────────────────────────────────────────

import type { ProviderType } from "@/lib/llm/callers";

export type MessageRole = "user" | "assistant" | "system";

export interface Character {
  id: string;
  name: string;
  avatar?: string;
  description: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A saved scene setup: standing scenario text plus an opening message.
 * Picked in the chat builder to override the character sheet's own
 * scenario/first message — one character, many stories.
 */
export interface Scenario {
  id: string;
  name: string;
  /** Standing story context injected into the prompt ("Current scenario: …") */
  scenario: string;
  /** Opening assistant message; falls back to the character's own when empty */
  firstMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/** The user's identity in the roleplay — like a Character, but for the player */
export interface Persona {
  id: string;
  name: string;
  avatar?: string;
  /** Who the user is in the story — appearance, role, backstory */
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  characterId?: string;
  imageJobId?: string;
  timestamp: string;
  tokens?: number;
  /** Memory injected into the prompt that produced this reply (assistant only) */
  memoryTrace?: MemoryTrace;
  /** User feedback on this reply (thumbs up/down in the hover actions) */
  rating?: "up" | "down";
  /** Image cards only: collapsed to a one-line summary to declutter the chat */
  collapsed?: boolean;
  /** True when this is a provider-failure notice, not real dialogue — such
   *  messages are excluded from prompts, extraction, and cadence counts */
  error?: boolean;
}

/** What memory shaped a given assistant reply — for the "why did you say
 *  that?" inspector. Recorded at generation time from the exact injected
 *  prompt sections. */
export interface MemoryTrace {
  facts:          string[];
  episodes:       string[];
  insights:       string[];
  sharedLanguage: string[];
  lore:           string[];
  storyTime?:     string | null;
  /** Traces written before the field was renamed from `bits`. Read-only. */
  bits?:          string[];
}

export interface Chat {
  id: string;
  name: string;
  /** 1:1 chats: the character. Group chats: the primary member (first). */
  characterId?: string;
  /** Group chats only: all character members, in join order. Absent for 1:1. */
  memberIds?: string[];
  /** Group chats: members currently OUT of the scene. Absent members don't
   *  speak and don't witness facts extracted while they're away. */
  absentIds?: string[];
  modelId?: string;
  providerId?: ProviderId;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  contextUsed?: number;
  contextMax?: number;
  /** Which preset applies. Unset falls back to the store's defaultPresetId,
   *  resolved at read time so old chats pick up the default too. */
  presetId?: string;
  /** Per-chat overrides layered on top of the preset. Field name kept from the
   *  old ChatSettings so persisted chats round-trip without a migration. */
  settings?: Partial<GenerationParams>;
  /** Which lorebooks (worlds) apply to this chat. Undefined = all books
   *  (legacy behavior); [] = none; otherwise only the listed books inject. */
  lorebookIds?: string[];
  /** Scenario override chosen in the chat builder — snapshot taken at chat
   *  creation, replaces the character sheet's own scenario in the prompt. */
  scenarioText?: string;
}

export interface LoreEntry {
  id: string;
  lorebookId: string;
  key: string;
  value: string;
  enabled: boolean;
  tokens?: number;
  priority?: number;
  /** Always inject, regardless of keywords — used for scenarios / standing context */
  constant?: boolean;
}

export interface Lorebook {
  id: string;
  name: string;
  description?: string;
  entries: LoreEntry[];
  createdAt: string;
}

// ─── Image Generation ─────────────────────────────────────────────────────────

export type ImageJobStatus = "queued" | "generating" | "complete" | "failed";

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "2:1" | "custom";

export interface LoraEntry {
  name: string;
  weight: number;
}

export interface ImageGenerationSettings {
  provider: "comfyui";
  workflow: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  /** -1 means "randomise at queue time" — see lib/providers/comfyui.ts */
  seed: number;
  batchCount: number;
  /** Injected as `<lora:name:weight>` into the workflow's loraSyntaxNode */
  loras: LoraEntry[];
}

export interface ImageJob {
  id: string;
  chatId?: string;
  prompt: string;
  status: ImageJobStatus;
  settings: ImageGenerationSettings;
  outputUrls: string[];
  promptId?: string; // ComfyUI prompt ID
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// Workflow templates are described by GET /api/workflows, read from the JSON
// on disk — there was a WorkflowTemplate interface here that nothing ever used.

// ─── Provider Types ───────────────────────────────────────────────────────────

/** Every backend the app talks to. ComfyUI is an image backend and stays
 *  outside ProviderType, which is the union callLLM branches on. */
export type ProviderId = ProviderType | "comfyui";

export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  parameters?: string;
  providerId: ProviderId;
  /** OpenRouter only: sampler params this model's providers actually honour.
   *  Drives which advanced controls are worth showing. */
  supportedParameters?: string[];
}

export interface ProviderSettings {
  /** utilityModel: local Ollama model for background tasks that must run
   *  uncensored regardless of the chat's (possibly cloud) model — currently
   *  the /image scene-director step. */
  ollama: { baseUrl: string; enabled: boolean; utilityModel?: string };
  lmstudio: { baseUrl: string; enabled: boolean };
  openrouter: { apiKey: string; enabled: boolean };
  comfyui: { baseUrl: string; enabled: boolean };
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  connected: boolean;
  checking: boolean;
  error?: string;
  /** Short label shown in the sidebar — e.g. "llama3.2" or "3 models" */
  modelLabel?: string;
}

// ─── Memory-task request ──────────────────────────────────────────────────────
// One body shape POSTed by runExtraction() in lib/chat/generation.ts to
// /api/drawer/extract, /api/drawer/episode and /api/chat/core-memory/refresh.
// Declaring it once is what keeps the field names from drifting apart across
// the three.
//
// Deliberately carries NO generation params and no preset/global prompt text:
// these routes run format:"json" on backend defaults, and a roleplay
// temperature or instruction would break structured output.

/**
 * What the client sends to the three memory-task routes (extract, episode and
 * core-memory/refresh). One builder in lib/chat/generation.ts produces it and
 * parseMemoryTaskRequest in lib/api/server.ts is the only thing that validates
 * it.
 */
export interface MemoryTaskRequest {
  chatId:          string;
  characterId:     string;
  /** Falls back to characterId in every route that reads it. */
  characterName?:  string;
  personaName?:    string;
  /** Recent turns. In groups each carries its speaker's display name, so the
   *  extractor never attributes one character's line to another. */
  messages:        Array<{ role: MessageRole; content: string; speaker?: string }>;
  /** Drift anchor for the persona rewrite — character sheet text only */
  characterAnchor?: string;
  /** Group chats: everyone present in the scene (characters + player).
   *  Extracted facts are stamped known_to with these ids, so absent members
   *  never "remember" what happened without them. */
  participants?:   Array<{ id: string; name: string }>;
  providerType:    ProviderType;
  providerBaseUrl: string;
  modelId:         string;
  apiKey?:         string;
  /** /api/drawer/episode only */
  mode?:           "episode" | "reflect";
}

// ─── Generation Parameters ───────────────────────────────────────────────────
// Provider-neutral sampler knobs. Every backend spells these differently (see
// PARAM_MAP in lib/providers/params.ts) and supports a different subset, so
// nothing here is sent verbatim — the mapping layer translates and drops.

export interface GenerationParams {
  temperature: number;
  maxTokens: number;
  /** History budget in tokens. Client-side everywhere; also Ollama's num_ctx. */
  contextSize: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  frequencyPenalty: number;
  presencePenalty: number;
}

export type ParamKey = keyof GenerationParams;

/** Standing instructions that apply to every chat, set once in Presets. */
export interface PromptInstructions {
  /** Injected just below the character identity line of every system prompt */
  globalPrompt?: string;
  /** Forces the reply to begin with this text */
  prefill?: string;
  /** Max 10. Added as an instruction — not enforceable at the API level. */
  forbiddenWords?: string[];
}

/** A named, reusable bundle of parameters and standing prompts. */
export interface Preset {
  id: string;
  name: string;
  /** Sparse: only what the user actually set. Unset keys fall through to
   *  DEFAULT_GENERATION_PARAMS and are not sent at all beyond the core three. */
  params: Partial<GenerationParams>;
  /** Sent only while this preset is active, below the global prompt */
  customPrompt?: string;
  /** Override the global prefill / forbidden words when set */
  prefill?: string;
  forbiddenWords?: string[];
  createdAt: string;
  updatedAt: string;
}

/** What generation.ts consumes after global → preset → chat merging. */
export interface ResolvedGeneration {
  params: Partial<GenerationParams>;
  globalPrompt?: string;
  customPrompt?: string;
  prefill: string;
  forbiddenWords: string[];
  presetId: string | null;
}

// ─── Unified Chat Provider Interface ─────────────────────────────────────────

export interface ChatProvider {
  id: ProviderId;
  name: string;
  checkConnection(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  streamChat(
    messages: Array<{ role: MessageRole; content: string }>,
    modelId: string,
    params?: Partial<GenerationParams>,
    signal?: AbortSignal
  ): AsyncIterable<string>;
}

// ─── Durable app state ───────────────────────────────────────────────────────

/**
 * The whole durable app state: what `GET /api/state` returns, what
 * `PUT /api/state` accepts, what the store persists and hydrates, and what
 * FableStore reads and replaces.
 *
 * It was enumerated by hand in five modules, so adding a collection meant
 * finding all five — and the SQLite end typed its rows `unknown[]`, which
 * removed the last place a miss would have shown up. One declaration makes a
 * forgotten collection a type error instead.
 */
export interface PersistedAppState {
  characters:         Character[];
  chats:              Chat[];
  personas:           Persona[];
  lorebooks:          Lorebook[];
  scenarios:          Scenario[];
  presets:            Preset[];
  /** null clears the selection; the collections above are always present. */
  defaultPresetId:    string | null;
  globalInstructions: PromptInstructions;
}
