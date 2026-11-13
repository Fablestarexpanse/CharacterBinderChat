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
   negative refuses "cartoon, illustration, text"). The page appears in the chat as an image card.

Looks come from each person's image tags; without tags, from the appearance part of their description
(`lookFromDescription`), and the button says who has no tags.

## Test log

| Date | Chat | Pages | Result |
|---|---|---|---|
| 13 Nov | Night Shift demo (branch), 3 messages | 1 (5 panels) | Worked first time: lettering exact, June consistent. Narration put in a balloon; Nora drawn in the booth though only on the phone. |
| 13 Nov | Storm on Quay Street (branch), group of 3, 3 rounds of turns | 3 (6, 4, 6 panels), ~30 s each to draw | Each page continued exactly after the last (checked by `comic.upTo` and by reading). Found the issues below. |

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

### 2. A line given to the wrong speaker

**Seen:** page 3: "Same time next storm" appeared as Nora's narration caption and again as a balloon from Elias.

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

## Fixed

| Issue | Fix | Checked |
|---|---|---|
| Narration put in a speech balloon ("The ON AIR light hums red") | Script prompt: balloons are only words said aloud | Pages 2 and 3 |
| An action as a balloon ("sigh.") | `ACTION_ONLY` filter in `cleanComicScript` | Unit test |
| Names printed in the picture ("NORA NOKI" on a shirt) | Names replaced by a short form of the look in everything drawn | Pages 2 and 3, unit test |
| A persona without tags merged into another character | `lookFromDescription`; the button names who has no tags; demo personas ship with tags | Page 2 (Nora distinct) |
| Group chat: "Elias, …" not recognised, so the wrong member answered | First or full name, whole word (`pickSpeaker`) | Live, unit test |
| MOSS's photo negative refused illustration and text | `COMIC_NEGATIVE` | First page |
