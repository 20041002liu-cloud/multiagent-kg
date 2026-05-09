"""Lightweight embedding server using sentence-transformers + FastAPI.
Start: python embedding_server.py
OpenAI-compatible /v1/embeddings endpoint on port 8089.
"""
from __future__ import annotations

import os
import sys
from typing import Any

# Use HF mirror + D drive cache for China mainland access
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HOME", "D:/huggingface_cache")

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_NAME = "BAAI/bge-m3"
PORT = 8089

print(f"Loading {MODEL_NAME} ...", flush=True)
model = SentenceTransformer(MODEL_NAME)
print(f"Loaded. dim={model.get_sentence_embedding_dimension()}", flush=True)

app = FastAPI(title="bge-m3 embedding service")


class EmbeddingRequest(BaseModel):
    model: str = MODEL_NAME
    input: list[str] | str

    @property
    def texts(self) -> list[str]:
        return [self.input] if isinstance(self.input, str) else self.input


class EmbeddingData(BaseModel):
    object: str = "embedding"
    index: int = 0
    embedding: list[float]


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    total_tokens: int = 0


class EmbeddingResponse(BaseModel):
    object: str = "list"
    data: list[EmbeddingData]
    model: str = MODEL_NAME
    usage: UsageInfo = UsageInfo()


@app.post("/v1/embeddings", response_model=EmbeddingResponse)
def embeddings(req: EmbeddingRequest) -> dict[str, Any]:
    texts = req.texts
    vecs = model.encode(texts, normalize_embeddings=True)
    data = [
        EmbeddingData(index=i, embedding=v.tolist())
        for i, v in enumerate(vecs)
    ]
    return {
        "object": "list",
        "data": [d.model_dump() for d in data],
        "model": MODEL_NAME,
        "usage": {"prompt_tokens": sum(len(t) for t in texts), "total_tokens": 0},
    }


@app.get("/v1/models")
def list_models() -> dict[str, Any]:
    return {"object": "list", "data": [{"id": MODEL_NAME, "object": "model"}]}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
