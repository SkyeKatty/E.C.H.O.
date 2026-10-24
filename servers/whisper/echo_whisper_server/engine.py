from __future__ import annotations

import os
import threading
from typing import Any

_lock = threading.Lock()
_model: Any = None


def _model_name() -> str:
    return os.environ.get("ECHO_WHISPER_MODEL", "base").strip() or "base"


def _device() -> str:
    return os.environ.get("ECHO_WHISPER_DEVICE", "cpu").strip() or "cpu"


def _compute_type() -> str:
    return os.environ.get("ECHO_WHISPER_COMPUTE_TYPE", "int8").strip() or "int8"


def get_model():
    global _model
    with _lock:
        if _model is not None:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError as err:
            raise RuntimeError(
                "faster-whisper is not installed. Run: pip install -e \"servers/whisper[runtime]\""
            ) from err
        _model = WhisperModel(_model_name(), device=_device(), compute_type=_compute_type())
        return _model


def transcribe_file(path: str, *, language: str | None = None) -> str:
    model = get_model()
    segments, _info = model.transcribe(
        path,
        language=language or None,
        vad_filter=True,
    )
    parts: list[str] = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            parts.append(text)
    return " ".join(parts).strip()


def status() -> dict[str, str]:
    return {
        "engine": "faster-whisper",
        "model": _model_name(),
        "device": _device(),
        "computeType": _compute_type(),
        "loaded": str(_model is not None),
    }
