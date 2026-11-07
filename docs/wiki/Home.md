# FableChat help

FableChat is a local-first app for long, character-driven stories with an AI model. It runs on your own computer,
remembers what happens in each story, and can give characters faces, voices and a phone.

**New here?** Start with [Getting started](Getting-Started.md), then [Choosing a chat model](Chat-Models.md).

## Guides

| Page | What it covers |
|---|---|
| [Getting started](Getting-Started.md) | Installing, the first run, the demo story, updating |
| [Choosing a chat model](Chat-Models.md) | Ollama, LM Studio, OpenRouter, custom model ids, the picture reader |
| [Characters and personas](Characters-and-Personas.md) | The Library, making and editing characters, who *you* are, importing and exporting cards |
| [Lorebooks and scenarios](Lorebooks-and-Scenarios.md) | World details that appear when they are mentioned, and reusable scene setups |
| [How memory works](Memory.md) | Core Memory, the knowledge graph, pinning and locking facts, Peek Prompt, branching |
| [Texts, calls and pictures](Texts-Calls-and-Pictures.md) | Characters who text and call you, photos both ways, the picture reader |
| [Images and video](Images-and-Video.md) | ComfyUI, workflows, a character's look, likeness, Image Studio, clips |
| [Voice and the narrator](Voice-and-Narrator.md) | Setting up voice, giving characters a voice, Play, Read aloud, the narrator |
| [Settings, data and backup](Settings-and-Backup.md) | The Settings tabs, backups, using FableChat from another device |
| [AI agents (MCP)](AI-Agents-MCP.md) | Letting Claude or another agent build your characters |
| [Troubleshooting](Troubleshooting.md) | When something does not work |

## Quick answers

- **Where is my data?** In one file on your computer, `data/fablestore.db`. Back it up from
  **Settings → Data & backup → Download full backup**.
- **Does anything go to the internet?** Only what you choose: an OpenRouter model, or a cloud media service you add.
  Ollama, LM Studio, ComfyUI and the voice server all run on your computer.
- **Can I start over with a character?** Start a **new chat** with them: memory belongs to a chat, so a new chat is a
  fresh start. See [How memory works](Memory.md).
- **Something broke.** See [Troubleshooting](Troubleshooting.md), or open an issue on GitHub with what you did and what you
  saw.
