// ─── Card application ─────────────────────────────────────────────────────────
// Takes dropped/picked files, decodes them (PNG chunk or JSON), and lands each
// in the right place in the store: characters open the editor for review,
// lorebooks/personas/scenarios import directly. Shared by the window drop
// overlay and the Characters section's file picker.

import { useFableStore } from "@/lib/store";
import {
  decodePngPayload,
  convertPayload,
  downscaleImage,
  isPng,
  type ImportedCard,
  type ImportedLorebook,
} from "./cardFile";

export interface ImportResult {
  file: string;
  ok: boolean;
  message: string;
}

export async function importCardFiles(files: File[]): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  let characterOpened = false;

  for (const file of files) {
    try {
      const card = await decodeFile(file);
      if (!card) {
        results.push({ file: file.name, ok: false, message: "not a PNG card or JSON file." });
        continue;
      }
      results.push(await applyCard(card, file, characterOpened));
      if (card.kind === "character" && !characterOpened) characterOpened = true;
    } catch (err) {
      results.push({
        file: file.name,
        ok: false,
        message: `import failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return results;
}

async function decodeFile(file: File): Promise<ImportedCard | null> {
  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    return convertPayload(JSON.parse(await file.text()), null);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPng(bytes)) return null;
  const payload = decodePngPayload(bytes);
  if (!payload) {
    return { kind: "unsupported", reason: "PNG has no embedded card data." };
  }
  return convertPayload(payload.json, payload.key);
}

function importBook(book: ImportedLorebook): number {
  const store = useFableStore.getState();
  const bookId = store.addLorebook(book.name);
  if (book.description) store.updateLorebook(bookId, { description: book.description });
  for (const entry of book.entries) {
    useFableStore.getState().addLoreEntry(bookId, entry);
  }
  return book.entries.length;
}

async function applyCard(
  card: ImportedCard,
  file: File,
  characterAlreadyOpened: boolean
): Promise<ImportResult> {
  const store = useFableStore.getState();

  switch (card.kind) {
    case "character": {
      // The editor reviews one character at a time — first card wins the dialog
      if (characterAlreadyOpened) {
        return {
          file: file.name,
          ok: false,
          message: "character skipped: review and save the first one, then drop this again.",
        };
      }
      // The card art itself becomes the avatar (downscaled), overriding any
      // avatar path recorded inside the card JSON.
      const draft = { ...card.draft };
      if (file.size > 8 && isPng(new Uint8Array(await file.slice(0, 8).arrayBuffer()))) {
        const avatar = await downscaleImage(file);
        if (avatar) draft.avatar = avatar;
      }
      let extra = "";
      if (card.embeddedBook) {
        const n = importBook(card.embeddedBook);
        extra = ` Embedded lorebook "${card.embeddedBook.name}" imported (${n} entries).`;
      }
      store.openCharacterEditor(null, draft);
      store.setActiveSection("characters");
      return {
        file: file.name,
        ok: true,
        message: `character "${draft.name}" ready for review in the editor.${extra}`,
      };
    }

    case "lorebook": {
      const n = importBook(card.book);
      store.setActiveSection("lorebooks");
      return { file: file.name, ok: true, message: `lorebook "${card.book.name}" imported (${n} entries).` };
    }

    case "persona": {
      const id = store.addPersona({ name: card.name, description: card.description });
      store.setActivePersona(id);
      store.setActiveSection("characters");
      return { file: file.name, ok: true, message: `persona "${card.name}" imported and set active.` };
    }

    case "scenario": {
      const n = importBook(card.book);
      store.setActiveSection("lorebooks");
      const firstMes = card.firstMessage
        ? " Its opening message wasn't imported — scenarios inject as always-on lore."
        : "";
      return {
        file: file.name,
        ok: true,
        message: `scenario "${card.name}" imported as always-on lorebook (${n} entr${n === 1 ? "y" : "ies"}).${firstMes}`,
      };
    }

    case "unsupported":
      return { file: file.name, ok: false, message: card.reason };
  }
}
