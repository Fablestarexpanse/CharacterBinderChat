import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Character,
  Chat,
  Message,
  Lorebook,
  Memory,
  ImageJob,
  ImageGenerationSettings,
  ProviderSettings,
  ProviderStatus,
  ProviderId,
  AspectRatio,
} from "@/lib/types";

// ─── Sidebar Navigation ───────────────────────────────────────────────────────

export type SidebarSection =
  | "characters"
  | "chats"
  | "groups"
  | "lorebooks"
  | "presets"
  | "image-studio"
  | "gallery"
  | "workflows"
  | "extensions"
  | "settings";

// ─── Inspector Panel ──────────────────────────────────────────────────────────

export type InspectorTab = "character" | "memory" | "summary" | "lore" | "image-studio" | "core-memory";

// ─── Default Image Settings ───────────────────────────────────────────────────

const defaultImageSettings: ImageGenerationSettings = {
  provider: "comfyui",
  workflow: "flux-cinematic",
  prompt: "",
  negativePrompt: "blurry, deformed, low quality, watermark",
  aspectRatio: "1:1" as AspectRatio,
  width: 1024,
  height: 1024,
  steps: 28,
  cfg: 7,
  sampler: "euler",
  seed: -1,
  batchCount: 1,
  refiner: false,
  loras: [],
  controlNet: undefined,
};

// ─── Placeholder Data ─────────────────────────────────────────────────────────

const PLACEHOLDER_CHARACTERS: Character[] = [
  {
    id: "char-ronan",
    name: "Ronan",
    description:
      "A grizzled mercenary with a sharp wit and a code of honor. Former city guard turned freelance operative in the neon-drenched sprawl.",
    personality: "Sarcastic, loyal, world-weary but optimistic underneath the cynicism.",
    tags: ["cyberpunk", "mercenary", "male", "action"],
    avatar: "/avatars/ronan.png",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "char-fen",
    name: "Fen",
    description:
      "A quiet, enigmatic netrunner who speaks in riddles and sees the world through a lattice of data streams.",
    personality: "Introspective, brilliant, cautious. Speaks sparingly but precisely.",
    tags: ["cyberpunk", "hacker", "female", "mystery"],
    avatar: "/avatars/fen.png",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const PLACEHOLDER_MESSAGES: Message[] = [
  {
    id: "msg-1",
    chatId: "chat-1",
    role: "assistant",
    content:
      "The rain hammers the corrugated roof above us. I lean against the wall of the safehouse, arms crossed, watching you with that half-lidded expression I've perfected over a decade of bad deals.\n\n\"You're late,\" I say. Not an accusation — just a statement of fact. \"The shuttle to the upper levels leaves in forty minutes. You want to tell me what kept you, or do we move?\"",
    characterId: "char-ronan",
    timestamp: new Date(Date.now() - 600000).toISOString(),
  },
  {
    id: "msg-2",
    chatId: "chat-1",
    role: "user",
    content:
      "Sorry — the checkpoint at Sector 7 was locked down. Corporate security sweep. I had to go three levels underground to get around it.",
    timestamp: new Date(Date.now() - 480000).toISOString(),
  },
  {
    id: "msg-3",
    chatId: "chat-1",
    role: "assistant",
    content:
      "A low exhale. I push off the wall and move to the window, peering through a crack in the boards at the alley below.\n\n\"Sector 7.\" My jaw tightens. \"That's Kaspar's territory. If they were running a sweep, it means someone's been talking.\" I turn back, eyes sharp. \"Anyone follow you down here?\"",
    characterId: "char-ronan",
    timestamp: new Date(Date.now() - 360000).toISOString(),
  },
];

const PLACEHOLDER_CHATS: Chat[] = [
  {
    id: "chat-1",
    name: "Neon Rain",
    characterId: "char-ronan",
    modelId: "llama3.2:latest",
    providerId: "ollama",
    messages: PLACEHOLDER_MESSAGES,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
    contextUsed: 2847,
    contextMax: 8192,
  },
  {
    id: "chat-2",
    name: "Ghost Protocol",
    characterId: "char-fen",
    modelId: "mistral:latest",
    providerId: "ollama",
    messages: [],
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 172800000).toISOString(),
    contextUsed: 512,
    contextMax: 8192,
  },
];

const PLACEHOLDER_MEMORIES: Memory[] = [
  {
    id: "mem-1",
    chatId: "chat-1",
    content: "The player character is a courier working freelance jobs in the lower city.",
    pinned: true,
    type: "manual",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "mem-2",
    chatId: "chat-1",
    content: "Ronan distrusts corporate security forces, especially Kaspar Division.",
    pinned: true,
    type: "extracted",
    createdAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: "mem-3",
    chatId: "chat-1",
    content: "The safehouse is located in Sector 4, three levels underground.",
    pinned: false,
    type: "extracted",
    createdAt: new Date(Date.now() - 900000).toISOString(),
  },
];

const PLACEHOLDER_LORE: Lorebook = {
  id: "lb-1",
  name: "Neon City Lore",
  description: "World-building entries for the cyberpunk setting",
  entries: [
    { id: "le-1", lorebookId: "lb-1", key: "Kaspar Division", value: "Elite corporate security force contracted by Apex Corp to police the upper levels.", enabled: true, tokens: 24, priority: 10 },
    { id: "le-2", lorebookId: "lb-1", key: "lower city", value: "The sprawling underground districts beneath the sky bridges, home to the majority of the city's population.", enabled: true, tokens: 30, priority: 5 },
    { id: "le-3", lorebookId: "lb-1", key: "netrunner", value: "A hacker capable of interfacing directly with the city's data grid using neural implants.", enabled: true, tokens: 22, priority: 5 },
  ],
  createdAt: new Date().toISOString(),
};

// ─── Store Shape ──────────────────────────────────────────────────────────────

interface FableStore {
  // Navigation
  activeSection: SidebarSection;
  setActiveSection: (s: SidebarSection) => void;

  // Inspector
  inspectorTab: InspectorTab;
  setInspectorTab: (t: InspectorTab) => void;
  inspectorOpen: boolean;
  setInspectorOpen: (v: boolean) => void;

  // Characters
  characters: Character[];

  // Chats
  chats: Chat[];
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  /** Adds a message and returns its generated ID */
  addMessage: (chatId: string, message: Omit<Message, "id" | "timestamp">) => string;
  /** Stream partial assistant content into an existing message */
  updateMessageContent: (chatId: string, messageId: string, content: string) => void;
  /** Update which model / provider a chat uses */
  setChatModel: (chatId: string, modelId: string, providerId: string) => void;
  createChat: (characterId?: string) => string;

  // Input
  inputValue: string;
  setInputValue: (v: string) => void;

  // Memories
  memories: Memory[];

  // Lorebooks
  lorebooks: Lorebook[];

  // Image Jobs
  imageJobs: ImageJob[];
  addImageJob: (job: ImageJob) => void;
  updateImageJob: (id: string, updates: Partial<ImageJob>) => void;

  // Image Settings (Image Studio panel)
  imageSettings: ImageGenerationSettings;
  setImageSettings: (s: Partial<ImageGenerationSettings>) => void;

  // Provider Settings
  providerSettings: ProviderSettings;
  setProviderSetting: <K extends keyof ProviderSettings>(
    provider: K,
    value: Partial<ProviderSettings[K]>
  ) => void;

  // Provider Status
  providerStatuses: ProviderStatus[];
  setProviderStatus: (id: ProviderId, status: Partial<ProviderStatus>) => void;

  // Drawer 2 — knowledge graph sync signal
  // Bump this after extraction completes so inspector tabs re-fetch from the DB.
  extractionVersion: number;
  bumpExtraction: () => void;
  isExtracting: boolean;
  setIsExtracting: (v: boolean) => void;
}

// ─── Store Implementation ─────────────────────────────────────────────────────

export const useFableStore = create<FableStore>()(
  persist(
    (set, get) => ({
      activeSection: "chats",
      setActiveSection: (s) => set({ activeSection: s }),

      inspectorTab: "character",
      setInspectorTab: (t) => set({ inspectorTab: t }),
      inspectorOpen: true,
      setInspectorOpen: (v) => set({ inspectorOpen: v }),

      characters: PLACEHOLDER_CHARACTERS,

      chats: PLACEHOLDER_CHATS,
      activeChatId: "chat-1",
      setActiveChatId: (id) => set({ activeChatId: id }),

      addMessage: (chatId, msg) => {
        const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const message: Message = {
          ...msg,
          id,
          timestamp: new Date().toISOString(),
        };
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: [...c.messages, message], updatedAt: new Date().toISOString() }
              : c
          ),
        }));
        return id;
      },

      updateMessageContent: (chatId, messageId, content) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, content } : m
                  ),
                }
              : c
          ),
        }));
      },

      setChatModel: (chatId, modelId, providerId) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId ? { ...c, modelId, providerId } : c
          ),
        }));
      },

      createChat: (characterId) => {
        const id = `chat-${Date.now()}`;
        const character = get().characters.find((c) => c.id === characterId);
        const newChat: Chat = {
          id,
          name: character ? `Chat with ${character.name}` : "New Chat",
          characterId,
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          contextUsed: 0,
          contextMax: 8192,
        };
        set((state) => ({ chats: [newChat, ...state.chats], activeChatId: id }));
        return id;
      },

      inputValue: "",
      setInputValue: (v) => set({ inputValue: v }),

      memories: PLACEHOLDER_MEMORIES,
      lorebooks: [PLACEHOLDER_LORE],

      imageJobs: [],
      addImageJob: (job) => set((s) => ({ imageJobs: [job, ...s.imageJobs] })),
      updateImageJob: (id, updates) =>
        set((s) => ({ imageJobs: s.imageJobs.map((j) => (j.id === id ? { ...j, ...updates } : j)) })),

      imageSettings: defaultImageSettings,
      setImageSettings: (s) =>
        set((state) => ({ imageSettings: { ...state.imageSettings, ...s } })),

      providerSettings: {
        ollama: { baseUrl: "http://127.0.0.1:11434", enabled: true },
        lmstudio: { baseUrl: "http://127.0.0.1:1234", enabled: true },
        openrouter: { apiKey: "", enabled: false },
        comfyui: { baseUrl: "http://127.0.0.1:8188", enabled: true },
      },
      setProviderSetting: (provider, value) =>
        set((state) => ({
          providerSettings: {
            ...state.providerSettings,
            [provider]: { ...state.providerSettings[provider], ...value },
          },
        })),

      providerStatuses: [
        { id: "ollama", name: "Ollama", connected: false, checking: false },
        { id: "lmstudio", name: "LM Studio", connected: false, checking: false },
        { id: "openrouter", name: "OpenRouter", connected: false, checking: false },
        { id: "comfyui", name: "ComfyUI", connected: false, checking: false },
      ],
      setProviderStatus: (id, status) =>
        set((state) => ({
          providerStatuses: state.providerStatuses.map((p) =>
            p.id === id ? { ...p, ...status } : p
          ),
        })),

      extractionVersion: 0,
      bumpExtraction:    () => set((s) => ({ extractionVersion: s.extractionVersion + 1 })),
      isExtracting:      false,
      setIsExtracting:   (v) => set({ isExtracting: v }),
    }),
    {
      name: "fablechat-store",
      // Only persist settings, not transient UI state
      partialize: (state) => ({
        providerSettings: state.providerSettings,
        characters: state.characters,
        chats: state.chats,
        lorebooks: state.lorebooks,
        imageJobs: state.imageJobs,
      }),
    }
  )
);
