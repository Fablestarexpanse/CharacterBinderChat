# Merging CharacterBinder into FableChat

> **History.** This was the plan for the merge; all five phases are done. What is still missing or could be
> better is in `docs/audit-2026-11.md`, and the work in progress is in `docs/plan-2026-11.md`.

**Goal:** one tool, one launch. CharacterBinder
(github.com/Fablestarexpanse/CharacterBinder, MIT) is a separate Vite app that
builds character, lorebook, persona, scenario and script cards and exports them
as Tavern-format PNGs. FableChat already imported those PNGs but could not make
them, so anyone using both ran two servers and moved files between them by hand.

## The decision

**FableChat's own data model becomes a superset of the card format. There is no
second library, no second editor and no second server.**

CharacterBinder's job is split into three pieces and each goes where it belongs:

| CharacterBinder piece | Where it lands | Why |
|---|---|---|
| PNG/JSON codec, Tavern V2 shape, platform converters | `lib/cards/` (pure, tested) | One implementation of the format, shared by import and export. FableChat had its own read-only copy of the codec; that is deleted. |
| The five card editors | FableChat's existing Characters / Lorebooks / Scenarios / Personas screens, extended | They already exist and already save to SQLite. Porting CharacterBinder's React 18 + Tailwind 3 components would mean a second UI language to maintain; the *logic* ports, the screens do not. |
| IndexedDB library, Archive zip | Dropped. SQLite is the library. A one-time **import of a CharacterBinder archive zip** carries existing collections over. | A second store of the same cards is the thing being removed. |
| MCP server + WebSocket bridge | Rebuilt as a thin MCP server over FableChat's HTTP API (phase 5) | The bridge existed because a Node process cannot reach a browser's IndexedDB. FableChat has a real server, so the pairing token, handshake and one-connection rule are no longer needed. |

## Phases

**Phase 1 — done.** Cards are first-class.
- `Character` gains the rest of the V2 spec: example dialogue, system prompt,
  post-history instructions, alternate greetings, creator, creator notes,
  version, and the platform `extensions` block (kept verbatim so export gives it
  back).
- `lib/cards/png.ts` reads **and writes** card PNGs; `lib/cards/tavern.ts` maps
  Character ↔ card both ways. Round trip tested field by field, and through a real
  PNG in the browser.
- Export from the Characters screen: PNG (art embedded) or JSON.
- The prompt now uses the new fields and expands `{{char}}` / `{{user}}` / `<BOT>` /
  `<USER>`. Before this, an imported card sent those placeholders to the model
  literally, and every field but five was discarded on import.

**Phase 2 — done.** Lorebooks, personas and scenarios to parity.
- Lorebook entries gain secondary keys, *selective* (primary AND secondary must
  match), case sensitivity, a memo, and a stored position. The first three change
  matching; `entryTriggered` stays the single rule shared by generation and the Lore
  tab. SillyTavern world-info spellings (`keysecondary`, numeric `position`) import.
- A character can own a lorebook (`Character.lorebookId`). Importing a card with an
  embedded `character_book` creates and links it; exporting a character embeds it;
  starting a chat with them includes their book.
- Lorebooks, personas and scenarios export as JSON (lorebooks and scenarios have no
  art, so no PNG; personas export a PNG with their avatar).
- Alternate greetings are offered in the new-chat dialog, with `{{user}}` filled in.
- **Position is stored, not applied.** All lore is injected as one `[World Lore]`
  block, so `before_char` / `after_char` round-trips but does not move text. Applying
  it would mean splitting that block around the character sheet.

**Phase 3 — done.** Quick Import and platforms.
- `lib/cards/textParser.ts` is CharacterBinder's parser unchanged (headed sections,
  W++, JSON, prose); its 29 tests came across through a small vitest shim
  (`tests/unit/_vitest.mjs`). "Quick import" in the character editor shows how the
  text would be split with a checkbox per field; it adds to filled fields rather
  than replacing them, and never drops text (unrecognised sections land in
  Description with their label).
- `lib/cards/platforms.ts` + `convert.ts`: SillyTavern, JanitorAI, Chub, Agnai,
  Venus, Backyard, RisuAI, generic. 48 ported tests, including "every platform
  writes every field it claims to keep". Export has a platform picker and lists what
  *this* character has that the platform will drop. JanitorAI / Agnai / Backyard
  JSON now imports as a character.
- `lib/cards/validate.ts`: export refuses a card the spec would reject (no name or
  description) with the reason.
- Shapeless prose uses the keyword sorter only. The AI sorter was dropped (see
  below); wiring it to the Ollama/OpenRouter connection is a small follow-up.

**Phase 4 — migration done; three extras deliberately skipped.**
- **Archive import.** Drop or pick a CharacterBinder "Archive All" `.zip` on the
  Characters screen (or anywhere in the window) and the whole collection comes
  across: characters (art becomes the avatar, embedded lorebooks created and
  linked, all card fields kept), lorebooks, personas, scenarios. Characters are
  saved directly rather than opened for review one by one. Re-running is safe:
  anything already present is skipped, and two *different* characters sharing a
  name are both kept. A persona the user already chose is never changed. Tested with
  a real JSZip-built archive and with hostile ones (decompression bombs, lying size
  headers, truncation).
- **Not ported, on purpose:** the per-field token counter (Peek Prompt already
  shows real token counts for what is sent), built-in templates (Quick Import and
  card import cover starting from existing text), the Decode PNG inspector (a
  JSON export of any card shows the same), and script cards (no home in a chat
  app). Each is a small addition if wanted.

**Phase 5 — done, with server-authoritative edits.** The MCP server is a thin stdio
proxy (`mcp/`) over a new card API, and the sync layer changed underneath it:
- Every write bumps a global **revision**; rows remember the revision that wrote them
  and deletions leave tombstones. `GET /api/state/changes?since=N` returns what
  changed after N.
- `PATCH /api/state` carries the tab's **base revision**. A write over a shared row
  (characters, lorebooks, personas, scenarios, presets) that changed on the server
  since is skipped and reported: the **server's copy wins**. Chats are the opposite:
  only the generating tab writes them, so **the browser's copy wins** if it has
  unsaved changes (a streaming reply is never overwritten).
- An open tab **polls** (3 s, and on focus), **pulls before every save**, and merges
  with a pure, tested policy (`lib/sync/remote.ts`). A conflicting local edit is
  dropped with a warning that names it.
- `/api/cards/<type>` creates, changes and deletes cards **in SQLite, in card
  format**. Unknown or mistyped fields are refused with the allowed list. Every
  change keeps the previous version and an event naming who made it; the tab shows it
  with **Undo**, and agents can undo too (`undo_change`).
- Because the server is now the authority, nothing about the agent path requires the
  app tab to be open, and a second device would see the same changes the same way.

Not synced between tabs: list order (a reorder is not a content change), the default
preset and global instructions. Neither is something an agent edits.

## What is deliberately not ported
- **The in-browser WebLLM sorter** (a 2.2 GB WebGPU model download). FableChat has
  connections to real model servers; use them.
- **The WebSocket bridge and pairing token** (see table).
- **The separate Library screen and IndexedDB.**

## Known limits of phase 1
- An exported PNG embeds the character's **avatar**, which FableChat stores
  downscaled to 512px JPEG. Original full-resolution art is not kept, so an
  imported-then-exported card has smaller art than the source. The export says so
  when a character has no art at all.
- `fable_drawer2/` and the eval harness mirror `promptBuilder.ts` by hand
  (see its header); `tests/memory-eval/long-chat.mjs` does not yet know about the
  new card sections. They only matter for characters that use the new fields.

## Retiring CharacterBinder
Once the above is settled: publish a final CharacterBinder release whose README
points here and says how to import an archive, then archive the repository. That
is a repository setting, so it is yours to do.
