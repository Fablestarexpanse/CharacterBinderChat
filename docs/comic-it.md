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
| 13 Nov | "Brakka Stonehide & Sefa Vire": new fantasy cast (half-orc ranger in crimson, elf arcanist in midnight blue and gold, persona Tam, red-haired courier in moss green), 4 rounds of 3 turns in a wraith-haunted shrine | 4 (6 panels each) | Each page continued exactly. **No blending at all across 24 panels**: three people who differ in species, build, hair and one signature colour stay apart, which supports idea 1 under issue 1. Found issues 6–8 below; fixed what the prompt and layout can. |

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

Ranked by how likely they are to bite. **Confirmed** means the code was checked and does this today.

**A. Long chats overflow the script model's context (confirmed).** `callOllama` sends no `num_ctx`, so Ollama uses
its default window (2–4k tokens on most installs); the built-in model runs at 8192. Sixteen long role-play replies can
exceed that, and Ollama cuts from the *front*, which is where the instructions are. Expect garbled or missing scripts
on long, wordy chats. Fix: set `num_ctx` for these calls, and cap the excerpt by tokens (keep the newest lines, summarise
the rest) rather than by 16 messages.

**B. Branching a chat breaks "where the last page ended" (confirmed).** A branch copies `chat.comic`, but gives every
message a new id, so `upTo` no longer matches and the next page starts again from the very beginning. Fix: remap
`comic.upTo` through the branch's id map (or drop it when the branch point is before it).

**C. Deleting or re-rolling a covered message has the same effect.** If the message `upTo` points at is deleted or
replaced, the page boundary is lost and the next page re-covers the whole chat. Fix: fall back to the comic card's own
position in the chat (the page card sits after what it covered).

**D. The page card shows the raw layout JSON (confirmed).** `ImageCard` prints `job.prompt` as the caption and puts it
in Re-roll's edit box: a wall of coordinates. Fix: a comic card (or a `kind: "comic"` on the job) that shows the title
and panel count, keeps the script, and offers **Redo page** (new script for the same stretch) separately from
**Re-draw** (same script, new seed).

**E. No way to redo or restart a page.** Deleting a page doesn't move `upTo` back, so you can't get a better version
of the same stretch, and there is no "start the comic over". Fix: Redo page on the card; a reset in the chat menu.

**F. Pages live only in ComfyUI's output folder.** Like scene pictures, the card points at ComfyUI's URL. If ComfyUI is
off, moved or its output cleaned, the pages are gone ("Image no longer available"), and the chat export can't fetch them.
Comic pages are worth keeping: store each finished page as an asset (`storePicture`), as photo messages do.

**G. Texts and phone calls are drawn as if everyone is in the room (confirmed).** The excerpt is built from raw content,
not `historyContent`, so "(by text)" / "(on the phone)" are lost. Fix: use `historyContent` so the script knows.

**H. Who "you" are can change (confirmed).** A chat doesn't record which persona it was played with; the page uses
whichever persona is active when you press the button. Switch persona between pages and "you" changes face.

**I. Adult content and young-looking art.** Comic pages ignore the undressed tags (fine) but nothing stops an explicit
scene from being drawn, and stylised art made Tam (19) look like a child. Before Comic-it is used with mature stories:
add `nsfw` to `COMIC_NEGATIVE` unless the user opts in, put "adult" in every figure's look, and never combine
undressed looks with comic pages.

**J. People the cast doesn't include drift.** The wraith / Master Elowen had no look, so MOSS invented one each page.
Fix: let the script name recurring extras with a one-line look, and carry those looks forward in the recap.

**K. GPU memory.** The script call doesn't ask Ollama to unload the memory model afterwards (the scene director sends
`keep_alive: 0`), so the 4B model can stay in VRAM while MOSS draws. On a smaller card this means slow pages or
out-of-memory. Fix: unload after the script, as the director does.

**L. Wider text support.** Balloon wrapping assumes ~15 px per Latin character; CJK and long German words will wrap
badly. Name removal uses `\b`, which misses names with accents ("Zoë"), so those could still be lettered into the
picture. `ACTION_ONLY` knows English words only. Manga reads right to left; the grid assumes left to right.

**M. Smaller things.** The art style is global (a per-chat style would let one chat be manga and another noir); the
on/off switch is cached for 10 s and only rechecked when you change chat; the button gives no progress while MOSS draws
(the card does); MOSS's settings (30 steps, 1024×1536) are fixed; there is no end-to-end test, only unit tests of the
layout and script cleaning.

## Fixed

| Issue | Fix | Checked |
|---|---|---|
| Narration put in a speech balloon ("The ON AIR light hums red") | Script prompt: balloons are only words said aloud | Pages 2 and 3 |
| An action as a balloon ("sigh.") | `ACTION_ONLY` filter in `cleanComicScript` | Unit test |
| Names printed in the picture ("NORA NOKI" on a shirt) | Names replaced by a short form of the look in everything drawn | Pages 2 and 3, unit test |
| A persona without tags merged into another character | `lookFromDescription`; the button names who has no tags; demo personas ship with tags | Page 2 (Nora distinct) |
| Group chat: "Elias, …" not recognised, so the wrong member answered | First or full name, whole word (`pickSpeaker`) | Live, unit test |
| MOSS's photo negative refused illustration and text | `COMIC_NEGATIVE` | First page |
