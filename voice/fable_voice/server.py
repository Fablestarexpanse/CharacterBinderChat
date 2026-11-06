"""FableChat's voice server: VibeVoice behind a small OpenAI-compatible API.

Run:  python -m fable_voice.server --model <dir> --voices <dir> [--port 7861]
Set FABLE_VOICE_TOKEN in the environment: every request must carry it in the
X-Fable-Voice-Token header, and the Host must be this machine at this port.
FableChat starts the server with a fresh random token, so a web page in a
browser on this computer cannot use it (not even through DNS rebinding).

Endpoints (JSON unless noted; bound to 127.0.0.1):
  GET  /health                 → {ok, model, worker: "stopped"|"loading"|"ready", device, voices}
  GET  /v1/voices              → {voices: [{id, name, source, seconds, isolated?}]}
  POST /v1/voices?name=&consent=1&isolate=1   body: audio bytes (wav/mp3/flac/ogg)
                               → {ok, voice}   (refused without consent=1)
  DELETE /v1/voices/<id>       → {ok}
  POST /v1/audio/speech        {input, voice} → audio/wav (OpenAI's speech API shape)
  POST /v1/dialogue            {lines: [{voice, text}]} → audio/wav, up to 4 voices
  POST /v1/unload              → {ok}: stop the worker now and free the GPU
  POST /v1/shutdown            → {ok}: stop the worker and exit this server

One job at a time. The model lives in a worker process that loads on the first
job and exits after --idle seconds without one (see worker.py).
"""

from __future__ import annotations

import argparse
import hmac
import io
import json
import multiprocessing as mp
import os
import queue
import re
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import worker as worker_mod
from .voices import SAMPLE_RATE, VoiceLibrary, wav_bytes

MAX_SPEAKERS = 4
MAX_CHARS = 4000
MAX_UPLOAD = 25 * 1024 * 1024
MAX_SAMPLE_SECONDS = 60      # decoded, before vocal isolation (the kept voice is trimmed to 30 s)
LOAD_TIMEOUT = 900           # seconds for the model to load
JOB_TIMEOUT = 1800           # seconds for one line or dialogue
POLL = 1.0


def clean_line(text: str) -> str:
    """What VibeVoice should say: no stage directions, no tags, no markdown.

    *leans on the wall* (a stage direction) is dropped, but *not* in "I did *not*
    do it" is emphasis and is kept as a word: a span is treated as an action only
    when it holds several words or stands at the start of a sentence.
    """
    def star(m: re.Match) -> str:
        inner = m.group(2).strip()
        words = len(inner.split())
        at_start = m.start() == 0 or bool(re.search(r"[.!?…]\s*$", text[: m.start()]))
        # An action: three or more words anywhere, or at a sentence start two words or a
        # lower-case one ("*nods*"). Otherwise emphasis ("*not*", "*Never*"): keep the word.
        if words >= 3 or (at_start and (words >= 2 or inner[:1].islower())):
            return " "
        return inner

    # Like markdown emphasis, the text right inside the asterisks is not a space: "5 * 3" is not a span
    t = re.sub(r"(\*{1,2})(\S(?:[^*\n]{0,298}?\S)?)\1", star, text)
    t = t.replace("*", " ")
    t = re.sub(r"\[[^\]]{0,300}\]", " ", t)            # [photo: …], [sent a photo]
    t = re.sub(r"[_#`>~]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _num(params: dict, key: str, lo: float, hi: float) -> float | None:
    if key not in params:
        return None
    try:
        v = float(params[key])
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be a number")
    if not lo <= v <= hi:
        raise ValueError(f"{key} must be between {lo} and {hi}")
    return v


def clean_params(raw: dict) -> dict:
    out: dict = {}
    for key, lo, hi in (("cfg", 0.5, 5.0), ("temperature", 0.05, 2.0), ("top_p", 0.05, 1.0), ("top_k", 0, 200)):
        v = _num(raw, key, lo, hi)
        if v is not None:
            out[key] = int(v) if key == "top_k" else v
    if "sample" in raw:
        out["sample"] = raw["sample"] is True or str(raw["sample"]).lower() in ("1", "true", "yes")
    return out


class Engine:
    def __init__(self, model: str, voices: VoiceLibrary, device: str, steps: int, idle: float):
        self.model, self.voices, self.device, self.steps, self.idle = model, voices, device, steps, idle
        self.proc: mp.process.BaseProcess | None = None
        self.req = None
        self.res = None
        self.state = "stopped"
        self.lock = threading.Lock()
        self.info: dict = {}
        self.ctx = mp.get_context("spawn")

    def _start(self) -> None:
        self.req, self.res = self.ctx.Queue(), self.ctx.Queue()
        self.proc = self.ctx.Process(target=worker_mod.run, args=(self.req, self.res, self.model, self.device, self.steps, self.idle), daemon=True)
        self.state = "loading"
        self.proc.start()
        deadline = time.time() + LOAD_TIMEOUT
        while True:
            try:
                kind, *rest = self.res.get(timeout=POLL)
            except queue.Empty:
                if not self.proc.is_alive():
                    self.state = "stopped"
                    raise RuntimeError("the voice model stopped while loading (see server.log)")
                if time.time() > deadline:
                    self.proc.kill()
                    self.state = "stopped"
                    raise RuntimeError("the voice model did not load in time")
                continue
            if kind == "ready":
                self.info = rest[0]
                self.state = "ready"
                return
            if kind == "error":
                self.state = "stopped"
                raise RuntimeError(str(rest[-1]).splitlines()[0] if rest else "the voice model did not start")

    def alive(self) -> bool:
        return bool(self.proc and self.proc.is_alive())

    def status(self) -> str:
        if self.state == "ready" and not self.alive():
            self.state = "stopped"  # it exited after the idle time
        return self.state

    def stop(self) -> None:
        with self.lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        if self.alive():
            try:
                self.req.put(("stop",))
            except Exception:
                pass
            self.proc.join(timeout=15)
            if self.proc.is_alive():
                self.proc.kill()
        self.state = "stopped"

    def _run_job(self, script: str, paths: list[str], params: dict) -> tuple[bytes, float]:
        """Send one job and wait for it. A job the worker never took (it was exiting for
        idleness, or died) is sent again once to a fresh worker; a worker that dies after
        taking it is an error, never a 30-minute hang."""
        for attempt in (1, 2):
            if not self.alive():
                self._start()
            job = uuid.uuid4().hex
            self.req.put(("speak", job, script, paths, params))
            taken = False
            deadline = time.time() + JOB_TIMEOUT
            while True:
                try:
                    kind, jid, *rest = self.res.get(timeout=POLL)
                except queue.Empty:
                    if not self.proc.is_alive():
                        self.state = "stopped"
                        if not taken and attempt == 1:
                            break  # lost to an idle exit: try once more
                        raise RuntimeError("the voice worker stopped while speaking (see server.log)")
                    if time.time() > deadline:
                        self._stop_locked()
                        raise RuntimeError("speaking took too long and was stopped")
                    continue
                if jid != job:
                    continue
                if kind == "taken":
                    taken = True
                elif kind == "error":
                    raise RuntimeError(rest[0])
                elif kind == "done":
                    audio, seconds = rest
                    return wav_bytes(audio), seconds
        raise RuntimeError("the voice worker could not take the job")

    def speak(self, lines: list[tuple[str, str]], params: dict) -> tuple[bytes, float]:
        """lines: (voice id, text). Distinct voices become Speaker 1..N in order of first appearance."""
        order: list[str] = []
        script = []
        for voice, text in lines:
            t = clean_line(text)
            if not t:
                continue
            if voice not in order:
                order.append(voice)
            script.append(f"Speaker {order.index(voice) + 1}: {t}")
        if not script:
            raise ValueError("nothing to say once stage directions and markup are removed")
        if len(order) > MAX_SPEAKERS:
            raise ValueError(f"at most {MAX_SPEAKERS} voices in one clip")
        paths = []
        for v in order:
            p = self.voices.path(v)
            if not p:
                raise ValueError(f"no such voice: {v}")
            paths.append(str(p))
        with self.lock:
            return self._run_job("\n".join(script), paths, params)

    def isolate(self, audio, sr: int):
        """Vocal isolation in a short-lived process, under the same lock as speech, so it
        never competes with a running job for GPU memory and gives all of it back."""
        with self.lock:
            q = self.ctx.Queue()
            p = self.ctx.Process(target=worker_mod.isolate, args=(q, audio, sr), daemon=True)
            p.start()
            try:
                kind, value = q.get(timeout=600)
            finally:
                p.join(timeout=30)
                if p.is_alive():
                    p.kill()
            if kind == "error":
                raise RuntimeError(value)
            return value


def make_handler(engine: Engine, port: int, token: str, shutdown):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        server_version = "FableVoice/1"
        timeout = 120  # a stalled client cannot hold a thread for ever

        def log_message(self, fmt, *args):
            print("[voice]", fmt % args, flush=True)

        def _json(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _fail(self, code: int, error: str) -> None:
            self._json(code, {"ok": False, "error": error})

        def _audio(self, data: bytes, seconds: float) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Generation-Seconds", str(seconds))
            self.end_headers()
            self.wfile.write(data)

        def _body(self, limit: int = 1024 * 1024) -> bytes:
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise ValueError("bad Content-Length")
            if n < 0 or n > limit:
                raise ValueError("request too large" if n > limit else "bad Content-Length")
            return self.rfile.read(n) if n else b""

        def _allowed(self) -> bool:
            """Only FableChat: this machine's address at this port, carrying the token."""
            host = (self.headers.get("Host") or "").strip().lower()
            sent = self.headers.get("X-Fable-Voice-Token") or ""
            if host not in allowed_hosts or not token or not hmac.compare_digest(sent, token):
                self._fail(403, "forbidden")
                return False
            return True

        def _guarded(self, fn) -> None:
            if not self._allowed():
                return
            try:
                fn()
            except ValueError as e:
                self._fail(400, str(e))
            except Exception as e:  # logged in full; the client gets one line, no paths
                traceback.print_exc()
                self._fail(500, str(e).splitlines()[0] if str(e) else type(e).__name__)

        def do_GET(self):
            self._guarded(self._get)

        def do_DELETE(self):
            self._guarded(self._delete)

        def do_POST(self):
            self._guarded(self._post)

        def _get(self):
            path = urlparse(self.path).path
            if path == "/health":
                return self._json(200, {"ok": True, "model": engine.model, "worker": engine.status(),
                                        "device": engine.info.get("device", engine.device), "voices": len(engine.voices.list())})
            if path == "/v1/voices":
                return self._json(200, {"voices": engine.voices.list()})
            if path == "/v1/models":
                return self._json(200, {"data": [{"id": "vibevoice", "object": "model"}]})
            self._fail(404, "not found")

        def _delete(self):
            m = re.match(r"^/v1/voices/(.+)$", urlparse(self.path).path)
            if not m:
                return self._fail(404, "not found")
            if engine.voices.remove(m.group(1)):
                return self._json(200, {"ok": True})
            self._fail(404, "no such voice of yours")

        def _post(self):
            url = urlparse(self.path)
            if url.path == "/v1/unload":
                engine.stop()
                return self._json(200, {"ok": True})
            if url.path == "/v1/shutdown":
                engine.stop()
                self._json(200, {"ok": True})
                threading.Thread(target=shutdown, daemon=True).start()
                return
            if url.path == "/v1/voices":
                q = parse_qs(url.query)
                if q.get("consent", ["0"])[0] != "1":
                    return self._fail(400, "confirm this is your voice, a voice you may use, or a made-up one (consent=1)")
                raw = self._body(MAX_UPLOAD)
                import soundfile as sf
                try:
                    info = sf.info(io.BytesIO(raw))
                    # Decode at most a minute: a small, low-bitrate file can otherwise expand to hours
                    audio, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False, frames=int(info.samplerate * MAX_SAMPLE_SECONDS))
                except Exception:
                    raise ValueError("that file could not be read as audio (WAV, FLAC, Ogg or MP3)")
                if audio.size == 0:
                    raise ValueError("that file holds no sound")
                isolate = q.get("isolate", ["1"])[0] == "1"
                voice = engine.voices.add(q.get("name", ["My voice"])[0], audio, sr,
                                          isolate=engine.isolate if isolate else None)
                return self._json(200, {"ok": True, "voice": voice})
            try:
                body = json.loads(self._body() or b"{}")
            except json.JSONDecodeError:
                raise ValueError("the body must be JSON")
            if not isinstance(body, dict):
                raise ValueError("the body must be a JSON object")
            params = clean_params(body)
            if url.path == "/v1/audio/speech":
                text = str(body.get("input") or "")
                voice = str(body.get("voice") or "")
                if not text.strip() or not voice:
                    raise ValueError("input and voice are required")
                if len(text) > MAX_CHARS:
                    raise ValueError(f"at most {MAX_CHARS} characters in one line")
                data, secs = engine.speak([(voice, text)], params)
                return self._audio(data, secs)
            if url.path == "/v1/dialogue":
                raw_lines = body.get("lines")
                if not isinstance(raw_lines, list) or not raw_lines:
                    raise ValueError("lines must be a list of {voice, text}")
                lines = [(str((l or {}).get("voice") or ""), str((l or {}).get("text") or "")) for l in raw_lines[:200] if isinstance(l, dict)]
                if sum(len(t) for _, t in lines) > MAX_CHARS * 2:
                    raise ValueError(f"at most {MAX_CHARS * 2} characters in one dialogue")
                data, secs = engine.speak(lines, params)
                return self._audio(data, secs)
            self._fail(404, "not found")

    return Handler


class Server(ThreadingHTTPServer):
    # Windows' SO_REUSEADDR would let a second server share the port; refuse that
    allow_reuse_address = os.name != "nt"
    daemon_threads = True


def main() -> None:
    ap = argparse.ArgumentParser(description="FableChat voice server (VibeVoice)")
    ap.add_argument("--model", required=True, help="folder holding the VibeVoice model")
    ap.add_argument("--voices", required=True, help="folder for voice samples (demo/ and yours/)")
    ap.add_argument("--port", type=int, default=7861)
    ap.add_argument("--device", default=None)
    ap.add_argument("--steps", type=int, default=10)
    ap.add_argument("--idle", type=float, default=120.0, help="seconds without a job before the model is unloaded")
    a = ap.parse_args()
    token = os.environ.get("FABLE_VOICE_TOKEN", "")
    if len(token) < 16:
        raise SystemExit("FABLE_VOICE_TOKEN must be set (FableChat sets it when it starts the server)")
    device = a.device
    if not device:
        import torch
        device = "cuda" if torch.cuda.is_available() else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
    engine = Engine(str(Path(a.model)), VoiceLibrary(Path(a.voices)), device, a.steps, a.idle)
    srv: Server | None = None

    def shutdown():
        time.sleep(0.2)
        if srv:
            srv.shutdown()

    srv = Server(("127.0.0.1", a.port), make_handler(engine, a.port, token, shutdown))
    print(f"[voice] FableChat voice server on http://127.0.0.1:{a.port} ({device}); model {a.model}", flush=True)
    try:
        srv.serve_forever()
    finally:
        engine.stop()


if __name__ == "__main__":
    mp.freeze_support()
    main()
