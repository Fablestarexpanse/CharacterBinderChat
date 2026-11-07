# Voice and the narrator

Characters can speak their replies in their own voice, and a narrator can read the story around them, like an
audiobook. It runs on your computer with **[VibeVoice](https://github.com/SanDiegoDude/VibeVoice)**.

## Setting up voice (once)

**Settings → Media → Voice**: choose a folder and press **Download and set up**. Nothing is downloaded before that.

- About **11 GB** with everything it needs.
- An **NVIDIA graphics card** with 6–7 GB free is best. It works alongside ComfyUI on a 24 GB card.
- The voice server starts by itself when something speaks, and gives the graphics memory back after a couple of
  minutes of quiet. **Stop and free the GPU** stops it now.

The first line after a start takes longer (half a minute or so) while the model loads.

## Giving a character a voice

In the character's (or persona's) editor, **Voice**:

- **Upload a voice sample** — 10 to 30 seconds of one person talking (WAV, MP3, Ogg or FLAC). Background music is
  removed for you. You must tick that it is **your voice, a voice you have permission to use, or a made-up one**: never
  a real person who has not agreed to it.
- **Or a demo voice** — Alice, Maya or Mary (women), Carter, Frank or Samuel (men).
- **Preview** speaks a line so you can hear it.

## Hearing replies

- **Play** (the speaker icon under a reply) speaks it in that character's voice. Press again to stop. Played audio is
  kept, so playing it again is instant.
- **Read replies aloud** (the speaker icon in the chat header) speaks each new reply as it arrives.

What is spoken:

- a text or a line on a call: all of it;
- a story reply: only what is **in quotes**, unless you have a narrator (below). Actions in `*asterisks*` are not read.

## The narrator

**Settings → Media → Narrator** sets a **female** and a **male** narrator voice, and **Reads:** picks which one is used.
With the narrator on, a story reply plays as one clip in two voices: the narrator reads the narration and actions, the
character speaks their quoted lines.

Texts and phone calls are always the character alone.

## Coming next

Voice notes from characters, spoken phone calls and group scenes in several voices.
