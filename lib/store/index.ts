import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Character,
  Chat,
  ChatSettings,
  Message,
  MemoryTrace,
  Lorebook,
  LoreEntry,
  Memory,
  ImageJob,
  ImageGenerationSettings,
  ModelInfo,
  Persona,
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

export type InspectorTab = "character" | "memory" | "graph" | "summary" | "lore" | "image-studio" | "core-memory";

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
// Timestamps are FIXED, not Date.now()-derived. These objects are evaluated at
// module load, which happens once on the server and again in the browser — any
// clock-derived value differs between the two and makes React throw away the
// hydrated tree. Real chats get real timestamps at creation time.

const SEED_EPOCH = "2026-06-06T00:00:00.000Z";
const seedTime = (msOffset: number) =>
  new Date(Date.parse(SEED_EPOCH) + msOffset).toISOString();

const PLACEHOLDER_CHARACTERS: Character[] = [
  {
    id: "char-ronan",
    name: "Ronan",
    description:
      "A grizzled mercenary with a sharp wit and a code of honor. Former city guard turned freelance operative in the neon-drenched sprawl.",
    personality: "Sarcastic, loyal, world-weary but optimistic underneath the cynicism.",
    tags: ["cyberpunk", "mercenary", "male", "action"],
    avatar: "/avatars/ronan.png",
    createdAt: seedTime(0),
    updatedAt: seedTime(0),
  },
  {
    id: "char-fen",
    name: "Fen",
    description:
      "A quiet, enigmatic netrunner who speaks in riddles and sees the world through a lattice of data streams.",
    personality: "Introspective, brilliant, cautious. Speaks sparingly but precisely.",
    tags: ["cyberpunk", "hacker", "female", "mystery"],
    avatar: "/avatars/fen.png",
    createdAt: seedTime(0),
    updatedAt: seedTime(0),
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
    timestamp: seedTime(-600000),
  },
  {
    id: "msg-2",
    chatId: "chat-1",
    role: "user",
    content:
      "Sorry — the checkpoint at Sector 7 was locked down. Corporate security sweep. I had to go three levels underground to get around it.",
    timestamp: seedTime(-480000),
  },
  {
    id: "msg-3",
    chatId: "chat-1",
    role: "assistant",
    content:
      "A low exhale. I push off the wall and move to the window, peering through a crack in the boards at the alley below.\n\n\"Sector 7.\" My jaw tightens. \"That's Kaspar's territory. If they were running a sweep, it means someone's been talking.\" I turn back, eyes sharp. \"Anyone follow you down here?\"",
    characterId: "char-ronan",
    timestamp: seedTime(-360000),
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
    createdAt: seedTime(-86400000),
    updatedAt: seedTime(0),
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
    createdAt: seedTime(-172800000),
    updatedAt: seedTime(-172800000),
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
    createdAt: seedTime(-3600000),
  },
  {
    id: "mem-2",
    chatId: "chat-1",
    content: "Ronan distrusts corporate security forces, especially Kaspar Division.",
    pinned: true,
    type: "extracted",
    createdAt: seedTime(-1800000),
  },
  {
    id: "mem-3",
    chatId: "chat-1",
    content: "The safehouse is located in Sector 4, three levels underground.",
    pinned: false,
    type: "extracted",
    createdAt: seedTime(-900000),
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
  createdAt: seedTime(0),
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
  /** Create a character; returns the generated id (slug of the name) */
  addCharacter: (data: Omit<Character, "id" | "createdAt" | "updatedAt">) => string;
  updateCharacter: (id: string, updates: Partial<Omit<Character, "id" | "createdAt">>) => void;
  deleteCharacter: (id: string) => void;

  // Personas — the user's identity in the roleplay
  personas: Persona[];
  /** Which persona is active in chats (null = plain "User") */
  activePersonaId: string | null;
  setActivePersona: (id: string | null) => void;
  addPersona: (data: Omit<Persona, "id" | "createdAt" | "updatedAt">) => string;
  updatePersona: (id: string, updates: Partial<Omit<Persona, "id" | "createdAt">>) => void;
  deletePersona: (id: string) => void;

  // Character editor dialog (global — opened from CharactersView or the inspector)
  characterEditorOpen: boolean;
  /** id of the character being edited, or null when creating a new one */
  characterEditorId: string | null;
  /** Prefill values for create mode (e.g. from an imported character card) */
  characterEditorDraft: Partial<Character> | null;
  openCharacterEditor: (id?: string | null, draft?: Partial<Character> | null) => void;
  closeCharacterEditor: () => void;

  // Chats
  chats: Chat[];
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  /** Replace characters + chats + personas + lorebooks with the durable SQLite copy (on app load) */
  hydrateFromServer: (characters: Character[], chats: Chat[], personas: Persona[], lorebooks?: Lorebook[]) => void;
  /** Adds a message and returns its generated ID */
  addMessage: (chatId: string, message: Omit<Message, "id" | "timestamp">) => string;
  /** Stream partial assistant content into an existing message */
  updateMessageContent: (chatId: string, messageId: string, content: string) => void;
  /** Record which memory shaped a reply (provenance for the memory inspector) */
  setMessageMemoryTrace: (chatId: string, messageId: string, trace: MemoryTrace) => void;
  /** Update which model / provider a chat uses */
  setChatModel: (chatId: string, modelId: string, providerId: string) => void;
  /** Update the real token accounting shown by the header context meter */
  setChatContext: (chatId: string, contextUsed: number, contextMax: number) => void;
  /** Merge per-chat generation settings (temperature, maxTokens, topP…) */
  updateChatSettings: (chatId: string, settings: Partial<ChatSettings>) => void;
  createChat: (characterId?: string) => string;
  deleteChat: (chatId: string) => void;
  renameChat: (chatId: string, name: string) => void;
  /** Wipe messages (re-seeds the character's greeting if they have one) */
  clearChat: (chatId: string) => void;
  removeMessage: (chatId: string, messageId: string) => void;

  // Generation (transient — one generation at a time)
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;

  // Input
  inputValue: string;
  setInputValue: (v: string) => void;

  // Memories
  memories: Memory[];

  // Lorebooks
  lorebooks: Lorebook[];
  addLorebook: (name: string) => string;
  updateLorebook: (id: string, updates: Partial<Pick<Lorebook, "name" | "description">>) => void;
  deleteLorebook: (id: string) => void;
  addLoreEntry: (lorebookId: string, entry: Omit<LoreEntry, "id" | "lorebookId">) => string;
  updateLoreEntry: (lorebookId: string, entryId: string, updates: Partial<Omit<LoreEntry, "id" | "lorebookId">>) => void;
  deleteLoreEntry: (lorebookId: string, entryId: string) => void;

  // Image Jobs
  imageJobs: ImageJob[];
  addImageJob: (job: ImageJob) => void;
  updateImageJob: (id: string, updates: Partial<ImageJob>) => void;

  // Image Settings (Image Studio panel)
  imageSettings: ImageGenerationSettings;
  setImageSettings: (s: Partial<ImageGenerationSettings>) => void;

  // Custom model IDs the user typed in (e.g. an OpenRouter slug that isn't in
  // the fetched catalogue). Merged into the model selector.
  customModels: ModelInfo[];
  addCustomModel: (model: ModelInfo) => void;
  removeCustomModel: (id: string) => void;

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
  /** Error from the most recent extraction / core-memory refresh, or null */
  lastExtractionError: string | null;
  setLastExtractionError: (e: string | null) => void;
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

      addCharacter: (data) => {
        // Readable slug id — doubles as the Drawer 2 entity id
        const base =
          data.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
          "character";
        const taken = (i: string) => get().characters.some((c) => c.id === i);
        let id = `char-${base}`;
        for (let n = 2; taken(id); n++) id = `char-${base}-${n}`;

        const now = new Date().toISOString();
        const character: Character = { ...data, id, createdAt: now, updatedAt: now };
        set((s) => ({ characters: [...s.characters, character] }));
        return id;
      },

      updateCharacter: (id, updates) => {
        set((s) => ({
          characters: s.characters.map((c) =>
            c.id === id ? { ...c, ...updates, id, updatedAt: new Date().toISOString() } : c
          ),
        }));
      },

      deleteCharacter: (id) => {
        set((s) => ({ characters: s.characters.filter((c) => c.id !== id) }));
      },

      personas: [],
      activePersonaId: null,
      setActivePersona: (id) => set({ activePersonaId: id }),

      addPersona: (data) => {
        const base =
          data.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
          "persona";
        const taken = (i: string) => get().personas.some((p) => p.id === i);
        let id = `persona-${base}`;
        for (let n = 2; taken(id); n++) id = `persona-${base}-${n}`;

        const now = new Date().toISOString();
        const persona: Persona = { ...data, id, createdAt: now, updatedAt: now };
        set((s) => ({
          personas: [...s.personas, persona],
          // First persona becomes active automatically
          activePersonaId: s.activePersonaId ?? id,
        }));
        return id;
      },

      updatePersona: (id, updates) => {
        set((s) => ({
          personas: s.personas.map((p) =>
            p.id === id ? { ...p, ...updates, id, updatedAt: new Date().toISOString() } : p
          ),
        }));
      },

      deletePersona: (id) => {
        set((s) => ({
          personas: s.personas.filter((p) => p.id !== id),
          activePersonaId: s.activePersonaId === id ? null : s.activePersonaId,
        }));
      },

      characterEditorOpen:  false,
      characterEditorId:    null,
      characterEditorDraft: null,
      openCharacterEditor: (id = null, draft = null) =>
        set({ characterEditorOpen: true, characterEditorId: id, characterEditorDraft: draft }),
      closeCharacterEditor: () =>
        set({ characterEditorOpen: false, characterEditorId: null, characterEditorDraft: null }),

      chats: PLACEHOLDER_CHATS,
      activeChatId: "chat-1",
      setActiveChatId: (id) => set({ activeChatId: id }),

      hydrateFromServer: (characters, chats, personas, lorebooks) => {
        set((s) => ({
          characters,
          chats,
          personas,
          // Lorebooks joined the durable mirror later than the rest — an
          // empty server list may just mean "never synced yet", so keep the
          // local copy in that case and let the next save push it up.
          lorebooks: lorebooks && lorebooks.length > 0 ? lorebooks : s.lorebooks,
          activeChatId: chats.some((c) => c.id === s.activeChatId)
            ? s.activeChatId
            : chats[0]?.id ?? null,
          activePersonaId: personas.some((p) => p.id === s.activePersonaId)
            ? s.activePersonaId
            : personas[0]?.id ?? null,
        }));
      },

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

      setMessageMemoryTrace: (chatId, messageId, trace) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, memoryTrace: trace } : m
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

      setChatContext: (chatId, contextUsed, contextMax) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId ? { ...c, contextUsed, contextMax } : c
          ),
        }));
      },

      updateChatSettings: (chatId, settings) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId ? { ...c, settings: { ...c.settings, ...settings } } : c
          ),
        }));
      },

      createChat: (characterId) => {
        const id = `chat-${Date.now()}`;
        const character = get().characters.find((c) => c.id === characterId);

        // Seed with the character's greeting so the scene opens in-fiction
        const messages: Message[] = [];
        if (character?.firstMessage?.trim()) {
          messages.push({
            id:          `msg-${Date.now()}-first`,
            chatId:      id,
            role:        "assistant",
            content:     character.firstMessage,
            characterId: character.id,
            timestamp:   new Date().toISOString(),
          });
        }

        const newChat: Chat = {
          id,
          name: character ? `Chat with ${character.name}` : "New Chat",
          characterId,
          messages,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          contextUsed: 0,
          contextMax: 8192,
        };
        set((state) => ({ chats: [newChat, ...state.chats], activeChatId: id }));
        return id;
      },

      deleteChat: (chatId) => {
        set((state) => {
          const chats = state.chats.filter((c) => c.id !== chatId);
          return {
            chats,
            activeChatId:
              state.activeChatId === chatId ? chats[0]?.id ?? null : state.activeChatId,
          };
        });
      },

      renameChat: (chatId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          chats: state.chats.map((c) => (c.id === chatId ? { ...c, name: trimmed } : c)),
        }));
      },

      clearChat: (chatId) => {
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id !== chatId) return c;
            const character = state.characters.find((ch) => ch.id === c.characterId);
            const messages: Message[] = character?.firstMessage?.trim()
              ? [{
                  id:          `msg-${Date.now()}-first`,
                  chatId,
                  role:        "assistant",
                  content:     character.firstMessage,
                  characterId: character.id,
                  timestamp:   new Date().toISOString(),
                }]
              : [];
            return { ...c, messages, contextUsed: 0, updatedAt: new Date().toISOString() };
          }),
        }));
      },

      removeMessage: (chatId, messageId) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: c.messages.filter((m) => m.id !== messageId) }
              : c
          ),
        }));
      },

      isGenerating: false,
      setIsGenerating: (v) => set({ isGenerating: v }),

      inputValue: "",
      setInputValue: (v) => set({ inputValue: v }),

      memories: PLACEHOLDER_MEMORIES,

      lorebooks: [PLACEHOLDER_LORE],
      addLorebook: (name) => {
        const id = `lb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const book: Lorebook = { id, name, entries: [], createdAt: new Date().toISOString() };
        set((s) => ({ lorebooks: [...s.lorebooks, book] }));
        return id;
      },
      updateLorebook: (id, updates) =>
        set((s) => ({
          lorebooks: s.lorebooks.map((b) => (b.id === id ? { ...b, ...updates } : b)),
        })),
      deleteLorebook: (id) =>
        set((s) => ({ lorebooks: s.lorebooks.filter((b) => b.id !== id) })),
      addLoreEntry: (lorebookId, entry) => {
        const id = `le-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const full: LoreEntry = { ...entry, id, lorebookId };
        set((s) => ({
          lorebooks: s.lorebooks.map((b) =>
            b.id === lorebookId ? { ...b, entries: [...b.entries, full] } : b
          ),
        }));
        return id;
      },
      updateLoreEntry: (lorebookId, entryId, updates) =>
        set((s) => ({
          lorebooks: s.lorebooks.map((b) =>
            b.id === lorebookId
              ? { ...b, entries: b.entries.map((e) => (e.id === entryId ? { ...e, ...updates } : e)) }
              : b
          ),
        })),
      deleteLoreEntry: (lorebookId, entryId) =>
        set((s) => ({
          lorebooks: s.lorebooks.map((b) =>
            b.id === lorebookId
              ? { ...b, entries: b.entries.filter((e) => e.id !== entryId) }
              : b
          ),
        })),

      imageJobs: [],
      addImageJob: (job) => set((s) => ({ imageJobs: [job, ...s.imageJobs] })),
      updateImageJob: (id, updates) =>
        set((s) => ({ imageJobs: s.imageJobs.map((j) => (j.id === id ? { ...j, ...updates } : j)) })),

      imageSettings: defaultImageSettings,
      setImageSettings: (s) =>
        set((state) => ({ imageSettings: { ...state.imageSettings, ...s } })),

      customModels: [],
      addCustomModel: (model) =>
        set((s) => ({
          customModels: s.customModels.some((m) => m.id === model.id)
            ? s.customModels
            : [...s.customModels, model],
        })),
      removeCustomModel: (id) =>
        set((s) => ({ customModels: s.customModels.filter((m) => m.id !== id) })),

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
      lastExtractionError:    null,
      setLastExtractionError: (e) => set({ lastExtractionError: e }),
    }),
    {
      name: "fablechat-store",
      // Only persist settings, not transient UI state
      partialize: (state) => ({
        providerSettings: state.providerSettings,
        characters: state.characters,
        chats: state.chats,
        personas: state.personas,
        activePersonaId: state.activePersonaId,
        customModels: state.customModels,
        lorebooks: state.lorebooks,
        imageJobs: state.imageJobs,
      }),
      // The polling loop that drives queued/generating jobs dies with the
      // page, so anything still in-flight after a reload can never finish —
      // mark it failed instead of spinning forever.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.imageJobs = state.imageJobs.map((j) =>
          j.status === "queued" || j.status === "generating" || j.status === "pending"
            ? { ...j, status: "failed" as const, error: "Interrupted by page reload" }
            : j
        );
      },
    }
  )
);
