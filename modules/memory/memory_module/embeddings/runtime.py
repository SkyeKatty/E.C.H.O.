from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING

from memory_module.config import settings

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

logger = logging.getLogger("memory.embeddings")

_lock = threading.Lock()
_runtime: "EmbeddingRuntime | None" = None


class EmbeddingRuntime:
    def __init__(self, model: SentenceTransformer, model_id: str, dimension: int) -> None:
        self._model = model
        self.model_id = model_id
        self.model_version = settings.embedding_model_version
        self.dimension = dimension

    def encode(self, text: str) -> list[float]:
        trimmed = (text or "").strip()
        if not trimmed:
            raise ValueError("Cannot embed empty text")
        vec = self._model.encode(trimmed, normalize_embeddings=True, show_progress_bar=False)
        return [float(x) for x in vec.tolist()]


def get_embedding_runtime() -> EmbeddingRuntime | None:
    global _runtime
    if not settings.semantic_configured():
        return None
    if _runtime is not None:
        return _runtime
    with _lock:
        if _runtime is not None:
            return _runtime
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            logger.error(
                "sentence-transformers not installed; pip install -e '.[embeddings]' in modules/memory"
            )
            raise RuntimeError("Embedding dependencies missing") from exc

        model_id = settings.embedding_model or ""
        logger.info("Loading embedding model %s on %s", model_id, settings.embedding_device)
        try:
            model = SentenceTransformer(model_id, device=settings.embedding_device)
        except Exception as exc:
            raise RuntimeError(
                "Failed to load embedding model (check torch/transformers versions; "
                "pip install -e '.[embeddings]' in modules/memory)"
            ) from exc
        dimension = int(model.get_sentence_embedding_dimension())
        # Fail fast if torch was disabled by incompatible transformers (encode would break later).
        try:
            model.encode("health check", normalize_embeddings=True, show_progress_bar=False)
        except Exception as exc:
            raise RuntimeError(
                "Embedding model loaded but encode failed — often torch/transformers mismatch "
                "(need torch >= 2.2 and transformers < 4.48, or upgrade torch to >= 2.6)"
            ) from exc
        if settings.embedding_dimension and settings.embedding_dimension != dimension:
            logger.warning(
                "ECHO_MEMORY_EMBEDDING_DIMENSION=%s but model outputs %s; pgvector column may not be used",
                settings.embedding_dimension,
                dimension,
            )
        _runtime = EmbeddingRuntime(model, model_id, dimension)
        return _runtime


def try_get_embedding_runtime() -> EmbeddingRuntime | None:
    try:
        return get_embedding_runtime()
    except RuntimeError:
        return None
