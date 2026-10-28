#!/usr/bin/env python3
"""
SonicScribe faster-whisper worker (Linux).

Reads one JSON command per stdin line and emits one JSON event per stdout line.
The process stays alive across jobs so the loaded Whisper model is reused.

Commands:  {"cmd": "ping"} | {"cmd": "probe"} | {"cmd": "transcribe", ...} | {"cmd": "cancel"} | {"cmd": "shutdown"}
Events:    ready, pong, probe, status, progress, segment, done, cancelled, error
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

_lock = threading.Lock()
_cancel = threading.Event()
_busy = threading.Event()

_model = None
_model_key: tuple[str, str, str] | None = None

# Models offered in the UI. Their Hugging Face repos come from faster-whisper itself (see model_repo).
MODEL_NAMES = ["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"]

MODEL_BYTES = {
    "large-v3": 3_090_000_000,
    "large-v3-turbo": 1_620_000_000,
    "medium": 1_530_000_000,
    "small": 484_000_000,
    "base": 145_000_000,
    "tiny": 75_000_000,
}


def emit(payload: dict) -> None:
    with _lock:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()


# ── Model cache ──────────────────────────────────────────────────────────────


def hf_hub_dir() -> Path:
    if os.environ.get("HF_HUB_CACHE"):
        return Path(os.environ["HF_HUB_CACHE"])
    hf_home = os.environ.get("HF_HOME") or os.path.join(
        os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache", "huggingface"
    )
    return Path(hf_home) / "hub"


def model_repo(model: str) -> str:
    try:
        from faster_whisper.utils import _MODELS

        return _MODELS.get(model, model)
    except Exception:  # noqa: BLE001
        return f"Systran/faster-whisper-{model}"


def repo_dir(model: str) -> Path:
    return hf_hub_dir() / ("models--" + model_repo(model).replace("/", "--"))


def dir_size(path: Path) -> int:
    total = 0
    if path.exists():
        for child in path.rglob("*"):
            try:
                if child.is_file() and not child.is_symlink():
                    total += child.stat().st_size
            except OSError:
                pass
    return total


def cached_model_bin(model: str) -> Path | None:
    snapshots = repo_dir(model) / "snapshots"
    if not snapshots.is_dir():
        return None
    for snap in snapshots.iterdir():
        candidate = snap / "model.bin"
        if candidate.is_file():
            return candidate
    return None


def remote_size(model: str) -> int:
    """Exact download size from the Hub, falling back to the catalogue estimate."""
    fallback = MODEL_BYTES.get(model, 1_000_000_000)
    try:
        from huggingface_hub import HfApi

        info = HfApi().model_info(model_repo(model), files_metadata=True, timeout=10)
        total = sum(s.size or 0 for s in info.siblings or [])
        return total or fallback
    except Exception:  # noqa: BLE001
        return fallback


def purge_stale_partials(model: str, idle_seconds: float = 30.0) -> int:
    """Interrupted downloads leave uniquely named *.incomplete files that are never resumed."""
    freed = 0
    now = time.time()
    for part in (repo_dir(model) / "blobs").glob("*.incomplete"):
        try:
            st = part.stat()
            if now - st.st_mtime > idle_seconds:
                part.unlink()
                freed += st.st_size
        except OSError:
            pass
    return freed


def is_cache_healthy(model: str) -> bool:
    """A repo dir with no usable model.bin is a broken partial download."""
    root = repo_dir(model)
    if not root.exists():
        return True
    model_bin = cached_model_bin(model)
    if model_bin is None:
        return any(root.rglob("*.incomplete"))  # still mid-download: leave it to resume
    minimum = max(30_000_000, int(MODEL_BYTES.get(model, 1_000_000_000) * 0.5))
    try:
        return model_bin.stat().st_size >= minimum
    except OSError:
        return False


def cached_models() -> list[str]:
    return [m for m in MODEL_NAMES if cached_model_bin(m) is not None]


# ── Device ───────────────────────────────────────────────────────────────────


def gpu_info() -> tuple[str, float]:
    """Name and VRAM (GB) of the first NVIDIA GPU, via nvidia-smi."""
    smi = shutil.which("nvidia-smi")
    if smi:
        try:
            out = subprocess.run(
                [smi, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            ).stdout.strip().splitlines()
            if out:
                name, mem = [p.strip() for p in out[0].split(",", 1)]
                return name, round(float(mem) / 1024, 1)
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    return "NVIDIA GPU", 0.0


def detect_device(preference: str = "auto") -> dict:
    cuda_count = 0
    try:
        import ctranslate2

        cuda_count = ctranslate2.get_cuda_device_count()
    except Exception:  # noqa: BLE001
        pass
    if cuda_count > 0 and preference != "cpu":
        name, vram = gpu_info()
        return {"device": "cuda", "name": name, "vram_gb": vram}
    return {"device": "cpu", "name": f"CPU · {os.cpu_count() or 1} threads", "vram_gb": 0.0}


def compute_types(device: str, vram_gb: float, model: str) -> list[str]:
    if device != "cuda":
        return ["int8", "float32"]
    if vram_gb and vram_gb < 8 and model.startswith("large"):
        return ["int8_float16", "float16", "int8"]
    return ["float16", "int8_float16", "int8"]


def probe() -> None:
    info: dict = {"type": "probe", "python": sys.version.split()[0], "executable": sys.executable}
    try:
        import faster_whisper

        info["faster_whisper"] = faster_whisper.__version__
    except Exception as exc:  # noqa: BLE001
        info["faster_whisper"] = None
        info["import_error"] = str(exc)
    try:
        import ctranslate2

        info["ctranslate2"] = ctranslate2.__version__
        info["cuda_devices"] = ctranslate2.get_cuda_device_count()
    except Exception:  # noqa: BLE001
        info["ctranslate2"] = None
        info["cuda_devices"] = 0
    if info.get("cuda_devices"):
        info["gpu_name"], info["vram_gb"] = gpu_info()
    info["cached_models"] = cached_models()
    info["hub_dir"] = str(hf_hub_dir())
    emit(info)


# ── Model loading ────────────────────────────────────────────────────────────


def load_model(model: str, dev: dict, job_id: str):
    global _model, _model_key

    device = dev["device"]
    if _model is not None and _model_key and _model_key[:2] == (model, device):
        return _model, _model_key[2]

    _model = None
    _model_key = None

    if not is_cache_healthy(model):
        shutil.rmtree(repo_dir(model), ignore_errors=True)
        emit({"type": "status", "job_id": job_id, "stage": "loading", "message": f"Removed a damaged {model} download. Fetching it again."})

    patch_pyav()
    from faster_whisper import WhisperModel

    needs_download = cached_model_bin(model) is None
    if needs_download:
        purge_stale_partials(model)
    expected =remote_size(model) if needs_download else MODEL_BYTES.get(model, 1_000_000_000)
    last_error: Exception | None = None

    for ct in compute_types(device, dev["vram_gb"], model):
        emit({
            "type": "status", "job_id": job_id, "stage": "downloading" if needs_download else "loading",
            "message": f"Downloading {model}" if needs_download else f"Loading {model} · {ct} on {dev['name']}",
        })
        result: dict = {}
        done = threading.Event()

        def run(ct=ct) -> None:
            try:
                result["model"] = WhisperModel(model, device=device, compute_type=ct)
            except Exception as exc:  # noqa: BLE001
                result["error"] = exc
            finally:
                done.set()

        threading.Thread(target=run, daemon=True).start()
        started = time.time()
        while not done.wait(timeout=1.0):
            if needs_download:
                # Stale partial files can make the folder larger than the model; never report past 99 %.
                have = min(dir_size(repo_dir(model)), int(expected * 0.99))
                emit({
                    "type": "progress", "job_id": job_id, "stage": "downloading",
                    "bytes": have, "total": expected, "elapsed": round(time.time() - started, 1),
                })
            if _cancel.is_set():
                # The loader thread can't be interrupted; let it finish in the background.
                raise CancelledError()

        if "model" in result:
            _model = result["model"]
            _model_key = (model, device, ct)
            return _model, ct
        last_error = result.get("error")
        emit({"type": "status", "job_id": job_id, "stage": "loading", "message": f"{ct} failed: {last_error}. Trying the next option."})
        needs_download = cached_model_bin(model) is None

    raise last_error or RuntimeError(f"Could not load {model}")


class CancelledError(Exception):
    pass


def patch_pyav() -> None:
    """faster-whisper 1.2 passes metadata_errors= to av.open(), which PyAV 19 removed."""
    try:
        import av
    except ImportError:
        return
    original = av.open
    if getattr(original, "_sonicscribe_compat", False):
        return

    def open_compat(*args, **kwargs):
        try:
            return original(*args, **kwargs)
        except TypeError as exc:
            if "metadata_errors" not in str(exc):
                raise
            kwargs.pop("metadata_errors", None)
            return original(*args, **kwargs)

    open_compat._sonicscribe_compat = True  # type: ignore[attr-defined]
    av.open = open_compat


# ── Transcription ────────────────────────────────────────────────────────────


def transcribe(cmd: dict) -> None:
    job_id = cmd.get("job_id", "")
    path = cmd.get("file")
    model_name = cmd.get("model") or "large-v3-turbo"
    language = cmd.get("language") or "auto"
    vad = cmd.get("vad", True)
    beam = int(cmd.get("beam_size") or 5)
    prompt = (cmd.get("initial_prompt") or "").strip() or None

    if not path or not Path(path).is_file():
        raise FileNotFoundError(f"File not found: {path}")

    dev = detect_device(cmd.get("device", "auto"))
    emit({"type": "status", "job_id": job_id, "stage": "loading", "message": f"Preparing {dev['name']}", "device": dev})
    model, ct = load_model(model_name, dev, job_id)

    emit({"type": "status", "job_id": job_id, "stage": "decoding", "message": "Reading audio", "device": dev, "compute_type": ct})
    started = time.time()
    segments, info = model.transcribe(
        path,
        language=None if language == "auto" else language,
        beam_size=beam,
        vad_filter=bool(vad),
        vad_parameters={"min_silence_duration_ms": 500},
        initial_prompt=prompt,
        condition_on_previous_text=False,
    )
    duration = float(info.duration or 0.0)
    emit({
        "type": "status", "job_id": job_id, "stage": "transcribing", "message": "Transcribing",
        "language": info.language, "language_probability": round(info.language_probability, 3), "duration": round(duration, 2),
    })

    count = 0
    for seg in segments:
        if _cancel.is_set():
            raise CancelledError()
        count += 1
        elapsed = time.time() - started
        emit({
            "type": "segment", "job_id": job_id,
            "segment": {"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()},
            "position": round(seg.end, 2), "duration": round(duration, 2),
            "speed": round(seg.end / elapsed, 2) if elapsed > 0 else 0.0,
        })

    elapsed = time.time() - started
    emit({
        "type": "done", "job_id": job_id, "segment_count": count, "duration": round(duration, 2),
        "elapsed": round(elapsed, 2), "language": info.language, "model": model_name,
        "device": dev, "compute_type": ct,
    })


def run_job(cmd: dict) -> None:
    job_id = cmd.get("job_id", "")
    try:
        transcribe(cmd)
    except CancelledError:
        emit({"type": "cancelled", "job_id": job_id})
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        msg = str(exc) or exc.__class__.__name__
        low = msg.lower()
        hint = None
        if "libcublas" in low or "libcudnn" in low or "cuda" in low:
            hint = "CUDA libraries failed to load. Run Settings → Engine → Repair, or set the device to CPU."
        elif "out of memory" in low:
            hint = "The GPU ran out of memory. Try large-v3-turbo or medium, or close other GPU apps."
        elif "invalid data" in low or "could not open" in low or "errno 1094995529" in low:
            hint = "This file couldn't be decoded. It may be damaged or have no audio track."
        emit({"type": "error", "job_id": job_id, "error": msg, "hint": hint})
    finally:
        _busy.clear()


def main() -> int:
    emit({"type": "ready", "pid": os.getpid()})
    jobs: queue.Queue[dict | None] = queue.Queue()

    def job_loop() -> None:
        while (cmd := jobs.get()) is not None:
            run_job(cmd)

    runner = threading.Thread(target=job_loop, daemon=True)
    runner.start()

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as exc:
            emit({"type": "error", "error": f"Bad command: {exc}"})
            continue

        name = cmd.get("cmd")
        if name == "ping":
            emit({"type": "pong", "busy": _busy.is_set()})
        elif name == "probe":
            probe()
        elif name == "cancel":
            _cancel.set()
        elif name == "transcribe":
            _cancel.clear()
            _busy.set()
            jobs.put(cmd)
        elif name == "shutdown":
            break
        else:
            emit({"type": "error", "error": f"Unknown command: {name}"})

    _cancel.set()
    jobs.put(None)
    return 0


if __name__ == "__main__":
    if "--probe" in sys.argv:
        probe()
        raise SystemExit(0)
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130) from None
