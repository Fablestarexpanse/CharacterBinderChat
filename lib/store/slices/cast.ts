// ─── Characters, personas and scenarios ─────────────────────────────────────────
// Characters, personas and scenarios — the people and the setups they play in.

import type { StateCreator } from "zustand";
import { uniqueSlugId } from "../defaults";
import type { FableStore } from "../index";
import type {
  Character, Persona, Scenario,
} from "@/lib/types";

export interface CastSlice {
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
}

export const createCastSlice: StateCreator<FableStore, [], [], CastSlice> = (set, get) => ({
  characters: [],

  addCharacter: (data) => {
    const id = uniqueSlugId("char", data.name, (i) => get().characters.some((c) => c.id === i));

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
    const id = uniqueSlugId("persona", data.name, (i) => get().personas.some((p) => p.id === i));

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

  // ── Presets ─────────────────────────────────────────────────────────
});
