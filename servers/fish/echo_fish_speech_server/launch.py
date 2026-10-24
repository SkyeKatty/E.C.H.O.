from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from .deps import fish_speech_home
from .weights import resolve_llama_checkpoint_path


def build_api_server_command(home: Path) -> list[str]:
    port = os.environ.get("ECHO_FISH_PORT", "8092")
    host = os.environ.get("ECHO_FISH_HOST", "127.0.0.1")
    listen = f"{host}:{port}"

    llama_path = resolve_llama_checkpoint_path(home)

    cmd: list[str] = [
        sys.executable,
        str(home / "tools" / "api_server.py"),
        "--listen",
        listen,
        "--llama-checkpoint-path",
        str(llama_path),
    ]

    decoder = os.environ.get("ECHO_FISH_DECODER_CHECKPOINT", "").strip()
    if decoder:
        dec_path = Path(decoder)
        if not dec_path.is_absolute():
            dec_path = home / decoder
        cmd.extend(["--decoder-checkpoint-path", str(dec_path)])

    decoder_cfg = os.environ.get("ECHO_FISH_DECODER_CONFIG", "modded_dac_vq").strip()
    if decoder and decoder_cfg:
        cmd.extend(["--decoder-config-name", decoder_cfg])

    device = os.environ.get("ECHO_FISH_DEVICE", "").strip()
    if device:
        cmd.extend(["--device", device])

    if os.environ.get("ECHO_FISH_HALF", "").strip() in ("1", "true", "yes"):
        cmd.append("--half")

    if os.environ.get("ECHO_FISH_COMPILE", "").strip() in ("1", "true", "yes"):
        cmd.append("--compile")

    api_key = os.environ.get("ECHO_FISH_API_KEY", "").strip()
    if api_key:
        cmd.extend(["--api-key", api_key])

    workers = os.environ.get("ECHO_FISH_WORKERS", "").strip()
    if workers.isdigit():
        cmd.extend(["--workers", workers])

    return cmd


def run() -> None:
    from .deps import require_runtime_extras

    require_runtime_extras()
    home = fish_speech_home()
    from .deps import ensure_pytorch_cuda

    ensure_pytorch_cuda(home=home)

    cmd = build_api_server_command(home)
    if not os.environ.get("ECHO_FISH_DEVICE", "").strip():
        try:
            import torch

            if torch.cuda.is_available():
                cmd.extend(["--device", "cuda:0"])
        except ImportError:
            pass
    print("[echo-fish-speech] Fish Audio API server")
    print(f"[echo-fish-speech] Weights cache: {os.environ.get('ECHO_FISH_DATA_DIR') or '(default under LOCALAPPDATA or ~/.local/share)'}")
    print("[echo-fish-speech]", " ".join(cmd))
    print("[echo-fish-speech] Docs: https://speech.fish.audio/server/")
    raise SystemExit(subprocess.call(cmd, cwd=str(home)))
