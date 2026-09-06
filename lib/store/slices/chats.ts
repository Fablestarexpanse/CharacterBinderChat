// ─── Chats and their messages, plus the one-at-a-time generation flag. ──────────
// Chats and their messages, plus the one-at-a-time generation flag.

import type { StateCreator } from "zustand";
import type { FableStore } from "../index";
import type {
  Character, Chat, GenerationParams, MemoryTrace, Message, PersistedAppState, ProviderId,
} from "@/lib/types";

export interface ChatsSlice {
  // Chats
  chats: Chat[];
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  /** Replace the local collections with the durable SQLite copy (on app load).
   *  Object-shaped: the positional list had grown past readability. */
  hydrateFromServer: (data: PersistedAppState) => void;
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
  setChatModel: (chatId: string, modelId: string, providerId: ProviderId) => void;
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
  deleteChat: (chatId: string) => void;
  renameChat: (chatId: string, name: string) => void;
  /** Wipe messages (re-seeds the character's greeting if they have one) */
  clearChat: (chatId: string) => void;
  removeMessage: (chatId: string, messageId: string) => void;

  // Generation (transient — one generation at a time)
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
}

/**
 * Replace one message inside one chat, leaving every other object identity
 * alone — four actions differed only in the patch they applied.
 */
function patchMessage(
  state: { chats: Chat[] },
  chatId: string,
  messageId: string,
  patch: (m: Message) => Message
): { chats: Chat[] } {
  return {
    chats: state.chats.map((c) =>
      c.id !== chatId
        ? c
        : { ...c, messages: c.messages.map((m) => (m.id === messageId ? patch(m) : m)) }
    ),
  };
}

export const createChatsSlice: StateCreator<FableStore, [], [], ChatsSlice> = (set, get) => ({
  chats: [],
  activeChatId: null,
  setActiveChatId: (id) => set({ activeChatId: id }),

  hydrateFromServer: ({
    characters, chats, personas, lorebooks, scenarios,
    presets, defaultPresetId, globalInstructions,
  }) => {
    set((s) => ({
      characters,
      chats,
      personas,
      // Server wins for lorebooks too: keeping the local copy when the
      // server list was empty resurrected deliberately-deleted books
      // (the localStorage seed re-pushed them after a cache clear).
      lorebooks: lorebooks ?? s.lorebooks,
      scenarios: scenarios ?? s.scenarios,
      presets: presets ?? s.presets,
      defaultPresetId: defaultPresetId !== undefined ? defaultPresetId : s.defaultPresetId,
      globalInstructions: globalInstructions ?? s.globalInstructions,
      // null means "show the chat list". Only keep an active chat if it
      // still exists; don't invent one, or the app would always open into
      // an arbitrary conversation instead of letting you pick.
      activeChatId: s.activeChatId && chats.some((c) => c.id === s.activeChatId)
        ? s.activeChatId
        : null,
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

  rateMessage: (chatId, messageId, rating) =>
    set((s) => patchMessage(s, chatId, messageId, (m) => {
      // Passing the current rating clears it, and clearing means removing the
      // key rather than storing undefined — the message is persisted as JSON.
      if (rating !== undefined) return { ...m, rating };
      const rest = { ...m };
      delete rest.rating;
      return rest;
    })),

  updateMessageContent: (chatId, messageId, content) =>
    set((s) => patchMessage(s, chatId, messageId, (m) => ({ ...m, content }))),

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

  markMessageError: (chatId, messageId) =>
    set((s) => patchMessage(s, chatId, messageId, (m) => ({ ...m, error: true }))),

  setMessageImageJob: (chatId, messageId, jobId) =>
    set((s) => patchMessage(s, chatId, messageId, (m) => ({ ...m, imageJobId: jobId }))),

  toggleMessageCollapsed: (chatId, messageId) =>
    set((s) => patchMessage(s, chatId, messageId, (m) => ({ ...m, collapsed: !m.collapsed }))),

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
});
