// ─── Card service ─────────────────────────────────────────────────────────────
// Create, read, change, delete and undo cards on the SERVER, speaking card format
// (Tavern V2, lorebook, persona, scenario) on the outside. This is what an agent
// uses: it never touches the browser's store. The write lands in SQLite with a new
// revision, and any open tab picks it up before its next save (see StateSync).
//
// Every write that changes or removes something leaves a history row holding the
// previous version, and an event the tab announces with an Undo. An agent that
// misjudges can be reversed; nothing here is a one-way door.

import type { FableStore } from "@/lib/db/store";
import type { Character, LoreEntry } from "@/lib/types";
import { uniqueSlugId } from "@/lib/store/defaults";
import { convertPayload, parseLorebook, type ImportedLorebook } from "@/lib/import/cardFile";
import { characterToCard, loreToCharacterBook, lorebookToCard, personaToCard, scenarioToCard } from "@/lib/cards/tavern";
import { validateTavernCardV2 } from "@/lib/cards/validate";
import { assetUrl } from "@/lib/db/assets";

export const CARD_TYPES = ["character", "lorebook", "persona", "scenario"] as const;
export type CardType = (typeof CARD_TYPES)[number];

const COLLECTION: Record<CardType, string> = {
  character: "characters", lorebook: "lorebooks", persona: "personas", scenario: "scenarios",
};

type Row = Record<string, unknown> & { id: string; name: string };

/** A failure the caller caused (bad input, unknown id), as opposed to a bug. */
export class CardError extends Error {
  // An explicit field rather than a constructor parameter property: the unit
  // tests run this file under Node's own type stripping, which does not support those.
  readonly status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.status = status;
  }
}

export const isCardType = (v: unknown): v is CardType => typeof v === "string" && (CARD_TYPES as readonly string[]).includes(v);

const nowIso = () => new Date().toISOString();
const rand = () => Math.random().toString(36).slice(2, 7);

/** Source label for events: short, printable, never trusted to be anything else. */
export function cleanSource(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/[^\w .\-/]/g, "").trim().slice(0, 40);
  return s || "agent";
}

// ─── Reading ──────────────────────────────────────────────────────────────────

export interface CardSummary { id: string; type: CardType; name: string; detail: string }

export function listCards(store: FableStore, type: CardType): CardSummary[] {
  return store.listRows(COLLECTION[type]).map((r) => {
    const row = r as Row;
    const detail =
      type === "lorebook" ? `${(row.entries as unknown[] | undefined)?.length ?? 0} entries`
      : String(row.description ?? row.scenario ?? "").replace(/\s+/g, " ").slice(0, 120);
    return { id: row.id, type, name: row.name, detail };
  });
}

/** One card in its interchange format. A character's own lorebook rides inside it. */
export function getCard(store: FableStore, type: CardType, id: string): object {
  const found = store.getRow(COLLECTION[type], id);
  if (!found) throw new CardError(`${type} "${id}" not found`, 404);
  const row = found.data as unknown as Row;
  switch (type) {
    case "character": {
      const book = typeof row.lorebookId === "string" ? store.getRow("lorebooks", row.lorebookId)?.data : undefined;
      return characterToCard(
        row as unknown as Character,
        book ? loreToCharacterBook(String(book.name), book.description as string | undefined, (book.entries as LoreEntry[]) ?? []) : undefined,
      );
    }
    case "lorebook": return lorebookToCard({ name: row.name, description: row.description as string | undefined, entries: (row.entries as LoreEntry[]) ?? [] });
    case "persona":  return personaToCard({ name: row.name, description: String(row.description ?? "") });
    case "scenario": return scenarioToCard({ name: row.name, scenario: String(row.scenario ?? ""), firstMessage: row.firstMessage as string | undefined });
  }
}

// ─── Building rows ────────────────────────────────────────────────────────────

function bookRow(store: FableStore, book: ImportedLorebook, name?: string): Row {
  const id = uniqueSlugId("lb", book.name, (i) => !!store.getRow("lorebooks", i));
  return {
    id, name: name ?? book.name, ...(book.description ? { description: book.description } : {}),
    createdAt: nowIso(),
    entries: book.entries.map((e) => ({ ...e, id: `le-${Date.now()}-${rand()}`, lorebookId: id })),
  };
}

// ─── The write path ───────────────────────────────────────────────────────────

interface Touch { collection: string; id: string; row: Row | null }

/**
 * Apply row changes as one atomic write: history of each row's prior state, the
 * patch itself, and the event. If any step fails nothing is half-done.
 */
function commit(store: FableStore, source: string, summary: string, touches: Touch[]): { rev: number; historyId: number | null } {
  return store.transaction(() => {
    let historyId: number | null = null;
    const prev = store.rev();
    touches.forEach((t, i) => {
      const before = store.getRow(t.collection, t.id);
      const hid = store.saveHistory({
        collection: t.collection, rowId: t.id, data: before ? JSON.stringify(before.data) : null,
        seq: before?.seq ?? null, rev: prev, source,
      });
      // The undo handle is the primary row. Rows written in the same transaction
      // (a created character's lorebook) share its revision and undo together.
      if (i === 0) historyId = hid;
    });
    const upserts: Record<string, Array<{ id: string }>> = {};
    const removals: Record<string, string[]> = {};
    for (const t of touches) {
      if (t.row) (upserts[t.collection] ??= []).push(t.row);
      else (removals[t.collection] ??= []).push(t.id);
    }
    const { rev } = store.patchAppState({ upserts, removals });
    store.recordEvent({ rev, source, summary, historyId });
    return { rev, historyId };
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

const KIND: Record<CardType, string> = { character: "character", lorebook: "lorebook", persona: "persona", scenario: "scenario" };

export function createCard(store: FableStore, type: CardType, payload: unknown, source: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CardError("card must be a JSON object");

  // A card that says what it is wins over the type it was sent as. Without this a
  // character card sent as a persona fails with "missing a name", which sends the
  // caller looking in the wrong place.
  const declared = ({ chara_card_v2: "character", persona_card_v1: "persona", scenario_card_v1: "scenario", script_card_v1: "script" } as Record<string, string>)[
    String((payload as Record<string, unknown>).spec)];
  if (declared && declared !== type) throw new CardError(`that is a ${declared} card, not a ${type}`);

  // Characters are checked against the spec up front, so an agent gets the
  // actual reason ("Description is required") rather than a generic refusal
  if (type === "character") {
    const p = payload as Record<string, unknown>;
    const asCard = p.spec === "chara_card_v2" ? p : { spec: "chara_card_v2", spec_version: "2.0", data: p };
    const check = validateTavernCardV2({ ...asCard, data: { ...blankData(), ...(asCard.data as object) } });
    if (!check.valid) throw new CardError(check.errors.join("; "));
  }

  // A bare lorebook (no spec) is recognised by its key; the others by shape
  const key = type === "lorebook" ? "lorebook" : type === "persona" ? "persona" : type === "scenario" ? "scenario" : null;
  const imported = convertPayload(type === "character" && (payload as Record<string, unknown>).spec !== "chara_card_v2"
    ? { spec: "chara_card_v2", spec_version: "2.0", data: payload } : payload, key);
  if (imported.kind === "unsupported") throw new CardError(imported.reason);
  if (imported.kind !== KIND[type]) throw new CardError(`that is a ${imported.kind} card, not a ${type}`);

  const touches: Touch[] = [];
  let primary: Row;
  switch (imported.kind) {
    case "character": {
      const d = imported.draft;
      const id = uniqueSlugId("char", d.name ?? "", (i) => !!store.getRow("characters", i));
      let lorebookId: string | undefined;
      let sidekick: Row | null = null;
      if (imported.embeddedBook) { sidekick = bookRow(store, imported.embeddedBook); lorebookId = sidekick.id; }
      primary = { ...stripUndefined(d), id, name: d.name ?? "", description: d.description ?? "", tags: d.tags ?? [], ...(lorebookId ? { lorebookId } : {}), createdAt: nowIso(), updatedAt: nowIso() };
      touches.push({ collection: "characters", id, row: primary });
      if (sidekick) touches.push({ collection: "lorebooks", id: sidekick.id, row: sidekick });
      break;
    }
    case "lorebook": primary = bookRow(store, imported.book); touches.push({ collection: "lorebooks", id: primary.id, row: primary }); break;
    case "persona": {
      const id = uniqueSlugId("persona", imported.name, (i) => !!store.getRow("personas", i));
      primary = { id, name: imported.name, description: imported.description, createdAt: nowIso(), updatedAt: nowIso() };
      touches.push({ collection: "personas", id, row: primary });
      break;
    }
    case "scenario": {
      const id = uniqueSlugId("scn", imported.name, (i) => !!store.getRow("scenarios", i));
      const text = imported.book.entries.map((e) => e.value.trim()).filter(Boolean).join("\n\n");
      primary = { id, name: imported.name, scenario: text, ...(imported.firstMessage ? { firstMessage: imported.firstMessage } : {}), createdAt: nowIso(), updatedAt: nowIso() };
      touches.push({ collection: "scenarios", id, row: primary });
      break;
    }
  }
  const r = commit(store, source, `${source} created ${type} “${primary.name}”`, touches);
  return { id: primary.id, type, name: primary.name, rev: r.rev };
}

function blankData() {
  return { description: "", personality: "", scenario: "", first_mes: "", mes_example: "", creator_notes: "", system_prompt: "",
    post_history_instructions: "", alternate_greetings: [], tags: [], creator: "", character_version: "1.0", extensions: {} };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/** Card field -> Character field, with the type each must have. */
const CHARACTER_FIELDS: Record<string, { to: string; kind: "string" | "strings" | "object" }> = {
  name: { to: "name", kind: "string" }, description: { to: "description", kind: "string" },
  personality: { to: "personality", kind: "string" }, scenario: { to: "scenario", kind: "string" },
  first_mes: { to: "firstMessage", kind: "string" }, mes_example: { to: "exampleDialogue", kind: "string" },
  creator_notes: { to: "creatorNotes", kind: "string" }, system_prompt: { to: "systemPrompt", kind: "string" },
  post_history_instructions: { to: "postHistoryInstructions", kind: "string" },
  alternate_greetings: { to: "alternateGreetings", kind: "strings" }, tags: { to: "tags", kind: "strings" },
  creator: { to: "creator", kind: "string" }, character_version: { to: "characterVersion", kind: "string" },
  extensions: { to: "cardExtensions", kind: "object" },
};

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Shallow-merge `changes` (card-format field names) into an existing card. An
 * unknown field is an error naming the allowed ones, not silently ignored: an
 * agent that misspells a field should learn that, not assume it worked.
 */
export function updateCard(store: FableStore, type: CardType, id: string, changes: unknown, source: string) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new CardError("changes must be an object");
  const found = store.getRow(COLLECTION[type], id);
  if (!found) throw new CardError(`${type} "${id}" not found`, 404);
  const row: Row = { ...(found.data as Row) };
  // Characters may be sent as a whole card ({data: {...}}) or as bare fields
  let c = changes as Record<string, unknown>;
  if (type === "character" && c.data && typeof c.data === "object" && !Array.isArray(c.data)) c = c.data as Record<string, unknown>;
  if (Object.keys(c).length === 0) throw new CardError("nothing to change");

  const fail = (field: string, allowed: string[]) => {
    throw new CardError(`unknown or unsupported field "${field}" for a ${type}. Allowed: ${allowed.join(", ")}`);
  };

  if (type === "character") {
    for (const [field, value] of Object.entries(c)) {
      const spec = CHARACTER_FIELDS[field];
      if (!spec) {
        if (field === "character_book") throw new CardError("a character's lorebook is edited as its own card: use type \"lorebook\"");
        fail(field, Object.keys(CHARACTER_FIELDS));
      }
      const ok = spec.kind === "string" ? typeof value === "string"
        : spec.kind === "strings" ? isStrings(value)
        : !!value && typeof value === "object" && !Array.isArray(value);
      if (!ok) throw new CardError(`"${field}" must be ${spec.kind === "string" ? "a string" : spec.kind === "strings" ? "an array of strings" : "an object"}`);
      // An empty string clears an optional field rather than storing ""
      row[spec.to] = typeof value === "string" && field !== "name" && field !== "description" && value.trim() === "" ? undefined : value;
    }
    if (typeof row.name !== "string" || !row.name.trim()) throw new CardError("name cannot be empty");
    if (typeof row.description !== "string" || !String(row.description).trim()) throw new CardError("description cannot be empty");
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
  } else if (type === "lorebook") {
    for (const [field, value] of Object.entries(c)) {
      if (field === "name" || field === "description") {
        if (typeof value !== "string") throw new CardError(`"${field}" must be a string`);
        row[field] = value;
      } else if (field === "entries") {
        if (!Array.isArray(value)) throw new CardError('"entries" must be an array');
        const book = parseLorebook({ name: row.name, entries: value }) ?? null;
        if (!book && value.length > 0) throw new CardError("none of those entries has both keywords and content");
        row.entries = (book?.entries ?? []).map((e) => ({ ...e, id: `le-${Date.now()}-${rand()}`, lorebookId: id }));
      } else fail(field, ["name", "description", "entries"]);
    }
    if (!String(row.name).trim()) throw new CardError("name cannot be empty");
  } else {
    const allowed: Record<string, string> = type === "persona" ? { name: "name", description: "description" } : { name: "name", scenario: "scenario", first_mes: "firstMessage" };
    for (const [field, value] of Object.entries(c)) {
      const to = allowed[field];
      if (!to) fail(field, Object.keys(allowed));
      if (typeof value !== "string") throw new CardError(`"${field}" must be a string`);
      row[to] = to === "firstMessage" && !value.trim() ? undefined : value;
    }
    if (!String(row.name).trim()) throw new CardError("name cannot be empty");
    if (row.firstMessage === undefined) delete row.firstMessage;
  }

  row.updatedAt = nowIso();
  const r = commit(store, source, `${source} edited ${type} “${row.name}”`, [{ collection: COLLECTION[type], id, row }]);
  return { id, type, name: row.name, rev: r.rev, historyId: r.historyId };
}

// ─── Delete / undo ────────────────────────────────────────────────────────────

/**
 * Give a character or persona a picture. The bytes go to the asset store (checked
 * there to be a real image) and the row gets the reference, as one recorded,
 * undoable change like any other.
 */
export function setAvatar(store: FableStore, type: CardType, id: string, bytes: Uint8Array, source: string) {
  if (type !== "character" && type !== "persona") throw new CardError(`only characters and personas have a picture, not a ${type}`);
  const found = store.getRow(COLLECTION[type], id);
  if (!found) throw new CardError(`${type} "${id}" not found`, 404);
  let hash: string;
  try { hash = store.putAsset(bytes).hash; }
  catch (e) { throw new CardError(e instanceof Error ? e.message : String(e)); }
  const row = { ...(found.data as Row), avatar: assetUrl(hash), updatedAt: nowIso() };
  const r = commit(store, source, `${source} set the picture of ${type} “${row.name}”`, [{ collection: COLLECTION[type], id, row }]);
  return { id, type, name: row.name, avatar: row.avatar, rev: r.rev, historyId: r.historyId };
}

/** What depends on a card, so a delete can say so instead of leaving things pointing at nothing. */
export interface UsedBy {
  /** Chats that have this character, or list this lorebook */
  chats: number;
  /** For a lorebook: the characters whose own book it is (their link is cleared) */
  characters?: string[];
}

export function deleteCard(store: FableStore, type: CardType, id: string, source: string) {
  const found = store.getRow(COLLECTION[type], id);
  if (!found) throw new CardError(`${type} "${id}" not found`, 404);
  const name = String((found.data as Row).name ?? id);

  const touches: Touch[] = [{ collection: COLLECTION[type], id, row: null }];
  const usedBy: UsedBy = { chats: 0 };
  if (type === "character") {
    usedBy.chats = store.countChatsUsingCharacter(id);
  } else if (type === "lorebook") {
    usedBy.chats = store.countChatsListingLorebook(id);
    // A character whose lorebook is deleted must not keep pointing at it. Changed in the
    // same write as the delete, so one undo puts both back.
    const owners = (store.listRows("characters") as Row[]).filter((c) => c.lorebookId === id);
    usedBy.characters = owners.map((c) => c.name);
    for (const owner of owners) {
      const { lorebookId: _gone, ...rest } = owner;
      void _gone;
      touches.push({ collection: "characters", id: owner.id, row: { ...rest, updatedAt: nowIso() } as Row });
    }
  }

  const note = usedBy.chats > 0 ? ` (${usedBy.chats} chat${usedBy.chats === 1 ? " uses" : "s use"} it)` : "";
  const r = commit(store, source, `${source} deleted ${type} “${name}”${note}`, touches);
  const warning =
    type === "character" && usedBy.chats > 0
      ? `${usedBy.chats} chat${usedBy.chats === 1 ? "" : "s"} use${usedBy.chats === 1 ? "s" : ""} this character and can no longer continue until it is restored (undo_change with historyId ${r.historyId}).`
      : type === "lorebook" && (usedBy.characters?.length ?? 0) > 0
        ? `The lorebook of ${usedBy.characters!.join(", ")} was deleted and their link cleared. undo_change restores both.`
        : undefined;
  return { id, type, name, rev: r.rev, historyId: r.historyId, usedBy, ...(warning ? { warning } : {}) };
}

/**
 * Put rows back as they were before an outside write, or remove ones that write
 * created. Everything written in the same transaction undoes together: undoing a
 * created character also removes the lorebook that came with it.
 */
export function undo(store: FableStore, historyId: number, source: string) {
  const h = store.getHistory(historyId);
  if (!h) throw new CardError("that change can no longer be undone (already undone, or too old)", 404);
  const group = store.getHistoryGroup(h.rev);

  const rev = store.transaction(() => {
    const upserts: Record<string, Array<{ id: string }>> = {};
    const removals: Record<string, string[]> = {};
    let name = h.rowId;
    for (const g of group) {
      const row = g.data ? (JSON.parse(g.data) as Row) : null;
      if (row) (upserts[g.collection] ??= []).push(row); else (removals[g.collection] ??= []).push(g.rowId);
      if (g.id === h.id) name = String(row?.name ?? store.getRow(g.collection, g.rowId)?.data.name ?? g.rowId);
    }
    const { rev: next } = store.patchAppState({ upserts, removals });
    for (const g of group) store.deleteHistory(g.id);
    store.recordEvent({ rev: next, source, summary: `${source} undid a change to “${name}”`, historyId: null });
    return next;
  });
  return { rev };
}
