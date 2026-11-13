# Settings, data and backup

## Settings

**Settings** (sidebar) is split into tabs:

| Tab | What is in it |
|---|---|
| **Appearance** | Light, dark or match system; nine accent colours or your own. |
| **Chat models** | Ollama, LM Studio and OpenRouter, and the picture reader ([Choosing a chat model](Chat-Models.md)). |
| **Memory** | How memory is written and retrieved ([How memory works](Memory.md)). |
| **Media** | Image, video and voice connections, voice setup, the narrator, saving media to a folder. |
| **Contact** | Texts, calls and photos: the master switch, quiet hours, limits, sounds ([Texts, calls and pictures](Texts-Calls-and-Pictures.md)). |
| **Prompts** | The instructions FableChat sends behind the scenes, which you can edit and reset. |
| **Data & backup** | Backup, restore and export. |

## Your data

Everything is in one SQLite file, **`data/fablestore.db`**, saved a moment after every change. Clearing the browser
loses nothing. Open tabs pick up changes made elsewhere within a few seconds.

## Backing up

**Settings → Data & backup → Download full backup** saves one file with everything, memory included. It never contains
your API keys.

**Restore from a backup…** shows what a backup contains before it replaces anything, and keeps the database it
replaces.

The **JSON export** is a portable copy of your cards and chats **without memory** — handy for moving cards, but not a
backup.

**One chat** can be exported from its row in **Chats** or **Archive** (the download button). Choose:

- **Web page**: opens in any browser and prints to PDF; pictures and clips are inside the page.
- **Markdown** or **Plain text**: for notes apps and editors.
- **SillyTavern chat** (.jsonl): imports into SillyTavern and apps that read its chat files (words only).
- **FableChat (full)** (.json): every message and field, optionally with the chat's memory (facts and Core Memory).

Tick **Pictures**, **Clips** and **Spoken replies** to include them. Apart from the web page, a chat with media comes as
a .zip holding the file and a media folder. An image card's picture is fetched from ComfyUI, so ComfyUI must be running
for it; anything that could not be fetched is left out and the dialog says how many.

API keys are encrypted with a key in `data/.fable-secret`. Do not share that file.

## Using FableChat from another device

By default FableChat only answers on the computer it runs on. To use it from your phone or another computer on your
home network, set a password and start it listening on the network:

```bash
FABLE_PASSWORD=choose-one npx next start -H 0.0.0.0
```

Then open `http://<your computer's address>:3000` on the other device and sign in with that password. This is plain
HTTP: fine at home, not on an untrusted network. Put it behind HTTPS (a reverse proxy or Tailscale) before going
further.

## Optional environment variables

```env
FABLE_DB_PATH=/path/to/fablestore.db    # where the database lives (default data/fablestore.db)
FABLE_PASSWORD=choose-one               # needed to use FableChat from another device
FABLE_SECRET_KEY=<64 hex characters>    # keep the API-key encryption key off disk
```
