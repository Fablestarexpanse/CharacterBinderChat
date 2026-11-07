# Troubleshooting

## The app will not start

- **"node is not recognised" / wrong version** — install Node.js 22.18 or newer from [nodejs.org](https://nodejs.org)
  and run the launcher again.
- **An error mentioning `node-gyp`** — the database module needs build tools on your system; the message says which to
  install (on Windows, the Visual Studio C++ build tools).
- **Port 3000 is in use** — the launcher picks the next free port and prints it. Or close the other program.
- **It opens an old copy** — the launcher opens the copy already running. Stop it with Ctrl+C in its window and start
  again.

## A reply fails

"⚠️ Response failed" under a message means the model could not be reached.

- Is the provider running? The **System** box at the bottom left shows online / offline.
- Is the model loaded? In LM Studio, load it and start the server; in Ollama, `ollama pull <model>`.
- Is the model id right? Pick it from the list, or check the spelling under **Custom model ID**.
- OpenRouter: check your key and credit in **Settings → Chat models**.

Press **Regenerate** to try again.

## Memory does not update

- Memory is written after each reply by the chat model. A slow or very small model can take a while, or produce
  nothing usable; try a larger one.
- Check the inspector's **Memory** tab after a reply or two, not straight away.

## Pictures

- **ComfyUI shows offline** — start ComfyUI, then **Settings → Media → Test**.
- **A missing model file** — the error names the file; put it in the matching ComfyUI models folder.
- **Pictures do not look like the character** — fill in **How images draw them**, add reference pictures, or turn on
  **Make pictures look like** them ([Images and video](Images-and-Video.md)).
- **Characters never send photos** — both switches are needed: **Settings → Contact** (Contact & media) and the
  character's **May send you photos**.

## Voice

- **No speaker buttons** — voice is not set up yet: **Settings → Media → Voice → Download and set up**.
- **"… has no voice yet"** — pick a demo voice or upload a sample in their editor.
- **The first line is slow** — the model loads on the first line after a start (half a minute or so). Later lines are
  much faster.
- **"Something else is using port 7861"** — an older voice server is still running. Restart your computer, or stop the
  other program using that port.
- **Out of graphics memory** — stop the voice server (**Stop and free the GPU**) while making video, or close other GPU
  programs.

## Texts and calls never come

All of these must allow it: **Settings → Contact** on, not paused, not on Do not disturb, outside quiet hours, under the
daily limit, and the character's **May contact you** (and **May call you** for calls) on. A FableChat tab must be open.

## Something was deleted by mistake

- A card changed or deleted by an agent: **Undo** in the notice, or ask the agent to `undo_change`.
- Anything else: restore your latest backup (**Settings → Data & backup → Restore from a backup…**). The current
  database is kept, not overwritten.

## Still stuck?

Open an issue on GitHub with what you did, what you expected and what you saw (a screenshot helps). Do not include
your API keys or `data/.fable-secret`.
