// ─── What refers to what ──────────────────────────────────────────────────────
// Characters, lorebooks and chats point at each other by id. Deleting one used to
// leave the others pointing at nothing, and nothing said so: a chat whose character
// was deleted kept answering as a generic assistant with no memory. These are the
// questions to ask before deleting, and the one generation asks before answering.

import type { Character, Chat } from "@/lib/types";

/** Chats where this character is the 1:1 partner or a group member. */
export function chatsUsingCharacter(chats: Pick<Chat, "characterId" | "memberIds">[], characterId: string): number {
  return chats.filter((c) => c.characterId === characterId || (c.memberIds ?? []).includes(characterId)).length;
}

/** Characters whose own lorebook is this one. */
export function charactersUsingLorebook(characters: Pick<Character, "id" | "name" | "lorebookId">[], lorebookId: string) {
  return characters.filter((c) => c.lorebookId === lorebookId);
}

/**
 * Chats that explicitly list this lorebook. A chat with no list uses every book, so
 * it is not "using" any one of them and is not counted.
 */
export function chatsListingLorebook(chats: Pick<Chat, "lorebookIds">[], lorebookId: string): number {
  return chats.filter((c) => c.lorebookIds?.includes(lorebookId)).length;
}

/**
 * Is there a speaker the chat expects, who no longer exists? A chat with no
 * character at all (a plain assistant chat) is fine; one that has a character id
 * which resolves to nobody is orphaned, and must not quietly become that assistant.
 */
export function speakerIsMissing(speakerCharId: string | undefined, characters: Pick<Character, "id">[]): boolean {
  return !!speakerCharId && !characters.some((c) => c.id === speakerCharId);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
