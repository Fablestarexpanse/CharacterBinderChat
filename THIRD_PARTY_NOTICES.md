# Third-party notices

FableChat includes code derived from the following project. Its license requires that the copyright and permission
notice below be included with that code, and this file is where it travels.

## CharacterBinder

<https://github.com/Fablestarexpanse/CharacterBinder>, licensed under the MIT License.

Derived files (ported or adapted; each begins with a comment saying so):

| In this repository | What it came from |
|---|---|
| `lib/cards/png.ts` | The PNG card codec (`pngMetadata.ts`, `carrierImage.ts`, `minimalPng.ts`) |
| `lib/cards/textParser.ts` | `cardTextParser.ts` (Quick Import), unchanged apart from a header |
| `lib/cards/platforms.ts`, `lib/cards/convert.ts` | The platform registry and converters, without the UI styling fields |
| `lib/cards/validate.ts` | The Tavern Card V2 validator |
| `lib/cards/tavern.ts` | The card types and blank-card/coercion helpers (the rest of the file is original) |
| `tests/unit/cardsPng.test.mjs`, `tests/unit/cardsTextParser.test.mjs`, `tests/unit/cardsConverters.test.mjs` | Tests ported from CharacterBinder's suite |

Not derived: `lib/cards/zip.ts` (written for FableChat to read CharacterBinder's archive format),
`tests/unit/_vitest.mjs` (an original adapter that lets those tests run here), and everything else in the repository.

```
MIT License

Copyright (c) 2026 PromptWaffle

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## npm dependencies

Packages installed from npm (Next.js, React, better-sqlite3, the MCP SDK and the rest) are not copied into this
repository; each is distributed under its own license, recorded in `package-lock.json` and in each package's own
`LICENSE` file under `node_modules/`.
