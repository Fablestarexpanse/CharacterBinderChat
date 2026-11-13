# Getting started

## What you need

- **[Node.js](https://nodejs.org) 22.18 or newer.** The LTS download is fine.
- **A chat model**, at least one of:
  - [Ollama](https://ollama.ai) or [LM Studio](https://lmstudio.ai), free and on your own computer;
  - an [OpenRouter](https://openrouter.ai) account and API key, for cloud models.

Images, video and voice are optional and set up later ([Images and video](Images-and-Video.md),
[Voice and the narrator](Voice-and-Narrator.md)).

## Install and start

1. Download the repository (green **Code** button → **Download ZIP**, then unzip it) or clone it with git.
2. Install it, once:
   - **Windows:** double-click **`install.bat`**.
   - **macOS / Linux:** in a terminal in that folder, run **`./install.sh`**.

   This downloads about 300 MB and builds the app; it takes a few minutes.
3. Start it, every time you want to use it:
   - **Windows:** double-click **`start.bat`**.
   - **macOS / Linux:** run **`./start.sh`**.
4. Your browser opens at **http://localhost:3000**. Keep the start window open while you use FableChat; **Ctrl+C**
   in it stops the app.

Starting again while FableChat is running opens the copy that is already running instead of starting a second one. If
port 3000 is busy it picks the next free one and tells you.

**Getting a new version:** close FableChat, then run **`update.bat`** (or **`./update.sh`**). It fetches the new version
with git and rebuilds only what changed. Your chats and characters (the `data` folder) are not touched. A copy downloaded
as a ZIP cannot update itself: download the new ZIP, move your `data` folder into it, and run install there.

## The first screen: a demo story

A new install opens in **Port Ellery**, a rainy harbour city. June, a late-night radio host, has just put your call on
air; you are Nora, a photographer new in town. Elias the baker is in the Library too, and there is a second persona
(Theo, a night nurse) and a lorebook for the city.

1. Pick a model in the dropdown at the top of the chat ([Choosing a chat model](Chat-Models.md)).
2. Type a reply and press **Enter**.
3. Open the inspector (the panel icon at the top right) and watch **Core Mem** and **Memory** fill in as the story goes.

Edit or delete any of the demo. Once deleted it stays deleted; **Library → Add the demo story** brings it back.

## Your own story

1. **Library → New character** (or drop a character card file anywhere in the window). See
   [Characters and personas](Characters-and-Personas.md).
2. **Library → Personas** → create who *you* are and choose **Use as me**.
3. On the character's card, press **Chat**.

## Updating

Download the new version over the old folder (your `data/` folder is kept) or `git pull`, then start the launcher
again: it notices the update and rebuilds. Take a backup first if you like
(**Settings → Data & backup → Download full backup**).
