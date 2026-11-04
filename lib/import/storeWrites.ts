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
