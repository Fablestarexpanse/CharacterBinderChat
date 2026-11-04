"use client";

// ─── Inspected character resolution ──────────────────────────────────────────
// The inspector tabs all need "which character am I looking at". For 1:1
// chats that's the chat's character; for group chats it's the member picked
// in the inspector's member selector (defaulting to the first member).
// Centralised so every tab resolves identically.

import { useFableStore } from "@/lib/store";
import type { Character, Chat } from "@/lib/types";
import { useUiStore } from "@/lib/store/ui";

export function useInspectedCharacter(): {
  chat:      Chat | undefined;
  character: Character | undefined;
  isGroup:   boolean;
  /** The chat names a character that no longer exists (it was deleted) */
  deleted:   boolean;
} {
  const { activeChatId, chats, characters } = useFableStore();
  const { inspectorMemberId } = useUiStore();
  const chat = chats.find((c) => c.id === activeChatId);
  const memberIds = chat?.memberIds ?? [];
  const isGroup = memberIds.length >= 2;
  const charId = isGroup
    ? (inspectorMemberId && memberIds.includes(inspectorMemberId)
        ? inspectorMemberId
        : memberIds[0])
    : chat?.characterId;
  const character = characters.find((c) => c.id === charId);
  return { chat, character, isGroup, deleted: !!charId && !character };
}

/** What the inspector tabs say when there is no character to show. */
export function noCharacterText(deleted: boolean): string {
  return deleted
    ? "This chat's character was deleted. Its memory is kept, and comes back if the character is restored."
    : "No character assigned to this chat.";
}
