// ─── Core Data Models ────────────────────────────────────────────────────────

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
  /** True when this is a provider-failure notice, not real dialogue — such
   *  messages are excluded from prompts, extraction, and cadence counts */
  error?: boolean;
}

/** What memory shaped a given assistant reply — for the "why did you say
 *  that?" inspector. Recorded at generation time from the exact injected
 *  prompt sections. */
export interface MemoryTrace {
  facts:      string[];
  episodes:   string[];
  insights:   string[];
  bits:       string[];
  lore:       string[];
  storyTime?: string | null;
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
  providerId?: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  contextUsed?: number;
  contextMax?: number;
  /** Per-chat generation parameters; provider defaults apply when unset */
  settings?: Partial<ChatSettings>;
  /** Which lorebooks (worlds) apply to this chat. Undefined = all books
   *  (legacy behavior); [] = none; otherwise only the listed books inject. */
  lorebookIds?: string[];
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

export type ImageJobStatus = "pending" | "queued" | "generating" | "complete" | "failed";

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "2:1" | "custom";

export interface LoraEntry {
  name: string;
  weight: number;
}

export interface ImageGenerationSettings {
  provider: "comfyui" | "a1111";
  workflow: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  seed: number | -1;
  batchCount: number;
  refiner: boolean;
  characterReferenceImage?: string;
  loras: LoraEntry[];
  controlNet?: string;
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

// ─── Workflow Templates ───────────────────────────────────────────────────────

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  filename: string;
  supportedSamplers: string[];
  defaultSettings: Partial<ImageGenerationSettings>;
  previewImage?: string;
}

// ─── Provider Types ───────────────────────────────────────────────────────────

export type ProviderId = "ollama" | "lmstudio" | "openrouter" | "comfyui";

export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  parameters?: string;
  providerId: ProviderId;
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

export interface ChatSettings {
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  systemPrompt?: string;
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
    settings?: Partial<ChatSettings>,
    signal?: AbortSignal
  ): AsyncIterable<string>;
}
