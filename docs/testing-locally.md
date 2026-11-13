# Testing on your own machine

Everything below was built and checked in a cloud container against stand-in services (a fake Ollama and a fake
ComfyUI that record what they receive). What a real model, a real GPU and a real browser add is listed here, so it can
be checked where those exist. Tick items off in `docs/plan-contact-media.md` as they are confirmed.

## Get it

```bash
git clone https://github.com/Fablestarexpanse/CharacterBinderChat.git
cd CharacterBinderChat
./install.sh          # Windows: install.bat (once)
./start.sh            # Windows: start.bat
```

Already have a copy? Run `./update.sh` (Windows: `update.bat`): it pulls and rebuilds what changed.

## The automated checks

```bash
npm install
npm test              # ~500 unit tests, no server or model needed
npx tsc --noEmit      # types
npm run lint
```

One unit test, "the Python spec is still where AGENTS.md says it is", fails unless the `fable_drawer2/` reference
implementation sits next to this folder. Everything else should pass.

The API suite needs a running server on a scratch database:

```bash
FABLE_DB_PATH=/tmp/fable-test.db npm run dev -- -p 3001
FABLE_TEST_URL=http://localhost:3001 npm run test:api      # in a second terminal
```

## What only a real setup can confirm

Use a scratch database for these (`FABLE_DB_PATH=/tmp/fable-try.db ./start.sh`) so nothing touches your real library.
A fresh one opens on the Port Ellery demo story (June and Elias).

**1. Likeness with a real ComfyUI** (plan B4, not yet confirmed anywhere)
- Install the ComfyUI_IPAdapter_plus nodes, insightface, and the FaceID Plus V2 SDXL model and LoRA.
- Workflows → **Check nodes**: "SDXL Likeness (IP-Adapter FaceID)" should say all nodes installed.
- June's editor → How images draw June: add a clear face photo under Reference pictures and tick
  **Make pictures look like June**.
- Images tab → Draw as June → generate five pictures with different prompts. Do they look like the same person?

**2. Photos from a character** (plan C3–C5)
- Settings → Contact & media → **Allow photos and messages from characters**.
- June's editor → Contact → **May send you photos**.
- Ask him for a photo in chat. With a real model, does he use `[photo: …]` when it fits (and not every reply)?
- Review the prompt, take it, then try Redo, an earlier take, Use as portrait and Remove → Undo.

**3. Texts** (plan C1)
- The phone button in the message box. Do real replies read like texts (short, no narration)?
- Settings → Prompts → "Replying by text message": edit it and see the next reply change.

**4. Reaching out** (plan D)
- June's editor → Contact → **May contact you**, set **Wait at least** to 30 minutes.
- Leave the chat for 30+ minutes with FableChat open in a tab (another tab or app in front is fine).
- Expected: one text, with "June reached out because …" under it, and an unread badge if you were elsewhere.
- Turn on **Notifications** in Contact & media: the browser should ask once, then notify for the next one. Not yet
  observed anywhere (the cloud container has no display).
- In development (`npm run dev`) you can skip the wait: open the browser console and run `fableOutreachTick()`. It
  says what it did or why it held back.

**5. Narrow screens on a real phone** (plan 1.4): open FableChat from your phone (see "Using it from another device"
in the README). Only phone emulation has been checked so far.

**6. Windows**: `start.bat` has never been run.

Anything that goes wrong: note what you did and what you saw; that is enough to fix it from here.
