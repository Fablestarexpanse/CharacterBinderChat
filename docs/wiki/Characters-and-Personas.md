# Characters and personas

## The Library

**Library** (top of the sidebar) is the one place for every card, in four tabs: **Characters**, **Personas**,
**Lorebooks** and **Scenarios**. Search, sort, filter by tag, or **Select** several to export or delete together.
Deleting warns you which chats use the card.

## Making a character

**Library → New character** opens the editor:

- **Name, description, personality, scenario** — who they are. The description is in every prompt.
- **First message** and **alternate greetings** — how a chat with them opens.
- **Example dialogue** — sample exchanges in their voice (`<START>`, then `{{char}}:` and `{{user}}:` lines).
- **Tags** — for filtering in the Library.
- **How images draw them** — tags, LoRA and reference pictures for image models (see [Images and video](Images-and-Video.md)).
- **Voice** — how they sound (see [Voice and the narrator](Voice-and-Narrator.md)).
- **Contact** — whether they may send photos, text you first or call you (see
  [Texts, calls and pictures](Texts-Calls-and-Pictures.md)).

`{{char}}` and `{{user}}` in any field are replaced by the character's and your persona's names.

The editor asks before throwing away unsaved changes.

### A portrait

Upload one in the editor, or make one: in **Image Studio**, under a render, choose **Use for a character → Set as
portrait of…**, or **New character from this** to start a character from the picture.

## Importing cards

Drop a **PNG or JSON character card** anywhere in the window. FableChat reads SillyTavern (v1/v2), CharacterBinder,
JanitorAI, Agnai and Backyard cards, and a CharacterBinder **Archive All** `.zip`. A character's built-in lorebook comes
with it. Importing the same card twice is skipped.

**Quick Import** (in the Library) takes pasted text instead — headed sections, W++, JSON or plain paragraphs — and shows
how it would be sorted into fields before you apply it.

## Exporting

On a character's card: **PNG** (a Tavern card with the art embedded) or **JSON**, for SillyTavern, JanitorAI, Chub,
Agnai, Venus, Backyard, RisuAI or generic JSON; the export menu says which fields each site drops. **Export library**
saves everything as one `.zip` that imports back.

Voices and image looks are yours, not part of the card, so they are not exported.

## Personas: who you are

A persona is *you* in the story: your name and a description the characters know. Create one in
**Library → Personas** and choose **Use as me**, or switch at any time from the **You are** card at the top of the
inspector's **Character** tab. Personas are global, not per chat.

## Group chats

**Groups** (sidebar) puts several characters in one scene. Pick who replies next, or leave it to choose. Toggle who is
present: a character only remembers what happened while they were there.
