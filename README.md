# CharacterBinderChat

**A local-first AI roleplay studio.** CharacterBinderChat (FableChat) is a Next.js app that lets you have deep, persistent, character-driven conversations with local or cloud LLMs — with a two-layer memory system that keeps the AI aware of everything that has happened in your story.

---

> **Screenshot coming soon** — drop `docs/screenshot.png` in the repo to display it here.
<!-- ![CharacterBinderChat UI](docs/screenshot.png) -->

---

## What it is

Most AI chat apps forget everything the moment the context window fills up. CharacterBinderChat doesn't. It layers two complementary memory systems on top of any LLM:

- **Drawer 1 — Core Memory Block** (always in context): the character's current mood, emotional state, relationship with you, active commitments, internal thoughts, and a running narrative summary. Updated by the LLM after every exchange.
- **Drawer 2 — Bi-temporal Knowledge Graph** (retrieved): a SQLite graph of facts, entities, and relationship stats extracted from every conversation. Facts carry story-time and wall-time timestamps so you can ask "what did they believe *before* that happened?"

The result: characters that remember, grow, and feel consistent over hundreds of messages.

---

## Features

| Area | What's wired |
|------|-------------|
| **Chat** | Real streaming from Ollama, LM Studio, or OpenRouter. Tokens appear as they arrive. |
| **Characters** | Card-based character system with avatar, description, personality, scenario, tags. |
| **Core Memory (Drawer 1)** | Per-character JSON document: mood (valence/arousal/dominance), 5-axis relationship stats, commitments, emotional events, internal thoughts, narrative summary. LLM rewrites it after each response. |
| **Knowledge Graph (Drawer 2)** | Bi-temporal SQLite graph. Entities, facts, relationship stat axes (affection / trust / desire / connection / mood), commitments. Auto-extracted by LLM after each message. |
| **Inspector Panel** | Right-side panel with tabs: Character · Core Mem · Memory · Summary · Lore · Image Studio |
| **Model Selector** | Live model list fetched from all connected providers, grouped by provider. |
| **System Status** | Sidebar shows real-time connection status + loaded model name for each provider. |
| **Settings** | Per-provider test button: connects, fetches model list, shows "Connected · 3 models" or error. |
| **Image Generation** | `/image <prompt>` command routes to ComfyUI. |

---

## Tech stack

- **Frontend**: Next.js 16 (App Router, Turbopack), Tailwind CSS, Zustand
- **Database**: `better-sqlite3` — synchronous SQLite, zero config, runs in the Next.js server process
- **Providers**: Ollama · LM Studio · OpenRouter (OpenAI-compatible) · ComfyUI
- **Memory**: Custom bi-temporal schema + Core Memory JSON document

---

## Getting started

### Prerequisites

- Node.js 18+
- At least one LLM provider running locally:
  - [Ollama](https://ollama.ai) (default: `http://127.0.0.1:11434`)
  - [LM Studio](https://lmstudio.ai) (default: `http://127.0.0.1:1234`)
  - Or an [OpenRouter](https://openrouter.ai) API key

### Install & run

```bash
git clone https://github.com/Fablestarexpanse/CharacterBinderChat.git
cd CharacterBinderChat
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The SQLite database is created automatically at `data/fablestore.db` on first run. No migrations needed.

### Configuration

All provider settings are in the **Settings** panel inside the app — no `.env` required for local providers. For OpenRouter, paste your API key in Settings → OpenRouter.

Optional env vars:

```env
FABLE_DB_PATH=/path/to/your/fablestore.db   # custom DB location
```

---

## Project layout

```
fablechat/
├── app/
│   ├── api/
│   │   ├── chat/core-memory/     # Drawer 1 CRUD + LLM refresh
│   │   └── drawer/               # Drawer 2: entities, facts, stats, extract
│   └── page.tsx
├── components/
│   ├── chat/                     # ChatHeader, ChatInput, MessageItem
│   ├── inspector/                # CharacterTab, CoreMemoryTab, MemoryTab, SummaryTab…
│   └── sidebar/                  # Sidebar, SystemStatus
├── lib/
│   ├── chat/                     # promptBuilder, coreMemoryStore, memoryRewriter, tokenBudget
│   ├── db/                       # FableStore (better-sqlite3), schema, models
│   ├── providers/                # Ollama, LMStudio, OpenRouter, ComfyUI adapters
│   ├── services/                 # memoryUpdates helpers
│   └── store/                    # Zustand client store
└── data/
    └── fablestore.db             # auto-created SQLite database
```

---

## How the memory system works

```
User sends message
       │
       ▼
 fetchCoreMemory()          ← GET /api/chat/core-memory
       │
       ▼
 buildSystemPrompt()        ← character + mood + relationship + thoughts + narrative
       │
       ▼
 provider.streamChat()      ← Ollama / LM Studio / OpenRouter
       │
       ▼
 Response streams in        ← updateMessageContent() per token
       │
       ▼
 [parallel after complete]
  ├── /api/drawer/extract   ← Drawer 2: LLM extracts entities/facts/stats → SQLite
  └── /api/chat/core-memory/refresh  ← Drawer 1: LLM rewrites mood/persona/narrative
```

---

## Roadmap

- [ ] Character creation UI
- [ ] Lorebook keyword injection
- [ ] Group chats (multiple characters)
- [ ] GPU / VRAM monitoring
- [ ] Export chat as story document
- [ ] Persona editor (edit Core Memory directly in UI)
- [ ] Mobile layout

---

## License

MIT
