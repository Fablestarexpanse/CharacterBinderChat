// ─── Library archives ─────────────────────────────────────────────────────────
// A whole library (or a selection) as one .zip, in the same layout CharacterBinder's
// "Archive All" wrote: cards/<name>.png|json plus a manifest.json. So an archive made
// here imports into FableChat (lib/import/archive.ts) and into CharacterBinder, and
// the migration is no longer one-way. Pure: the caller builds each card file.

import { writeZip } from "./zipWrite";

export type ArchiveKind = "character" | "lorebook" | "persona" | "scenario";

export interface ArchiveItem {
  id: string;
  kind: ArchiveKind;
  name: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  /** The card file's bytes and extension, as a single export would produce it */
  bytes: Uint8Array;
  ext: "png" | "json";
}

/**
 * A file name no earlier card in the archive has taken. Card names are not unique
 * (two characters called "Rook"), and a ZIP with two entries of one name keeps only
 * one of them for most tools. A name with nothing usable in it falls back to the id.
 */
export function uniqueName(name: string, id: string, used: Set<string>): string {
  const base = name.replace(/[^\p{L}\p{N}_\- ]/gu, "").trim().slice(0, 80) || id;
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function buildArchive(items: ArchiveItem[]): Uint8Array {
  const used = new Set<string>();
  const manifest: object[] = [];
  const files = items.map((it) => {
    const file = `cards/${uniqueName(it.name, it.id, used)}.${it.ext}`;
    manifest.push({
      id: it.id, name: it.name, cardType: it.kind, tags: it.tags ?? [],
      createdAt: it.createdAt ?? null, updatedAt: it.updatedAt ?? null, file,
    });
    return { name: file, data: it.bytes };
  });
  return writeZip([
    ...files,
    { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
  ]);
}
