from __future__ import annotations

import logging
from typing import Any

import httpx
from openai import OpenAI

from .config import Settings


logger = logging.getLogger(__name__)


class EmbeddingAdapter:
    """Standalone embedding model adapter via OpenAI-compatible /v1/embeddings."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        base_url = settings.embedding_base_url or settings.model_base_url
        self.enabled = bool(base_url)
        self._client = OpenAI(
            base_url=base_url,
            api_key=settings.model_api_key,
            timeout=float(settings.model_timeout_seconds),
            http_client=httpx.Client(trust_env=False, timeout=float(settings.model_timeout_seconds)),
        ) if self.enabled else None
        self._model = settings.embedding_model_name
        self._dim = settings.embedding_dim
        self.last_error: str | None = None

    @property
    def dim(self) -> int:
        return self._dim

    def diagnostics(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "model": self._model,
            "dim": self._dim,
            "last_error": self.last_error,
        }

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not self.enabled or self._client is None:
            raise RuntimeError("EmbeddingAdapter disabled: EMBEDDING_BASE_URL not configured.")
        resp = self._client.embeddings.create(model=self._model, input=texts)
        self.last_error = None
        return [d.embedding for d in resp.data]

    def embed_batch(self, texts: list[str], batch_size: int = 64) -> list[list[float]]:
        results: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            try:
                results.extend(self.embed(batch))
            except Exception as exc:
                logger.warning("Embedding batch %d failed: %s", i // batch_size, exc)
                self.last_error = str(exc)
                raise
        return results
