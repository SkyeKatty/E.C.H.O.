"""Load memoryModule section from repo config.yaml when env vars are unset."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

_YAML_TO_ENV: list[tuple[str, str]] = [
    ("moduleId", "ECHO_MEMORY_MODULE_ID"),
    ("databaseUrl", "ECHO_MEMORY_DATABASE_URL"),
    ("controllerModuleWs", "ECHO_CONTROLLER_MODULE_WS"),
    ("moduleAuthToken", "ECHO_MODULE_AUTH_TOKEN"),
    ("embeddingModel", "ECHO_MEMORY_EMBEDDING_MODEL"),
    ("embeddingEnabled", "ECHO_MEMORY_EMBEDDING_ENABLED"),
    ("embeddingDevice", "ECHO_MEMORY_EMBEDDING_DEVICE"),
    ("embeddingModelVersion", "ECHO_MEMORY_EMBEDDING_MODEL_VERSION"),
    ("embeddingDimension", "ECHO_MEMORY_EMBEDDING_DIMENSION"),
    ("embeddingPollSec", "ECHO_MEMORY_EMBEDDING_POLL_SEC"),
    ("embeddingMaxAttempts", "ECHO_MEMORY_EMBEDDING_MAX_ATTEMPTS"),
    ("consolidationEnabled", "ECHO_MEMORY_CONSOLIDATION_ENABLED"),
    ("consolidationPollSec", "ECHO_MEMORY_CONSOLIDATION_POLL_SEC"),
    ("consolidationMaxAttempts", "ECHO_MEMORY_CONSOLIDATION_MAX_ATTEMPTS"),
    ("consolidationDuplicateRankMin", "ECHO_MEMORY_CONSOLIDATION_DUPLICATE_RANK_MIN"),
    ("consolidationContradictionDelta", "ECHO_MEMORY_CONSOLIDATION_CONTRADICTION_DELTA"),
    ("requireSubjectForPromotion", "ECHO_MEMORY_REQUIRE_SUBJECT"),
]


def _config_paths() -> list[Path]:
    explicit = os.getenv("ECHO_CONFIG")
    cwd = Path.cwd()
    candidates = [
        Path(explicit) if explicit else None,
        cwd / "config.yaml",
        cwd.parent / "config.yaml",
        cwd.parent.parent / "config.yaml",
    ]
    return [p for p in candidates if p is not None]


def _read_memory_module_block() -> dict[str, Any]:
    try:
        import yaml
    except ImportError:
        return {}

    for path in _config_paths():
        if not path.is_file():
            continue
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        if isinstance(raw, dict):
            block = raw.get("memoryModule")
            if isinstance(block, dict):
                return block
    return {}


def apply_config_yaml_to_env() -> None:
    block = _read_memory_module_block()
    if not block:
        return
    for yaml_key, env_key in _YAML_TO_ENV:
        if env_key in os.environ and os.environ[env_key] != "":
            continue
        if yaml_key not in block or block[yaml_key] is None:
            continue
        value = block[yaml_key]
        if isinstance(value, bool):
            os.environ[env_key] = "true" if value else "false"
        else:
            os.environ[env_key] = str(value)
