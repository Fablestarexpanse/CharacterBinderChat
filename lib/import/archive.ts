// ─── CharacterBinder archive import ───────────────────────────────────────────
// CharacterBinder's "Archive All" writes one .zip: cards/*.png (cards that were
// saved with their art) and cards/*.json, plus a manifest.json. This brings a
// whole collection over in one step, which is how someone using the old tool
// moves to this one.
//
// Unlike importing a single card, characters here are saved directly rather than
// opened for review one at a time — nobody is going to review two hundred. And
// because people run a migration twice (a retry, or a second archive that
// overlaps the first), anything already present is skipped, not duplicated.

import { useFableStore } from "@/lib/store";
import { readZip } from "@/lib/cards/zip";
import { imageToAvatar } from "@/lib/chat/assets";
import { decodePngPayload, convertPayload, isPng, type ImportedCard } from "./cardFile";
import { findSameBook, importBook, linkOrImportBook } from "./storeWrites";
import type { ImportResult } from "./applyCards";

export interface PlannedCard {
  name: string;
  card: ImportedCard;
  /** The PNG the card came from; its art becomes the avatar */
  png?: Uint8Array;
}

export interface ArchivePlan {
  cards: PlannedCard[];
  /** Entries that were not cards, or could not be read, with the reason */
  skipped: Array<{ name: string; reason: string }>;
}

/** Decode every card in an archive, without touching the store. */
export function planArchive(entries: Array<{ name: string; data: Uint8Array }>): ArchivePlan {
  const plan: ArchivePlan = { cards: [], skipped: [] };
  for (const { name, data } of entries) {
    const base = name.split("/").pop() ?? name;
    if (base.toLowerCase() === "manifest.json") continue;       // an index, not a card
    try {
      if (/\.json$/i.test(base)) {
        const card = convertPayload(JSON.parse(new TextDecoder().decode(data)), null);
        plan.cards.push({ name: base, card });
      } else if (isPng(data)) {
        const payload = decodePngPayload(data);
        if (!payload) { plan.skipped.push({ name: base, reason: "PNG has no embedded card" }); continue; }
        plan.cards.push({ name: base, card: convertPayload(payload.json, payload.key), png: data });
      } else {
        plan.skipped.push({ name: base, reason: "not a card file" });
      }
    } catch (e) {
      plan.skipped.push({ name: base, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return plan;
}

export interface ArchiveTally {
  characters: number; lorebooks: number; personas: number; scenarios: number;
  /** Already in this library, so left alone */
  duplicates: number;
  /** Not importable (script cards, unreadable files) */
  skipped: Array<{ name: string; reason: string }>;
}

const same = (a: string | undefined, b: string | undefined) => (a ?? "").trim() === (b ?? "").trim();

/**
 * Put a plan into the store. `makeAvatar` turns a card's PNG into the stored
 * avatar (downscaled); injected because that needs a canvas.
 */
export async function applyArchive(
  plan: ArchivePlan,
  makeAvatar: (png: Uint8Array) => Promise<string | null>,
): Promise<ArchiveTally> {
  const tally: ArchiveTally = { characters: 0, lorebooks: 0, personas: 0, scenarios: 0, duplicates: 0, skipped: [...plan.skipped] };

  for (const { name, card, png } of plan.cards) {
    const store = useFableStore.getState();
    switch (card.kind) {
      case "character": {
        const d = card.draft;
        if (store.characters.some((c) => same(c.name, d.name) && same(c.description, d.description))) { tally.duplicates++; break; }
        const avatar = png ? (await makeAvatar(png)) ?? d.avatar : d.avatar;
        let lorebookId: string | undefined;
        if (card.embeddedBook) lorebookId = linkOrImportBook(card.embeddedBook).id;
        store.addCharacter({ ...d, name: d.name ?? "Unnamed", description: d.description ?? "", tags: d.tags ?? [], avatar, lorebookId });
        tally.characters++;
        break;
      }
      case "lorebook": {
        if (findSameBook(card.book)) { tally.duplicates++; break; }
        importBook(card.book);
        tally.lorebooks++;
        break;
      }
      case "persona": {
        if (store.personas.some((p) => same(p.name, card.name) && same(p.description, card.description))) { tally.duplicates++; break; }
        // The store makes the first persona active when there is none; an existing
        // choice is never touched.
        store.addPersona({ name: card.name, description: card.description, ...(card.image ? { image: card.image } : {}) });
        tally.personas++;
        break;
      }
      case "scenario": {
        const text = card.book.entries.map((e) => e.value.trim()).filter(Boolean).join("\n\n");
        if (store.scenarios.some((s) => same(s.name, card.name) && same(s.scenario, text))) { tally.duplicates++; break; }
        store.addScenario({ name: card.name, scenario: text, firstMessage: card.firstMessage });
        tally.scenarios++;
        break;
      }
      case "unsupported":
        tally.skipped.push({ name, reason: card.reason });
        break;
    }
  }
  return tally;
}

export function describeTally(t: ArchiveTally): string {
  const parts = [
    t.characters && `${t.characters} character${t.characters === 1 ? "" : "s"}`,
    t.lorebooks && `${t.lorebooks} lorebook${t.lorebooks === 1 ? "" : "s"}`,
    t.personas && `${t.personas} persona${t.personas === 1 ? "" : "s"}`,
    t.scenarios && `${t.scenarios} scenario${t.scenarios === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const out = [parts.length ? `Imported ${parts.join(", ")}.` : "Nothing new to import."];
  if (t.duplicates) out.push(`${t.duplicates} already in your library, left alone.`);
  if (t.skipped.length) {
    const shown = t.skipped.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join("; ");
    out.push(`Skipped ${t.skipped.length}: ${shown}${t.skipped.length > 3 ? "…" : ""}.`);
  }
  return out.join(" ");
}

/** Entry point from the importer: a .zip File in, a summary out. */
export async function importArchive(file: File): Promise<ImportResult> {
  const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
  const tally = await applyArchive(planArchive(entries), (png) => imageToAvatar(new Blob([png as BlobPart], { type: "image/png" })));
  return { file: file.name, ok: true, archive: true, message: describeTally(tally) };
}
