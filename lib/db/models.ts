// ─── Drawer 2 TypeScript Models ───────────────────────────────────────────────
// Mirror of fable_drawer2/models.py — keep these in sync.

export type EntityType = "character" | "place" | "object" | "faction" | "concept";
export type StatName   = "affection" | "trust" | "desire" | "connection" | "mood";
export type CommitmentStatus = "active" | "fulfilled" | "broken" | "forgotten";

export const STAT_NAMES: StatName[] = ["affection", "trust", "desire", "connection", "mood"];

export const DEFAULT_DECAY_RATES: Record<StatName, number> = {
  affection:  0.05,
  trust:      0.03,
  desire:     0.08,
  connection: 0.02,
  mood:       0.20,
};

// ─── Entity ───────────────────────────────────────────────────────────────────

export interface DbEntity {
  id:          string;
  type:        EntityType;
  name:        string;
  description: string;
  createdAt:   number; // Unix timestamp
}

// ─── Fact (bi-temporal triple) ────────────────────────────────────────────────

export interface DbFact {
  id:            number;
  subjectId:     string;
  predicate:     string;
  objectId:      string | null;  // references another entity
  objectLiteral: string | null;  // free-text value
  tValidStart:   number;         // story-time start (Unix SECONDS — matches now())
  tValidEnd:     number | null;  // story-time end (null = still valid)
  tIngested:     number;         // wall-clock when recorded
  confidence:    number;         // 0.0–1.0 — how sure the extractor is
  importance:    number;         // 0.0–1.0 — how much it matters (retrieval sort key)
  knownTo:       string[];       // entity IDs who know this fact
  supersededBy:  number | null;  // FK to replacement fact
}

// ─── Relationship Stat ────────────────────────────────────────────────────────

export interface DbRelationshipStat {
  id:          number;
  observerId:  string;
  targetId:    string;
  statName:    StatName;
  value:       number;
  decayRate:   number;
  lastUpdated: number;
}

// ─── Memory Card ──────────────────────────────────────────────────────────────

export interface DbMemoryCard {
  id:         number;
  title:      string;
  content:    string;
  tags:       string[];   // ["episode"] for scene cards, ["reflection"] for insights
  entityIds:  string[];
  importance: number;     // 0.0–1.0 emotional/story weight
  createdAt:  number;
  updatedAt:  number;
}

// ─── Commitment ───────────────────────────────────────────────────────────────

export interface DbCommitment {
  id:          number;
  promisorId:  string;
  promiseeId:  string | null;
  description: string;
  status:      CommitmentStatus;
  createdAt:   number;
  resolvedAt:  number | null;
}

// ─── API Response Shapes ──────────────────────────────────────────────────────

export interface CharacterSummaryData {
  entity: DbEntity | null;
  relationships: Array<{
    targetId:   string;
    targetName: string;
    stats:      Array<{ name: StatName; value: number; decayRate: number }>;
  }>;
  facts: Array<{
    id:            number;
    predicate:     string;
    objectDisplay: string;
    confidence:    number;
    tValidStart:   number;
  }>;
  commitments: DbCommitment[];
}

// ─── Drawer 1: Core Memory Block ─────────────────────────────────────────────

export interface CoreMood {
  /** -1 (very negative) to 1 (very positive) */
  valence:   number;
  /** 0 (calm) to 1 (highly excited) */
  arousal:   number;
  /** 0 (submissive) to 1 (dominant) */
  dominance: number;
}

/** Relationship stats mirrored from Drawer 2 but kept in-context at all times */
export interface CoreStats {
  affection:  number; // 0-100
  trust:      number;
  desire:     number;
  connection: number;
  mood:       number;
}

export interface EmotionalEvent {
  timestamp:   string;
  description: string;
  impact:      "positive" | "negative" | "neutral";
  intensity:   number; // 0-1
}

/** The full Core Memory document stored as JSON in SQLite */
export interface CoreMemory {
  characterId:             string;
  version:                 number;
  updatedAt:               string; // ISO timestamp
  /** One-paragraph character self-description */
  persona:                 string;
  mood:                    CoreMood;
  relationship_with_user:  CoreStats;
  /** Set while the relationship is inside a post-rupture window — e.g.
   *  "Trust was recently broken and has not fully healed." */
  relationship_note?:      string | null;
  /** Active promises / obligations the character holds */
  active_commitments:      string[];
  /** Last N emotionally significant exchanges */
  recent_emotional_events: EmotionalEvent[];
  /** Character's current unspoken thoughts */
  internal_thoughts:       string[];
  /** Running narrative context — what has happened so far */
  narrative_summary:       string;
  /** In-fiction current time ("Thursday evening, before the symposium").
   *  The story clock: lets the prompt surface commitments whose moment has
   *  arrived, so characters bring promises up unprompted. */
  story_time?:             string | null;
}

/** Row shape returned from SQLite */
export interface DbCoreMemory {
  characterId: string;
  data:        CoreMemory;
  version:     number;
  updatedAt:   number; // Unix timestamp
}


