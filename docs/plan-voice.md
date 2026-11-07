# Plan: voices for everything (VibeVoice, packaged for FableChat)

NEXT (2026-11-05): V1–V3 work in the app. Next: V4 play button and read-aloud. Re-run Download and set up once on a clean folder to confirm the fixed steps (tokenizer, vocal isolation) end to end.

Source: [SanDiegoDude/VibeVoice](https://github.com/SanDiegoDude/VibeVoice) (MIT), a fork of Microsoft's VibeVoice with
engine fixes worth keeping. We take the **engine**, not the app: no Gradio, no AI script writer. FableChat installs,
starts and stops a small local voice server of its own, and talks to it like any other media connection.

Status key: ✅ done · 🔧 in progress · ⬜ not started. Nothing is ✅ until observed in a running app.

## Decisions (Ronan, 2026-11-05)

| Question | Answer |
|---|---|
| Default model | **VibeVoice-1.5B** (5.4 GB, `microsoft/VibeVoice-1.5B`). 7B (18.7 GB) selectable later; Realtime-0.5B only once checked. |
| Who runs it | **FableChat manages it**: one click installs it into a folder you pick (Python venv, PyTorch, the engine, the model), FableChat starts it when needed and stops it to free VRAM. |
| First pass covers | Play button + read aloud · voice notes · spoken phone calls · group scenes as one multi-voice clip |
| Downloads | Only after you press **Download and set up**. Nothing is fetched before that, and the size is shown first. |

## What we keep from the fork

- **Load-on-demand worker**: each job runs in a child process that exits afterwards, so the OS reclaims all VRAM
  (PyTorch otherwise holds it). Matters because ComfyUI shares the GPU.
- **Vocal isolation** (Mel-Band-Roformer, ~100 MB, downloaded with the rest) on voice samples, then optional
  normalisation, so a sample with music behind it still clones cleanly.
- **Delayed end-of-speech + 267 ms silence**: fewer clipped last syllables (~60% → ~10% in his measurements).
- Multi-speaker scripts (`Speaker 1: …` up to 4) for group scenes.

## Responsible use

Microsoft's model card limits VibeVoice to research and puts cloning a real person without their recorded consent out
of scope. So: bundled demo voices are offered; adding your own sample asks you to confirm it is your voice, a voice
you have permission to use, or a made-up one; generated audio is labelled as AI in the app; and nothing is ever
exported as if it were a real recording.

## Phases

| # | Item | Acceptance | Status |
|---|---|---|---|
| V1 | **Voice server** (`voice/`, Python): OpenAI-compatible `POST /v1/audio/speech` (`input`, `voice`, `response_format` wav/mp3), `GET /v1/voices`, `POST /v1/voices` (upload a sample, isolated + normalised once), `POST /v1/dialogue` (up to 4 speakers), `GET /health`. Each job in a worker process that exits after an idle timeout. | One sentence in a demo voice comes back as audible WAV; VRAM returns to idle after the timeout | ✅ 2026-11-05 on the RTX 4090: "You are late, Kira…" in the Carter demo voice, 4.0 s WAV at 24 kHz, `*leans on the wall*` stripped; 34.6 s with model load, a warm 5.7 s line in 15.9 s (about 2.8× real time, sdpa attention, no flash-attn); the server takes about 6 GB of VRAM. The idle unload is not measured yet |
| V2 | **Managed install**: Settings → Media → Voice → *VibeVoice (local)*: shows sizes, **Download and set up** into a chosen folder (venv, PyTorch for the GPU, the engine, the model), progress and log, then start/stop/status; the connection is the existing *OpenAI-compatible speech* kind pointed at it. | From nothing, one click ends with a working connection whose Test speaks | 🔧 observed: one click in Settings → Media installed uv's Python 3.11 venv, PyTorch 2.11 cu128, the engine, the 1.5B model and six demo voices into `F:\FableChat Voice`, and the server answered with CUDA. Found and fixed on the way: the engine's package pulls in the Gradio demo's `aiortc`, which does not build on Windows (now installed without its demo libraries); the model needs Qwen2.5's tokenizer (now fetched, 11 MB, into the folder's HF cache, since the server runs offline); vocal isolation crashed on an emoji under the Windows console encoding and was silently skipped (now UTF-8, its 0.9 GB model fetched at setup, and each voice records `isolated`). Not yet re-run from a clean folder with these fixes |
| V3 | **Voices**: characters and personas get a voice (connection + voice id + speed). The **character editor has a Voice section where you upload a voice sample to that character's profile** (Ronan, 2026-11-05), cleaned once by vocal isolation, with a consent tick, or pick a demo voice; preview it. Stored on the character or persona row (`voice`), not on cards: a sample is a recording of a real person, so it is not exported with the card. | Changing Ronan's voice changes the next thing he says | 🔧 observed: in his editor a sample was uploaded (consent ticked), stored as an audio asset on his profile and in the server's copy, handed to the voice server on first use and cleaned by vocal isolation (`isolated: true`); Preview spoke in that voice. The persona editor has the same section. Not yet: the line in chat (V4) |
| V4 | **Play / read aloud**: a play button on every reply; *Read replies aloud* per chat; audio cached as an asset per message + voice. | A reply plays in his voice; read-aloud speaks each new reply once | 🔧 observed 2026-11-06: Play on Ronan's demo reply made 8.3 s of audio in his uploaded voice (the quoted words only) in 11.7 s, kept it on the message, and a second Play reused it with no new request; the header toggle turns Read aloud on and off for the chat and fits at 390 px. Not yet observed: a new reply spoken by Read aloud (no chat model was running) |
| V4b | **Narrator**: Settings → Media → Narrator picks a voice (demo or your sample, with the consent tick) that reads a story reply's narration while the character speaks their quoted lines, as one multi-speaker clip. Texts and call lines are the character alone. | A reply with narration and quotes plays as one clip, the two voices taking turns | ✅ observed 2026-11-06: with Alice as narrator, Play on Ronan's demo reply sent six alternating lines and came back as one 19.9 s clip (43 s including the server start and model load); the audio is cached under both voices |
| V5 | **Voice notes** (plan C6): opt-in per character like photos (`[voice note: …]`), attachments `kind: "audio"`; yours by microphone later (needs speech-to-text). | A voice note arrives as an attachment and plays; it is remembered as a fact | ⬜ |
| V6 | **Spoken calls**: the call screen speaks their lines in their voice as they arrive. | A call answered from Recent Chats speaks the first line | ⬜ |
| V7 | **Group scenes**: a group exchange read as one clip with up to 4 voices. | A three-character exchange plays with three voices | ⬜ |
