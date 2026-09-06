// ─── Wire shapes ──────────────────────────────────────────────────────────────
// What the routes return, declared where both sides can import it.
//
// These were hand-typed twice — once in the handler, once in each view that
// rendered it — which is how /api/drawer/stats came to be described three
// different ways. Types only: this file is safe on both runtimes, so a
// component no longer has to reach into app/api/**/route.ts for a contract.

import type { CoreMemory, StatName, EntityType, CommitmentStatus } from "@/lib/db/models";

/** GET /api/chat/core-memory */
export interface CoreMemoryGetResponse {
  coreMemory:     CoreMemory;
  version:        number;
  updatedAt:      number;
  knownFacts:     string[];
  episodes:       string[];
  insights:       string[];
  sharedLanguage: string[];
}

/** One row of GET /api/drawer/stats — null when the stat has never been set. */
export interface DrawerStat {
  name:        StatName;
  value:       number | null;
  decayRate:   number | null;
  lastUpdated: number | null;
}

/** GET /api/drawer/facts — a fact with its object already rendered for display. */
export interface DrawerFact {
  id:            number;
  predicate:     string;
  objectDisplay: string;
  confidence:    number;
  tValidStart:   number;
  tValidEnd:     number | null;
  supersededBy:  number | null;
}

/** GET /api/workflows — one ComfyUI template in the workflows/ directory. */
export interface WorkflowSummary {
  slug:        string;
  title:       string;
  description: string | null;
  nodeCount:   number;
  /** Settings FableChat can drive on this template (from _meta.fablechat) */
  controls:    string[];
  /** Sampler defaults, when the template exposes a KSampler */
  steps:       number | null;
  cfg:         number | null;
  /** Set when the template file could not be read or parsed */
  error?:      string;
}

/** GET /api/drawer/graph — the story web. */
export interface GraphEntity {
  id: string; name: string; type: EntityType; kind: "entity";
  isCharacter: boolean; isPlayer: boolean;
}
export interface GraphCard {
  id: string; name: string; content: string;
  kind: "episode" | "insight"; importance: number; entityIds: string[];
}
export interface GraphCommitment {
  id: string; name: string; description: string; status: CommitmentStatus;
  promisorId: string; promiseeId: string | null; kind: "commitment";
}
export interface GraphPayload {
  entities:    GraphEntity[];
  literals:    Array<{ id: string; name: string }>;
  links:       Array<{ source: string; target: string; predicate: string; importance: number }>;
  cards:       GraphCard[];
  commitments: GraphCommitment[];
  bond:        Record<string, number | null>;
  mood:        { valence: number; arousal: number; dominance: number } | null;
}
