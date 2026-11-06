"use client";

// ─── UI state ─────────────────────────────────────────────────────────────────
// Which section is showing, which dialog is open, what is half-typed in the
// composer. None of it is persisted or synced: it describes this tab right now.
//
// Kept out of useFableStore so that store is exactly the durable domain state
// (see PersistedAppState). While the two were mixed, `partialize` and
// StateSync's diff had to be hand-maintained lists of what NOT to save.

import { create } from "zustand";
import type { Character } from "@/lib/types";
import type { SidebarSection, InspectorTab } from "./index";

/** A phone call in progress (lib/chat/calls.ts); null when there is none */
export interface CallState {
  chatId: string;
  characterId: string;
  /** incoming: ringing for you · calling: you rang, not picked up yet · connected: talking */
  phase: "incoming" | "calling" | "connected";
  /** When the call connected (ms), for the timer and the length logged at the end */
  connectedAt?: number;
  /** Why they are calling (incoming calls only) */
  outreach?: import("@/lib/chat/generation").OutreachRequest;
}

/** Settings is split into tabs so nothing needs a long scroll to find. */
export const SETTINGS_TABS = [
  { id: "appearance", label: "Appearance" },
  { id: "models", label: "Chat models" },
  { id: "memory", label: "Memory" },
  { id: "media", label: "Media" },
  { id: "contact", label: "Contact" },
  { id: "prompts", label: "Prompts" },
  { id: "data", label: "Data & backup" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

/** Something changed outside this tab. `historyId` is set when it can be undone. */
export interface RemoteNotice {
  key: number;
  text: string;
  historyId: number | null;
  /** "lost": the tab's own unsaved edit was replaced, which deserves more weight than an FYI */
  kind: "info" | "lost";
}

let noticeKey = 0;

interface UiStore {
  // Navigation
  activeSection: SidebarSection;
  setActiveSection: (s: SidebarSection) => void;

  /**
   * Narrow screens: the sidebar drawer is open for this place (`section|chatId`).
   * Keyed rather than a boolean so that navigating anywhere closes it with no
   * effect needed: the key no longer matches, so it is not shown.
   */
  navOpenAt: string | null;
  setNavOpenAt: (at: string | null) => void;

  // Inspector
  inspectorTab: InspectorTab;
  setInspectorTab: (t: InspectorTab) => void;
  inspectorOpen: boolean;
  setInspectorOpen: (v: boolean) => void;
  /** Narrow screens show the inspector as a sheet over the chat, closed until asked for */
  inspectorSheetOpen: boolean;
  setInspectorSheetOpen: (v: boolean) => void;
  /** Which group member the inspector panel is examining */
  inspectorMemberId: string | null;
  setInspectorMemberId: (id: string | null) => void;

  // New-chat builder dialog
  chatBuilderOpen: boolean;
  setChatBuilderOpen: (v: boolean) => void;

  // Character editor dialog (global — opened from the Library or the inspector)
  characterEditorOpen: boolean;
  /** id of the character being edited, or null when creating a new one */
  characterEditorId: string | null;
  /** Prefill values for create mode (e.g. from an imported character card) */
  characterEditorDraft: Partial<Character> | null;
  openCharacterEditor: (id?: string | null, draft?: Partial<Character> | null) => void;
  closeCharacterEditor: () => void;

  // A card the Library asked another screen to open (expand and scroll to)
  focusCardId: string | null;
  setFocusCardId: (id: string | null) => void;

  call: CallState | null;
  setCall: (call: CallState | null) => void;

  /** The Settings tab showing; set it before opening Settings to land on one (`setSettingsTab("contact")`) */
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;

  // Changes made by something other than this tab (an agent, another device)
  remoteNotices: RemoteNotice[];
  pushRemoteNotices: (notices: Array<Omit<RemoteNotice, "key">>) => void;
  dismissRemoteNotice: (key: number) => void;

  // Voice
  /** The reply being spoken: its audio is being made, or it is playing (lib/chat/speech.ts) */
  speaking: { messageId: string; phase: "making" | "playing" } | null;
  setSpeaking: (s: { messageId: string; phase: "making" | "playing" } | null) => void;

  // Composer
  /** A picture you sent is uploading or being read: the reply waits for it, so nothing else may answer first */
  sendingPicture: boolean;
  setSendingPicture: (on: boolean) => void;
  /** Chats with messages a character sent on their own while you were elsewhere */
  unreadChats: Record<string, number>;
  markUnread: (chatId: string) => void;
  clearUnread: (chatId: string) => void;
  /** Chats whose composer sends texts (phone messages in the story) rather than in-person lines */
  textModeChats: Record<string, boolean>;
  setTextMode: (chatId: string, on: boolean) => void;
  inputValue: string;
  setInputValue: (v: string) => void;
}

export const useUiStore = create<UiStore>()((set) => ({
  activeSection: "chats",
  setActiveSection: (s) => set({ activeSection: s }),
  navOpenAt: null,
  setNavOpenAt: (at) => set({ navOpenAt: at }),

  inspectorTab: "character",
  setInspectorTab: (t) => set({ inspectorTab: t }),
  inspectorOpen: true,
  setInspectorOpen: (v) => set({ inspectorOpen: v }),
  inspectorSheetOpen: false,
  setInspectorSheetOpen: (v) => set({ inspectorSheetOpen: v }),
  inspectorMemberId: null,
  setInspectorMemberId: (id) => set({ inspectorMemberId: id }),

  chatBuilderOpen: false,
  setChatBuilderOpen: (v) => set({ chatBuilderOpen: v }),

  characterEditorOpen:  false,
  characterEditorId:    null,
  characterEditorDraft: null,
  openCharacterEditor: (id = null, draft = null) =>
    set({ characterEditorOpen: true, characterEditorId: id, characterEditorDraft: draft }),
  closeCharacterEditor: () =>
    set({ characterEditorOpen: false, characterEditorId: null, characterEditorDraft: null }),

  focusCardId: null,
  setFocusCardId: (id) => set({ focusCardId: id }),

  call: null,
  setCall: (call) => set({ call }),

  settingsTab: "appearance",
  setSettingsTab: (tab) => set({ settingsTab: tab }),

  remoteNotices: [],
  pushRemoteNotices: (notices) =>
    set((s) => ({
      // Capped: a burst of agent writes must not bury the page in banners
      remoteNotices: [...s.remoteNotices, ...notices.map((n) => ({ ...n, key: ++noticeKey }))].slice(-5),
    })),
  dismissRemoteNotice: (key) => set((s) => ({ remoteNotices: s.remoteNotices.filter((n) => n.key !== key) })),

  speaking: null,
  setSpeaking: (speaking) => set({ speaking }),

  sendingPicture: false,
  setSendingPicture: (on) => set({ sendingPicture: on }),

  unreadChats: {},

  markUnread: (chatId) => set((s) => ({ unreadChats: { ...s.unreadChats, [chatId]: (s.unreadChats[chatId] ?? 0) + 1 } })),

  clearUnread: (chatId) => set((s) => { if (!s.unreadChats[chatId]) return s; const next = { ...s.unreadChats }; delete next[chatId]; return { unreadChats: next }; }),

  textModeChats: {},

  setTextMode: (chatId, on) => set((s) => ({ textModeChats: { ...s.textModeChats, [chatId]: on } })),

  inputValue: "",
  setInputValue: (v) => set({ inputValue: v }),
}));
