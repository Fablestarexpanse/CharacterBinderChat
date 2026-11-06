"""The model lives here, in a child process.

Loading VibeVoice takes a while, so the worker stays up between jobs, but only
for `idle_seconds`: then it exits, and the operating system takes back all of
its GPU memory (PyTorch would otherwise keep it reserved). This is the
load-on-demand idea from SanDiegoDude/VibeVoice, packaged as a long-lived
worker with an idle timeout so a conversation does not reload the model for
every line.

Protocol (multiprocessing queues):
  request:  ("speak", job_id, script, [voice_wav_paths], params)  |  ("stop",)
  response: ("ready", info) | ("taken", job_id) | ("done", job_id, float32 samples, seconds) | ("error", job_id, message)
"taken" tells the server the job will not be lost to an idle exit, so it can resend a
job that went into the queue just as the worker was leaving.
"""

from __future__ import annotations

import os
import queue
import time
import traceback

SAMPLE_RATE = 24000


def _attention(device: str) -> str:
    if device == "cuda":
        try:
            import flash_attn  # noqa: F401
            return "flash_attention_2"
        except ImportError:
            return "sdpa"
    return "sdpa"


def run(requests, responses, model_path: str, device: str, steps: int, idle_seconds: float) -> None:
    try:
        import numpy as np
        import torch
        from vibevoice.modular.modeling_vibevoice_inference import VibeVoiceForConditionalGenerationInference
        from vibevoice.modular.streamer import AudioStreamer
        from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor

        started = time.time()
        processor = VibeVoiceProcessor.from_pretrained(model_path)
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16 if device != "cpu" else torch.float32,
            device_map=device,
            attn_implementation=_attention(device),
        )
        model.eval()
        # The scheduler the fork's worker uses
        model.model.noise_scheduler = model.model.noise_scheduler.from_config(
            model.model.noise_scheduler.config,
            algorithm_type="sde-dpmsolver++",
            beta_schedule="squaredcos_cap_v2",
        )
        model.set_ddpm_inference_steps(num_steps=steps)
        responses.put(("ready", {"device": device, "loadSeconds": round(time.time() - started, 1)}))
    except Exception as e:  # the parent reports this as the reason voice is unavailable
        responses.put(("error", None, f"could not load the voice model: {e}\n{traceback.format_exc()}"))
        return

    import multiprocessing as mp
    parent = mp.parent_process()
    last = time.time()
    while True:
        try:
            req = requests.get(timeout=1.0)
        except queue.Empty:
            if time.time() - last > idle_seconds:
                return  # idle: exit and give the GPU memory back
            if parent is not None and not parent.is_alive():
                return  # the server was killed: do not hold the GPU as an orphan
            continue
        if req[0] == "stop":
            return
        if req[0] != "speak":
            continue
        _, job_id, script, voice_paths, params = req
        last = time.time()
        responses.put(("taken", job_id))
        try:
            t0 = time.time()
            inputs = processor(
                text=[script],
                voice_samples=[voice_paths],
                padding=True,
                return_tensors="pt",
                return_attention_mask=True,
            )
            streamer = AudioStreamer(batch_size=1, stop_signal=None, timeout=None)
            with torch.no_grad():
                model.generate(
                    **inputs,
                    max_new_tokens=None,
                    cfg_scale=float(params.get("cfg", 1.6)),
                    tokenizer=processor.tokenizer,
                    generation_config={
                        "do_sample": bool(params.get("sample", False)),
                        "temperature": float(params.get("temperature", 0.95)),
                        "top_p": float(params.get("top_p", 0.95)),
                        "top_k": int(params.get("top_k", 0)),
                    },
                    audio_streamer=streamer,  # the fork's delayed end-of-speech needs the streamer
                    refresh_negative=True,
                )
            chunks = []
            for c in streamer.get_stream(0):
                if torch.is_tensor(c):
                    c = c.float().cpu().numpy()
                chunks.append(np.asarray(c, dtype=np.float32).reshape(-1))
            audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
            responses.put(("done", job_id, audio, round(time.time() - t0, 2)))
        except Exception as e:
            responses.put(("error", job_id, f"{e}"))
        finally:
            last = time.time()
            if device == "cuda":
                torch.cuda.empty_cache()


def isolate(out, audio, sr: int) -> None:
    """Vocal isolation (Mel-Band-Roformer, from the fork) in its own short-lived process,
    so the CUDA memory it takes is given back when the process exits."""
    try:
        from vibevoice.utils.vocal_isolation import isolate_vocals
        out.put(("ok", isolate_vocals(audio, sample_rate=sr)))
    except Exception as e:
        out.put(("error", f"{e}"))
