# Comic-it: running notes

A living document for the Comic-it feature: how it works, every test run, the issues still open (with ideas to try),
and what has been fixed. Add to it after each test; move an issue to **Fixed** when a run shows it gone.

## How it works

1. **Switch:** Settings → Media → Comic-it (off by default; `/api/comic`, app_kv `comic:settings`, which also holds the
   art style). When on, a **Comic it** button sits beside the picture button in the message box.
2. **What a page covers:** the messages since the chat's last page (`chat.comic.upTo`), at most 16, with the previous
   page's `recap` so the story continues (`messagesSinceLastPage` in `lib/chat/comic.ts`).
3. **Script:** the background model (local memory model) writes panels, speech balloons and narration, never
   coordinates. Prompt: the editable `image.comic-script` (Settings → Prompts → "Comic page script"). Route:
   `/api/image/comic-script`. The answer is cleaned by `cleanComicScript` (`lib/media/comicPage.ts`).
4. **Layout:** code lays out the page (`layoutComicPage`): a grid of up to 6 panels on 1024×1536, a box for every
   figure, balloon and caption, and the global description (art style, grid, each person's look, the lettering rule).
   Names never reach the picture: people are referred to by a short form of their look.
5. **Prompt:** `compileLayout` turns the layout into MOSS-Image's Layout prompt (`abs_centralized`, `yxyx`), the same
   conversion as the official `moss-image-prompt-enhancer` compiler.
6. **Drawing:** MOSS-Image through the bundled `moss-photo` workflow, with `COMIC_NEGATIVE` (that workflow's own
   negative refuses "cartoon, illustration, text"), plus any LoRAs (see **LoRAs**). The page appears in the chat as a
   page card (`ComicPageCard`): the message carries `comic` (title, panels, what it covered, the recap, the script and,
   once drawn, the page kept as an asset). **Redo page** writes a new script for the same stretch; **Re-draw** draws the
   same script again; deleting the latest page moves the chat's boundary back to the page before.

Looks come from each person's image tags; without tags, from the appearance part of their description
(`lookFromDescription`), and the button says who has no tags.

## Test log

| Date | Chat | Pages | Result |
|---|---|---|---|
| 13 Nov | Night Shift demo (branch), 3 messages | 1 (5 panels) | Worked first time: lettering exact, June consistent. Narration put in a balloon; Nora drawn in the booth though only on the phone. |
| 13 Nov | Storm on Quay Street (branch), group of 3, 3 rounds of turns | 3 (6, 4, 6 panels), ~30 s each to draw | Each page continued exactly after the last (checked by `comic.upTo` and by reading). Found the issues below. |
| 13 Nov | "Brakka Stonehide & Sefa Vire": new fantasy cast (half-orc ranger in crimson, elf arcanist in midnight blue and gold, persona Tam, red-haired courier in moss green), 4 rounds of 3 turns in a wraith-haunted shrine | 4 (6 panels each) | Each page continued exactly. **No blending at all across 24 panels**: three people who differ in species, build, hair and one signature colour stay apart, which supports idea 1 under issue 1. Found issues 6–8 below; fixed what the prompt and layout can. |
| 13 Nov | Same chat, epilogue page 5, after the round-two fixes, with the style LoRA `ApricotPaper_MOSS_Style_V1` at 1.0 | 1 (6 panels) | ComfyUI's history shows `fablechat_lora_1` (LoraLoaderModelOnly) feeding the KSampler. The page took the LoRA's look (watercolour on warm paper) and kept all three people apart; the page card covered messages 29–32 only, was kept as an asset, and carried the "Ash Wraith" extra with a look. Panels varied in shot. One balloon garbled ("Iler Is leler…", issue 8); the other five lettered cleanly. |

## Open issues

### 1. Two similar people blend (MOSS)

**Seen:** page 3 of the 13 Nov run. Nora (auburn bob, freckles, green jacket) took June's dark hair, gold hoops and
glasses in two panels; on page 2 June wore Nora's green jacket and camera. Both are described apart, numbered, with
"never mixed: each keeps only their own hair, face and clothes".

**Ideas to try:**
- Give each person a distinct signature colour in their look ("always in a green jacket", "always in a cream cardigan")
  and say it in each figure box and balloon description.
- Fewer people per panel (one figure in close-ups), or put the person's full look in the panel caption as well as the
  figure box.
- Order the global list the same way the figures appear left to right.
- Try `moss_image_base` against the SFT model, or a higher CFG for long prompts.

**Evidence (13 Nov, fantasy run):** with clearly different people (species, build, hair, one signature colour each)
nothing blended in 24 panels. So the strongest fix is in the looks themselves: give similar characters a signature
colour or item. A hint for this in Fill from description, or in the editor, is worth trying.

### 2. A line given to the wrong speaker

**Seen:** page 3: "Same time next storm" appeared as Nora's narration caption and again as a balloon from Elias.

**Seen again (fantasy run):** "It's here. The wind knows." given to Brakka (Tam asked "It's here, isn't it?"); "Hold.
The wraith's not coming." never said by anyone. The script prompt now says to take a balloon from what THAT person said,
shorten but never invent or move a line; not yet re-tested.

**Ideas to try:**
- After cleaning, drop a balloon whose words match another panel's balloon or caption on the same page.
- In the script prompt, ask for balloons only from lines that person actually said in the excerpt; check by matching
  balloon text against the excerpt lines for that speaker (and drop or reassign when it isn't theirs).

### 3. Balloon tails don't always point at the speaker

**Seen:** 13 Nov page 1: Nora's "Would you two mind…" pointed at Elias. Improved by placing balloons on the speaker's
side, but MOSS still decides the tail.

**Ideas to try:** state the speaker's position in the balloon caption ("tail down to the woman on the left"); keep one
balloon per figure per panel.

### 4. Stray background text

**Seen:** first page: signs reading "PPORT TWO LINE PLINKS", "LINTNS". The description says "no other text anywhere"
and the negative has "extra text".

**Ideas to try:** add "plain unlabelled signs and screens" to the setting; add "signs with writing, posters" to the
negative.

### 5. Story slips from the small model

**Seen:** first page: Nora drawn in the booth when she only phoned in (prompt since told about phone calls); page 3's
first panel description repeated page 2's opening shot (the balloons were right).

**Ideas to try:** a larger script model when the GPU is free; pass the previous page's panel list rather than a
one-line recap; test with `long-chat`-style runs.

### 6. The turning point left out (fantasy run, page 3)

**Seen:** Tam reading the letter aloud ('To my student Sefa… Finish the ward.') is not on the page, and Tam holds his
knife instead of the letter. The line was in 'single quotes' inside an action, which the prompt did not count as speech.

**Done (not yet re-tested):** the script prompt now counts 'single quotes' and letters or signs read aloud as balloons,
says never to leave out the turning point, and to show what people hold when it matters.

### 7. Near-duplicate panels (fantasy run, pages 2, 3 and 4; Night Shift page 1)

**Seen:** two panels in a row with the same people come out as nearly the same picture (same framing, same pose).

**Done (unit-tested, not yet re-drawn):** the layout adds "a clearly different camera angle and distance from the panel
before it" to such a panel, and the script prompt asks for wide, medium and close-up in turn.

### 8. MOSS lettering typos

**Seen:** "getes in" (for "gets in"), "wraitht's" (for "wraith's"). The text sent was right; MOSS slipped.

**Ideas to try:** shorter balloons (8 words), larger balloon boxes for long lines, a higher CFG; compare
`moss_image_base`. Possibly avoid apostrophes next to unusual letter pairs.

## Foreseen (review of the code, 13 Nov; not yet seen in a run)

Most of the review's list was fixed in the second round (see **Fixed**). Still open:

**I. Adult content and young-looking art.** Ruled not a concern for this app (mature stories are fine). Kept here only
as a note: stylised art can make an adult look young, so a look that says "adult" or an age helps.

**L (part). Wider text support.** Balloon wrapping assumes ~15 px per Latin character; CJK and long German words will
wrap badly. `ACTION_ONLY` knows English words only. Manga reads right to left; the grid assumes left to right.
(Names with accents are now removed from the picture.)

**M. Smaller things.** The art style and style LoRA are global (a per-chat style would let one chat be manga and
another noir); the on/off switch is cached for 10 s and only rechecked when you change chat; MOSS's settings
(30 steps, 1024×1536) are fixed, so a speed LoRA (4 or 8 steps) can't be used as it should; there is no end-to-end
test, only unit tests.

## LoRAs

- **Style LoRA** (optional): Settings → Media → Comic-it. The LoRAs ComfyUI has are listed with MOSS-Image ones first;
  others are marked "(not MOSS)" because they won't load on MOSS. Kept in `comic:settings` as `styleLora`.
- **A character's comic LoRA** (optional): their look, "LoRA for comic pages" (`image.comicLora`: name, trigger,
  weight), kept apart from their usual LoRA because that one is for another model. The trigger word leads their look.
  Only the LoRAs of people on the page are applied.
- **How:** `moss-photo` has `_meta.fablechat.loraChain: true`, so `applySettingsToWorkflow` calls `chainLoras`
  (`lib/media/loraChain.ts`), which inserts `LoraLoaderModelOnly` nodes in front of every sampler (at most 8).

## Fixed

| Issue | Fix | Checked |
|---|---|---|
| Narration put in a speech balloon ("The ON AIR light hums red") | Script prompt: balloons are only words said aloud | Pages 2 and 3 |
| An action as a balloon ("sigh.") | `ACTION_ONLY` filter in `cleanComicScript` | Unit test |
| Names printed in the picture ("NORA NOKI" on a shirt) | Names replaced by a short form of the look in everything drawn | Pages 2 and 3, unit test |
| A persona without tags merged into another character | `lookFromDescription`; the button names who has no tags; demo personas ship with tags | Page 2 (Nora distinct) |
| Group chat: "Elias, …" not recognised, so the wrong member answered | First or full name, whole word (`pickSpeaker`) | Live, unit test |
| MOSS's photo negative refused illustration and text | `COMIC_NEGATIVE` | First page |
| A. Long chats overflowing the script model | Ollama calls send `num_ctx: 8192`; the excerpt is cut at 14,000 characters, earliest first, never to nothing | Unit test |
| B. A branch lost where the last page ended | `branchChat` remaps `chat.comic.upTo` and each card's `fromId`/`upToId`; a boundary after the branch point falls back to the last kept card | Unit test |
| C. A deleted or re-rolled covered message lost the boundary | `nextPageStart` falls back to the last page card's position | Unit test |
| D. The card showed the layout JSON | `ComicPageCard` (title, panel count, page); the script is kept on `message.comic` | Page 5 |
| E. No way to redo or restart a page | **Redo page** (new script) and **Re-draw** (same script); deleting the latest page moves the boundary back to the page before | Unit test (delete); Redo/Re-draw not yet pressed in a run |
| F. Pages lived only in ComfyUI's output | Each finished page is stored with `storePicture` (`comic.page`) | Page 5 |
| G. Texts and calls drawn as if in the room | The excerpt is built with `historyContent` | Code |
| H. "You" could change face between pages | The persona is kept on `chat.comic.personaId` | Page 5 |
| J. Recurring extras drifted | The script names extras with a look; they are kept on `chat.comic.extras` (at most 4 a page) | Page 5 (Ash Wraith), unit test |
| K. The script model stayed in VRAM while MOSS drew | The script call sends `keep_alive: 0` | Code |
| L (part). Accented names lettered into the picture | Name removal uses Unicode letter boundaries | Unit test ("Zoë") |
