// ─── Lorebooks and their keyword-triggered entries. ─────────────────────────────
// Lorebooks and their keyword-triggered entries.

import type { StateCreator } from "zustand";
import type { FableStore } from "../index";
import type {
  Lorebook, LoreEntry,
} from "@/lib/types";

export interface LoreSlice {
  // Lorebooks
  lorebooks: Lorebook[];
  addLorebook: (name: string) => string;
  updateLorebook: (id: string, updates: Partial<Pick<Lorebook, "name" | "description">>) => void;
  deleteLorebook: (id: string) => void;
  addLoreEntry: (lorebookId: string, entry: Omit<LoreEntry, "id" | "lorebookId">) => string;
  updateLoreEntry: (lorebookId: string, entryId: string, updates: Partial<Omit<LoreEntry, "id" | "lorebookId">>) => void;
  deleteLoreEntry: (lorebookId: string, entryId: string) => void;
}

export const createLoreSlice: StateCreator<FableStore, [], [], LoreSlice> = (set) => ({
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
});
