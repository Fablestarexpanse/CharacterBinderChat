"""Voice samples: the demo voices that ship with VibeVoice, and yours.

A voice is a short WAV the model imitates. Yours are cleaned once when added:
background music and noise removed with Mel-Band-Roformer vocal isolation
(from SanDiegoDude/VibeVoice), resampled to 24 kHz mono, trimmed to 30 s and
peak-normalised, then saved, so every later line uses the clean sample.
"""

from __future__ import annotations

import json
import re
import time
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 24000
MAX_SECONDS = 30


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:40] or "voice"


class VoiceLibrary:
    def __init__(self, root: Path):
        self.demo = root / "demo"
        self.yours = root / "yours"
        self.demo.mkdir(parents=True, exist_ok=True)
        self.yours.mkdir(parents=True, exist_ok=True)
        import threading
        self._name_lock = threading.Lock()

    def list(self) -> list[dict]:
        out = []
        for folder, source in ((self.demo, "demo"), (self.yours, "yours")):
            for wav in sorted(folder.glob("*.wav")):
                meta_path = wav.with_suffix(".json")
                try:  # one damaged record must not take the whole list (and /health) down
                    meta = json.loads(meta_path.read_text("utf-8")) if meta_path.exists() else {}
                    if not isinstance(meta, dict):
                        meta = {}
                except (OSError, ValueError):
                    meta = {}
                vid = f"{source}:{wav.stem}"
                out.append({"id": vid, "name": meta.get("name") or pretty(wav.stem), "source": source,
                            "seconds": meta.get("seconds"), "addedAt": meta.get("addedAt"),
                            **({"isolated": meta["isolated"]} if "isolated" in meta else {})})
        return out

    def path(self, voice_id: str) -> Path | None:
        source, _, stem = voice_id.partition(":")
        if not stem:  # a bare name: look in yours first, then the demos
            stem, source = voice_id, ""
        folders = {"demo": [self.demo], "yours": [self.yours]}.get(source, [self.yours, self.demo])
        for f in folders:
            p = f / f"{stem}.wav"
            if p.exists() and p.resolve().parent == f.resolve():
                return p
        return None

    def add(self, name: str, audio: np.ndarray, sr: int, isolate=None) -> dict:
        """isolate: a function (audio, sr) -> audio that removes music and noise, or None to skip."""
        audio = to_mono(audio)
        audio = audio[: int(sr * 60)]  # never isolate more than a minute; the kept voice is 30 s
        isolated = False
        isolation_error = None
        if isolate:
            try:
                audio = to_mono(isolate(audio, sr))
                isolated = True
            except Exception as e:  # isolation is a clean-up, not a requirement; the record says it was skipped
                isolation_error = str(e)[:200]
                print(f"[voices] vocal isolation skipped: {e}", flush=True)
        if sr != SAMPLE_RATE:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
        audio = audio[: SAMPLE_RATE * MAX_SECONDS]
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0:
            audio = audio * (0.9 / peak)
        with self._name_lock:  # two uploads with one name must not overwrite each other
            stem = slug(name)
            n = 2
            while (self.yours / f"{stem}.wav").exists():
                stem = f"{slug(name)}-{n}"
                n += 1
            write_wav(self.yours / f"{stem}.wav", audio)
        meta = {"name": name.strip()[:60] or pretty(stem), "seconds": round(len(audio) / SAMPLE_RATE, 1),
                "addedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "consent": True,
                "isolated": isolated, **({"isolationError": isolation_error} if isolation_error else {})}
        (self.yours / f"{stem}.json").write_text(json.dumps(meta), "utf-8")
        return {"id": f"yours:{stem}", **meta, "source": "yours"}

    def remove(self, voice_id: str) -> bool:
        source, _, stem = voice_id.partition(":")
        if source != "yours" or not stem:
            return False
        p = self.path(voice_id)
        if not p:
            return False
        p.unlink(missing_ok=True)
        p.with_suffix(".json").unlink(missing_ok=True)
        return True


def pretty(stem: str) -> str:
    # en-Alice_woman → Alice (woman, en)
    m = re.match(r"^([a-z]{2})-([A-Za-z]+)_?(.*)$", stem)
    if m:
        lang, name, rest = m.groups()
        tags = ", ".join(t for t in [rest.replace("_", " "), lang] if t)
        return f"{name} ({tags})"
    return stem.replace("-", " ").replace("_", " ").title()


def to_mono(audio) -> np.ndarray:
    a = np.asarray(audio, dtype=np.float32)
    if a.ndim > 1:
        a = a.mean(axis=0 if a.shape[0] < a.shape[-1] else -1)
    return a.reshape(-1)


def write_wav(path: Path, audio: np.ndarray, sr: int = SAMPLE_RATE) -> None:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def wav_bytes(audio: np.ndarray, sr: int = SAMPLE_RATE) -> bytes:
    import io
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()
