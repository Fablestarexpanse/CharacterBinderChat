# Merging CharacterBinder into FableChat

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

**Phase 2 — lorebooks, personas, scenarios to parity.** Lorebook entries gain
secondary keys, selective, case-sensitive and position (the import currently drops
all four); character ↔ lorebook link so "export with lorebook" embeds a
`character_book`; persona and scenario cards exported as PNG/JSON; alternate
greetings offered in the new-chat dialog.

**Phase 3 — Quick Import and platforms.** Port `cardTextParser.ts` (pure, 664
lines, with its tests) as "paste anything" in the character editor; port the
platform registry and converters so export can target Janitor, Chub, Agnai, Risu
etc. and warn which fields a platform drops. Shapeless prose goes to the
Ollama/OpenRouter connection FableChat already has, not a second in-browser model.

**Phase 4 — migration and the rest of the editor.** Import a CharacterBinder
archive `.zip` (its manifest lists every card with type). Token counter per field,
templates, Decode PNG inspector, script cards (decide whether they belong).

**Phase 5 — MCP server over HTTP,** then archive the CharacterBinder repo with a
README pointing here.

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
- Lorebooks do not yet export with a character (phase 2).
- `fable_drawer2/` and the eval harness mirror `promptBuilder.ts` by hand
  (see its header); `tests/memory-eval/long-chat.mjs` does not yet know about the
  new card sections. They only matter for characters that use the new fields.
