from __future__ import annotations

import hashlib
import logging
import math
import re
from typing import Any

import faiss
import numpy as np


logger = logging.getLogger(__name__)


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[\u4e00-\u9fa5A-Za-z0-9_]+", text.lower())


def _hashed_embedding(text: str, dim: int) -> np.ndarray:
    vec = np.zeros((dim,), dtype=np.float32)
    tokens = _tokenize(text)
    if not tokens:
        return vec
    for token in tokens:
        h = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16)
        idx = h % dim
        sign = -1.0 if ((h >> 8) & 1) else 1.0
        vec[idx] += sign
    norm = float(np.linalg.norm(vec))
    if norm > 1e-8:
        vec /= norm
    return vec


class FaissVectorMemory:
    def __init__(self, dim: int = 384, adapter: Any = None) -> None:
        if adapter is not None:
            dim = adapter.dim
        self._dim = dim
        self._adapter = adapter
        self._index = faiss.IndexFlatIP(dim)
        self._texts: list[str] = []
        self._metas: list[dict[str, Any]] = []

    def set_adapter(self, adapter: Any) -> None:
        self._adapter = adapter
        self._dim = adapter.dim

    def add(self, text: str, metadata: dict[str, Any] | None = None) -> None:
        vec = self._real_embedding(text) if self._adapter is not None else _hashed_embedding(text, self._dim)
        self._index.add(vec.reshape(1, -1))
        self._texts.append(text)
        self._metas.append(metadata or {})

    def search(self, query: str, top_k: int = 4) -> list[dict[str, Any]]:
        if self._index.ntotal == 0:
            return []
        q = self._real_embedding(query) if self._adapter is not None else _hashed_embedding(query, self._dim)
        q = q.reshape(1, -1)
        k = min(top_k, self._index.ntotal)
        scores, idx = self._index.search(q, k)
        results: list[dict[str, Any]] = []
        for score, i in zip(scores[0], idx[0]):
            if i < 0:
                continue
            results.append({
                "score": float(score),
                "text": self._texts[i],
                "metadata": self._metas[i],
            })
        return results

    def _real_embedding(self, text: str) -> np.ndarray:
        try:
            emb = self._adapter.embed([text])[0]
        except Exception:
            logger.warning("Real embedding failed, falling back to hashed embedding")
            return _hashed_embedding(text, self._dim)
        vec = np.array(emb, dtype=np.float32)
        norm = float(np.linalg.norm(vec))
        if norm > 1e-8:
            vec /= norm
        return vec


class MemoryManager:
    def __init__(self, dim: int = 384) -> None:
        self.vector = FaissVectorMemory(dim=dim)
        self.alias_map: dict[str, str] = {}

    def set_embedding_adapter(self, adapter: Any) -> None:
        """Inject a real embedding adapter, replacing hash-based embeddings."""
        self.vector.set_adapter(adapter)

    def remember_text(self, text: str, metadata: dict[str, Any]) -> None:
        self.vector.add(text, metadata=metadata)

    def retrieve_context(self, query: str, top_k: int = 4) -> list[str]:
        hits = self.vector.search(query=query, top_k=top_k)
        return [h["text"] for h in hits]

    def normalize_entity(self, name: str) -> str:
        key = name.strip().lower()
        return self.alias_map.get(key, name.strip())

    def register_alias(self, alias: str, canonical: str) -> None:
        self.alias_map[alias.strip().lower()] = canonical.strip()
