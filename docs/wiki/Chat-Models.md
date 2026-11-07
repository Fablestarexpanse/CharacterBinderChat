# Choosing a chat model

The model writes the characters' replies. FableChat calls it straight from your browser, so it works with a model on
your own computer or a cloud one.

## Connecting a provider

Open **Settings → Chat models**.

| Provider | What to do |
|---|---|
| **Ollama** | Install and start Ollama, pull a model (`ollama pull llama3.2`). The default address `http://localhost:11434` usually needs no change. |
| **LM Studio** | Load a model and start its local server (Developer tab). Default address `http://localhost:1234`. |
| **OpenRouter** | Paste your API key. It is stored encrypted on the server, never in the browser. |

The **System** box at the bottom left shows which providers are online.

## Picking a model for a chat

Use the dropdown at the top of the chat. It lists every model each connected provider reports; type in it to search
(`deepseek`). Each chat remembers its own model.

Not listed? Choose **＋ Custom model ID…** and type the id exactly as the provider names it:

| Provider | Format | Example |
|---|---|---|
| OpenRouter | `vendor/model` | `deepseek/deepseek-v3.2-exp` |
| Ollama | `name:tag` | `llama3.2:latest` |
| LM Studio | as its `/v1/models` lists it | `local-model` |

## Fine-tuning replies

The **gear icon** in the chat header holds this chat's temperature, top-p and maximum reply length. **Presets** (in the
sidebar) apply the same settings to many chats.

## The picture reader

When you send a picture in a chat, a model that can *see* describes it once, so every chat model understands it. Set
it in **Settings → Chat models → Picture reader**:

- **LM Studio:** a model with a vision projector (`mmproj`).
- **Ollama:** a vision model, for example `qwen2.5vl:7b` or `gemma3:12b`.
- **OpenRouter:** a model that accepts images, for example `google/gemini-2.5-flash`.

**Test** reads a small built-in picture. Without a reader, pictures still send and you can describe them yourself. See
[Texts, calls and pictures](Texts-Calls-and-Pictures.md).

## Which model is good?

Bigger models keep characters more consistent and follow the memory better. For local use, a 7–14B instruction model
is a good start; for long stories, a larger cloud model on OpenRouter helps. Memory is written after each reply by the
same model, so a very slow model makes the inspector update slowly.
