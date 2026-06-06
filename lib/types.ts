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

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  characterId?: string;
  imageJobId?: string;
  timestamp: string;
  tokens?: number;
}

export interface Chat {
  id: string;
  name: string;
  characterId?: string;
  modelId?: string;
  providerId?: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  contextUsed?: number;
  contextMax?: number;
}

export interface LoreEntry {
  id: string;
  lorebookId: string;
  key: string;
  value: string;
  enabled: boolean;
  tokens?: number;
  priority?: number;
}

export interface Lorebook {
  id: string;
  name: string;
  description?: string;
  entries: LoreEntry[];
  createdAt: string;
}

export interface Memory {
  id: string;
  chatId: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  type: "extracted" | "manual" | "summary";
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
  ollama: { baseUrl: string; enabled: boolean };
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
    settings?: Partial<ChatSettings>
  ): AsyncIterable<string>;
}
