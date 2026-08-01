import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Character,
  Chat,
  GenerationParams,
  Message,
  MemoryTrace,
  Lorebook,
  LoreEntry,
  ImageJob,
  ImageGenerationSettings,
  ModelInfo,
  Persona,
  Scenario,
  ProviderSettings,
  ProviderStatus,
  ProviderId,
  AspectRatio,
} from "@/lib/types";

// ─── Utility model ────────────────────────────────────────────────────────────
// Local Ollama model for background tasks that must never hit a cloud
// moderation layer — the /image scene director in particular. Read via
// `providerSettings.ollama.utilityModel ?? DEFAULT_UTILITY_MODEL` because
// persisted settings from before this field exist without it.
export const DEFAULT_UTILITY_MODEL =
  "hf.co/DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF:Q6_K";

// ─── Sidebar Navigation ───────────────────────────────────────────────────────

export type SidebarSection =
  | "characters"
  | "chats"
  | "groups"
  | "lorebooks"
  | "scenarios"
  | "presets"
  | "image-studio"
  | "gallery"
  | "workflows"
  | "extensions"
  | "settings";

// ─── Inspector Panel ──────────────────────────────────────────────────────────

// "summary" was removed (duplicated Memory + Core Mem); persisted selections
// of it fall back to "character" in InspectorPanel.
export type InspectorTab = "character" | "memory" | "graph" | "lore" | "image-studio" | "core-memory";

// ─── Default Image Settings ───────────────────────────────────────────────────

// Defaults match the Krea2 Turbo pipeline (the workflow whose models are
// actually installed on this machine): 8 steps, CFG 1, euler/simple.
const defaultImageSettings: ImageGenerationSettings = {
  provider: "comfyui",
  workflow: "krea2-lora-pipeline",
  prompt: "",
  negativePrompt: "blurry, deformed, low quality, watermark",
  aspectRatio: "1:1" as AspectRatio,
  // 1225×1225 ≈ 1.5MP — the Krea2 v5 pipeline's speed/quality sweet spot
  width: 1225,
  height: 1225,
  steps: 8,
  cfg: 1,
  sampler: "euler",
  seed: -1,
  batchCount: 1,
  loras: [],
};

// ─── Empty defaults ───────────────────────────────────────────────────────────
// The app used to seed demo characters, a written-out sample chat and a
// "Neon City Lore" book. They were indistinguishable from real content, and
// the seeded lore actually injected into live prompts. A fresh install now
// starts genuinely empty; every section has an empty state that explains what
// to create first.

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

  // Scenarios — saved scene setups picked in the chat builder
  scenarios: Scenario[];
  addScenario: (data: Omit<Scenario, "id" | "createdAt" | "updatedAt">) => string;
  updateScenario: (id: string, updates: Partial<Omit<Scenario, "id" | "createdAt">>) => void;
  deleteScenario: (id: string) => void;

  // New-chat builder dialog
  chatBuilderOpen: boolean;
  setChatBuilderOpen: (v: boolean) => void;

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
  /** Replace characters + chats + personas + lorebooks + scenarios with the durable SQLite copy (on app load) */
  hydrateFromServer: (characters: Character[], chats: Chat[], personas: Persona[], lorebooks?: Lorebook[], scenarios?: Scenario[]) => void;
  /** Adds a message and returns its generated ID */
  addMessage: (chatId: string, message: Omit<Message, "id" | "timestamp">) => string;
  /** Insert a message directly after another (per-message image generation) */
  insertMessageAfter: (chatId: string, afterMessageId: string, message: Omit<Message, "id" | "timestamp">) => string;
  /** Thumbs up/down on a reply; passing the current rating clears it */
  rateMessage: (chatId: string, messageId: string, rating: "up" | "down" | undefined) => void;
  /** Stream partial assistant content into an existing message */
  updateMessageContent: (chatId: string, messageId: string, content: string) => void;
  /** Record which memory shaped a reply (provenance for the memory inspector) */
  setMessageMemoryTrace: (chatId: string, messageId: string, trace: MemoryTrace) => void;
  /** Flag a message as a provider-failure notice (excluded from prompts) */
  markMessageError: (chatId: string, messageId: string) => void;
  /** Repoint an image-card message at a new job (retry / re-roll) */
  setMessageImageJob: (chatId: string, messageId: string, jobId: string) => void;
  /** Collapse / expand an image card in the transcript */
  toggleMessageCollapsed: (chatId: string, messageId: string) => void;
  /** Update which model / provider a chat uses */
  setChatModel: (chatId: string, modelId: string, providerId: string) => void;
  /** Choose which lorebooks (worlds) apply to a chat; undefined = all */
  setChatLorebooks: (chatId: string, lorebookIds: string[] | undefined) => void;
  /** Update the real token accounting shown by the header context meter */
  setChatContext: (chatId: string, contextUsed: number, contextMax: number) => void;
  /** Merge per-chat generation settings (temperature, maxTokens, topP…) */
  updateChatSettings: (chatId: string, settings: Partial<GenerationParams>) => void;
  createChat: (characterId?: string) => string;
  /** Chat-builder create: character + persona + worlds + scenario override in one shot */
  createChatFromBuilder: (config: {
    characterId: string;
    personaId?: string | null;
    /** undefined = all worlds */
    lorebookIds?: string[];
    /** Overrides the character sheet's scenario text in the prompt */
    scenarioText?: string;
    /** Overrides the character's greeting */
    firstMessage?: string;
    name?: string;
  }) => string;
  /** Group chat with 2+ characters; returns null if fewer than 2 resolve */
  createGroupChat: (characterIds: string[]) => string | null;
  /** Toggle a group member in/out of the scene (absent = silent + unwitnessing) */
  toggleMemberPresence: (chatId: string, characterId: string) => void;
  /** Which group member the inspector panel is examining */
  inspectorMemberId: string | null;
  setInspectorMemberId: (id: string | null) => void;
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
  /**
   * Delete renders and the image cards that referenced them. Dropping the job
   * alone would leave a card in the chat with nothing behind it, so the two
   * always go together. Conversation text is never touched — image cards carry
   * no dialogue, only the prompt.
   */
  deleteRenders: (jobIds: string[]) => void;

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

      characters: [],

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

      scenarios: [],
      addScenario: (data) => {
        const id = `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date().toISOString();
        set((s) => ({ scenarios: [...s.scenarios, { ...data, id, createdAt: now, updatedAt: now }] }));
        return id;
      },
      updateScenario: (id, updates) => {
        set((s) => ({
          scenarios: s.scenarios.map((sc) =>
            sc.id === id ? { ...sc, ...updates, id, updatedAt: new Date().toISOString() } : sc
          ),
        }));
      },
      deleteScenario: (id) => {
        set((s) => ({ scenarios: s.scenarios.filter((sc) => sc.id !== id) }));
      },

      chatBuilderOpen: false,
      setChatBuilderOpen: (v) => set({ chatBuilderOpen: v }),

      characterEditorOpen:  false,
      characterEditorId:    null,
      characterEditorDraft: null,
      openCharacterEditor: (id = null, draft = null) =>
        set({ characterEditorOpen: true, characterEditorId: id, characterEditorDraft: draft }),
      closeCharacterEditor: () =>
        set({ characterEditorOpen: false, characterEditorId: null, characterEditorDraft: null }),

      chats: [],
      activeChatId: null,
      setActiveChatId: (id) => set({ activeChatId: id }),

      hydrateFromServer: (characters, chats, personas, lorebooks, scenarios) => {
        set((s) => ({
          characters,
          chats,
          personas,
          // Server wins for lorebooks too: keeping the local copy when the
          // server list was empty resurrected deliberately-deleted books
          // (the localStorage seed re-pushed them after a cache clear).
          lorebooks: lorebooks ?? s.lorebooks,
          scenarios: scenarios ?? s.scenarios,
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

      insertMessageAfter: (chatId, afterMessageId, msg) => {
        const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const message: Message = {
          ...msg,
          id,
          timestamp: new Date().toISOString(),
        };
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id !== chatId) return c;
            const idx = c.messages.findIndex((m) => m.id === afterMessageId);
            const messages =
              idx === -1
                ? [...c.messages, message]
                : [...c.messages.slice(0, idx + 1), message, ...c.messages.slice(idx + 1)];
            return { ...c, messages, updatedAt: new Date().toISOString() };
          }),
        }));
        return id;
      },

      rateMessage: (chatId, messageId, rating) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id !== messageId) return m;
                    if (rating === undefined) {
                      const rest = { ...m };
                      delete rest.rating;
                      return rest;
                    }
                    return { ...m, rating };
                  }),
                }
              : c
          ),
        }));
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
          chats: state.chats.map((c) => {
            if (c.id !== chatId) return c;
            // Traces duplicate the injected memory strings per message; keep
            // them only on the most recent assistant replies or long chats
            // blow the localStorage quota and bloat every state sync.
            const KEEP_TRACES = 20;
            const assistantIds = c.messages
              .filter((m) => m.role === "assistant" && (m.memoryTrace || m.id === messageId))
              .map((m) => m.id);
            const dropBefore = new Set(assistantIds.slice(0, Math.max(0, assistantIds.length - KEEP_TRACES)));
            return {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id === messageId) return { ...m, memoryTrace: trace };
                if (dropBefore.has(m.id) && m.memoryTrace) {
                  const rest = { ...m };
                  delete rest.memoryTrace;
                  return rest;
                }
                return m;
              }),
            };
          }),
        }));
      },

      markMessageError: (chatId, messageId) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, error: true } : m
                  ),
                }
              : c
          ),
        }));
      },

      setMessageImageJob: (chatId, messageId, jobId) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, imageJobId: jobId } : m
                  ),
                }
              : c
          ),
        }));
      },

      toggleMessageCollapsed: (chatId, messageId) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, collapsed: !m.collapsed } : m
                  ),
                }
              : c
          ),
        }));
      },

      setChatLorebooks: (chatId, lorebookIds) => {
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id !== chatId) return c;
            if (lorebookIds === undefined) {
              const rest = { ...c };
              delete rest.lorebookIds;
              return rest;
            }
            return { ...c, lorebookIds };
          }),
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

      createChatFromBuilder: ({ characterId, personaId, lorebookIds, scenarioText, firstMessage, name }) => {
        const id = `chat-${Date.now()}`;
        const character = get().characters.find((c) => c.id === characterId);

        // Scenario override wins; otherwise the character's own greeting
        const opening = (firstMessage ?? character?.firstMessage)?.trim();
        const messages: Message[] = opening
          ? [{
              id:          `msg-${Date.now()}-first`,
              chatId:      id,
              role:        "assistant",
              content:     opening,
              characterId: character?.id,
              timestamp:   new Date().toISOString(),
            }]
          : [];

        const newChat: Chat = {
          id,
          name: name?.trim() || (character ? `Chat with ${character.name}` : "New Chat"),
          characterId,
          messages,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          contextUsed: 0,
          contextMax: 8192,
          ...(lorebookIds !== undefined ? { lorebookIds } : {}),
          ...(scenarioText?.trim() ? { scenarioText: scenarioText.trim() } : {}),
        };
        set((state) => ({
          chats: [newChat, ...state.chats],
          activeChatId: id,
          ...(personaId !== undefined ? { activePersonaId: personaId } : {}),
        }));
        return id;
      },

      createGroupChat: (characterIds) => {
        const id = `chat-${Date.now()}`;
        const members = characterIds
          .map((cid) => get().characters.find((c) => c.id === cid))
          .filter((c): c is Character => !!c);
        if (members.length < 2) return null;

        // Open with the first member's greeting if they have one — the rest
        // join the scene through conversation.
        const messages: Message[] = [];
        if (members[0].firstMessage?.trim()) {
          messages.push({
            id:          `msg-${Date.now()}-first`,
            chatId:      id,
            role:        "assistant",
            content:     members[0].firstMessage,
            characterId: members[0].id,
            timestamp:   new Date().toISOString(),
          });
        }

        const newChat: Chat = {
          id,
          name: members.map((c) => c.name).join(" & "),
          characterId: members[0].id,
          memberIds:   members.map((c) => c.id),
          absentIds:   [],
          messages,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          contextUsed: 0,
          contextMax: 8192,
        };
        set((state) => ({ chats: [newChat, ...state.chats], activeChatId: id }));
        return id;
      },

      inspectorMemberId: null,
      setInspectorMemberId: (id) => set({ inspectorMemberId: id }),

      toggleMemberPresence: (chatId, characterId) => {
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id !== chatId || !c.memberIds?.includes(characterId)) return c;
            const absent = new Set(c.absentIds ?? []);
            if (absent.has(characterId)) absent.delete(characterId);
            else if (absent.size < c.memberIds.length - 1) absent.add(characterId); // never empty the scene
            return { ...c, absentIds: [...absent] };
          }),
        }));
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
          chats: state.chats.map((c) =>
            c.id === chatId ? { ...c, name: trimmed, updatedAt: new Date().toISOString() } : c
          ),
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

      lorebooks: [],
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

      deleteRenders: (jobIds) => {
        const doomed = new Set(jobIds);
        if (doomed.size === 0) return;
        set((s) => ({
          imageJobs: s.imageJobs.filter((j) => !doomed.has(j.id)),
          chats: s.chats.map((c) => {
            const kept = c.messages.filter((m) => !m.imageJobId || !doomed.has(m.imageJobId));
            return kept.length === c.messages.length ? c : { ...c, messages: kept };
          }),
        }));
      },

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
        ollama: { baseUrl: "http://127.0.0.1:11434", enabled: true, utilityModel: DEFAULT_UTILITY_MODEL },
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
        scenarios: state.scenarios,
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
