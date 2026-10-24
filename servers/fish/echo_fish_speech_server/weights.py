from __future__ import annotations

import os
import sys
from pathlib import Path

# Relative checkpoint dir (under data root) -> Hugging Face model id
_DEFAULT_HF_REPOS: dict[str, str] = {
    "checkpoints/s2-pro": "fishaudio/s2-pro",
    "checkpoints/drama-3": "fishaudio/drama-3",
    "checkpoints/openaudio-s1-mini": "fishaudio/openaudio-s1-mini",
}


def data_root() -> Path:
    raw = os.environ.get("ECHO_FISH_DATA_DIR", "").strip()
    if raw:
        root = Path(raw).expanduser().resolve()
    elif sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        root = base / "ECHO" / "fish-speech"
    else:
        root = Path.home() / ".local" / "share" / "echo" / "fish-speech"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _auto_download_enabled() -> bool:
    return os.environ.get("ECHO_FISH_AUTO_DOWNLOAD", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def checkpoint_ready(path: Path) -> bool:
    return path.is_dir() and (path / "config.json").is_file()


def hf_repo_for_checkpoint(rel: str) -> str:
    override = os.environ.get("ECHO_FISH_HF_REPO", "").strip()
    if override:
        return override
    key = rel.replace("\\", "/").strip("/")
    if not key.startswith("checkpoints/"):
        key = f"checkpoints/{key}"
    repo = _DEFAULT_HF_REPOS.get(key)
    if repo:
        return repo
    raise SystemExit(
        f"No Hugging Face repo mapping for {rel!r}. Set ECHO_FISH_HF_REPO to the model id "
        "(e.g. fishaudio/drama-3)."
    )


def download_hf_repo(local_dir: Path, repo_id: str) -> None:
    from huggingface_hub import snapshot_download

    local_dir.mkdir(parents=True, exist_ok=True)
    print(f"[echo-fish-speech] Downloading {repo_id} → {local_dir} (large, one-time)…")
    snapshot_download(repo_id, local_dir=str(local_dir))


def ensure_checkpoint(path: Path, *, hf_repo: str) -> Path:
    if checkpoint_ready(path):
        return path
    if not _auto_download_enabled():
        raise SystemExit(
            f"Checkpoint not found at {path}. Set ECHO_FISH_AUTO_DOWNLOAD=1 or download weights manually."
        )
    download_hf_repo(path, hf_repo)
    if not checkpoint_ready(path):
        raise SystemExit(f"Download finished but {path}/config.json is still missing.")
    return path


def ensure_drama_codec(data: Path) -> None:
    """Drama 3 may borrow S2-Pro ``codec.pth`` when the drama dir has no codec."""
    drama = data / "checkpoints" / "drama-3"
    if not drama.is_dir():
        return
    if (drama / "codec.pth").is_file():
        return
    s2 = data / "checkpoints" / "s2-pro"
    if (s2 / "codec.pth").is_file():
        return
    if not _auto_download_enabled():
        return
    print("[echo-fish-speech] Drama 3 needs S2-Pro codec.pth — fetching fishaudio/s2-pro …")
    download_hf_repo(s2, "fishaudio/s2-pro")


def resolve_llama_checkpoint_path(_fish_home: Path) -> Path:
    rel = os.environ.get("ECHO_FISH_LLAMA_CHECKPOINT", "checkpoints/s2-pro").strip()
    rel_posix = rel.replace("\\", "/")
    path = Path(rel)
    if path.is_absolute():
        target = path
        hf_repo = os.environ.get("ECHO_FISH_HF_REPO", "").strip()
        if not hf_repo:
            hf_repo = _DEFAULT_HF_REPOS.get(f"checkpoints/{target.name}", "")
        if not hf_repo:
            raise SystemExit(
                f"Set ECHO_FISH_HF_REPO for checkpoint path {target} (e.g. fishaudio/drama-3)."
            )
    elif rel_posix.startswith("checkpoints/"):
        target = data_root() / rel_posix
        hf_repo = hf_repo_for_checkpoint(rel_posix)
    else:
        target = _fish_home / rel
        hf_repo = os.environ.get("ECHO_FISH_HF_REPO", "").strip() or hf_repo_for_checkpoint(
            f"checkpoints/{rel_posix}"
        )

    ensure_checkpoint(target, hf_repo=hf_repo)
    ensure_drama_codec(data_root())
    return target.resolve()
