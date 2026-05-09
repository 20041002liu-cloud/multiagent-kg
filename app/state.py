from __future__ import annotations

from typing import Any, TypedDict


class PipelineState(TypedDict, total=False):
    run_id: str
    strategy: str
    knowledge_base_id: str
    document_id: str
    chapter_id: str
    chunk_id: int
    raw_text: str
    clean_text: str
    vector_hits: list[str]
    ontology_schema: dict[str, Any]
    candidate_entities: list[dict[str, Any]]
    candidate_triples: list[dict[str, Any]]
    triples: list[dict[str, Any]]
    validation_report: dict[str, Any]
    graph_write_result: dict[str, Any]
    evaluation_metrics: dict[str, Any]
    errors: list[str]
