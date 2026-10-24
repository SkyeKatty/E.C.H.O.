from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from .weights import data_root

_FISH_GIT_URL = "https://github.com/fishaudio/fish-speech.git"
_STAMP_NAME = ".echo-fish-speech-deps"
_TORCH_CUDA_STAMP = ".echo-fish-pytorch-cuda"


def _validate_home(home: Path) -> None:
    api = home / "tools" / "api_server.py"
    root_marker = home / ".project-root"
    if not api.is_file():
        raise SystemExit(f"Missing {api} — not a Fish Speech tree")
    if not root_marker.is_file():
        raise SystemExit(
            f"{home} has no .project-root — Fish Speech must be a full source tree, not a broken pip install.\n"
            "Delete the folder and restart, or set ECHO_FISH_SPEECH_HOME to a valid checkout."
        )


def _git_clone(dest: Path) -> None:
    if shutil.which("git") is None:
        raise SystemExit(
            "git is not on PATH. Install Git for Windows, then run:\n"
            "  pnpm install:server:fish"
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[echo-fish-speech] Cloning Fish Speech into {dest} …")
    subprocess.check_call(
        ["git", "clone", "--depth", "1", _FISH_GIT_URL, str(dest)],
    )


def pytorch_cuda_tag() -> str:
    """
    PyTorch *wheel* tag for ``torch==2.8.0`` (Fish Speech pin): cu126, cu128, or cu129.

    This is not the same number as ``nvidia-smi``'s "CUDA Version" (e.g. 13.2). Drivers
    in the CUDA 13.x family run PyTorch wheels that bundle the 12.9 runtime (``cu129``).
    There is no ``cu132`` build for torch 2.8 on Windows.
    """
    return os.environ.get("ECHO_FISH_TORCH_CUDA", "cu129").strip() or "cu129"


def _pytorch_index() -> str:
    return f"https://download.pytorch.org/whl/{pytorch_cuda_tag()}"


def ensure_pytorch_cuda(*, home: Path | None = None) -> None:
    """Fish Speech needs a CUDA PyTorch build; plain ``pip install -e .`` often installs ``+cpu`` only."""
    try:
        import torch
    except ImportError:
        return

    if torch.cuda.is_available():
        name = torch.cuda.get_device_name(0)
        print(f"[echo-fish-speech] PyTorch {torch.__version__}, CUDA device: {name}")
        return

    stamp_path = (home or data_root() / "src" / "fish-speech") / _TORCH_CUDA_STAMP
    if stamp_path.is_file() and "+cpu" not in torch.__version__:
        print(
            "[echo-fish-speech] WARNING: PyTorch has CUDA symbols but torch.cuda.is_available() is False "
            "(driver mismatch?). Try another ECHO_FISH_TORCH_CUDA or update NVIDIA drivers."
        )
        return

    tag = pytorch_cuda_tag()
    print(
        f"[echo-fish-speech] PyTorch is {torch.__version__} (no CUDA). "
        f"Installing torch 2.8.0 + torchaudio with {tag} wheels …"
    )
    subprocess.check_call(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "torch==2.8.0",
            "torchaudio==2.8.0",
            "--index-url",
            _pytorch_index(),
            "--force-reinstall",
        ],
    )
    stamp_path.parent.mkdir(parents=True, exist_ok=True)
    stamp_path.write_text(f"{tag}\n", encoding="utf-8")

    probe = subprocess.run(
        [
            sys.executable,
            "-c",
            "import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)",
        ],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        raise SystemExit(
            f"CUDA PyTorch install finished but GPU is still not visible. "
            f"Try ECHO_FISH_TORCH_CUDA=cu128 or cu126, then delete {stamp_path} and restart."
        )


def _pip_install_editable(home: Path) -> None:
    tag = pytorch_cuda_tag()
    print(
        f"[echo-fish-speech] pip install -e {home}[{tag}] with PyTorch CUDA index (one-time, slow) …"
    )
    subprocess.check_call(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--extra-index-url",
            _pytorch_index(),
            "-e",
            f"{home}[{tag}]",
        ],
    )
    ensure_pytorch_cuda(home=home)


def ensure_fish_speech_installed() -> Path:
    """Ensure a Fish Speech **source tree** exists and editable deps are installed."""
    raw = os.environ.get("ECHO_FISH_SPEECH_HOME", "").strip()
    if raw:
        home = Path(raw).expanduser().resolve()
        _validate_home(home)
        return home

    home = data_root() / "src" / "fish-speech"
    if not (home / ".project-root").is_file():
        if home.exists():
            print(f"[echo-fish-speech] Removing incomplete tree {home}")
            shutil.rmtree(home)
        _git_clone(home)

    stamp = home / _STAMP_NAME
    if not stamp.is_file():
        _pip_install_editable(home)
        stamp.write_text("ok\n", encoding="utf-8")
    else:
        ensure_pytorch_cuda(home=home)

    _validate_home(home)
    return home


def fish_speech_home() -> Path:
    return ensure_fish_speech_installed()


def require_runtime_extras() -> None:
    try:
        import huggingface_hub  # noqa: F401
    except ImportError as err:
        raise SystemExit(
            'Missing Python deps. Run: pip install -e "servers/fish[runtime]"'
        ) from err


def main() -> None:
    """Bootstrap Fish Speech source + deps (``python -m echo_fish_speech_server.deps``)."""
    require_runtime_extras()
    home = ensure_fish_speech_installed()
    print(f"[echo-fish-speech] Ready: {home}")


if __name__ == "__main__":
    main()
