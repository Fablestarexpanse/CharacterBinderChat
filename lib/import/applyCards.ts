// ─── Card application ─────────────────────────────────────────────────────────
// Takes dropped/picked files, decodes them (PNG chunk or JSON), and lands each
// in the right place in the store: characters open the editor for review,
// lorebooks/personas/scenarios import directly. Shared by the window drop
// overlay and the Characters section's file picker.

import { useFableStore } from "@/lib/store";
import {
  decodePngPayload,
  convertPayload,
  isPng,
  type ImportedCard,
} from "./cardFile";
import { imageToAvatar } from "@/lib/chat/assets";
import { useUiStore } from "@/lib/store/ui";
import { importBook, linkOrImportBook } from "./storeWrites";
import { importArchive } from "./archive";
import { isZip } from "@/lib/cards/zip";
import { readTextChunk } from "@/lib/cards/png";
import { BUNDLE_KEY, base64ToBytes, cleanBundle, type BundleImage, type CardBundle } from "@/lib/cards/bundle";

export interface ImportResult {
  file: string;
  ok: boolean;
  message: string;
  /** A whole-collection import: the message is a summary, not one card's outcome */
  archive?: boolean;
}

export async function importCardFiles(files: File[]): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  let characterOpened = false;

  for (const file of files) {
    try {
      // A CharacterBinder archive is a whole collection, not a card
      if (/\.zip$/i.test(file.name) || isZip(new Uint8Array(await file.slice(0, 4).arrayBuffer()))) {
        results.push(await importArchive(file));
        continue;
      }
      const card = await decodeFile(file);
      if (!card) {
        results.push({ file: file.name, ok: false, message: "not a PNG card, JSON file or CharacterBinder archive (.zip)." });
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

/** FableChat's bundle from a trading-card PNG, checked; null for any other file. */
async function readBundle(file: File): Promise<CardBundle | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = readTextChunk(bytes, BUNDLE_KEY);
  if (!text) return null;
  try { return cleanBundle(JSON.parse(text)); } catch { return null; }
}

function blobOf(img: BundleImage): Blob {
  return new Blob([(base64ToBytes(img.data) ?? new Uint8Array()) as BlobPart], { type: img.type });
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
      // The card art itself becomes the avatar, overriding any avatar path
      // recorded inside the card JSON; a FableChat trading card carries the
      // plain portrait in its bundle, since its art is the framed card face.
      const draft = { ...card.draft };
      const bundle = await readBundle(file);
      const portrait = bundle?.portrait ? await imageToAvatar(blobOf(bundle.portrait)) : null;
      if (portrait) draft.avatar = portrait;
      else if (file.size > 8 && isPng(new Uint8Array(await file.slice(0, 8).arrayBuffer()))) {
        const avatar = await imageToAvatar(file);
        if (avatar) draft.avatar = avatar;
      }
      let extra = "";
      if (bundle?.references?.length) {
        const refs: string[] = [];
        for (const r of bundle.references) {
          const url = await imageToAvatar(blobOf(r));
          if (url) refs.push(url);
        }
        if (refs.length) {
          draft.referenceImages = refs;
          extra += ` ${refs.length} reference picture${refs.length === 1 ? "" : "s"} added.`;
        }
      }
      if (bundle?.openers?.length) {
        // Idempotent: a first message already saved (same name and text) is not added twice
        let added = 0;
        for (const o of bundle.openers) {
          const have = useFableStore.getState().openers.some((x) => x.name === o.name && x.text === o.text);
          if (!have) { store.addOpener({ name: o.name, text: o.text }); added++; }
        }
        if (added) extra += ` ${added} saved first message${added === 1 ? "" : "s"} added to the Library.`;
      }
      if (card.embeddedBook) {
        const { id, count, reused } = linkOrImportBook(card.embeddedBook);
        // Linked, so the character's own world travels with it when exported again
        draft.lorebookId = id;
        extra += reused
          ? ` Linked to the lorebook "${card.embeddedBook.name}" already in your library.`
          : ` Embedded lorebook "${card.embeddedBook.name}" imported and linked (${count} entries).`;
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
      const { count } = importBook(card.book);
      ui.setActiveSection("lorebooks");
      return { file: file.name, ok: true, message: `lorebook "${card.book.name}" imported (${count} entries).` };
    }

    case "persona": {
      const id = store.addPersona({ name: card.name, description: card.description, ...(card.image ? { image: card.image } : {}) });
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
