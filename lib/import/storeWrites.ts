// ─── Writing imported cards into the store ───────────────────────────────────
// Shared by the one-at-a-time importer (applyCards) and the archive importer, so
// a lorebook imported either way is built identically.

import { useFableStore } from "@/lib/store";
import type { ImportedLorebook } from "./cardFile";

export function importBook(book: ImportedLorebook): { id: string; count: number } {
  const store = useFableStore.getState();
  const bookId = store.addLorebook(book.name);
  if (book.description) store.updateLorebook(bookId, { description: book.description });
  for (const entry of book.entries) {
    useFableStore.getState().addLoreEntry(bookId, entry);
  }
  return { id: bookId, count: book.entries.length };
}

const norm = (s: string | undefined) => (s ?? "").trim();
const entrySig = (e: { key: string; value: string }) => `${norm(e.key).toLowerCase()}\u0000${norm(e.value)}`;

/** A lorebook already in the store with this name and the same entries (order ignored), if any. */
export function findSameBook(book: ImportedLorebook): string | undefined {
  const want = book.entries.map(entrySig).sort().join("\u0001");
  return useFableStore.getState().lorebooks.find((b) =>
    norm(b.name) === norm(book.name) && b.entries.length === book.entries.length &&
    b.entries.map(entrySig).sort().join("\u0001") === want,
  )?.id;
}

/**
 * The lorebook a character card carries: link the identical one already here
 * rather than making a second copy (an archive holds the book both embedded in
 * its owner and on its own, and re-importing a character should not fork its world).
 */
export function linkOrImportBook(book: ImportedLorebook): { id: string; count: number; reused: boolean } {
  const existing = findSameBook(book);
  if (existing) return { id: existing, count: book.entries.length, reused: true };
  return { ...importBook(book), reused: false };
}
