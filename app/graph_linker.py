"""Post-processing: link disconnected but semantically related entities in the KG."""

from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import numpy as np

from .graph_store import GraphStore
from .model_adapter import OpenAICompatibleAdapter

logger = logging.getLogger(__name__)

CO_OCCURRENCE = "co_occurrence"
SEMANTIC_RELATED = "semantic_related"
DEFAULT_EMBEDDING_THRESHOLD = 0.92
EMBEDDING_TOP_K = 1


def link_by_cooccurrence(
    graph_store: GraphStore,
    knowledge_base_id: str,
    triples: list[dict[str, Any]] | None = None,
    min_cooccurrences: int = 2,
    max_edges_per_entity: int = 3,
) -> list[dict[str, Any]]:
    """Link entities that co-occur across multiple source chunks, with per-entity cap."""
    if triples is None:
        triples = graph_store.search_triples(knowledge_base_id, keywords=[], limit=100000)
    if not triples:
        return []

    # Build entity -> set of sources
    entity_sources: dict[str, set[str]] = {}
    for t in triples:
        src = str(t.get("source", ""))
        for entity in (t["head"], t["tail"]):
            if entity not in entity_sources:
                entity_sources[entity] = set()
            entity_sources[entity].add(src)

    # Existing edges (bidirectional)
    existing: set[tuple[str, str]] = set()
    for t in triples:
        existing.add((t["head"], t["tail"]))
        existing.add((t["tail"], t["head"]))

    # Count shared sources for each candidate pair
    pair_scores: list[tuple[int, str, str, str]] = []
    entities_list = sorted(entity_sources.keys())
    for i in range(len(entities_list)):
        for j in range(i + 1, len(entities_list)):
            a, b = entities_list[i], entities_list[j]
            if (a, b) in existing:
                continue
            shared = entity_sources[a] & entity_sources[b]
            if len(shared) >= min_cooccurrences:
                pair_scores.append((len(shared), a, b, ",".join(sorted(shared)[:3])))

    # Sort by score descending
    pair_scores.sort(key=lambda x: x[0], reverse=True)

    # Apply per-entity cap
    entity_edge_count: Counter[str] = Counter()
    new_edges: list[dict[str, Any]] = []

    for score, a, b, shared_srcs in pair_scores:
        if entity_edge_count[a] >= max_edges_per_entity:
            continue
        if entity_edge_count[b] >= max_edges_per_entity:
            continue
        entity_edge_count[a] += 1
        entity_edge_count[b] += 1
        new_edges.append({
            "head": a,
            "relation": CO_OCCURRENCE,
            "tail": b,
            "evidence": f"共现 {score} 次 | {shared_srcs}",
            "confidence": round(min(0.3 + score * 0.15, 1.0), 3),
            "head_type": "Entity",
            "tail_type": "Entity",
            "knowledge_base_id": knowledge_base_id,
            "source": "linker:cooccurrence",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    return new_edges


def link_by_embedding(
    graph_store: GraphStore,
    knowledge_base_id: str,
    adapter: OpenAICompatibleAdapter,
    triples: list[dict[str, Any]] | None = None,
    threshold: float = DEFAULT_EMBEDDING_THRESHOLD,
) -> list[dict[str, Any]]:
    """Find semantically similar entities via embeddings.

    Only considers: low-degree entity (degree <= 2) → any other entity.
    Requires: cosine similarity > threshold. No source constraint.
    Per-entity cap prevents hub explosion."""
    if not adapter.enabled:
        logger.warning("Embedding adapter not available, skipping semantic linking")
        return []

    if triples is None:
        triples = graph_store.search_triples(knowledge_base_id, keywords=[], limit=100000)
    if not triples:
        return []

    degree: Counter[str] = Counter()
    for t in triples:
        degree[t["head"]] += 1
        degree[t["tail"]] += 1

    unique_entities = list(degree.keys())
    low_degree = [e for e in unique_entities if degree[e] <= 2]
    high_degree = [e for e in unique_entities if degree[e] > 2]

    if not low_degree:
        return []

    all_entities = low_degree + high_degree
    try:
        embeddings_list = adapter.embed_batch(all_entities)
    except Exception as exc:
        logger.warning("Embedding failed: %s", exc)
        return []

    emb_array = np.array(embeddings_list, dtype=np.float32)
    norms = np.linalg.norm(emb_array, axis=1, keepdims=True).clip(min=1e-08)
    emb_array = emb_array / norms

    low_embs = emb_array[:len(low_degree)]
    all_embs = emb_array  # all entities, so low-degree can also connect to each other

    # Low-degree vs all entities similarity
    sims = low_embs @ all_embs.T

    existing: set[tuple[str, str]] = set()
    for t in triples:
        existing.add((t["head"], t["tail"]))
        existing.add((t["tail"], t["head"]))

    # Per-entity top-K: for each low-degree entity, connect to its top-K
    # most similar entities, with a minimum similarity floor.
    seen_pairs: set[tuple[str, str]] = set()
    new_edges: list[dict[str, Any]] = []

    for i, low_entity in enumerate(low_degree):
        # Build (sim, other_idx, other_entity) for this low-degree entity
        scored: list[tuple[float, int, str]] = []
        for j, other_entity in enumerate(all_entities):
            if low_entity == other_entity:
                continue
            if (low_entity, other_entity) in existing:
                continue
            key = (low_entity, other_entity) if low_entity < other_entity else (other_entity, low_entity)
            if key in seen_pairs:
                continue
            sim = float(sims[i, j])
            if sim < threshold:
                continue
            scored.append((sim, j, other_entity))
        scored.sort(key=lambda x: x[0], reverse=True)
        for sim, _j, other_entity in scored[:EMBEDDING_TOP_K]:
            key = (low_entity, other_entity) if low_entity < other_entity else (other_entity, low_entity)
            seen_pairs.add(key)
            new_edges.append({
                "head": low_entity,
                "relation": SEMANTIC_RELATED,
                "tail": other_entity,
                "evidence": f"语义相似度: {sim:.3f}",
                "confidence": round(sim, 3),
                "head_type": "Entity",
                "tail_type": "Entity",
                "knowledge_base_id": knowledge_base_id,
                "source": "linker:embedding",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })

    return new_edges


def link_entities(
    graph_store: GraphStore,
    knowledge_base_id: str,
    adapter: OpenAICompatibleAdapter | None = None,
    triples: list[dict[str, Any]] | None = None,
    embedding_threshold: float = DEFAULT_EMBEDDING_THRESHOLD,
    write_to_graph: bool = True,
) -> dict[str, Any]:
    """Run all linking strategies. If write_to_graph=False, return edges without writing."""
    cooccurrence_edges = link_by_cooccurrence(
        graph_store, knowledge_base_id, triples=triples,
    )

    embedding_edges: list[dict[str, Any]] = []
    if adapter and adapter.enabled:
        embedding_edges = link_by_embedding(
            graph_store, knowledge_base_id, adapter, triples=triples,
            threshold=embedding_threshold,
        )

    all_edges = cooccurrence_edges + embedding_edges

    written = 0
    if all_edges and write_to_graph:
        result = graph_store.upsert_triples(
            triples=all_edges,
            source="linker",
            knowledge_base_id=knowledge_base_id,
        )
        written = result.get("written", 0)

    return {
        "cooccurrence": len(cooccurrence_edges),
        "embedding": len(embedding_edges),
        "total": len(all_edges),
        "written": written,
        "edges": all_edges,
    }
