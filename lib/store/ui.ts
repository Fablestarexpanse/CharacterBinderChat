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

  // Inspector
  inspectorTab: InspectorTab;
  setInspectorTab: (t: InspectorTab) => void;
  inspectorOpen: boolean;
  setInspectorOpen: (v: boolean) => void;
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

  // Changes made by something other than this tab (an agent, another device)
  remoteNotices: RemoteNotice[];
  pushRemoteNotices: (notices: Array<Omit<RemoteNotice, "key">>) => void;
  dismissRemoteNotice: (key: number) => void;

  // Composer
  inputValue: string;
  setInputValue: (v: string) => void;
}

export const useUiStore = create<UiStore>()((set) => ({
  activeSection: "chats",
  setActiveSection: (s) => set({ activeSection: s }),

  inspectorTab: "character",
  setInspectorTab: (t) => set({ inspectorTab: t }),
  inspectorOpen: true,
  setInspectorOpen: (v) => set({ inspectorOpen: v }),
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

  remoteNotices: [],
  pushRemoteNotices: (notices) =>
    set((s) => ({
      // Capped: a burst of agent writes must not bury the page in banners
      remoteNotices: [...s.remoteNotices, ...notices.map((n) => ({ ...n, key: ++noticeKey }))].slice(-5),
    })),
  dismissRemoteNotice: (key) => set((s) => ({ remoteNotices: s.remoteNotices.filter((n) => n.key !== key) })),

  inputValue: "",
  setInputValue: (v) => set({ inputValue: v }),
}));
