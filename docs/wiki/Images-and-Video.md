# Images and video

Pictures and clips are made by **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)** running on your computer (or a
cloud image service you add).

## Connecting ComfyUI

1. Start ComfyUI (default `http://127.0.0.1:8188`).
2. **Settings → Media → Media connections**: **Use my ComfyUI** under Images (and Video).
3. **Test** makes a real image (or a 2-second clip for video).
4. Under **Use for**, pick which connection makes portraits, photo messages, scene images and video.

## Workflows

The **Workflows** screen lists the bundled workflows (including **Krea2 photo** and **MOSS photo**) and any you add.
To add your own, in ComfyUI use **Export (API)** and drop the file on the Workflows screen: FableChat finds the prompt,
seed and size inputs itself.

## Making pictures

- **`/image`** in the message box draws the current scene; `/image a close-up of her hands` steers it.
- The **image icon** under a reply draws that moment.
- **Image Studio** (sidebar) makes pictures from a prompt. Under a render: **Delete** (with Undo) and
  **Use for a character** (set as someone's portrait, or start a new character from it).
- **Gallery** keeps everything made.

## A character's look

In the editor, **How images draw them** describes them for image models:

- **Fill from description** — the local memory model reads their description and personality and writes both tag sets
  below for you. **Undo** puts back what was there.
- **Image tags** — a short description used word for word in every picture of them (hair, eyes, build, clothes).
- **Image tags, undressed** (optional) — the same person with no clothing words. Each picture picks one set by itself:
  when its prompt (written by the scene director from the story, a photo line, or what you typed) has them nude or
  undressed, these lead; otherwise the usual tags. Portraits always use the usual tags. For adult characters only.
- **Avoid** — what to keep out.
- **LoRA** — a LoRA trained on them, with its trigger word and weight.
- **Fixed seed** — the same face more often, less variety.
- **Reference pictures** — their portrait and any picture you **Keep as reference**.
- **Make pictures look like** them — uses the reference pictures with a likeness workflow so faces stay consistent.

Personas have the same, so pictures of you look like you.

## Clips

**Make a clip** under a photo turns it into a few seconds of video with sound, through **MiniMax H3**. Everyone in the
scene (the character, your persona, others present) is given to it as a reference so faces hold. **Cancel** stops the
job in ComfyUI.

H3 needs these files in ComfyUI (Hugging Face `Comfy-Org/MiniMax-H3`):
`minimax_h3_fl2va_pruned_int8_convrot` and `minimax_h3_ref2va_pruned_int8_convrot` (diffusion_models),
`qwen3vl_32b_minimax_h3_nvfp4_awq` (text_encoders), `minimax_h3_video_vae_fp16` and `minimax_h3_audio_vae_fp32` (vae),
and the turbo LoRAs `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16` and `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16`
(loras, in a `MiniMax H3` subfolder). If one is missing, FableChat names it.

## Saving copies to a folder

Pictures and clips live inside FableChat (and in backups). To also get a copy of each in a folder, set one in
**Settings → Media → Save chat media to a folder**, optionally one sub-folder per character.
