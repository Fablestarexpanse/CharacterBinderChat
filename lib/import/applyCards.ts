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
import { useUiStore } from "@/lib/store/ui";

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
  const ui    = useUiStore.getState();

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
      ui.openCharacterEditor(null, draft);
      ui.setActiveSection("characters");
      return {
        file: file.name,
        ok: true,
        message: `character "${draft.name}" ready for review in the editor.${extra}`,
      };
    }

    case "lorebook": {
      const n = importBook(card.book);
      ui.setActiveSection("lorebooks");
      return { file: file.name, ok: true, message: `lorebook "${card.book.name}" imported (${n} entries).` };
    }

    case "persona": {
      const id = store.addPersona({ name: card.name, description: card.description });
      store.setActivePersona(id);
      ui.setActiveSection("characters");
      return { file: file.name, ok: true, message: `persona "${card.name}" imported and set active.` };
    }

    case "scenario": {
      // Scenarios used to be flattened into always-on lorebooks; now they land
      // in the Scenarios library where the chat builder can pick them (and the
      // opening message survives the import).
      const text = card.book.entries.map((e) => e.value.trim()).filter(Boolean).join("\n\n");
      store.addScenario({
        name: card.name,
        scenario: text,
        firstMessage: card.firstMessage,
      });
      ui.setActiveSection("scenarios");
      return {
        file: file.name,
        ok: true,
        message: `scenario "${card.name}" imported${card.firstMessage ? " with its opening message" : ""} — pick it when building a chat.`,
      };
    }

    case "unsupported":
      return { file: file.name, ok: false, message: card.reason };
  }
}
