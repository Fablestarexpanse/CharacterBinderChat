# How memory works

Most chat apps forget once the conversation is longer than the model can read. FableChat keeps two kinds of memory for
every chat, and puts the right parts back into the prompt each time.

**Memory belongs to a chat, not a character.** A new chat with the same character is a fresh start. To continue where
you left off, choose **carry memories over** from a previous story when you start the new chat.

## Core Memory (always in the prompt)

The inspector's **Core Mem** tab: the character's current **mood**, their **relationship with you** (affection, trust,
desire, connection, mood), **commitments** they made, **recent emotional events**, **internal thoughts** and a running
**summary** of the story so far. It is rewritten after every exchange.

Relationships move gradually and remember hurt: a betrayal opens a slow recovery, and the character keeps it in mind
until it heals.

## The knowledge graph (found when relevant)

The inspector's **Memory** tab:

- **Facts** — things the story has established ("June works at WPEL 88.7"). When something changes, the old fact is
  kept as history (**Show history**) and the new one replaces it, so you can see what a character believed before.
- **Entities** — the people, places and things in the story. **Merge** joins duplicates.
- **Relationships** — the stats between characters.

The **Web** tab draws the story as a map; click a node to focus on it.

### Curating memory

On any fact:

- **Edit** it (editing also locks it).
- **Pin** it — always in the prompt, whatever is being talked about.
- **Lock** it — what the model writes later cannot replace it.
- **Add a fact** by hand at the top of the list.

### Why did they say that?

The **🧠** button under a reply shows the memory that shaped it.

## The memory model (runs on your computer)

Memory is written after every reply, and that work does not use your chat model. A chat model may be a paid cloud
one, and memory runs often, so FableChat uses a small free model on your own computer instead: **Qwen3 4B Instruct**
(2.5 GB). It also writes the prompts for scene pictures.

**Settings → Memory → Memory model** shows which model is in use and how to get one. There are two ways:

- **With Ollama.** If [Ollama](https://ollama.com) is installed, FableChat starts it when needed. Press **Download
  Qwen3 4B Instruct** once to add the model to Ollama.
- **Without Ollama: the built-in model.** Press **Set up the built-in model**. FableChat downloads
  [llama.cpp](https://github.com/ggml-org/llama.cpp) (about 37 MB) and the model (2.5 GB) into a folder you choose
  (`data/local-model` unless you change it) and runs it itself. Both downloads are fixed versions checked against a
  known fingerprint, so a changed or damaged file is refused. It uses your graphics card when it can, otherwise the
  processor, starts only when memory needs it and stops after ten idle minutes, so it does not hold memory you need
  for pictures or voice. **Stop now** and **Remove** are on the same card.

FableChat tries Ollama first, then the built-in model.

**Use my chat model when no local model is running** is a separate switch, off by default. Off: when neither local
model is there, memory waits and tells you why. On: memory uses the chat's own model instead, which costs money on a
paid model.

## Seeing the whole prompt

The **eye icon** in the chat header (**Peek Prompt**) shows exactly what the model receives: the last prompt sent, or
a live preview built the same way.

## Branching

**Branch from here** under any message makes a new chat up to that point, with the memory the story had *at that
moment*. Branches from recent messages are exact; very old ones are marked approximate.

## Tips

- Memory is written after each reply, by the memory model above. On a computer without a graphics card it is slower,
  so the inspector catches up a little later.
- Correct a wrong fact rather than arguing with the character: edit or lock it in **Memory**.
- Local Ollama with the `nomic-embed-text` model makes fact retrieval smarter. Without it, FableChat matches words.
