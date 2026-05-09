from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class Entity(BaseModel):
    name: str
    entity_type: str = "Concept"
    aliases: list[str] = Field(default_factory=list)
    evidence: str = ""
    confidence: float = 0.7


class Triple(BaseModel):
    head: str
    relation: str
    tail: str
    evidence: str = ""
    confidence: float = 0.7
    head_type: str = "Concept"
    tail_type: str = "Concept"


class RunRequest(BaseModel):
    text: str = ""
    strategy: Literal["single", "ontology", "multi"] = "multi"
    knowledge_base_id: str = "default"
    document_id: str = "doc-001"
    chapter_id: str = "chapter-1"


class StartRunResponse(BaseModel):
    run_id: str
    status: str


class RunInfo(BaseModel):
    run_id: str
    strategy: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    summary: dict[str, Any] = Field(default_factory=dict)


class ExperimentRequest(BaseModel):
    text: str
    knowledge_base_id: str = "default"
    document_id: str = "doc-001"
    chapter_id: str = "chapter-1"


class ExperimentItem(BaseModel):
    strategy: str
    run_id: str
    metrics: dict[str, Any]


class ExperimentResponse(BaseModel):
    items: list[ExperimentItem]


class CreateKBRequest(BaseModel):
    name: str
    description: str = ""


class KnowledgeBaseItem(BaseModel):
    id: str
    name: str
    description: str = ""
    created_at: datetime
    updated_at: datetime


class DocumentItem(BaseModel):
    id: str
    knowledge_base_id: str
    filename: str
    file_type: str
    status: str
    chunk_count: int
    error: str | None = None
    size_bytes: int
    created_at: datetime
    updated_at: datetime


class KBRunStartRequest(BaseModel):
    strategy: Literal["single", "ontology", "multi"] = "multi"
    text: str = ""
    document_id: str | None = None
    chapter_id: str = "chapter-1"


class ChatRequest(BaseModel):
    question: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict]


class KBRunStartResponse(BaseModel):
    run_id: str
    status: str
    knowledge_base_id: str
