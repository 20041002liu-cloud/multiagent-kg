from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import faiss
import numpy as np
from neo4j import GraphDatabase
from neo4j.exceptions import Neo4jError, ServiceUnavailable

from .data_utils import repair_text_encoding

logger = logging.getLogger(__name__)


def _clean_row(item: dict[str, Any]) -> dict[str, Any]:
    row = dict(item)
    for key in ("head", "relation", "tail", "evidence", "head_type", "tail_type"):
        if key in row:
            row[key] = repair_text_encoding(str(row.get(key) or "")).strip()
    return row


class GraphStore:
    def __init__(self, uri: str | None, user: str, password: str, local_path: Path | None = None) -> None:
        self._driver = None
        self._local_path = local_path
        self._lock = threading.Lock()
        self._in_memory: list[dict[str, Any]] = self._load_local()
        self._vector_index: faiss.IndexFlatIP | None = None
        self._vector_texts: list[str] = []
        self._vector_rows: list[dict[str, Any]] = []
        self._vector_kb_id: str | None = None
        self._vector_dim: int = 0
        if uri:
            self._driver = GraphDatabase.driver(uri, auth=(user, password))

    @property
    def backend(self) -> str:
        return "neo4j" if self._driver else "local_json"

    def close(self) -> None:
        if self._driver:
            self._driver.close()

    def _load_local(self) -> list[dict[str, Any]]:
        if not self._local_path or not self._local_path.exists():
            return []
        try:
            data = json.loads(self._local_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        rows = data.get("triples", data if isinstance(data, list) else [])
        if not isinstance(rows, list):
            return []
        return [_clean_row(x) for x in rows if isinstance(x, dict)]

    def _save_local(self) -> None:
        if not self._local_path:
            return
        self._local_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "triples": self._in_memory,
        }
        self._local_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _local_rows(self, knowledge_base_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [
                _clean_row(x)
                for x in self._in_memory
                if x.get("knowledge_base_id") == knowledge_base_id
            ]

    def neo4j_status(self, knowledge_base_id: str) -> dict[str, Any]:
        local_count = len(self._local_rows(knowledge_base_id))
        if not self._driver:
            return {
                "configured": False,
                "connected": False,
                "backend": self.backend,
                "local_triples": local_count,
                "neo4j_triples": None,
                "error": "NEO4J_URI is not configured",
            }

        query = """
        MATCH ()-[r:RELATED_TO]->()
        WHERE r.knowledge_base_id = $knowledge_base_id
        RETURN count(r) AS rel_count
        """
        try:
            self._driver.verify_connectivity()
            with self._driver.session() as session:
                result = session.run(query, knowledge_base_id=knowledge_base_id).single()
            return {
                "configured": True,
                "connected": True,
                "backend": self.backend,
                "local_triples": local_count,
                "neo4j_triples": int(result["rel_count"]) if result else 0,
                "error": None,
            }
        except (Neo4jError, ServiceUnavailable, OSError) as exc:
            return {
                "configured": True,
                "connected": False,
                "backend": self.backend,
                "local_triples": local_count,
                "neo4j_triples": None,
                "error": str(exc),
            }

    def sync_local_to_neo4j(self, knowledge_base_id: str) -> dict[str, Any]:
        if not self._driver:
            return {
                "synced": 0,
                "backend": self.backend,
                "error": "NEO4J_URI is not configured",
            }

        rows = self._local_rows(knowledge_base_id)
        if not rows:
            return {"synced": 0, "backend": "neo4j", "error": None}

        payload = []
        for item in rows:
            row = _clean_row(item)
            row["knowledge_base_id"] = knowledge_base_id
            row["source"] = row.get("source", "local_json")
            payload.append(row)

        query = """
        UNWIND $rows AS row
        MERGE (h:Entity {knowledge_base_id: row.knowledge_base_id, name: row.head})
          ON CREATE SET h.entity_type = coalesce(row.head_type, "Concept")
          ON MATCH SET h.entity_type = coalesce(row.head_type, h.entity_type, "Concept")
        MERGE (t:Entity {knowledge_base_id: row.knowledge_base_id, name: row.tail})
          ON CREATE SET t.entity_type = coalesce(row.tail_type, "Concept")
          ON MATCH SET t.entity_type = coalesce(row.tail_type, t.entity_type, "Concept")
        MERGE (h)-[r:RELATED_TO {relation: row.relation, knowledge_base_id: row.knowledge_base_id}]->(t)
        SET r.evidence = coalesce(row.evidence, ""),
            r.confidence = coalesce(row.confidence, 0.7),
            r.source = row.source,
            r.updated_at = datetime()
        RETURN count(r) AS rel_count
        """
        try:
            self._driver.verify_connectivity()
            with self._driver.session() as session:
                result = session.run(query, rows=payload).single()
            return {
                "synced": int(result["rel_count"]) if result else 0,
                "backend": "neo4j",
                "error": None,
            }
        except (Neo4jError, ServiceUnavailable, OSError) as exc:
            return {"synced": 0, "backend": "neo4j", "error": str(exc)}

    def upsert_triples(self, triples: list[dict[str, Any]], source: str, knowledge_base_id: str) -> dict[str, Any]:
        if not triples:
            return {"written": 0, "backend": "none"}

        # Invalidate vector cache for this KB since data is changing
        if self._vector_kb_id == knowledge_base_id:
            self.invalidate_vector_index()

        def write_local() -> dict[str, Any]:
            with self._lock:
                before = len(self._in_memory)
                index = {
                    (x["knowledge_base_id"], x["head"], x["relation"], x["tail"]): i
                    for i, x in enumerate(self._in_memory)
                }
                for item in triples:
                    item = _clean_row(item)
                    key = (knowledge_base_id, item["head"], item["relation"], item["tail"])
                    row = dict(item)
                    row["knowledge_base_id"] = knowledge_base_id
                    row["source"] = source
                    row["updated_at"] = datetime.now(timezone.utc).isoformat()
                    if key in index:
                        self._in_memory[index[key]].update(row)
                    else:
                        index[key] = len(self._in_memory)
                        self._in_memory.append(row)
                self._save_local()
                return {"written": len(self._in_memory) - before, "backend": "local_json"}

        if not self._driver:
            return write_local()

        rows = []
        for item in triples:
            row = _clean_row(item)
            row["knowledge_base_id"] = knowledge_base_id
            row["source"] = source
            rows.append(row)

        query = """
        UNWIND $rows AS row
        MERGE (h:Entity {knowledge_base_id: row.knowledge_base_id, name: row.head})
          ON CREATE SET h.entity_type = coalesce(row.head_type, "Concept")
        MERGE (t:Entity {knowledge_base_id: row.knowledge_base_id, name: row.tail})
          ON CREATE SET t.entity_type = coalesce(row.tail_type, "Concept")
        MERGE (h)-[r:RELATED_TO {relation: row.relation, knowledge_base_id: row.knowledge_base_id}]->(t)
        SET r.evidence = coalesce(row.evidence, ""),
            r.confidence = coalesce(row.confidence, 0.7),
            r.source = row.source,
            r.updated_at = datetime()
        RETURN count(r) AS rel_count
        """
        try:
            with self._driver.session() as session:
                result = session.run(query, rows=rows).single()
            return {"written": int(result["rel_count"]) if result else 0, "backend": "neo4j"}
        except (Neo4jError, ServiceUnavailable, OSError):
            result = write_local()
            result["fallback"] = "neo4j_unavailable"
            return result

    def delete_document(self, knowledge_base_id: str, document_id: str) -> dict[str, Any]:
        source_prefix = f"{document_id}:"
        if not self._driver:
            with self._lock:
                before = len(self._in_memory)
                self._in_memory = [
                    row
                    for row in self._in_memory
                    if not (
                        row.get("knowledge_base_id") == knowledge_base_id
                        and str(row.get("source", "")).startswith(source_prefix)
                    )
                ]
                self._save_local()
                return {"deleted": before - len(self._in_memory), "backend": "local_json"}

        query = """
        MATCH ()-[r:RELATED_TO]->()
        WHERE r.knowledge_base_id = $knowledge_base_id AND r.source STARTS WITH $source_prefix
        WITH collect(r) AS rels
        FOREACH (r IN rels | DELETE r)
        RETURN size(rels) AS deleted
        """
        with self._driver.session() as session:
            result = session.run(query, knowledge_base_id=knowledge_base_id, source_prefix=source_prefix).single()
        return {"deleted": int(result["deleted"]) if result else 0, "backend": "neo4j"}

    def delete_knowledge_base(self, knowledge_base_id: str) -> dict[str, Any]:
        if not self._driver:
            with self._lock:
                before = len(self._in_memory)
                self._in_memory = [
                    row for row in self._in_memory if row.get("knowledge_base_id") != knowledge_base_id
                ]
                self._save_local()
                return {"deleted": before - len(self._in_memory), "backend": "local_json"}

        query = """
        MATCH (h:Entity {knowledge_base_id: $knowledge_base_id})-[r:RELATED_TO]->(t:Entity {knowledge_base_id: $knowledge_base_id})
        WITH collect(r) AS rels
        FOREACH (r IN rels | DELETE r)
        WITH size(rels) AS deleted
        MATCH (n:Entity {knowledge_base_id: $knowledge_base_id})
        DETACH DELETE n
        RETURN deleted
        """
        with self._driver.session() as session:
            result = session.run(query, knowledge_base_id=knowledge_base_id).single()
        return {"deleted": int(result["deleted"]) if result else 0, "backend": "neo4j"}

    def search_triples(self, knowledge_base_id: str, keywords: list[str], limit: int = 30) -> list[dict[str, Any]]:
        """Fuzzy search triples by keyword matching across head/relation/tail/evidence."""
        if not keywords:
            with self._lock:
                rows = [_clean_row(x) for x in self._in_memory if x.get("knowledge_base_id") == knowledge_base_id]
            return rows[:limit]

        kws = [kw.lower() for kw in keywords]
        def _score(row: dict[str, Any]) -> int:
            text = " ".join(str(row.get(k, "")) for k in ("head", "relation", "tail", "evidence")).lower()
            return sum(1 for kw in kws if kw in text)

        with self._lock:
            rows = [_clean_row(x) for x in self._in_memory if x.get("knowledge_base_id") == knowledge_base_id]

        scored = [(row, _score(row)) for row in rows]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [row for row, score in scored if score > 0][:limit]

    def _triple_text(self, row: dict[str, Any]) -> str:
        return " ".join(str(row.get(k, "")) for k in ("head", "relation", "tail", "evidence"))

    def _build_vector_index(self, knowledge_base_id: str, adapter: Any, dim: int) -> None:
        """Build FAISS inner-product index for all triples in a KB."""
        with self._lock:
            rows = [_clean_row(x) for x in self._in_memory if x.get("knowledge_base_id") == knowledge_base_id]
        if not rows:
            self._vector_index = None
            self._vector_texts = []
            self._vector_rows = []
            self._vector_kb_id = None
            return

        texts = [self._triple_text(row) for row in rows]
        try:
            embeddings = adapter.embed_batch(texts)
        except Exception:
            logger.warning("Failed to build vector index for KB %s", knowledge_base_id, exc_info=True)
            self._vector_index = None
            self._vector_texts = []
            self._vector_rows = []
            self._vector_kb_id = None
            return

        arr = np.array(embeddings, dtype=np.float32)
        norms = np.linalg.norm(arr, axis=1, keepdims=True).clip(min=1e-08)
        arr = arr / norms
        index = faiss.IndexFlatIP(arr.shape[1])
        index.add(arr)
        self._vector_index = index
        self._vector_texts = texts
        self._vector_rows = rows
        self._vector_kb_id = knowledge_base_id
        self._vector_dim = arr.shape[1]

    def _ensure_vector_index(self, knowledge_base_id: str, adapter: Any, dim: int) -> None:
        if self._vector_index is None or self._vector_kb_id != knowledge_base_id or self._vector_dim != dim:
            self._build_vector_index(knowledge_base_id, adapter, dim)

    def invalidate_vector_index(self) -> None:
        self._vector_index = None
        self._vector_texts = []
        self._vector_rows = []
        self._vector_kb_id = None

    def search_by_embedding(
        self, knowledge_base_id: str, query: str, adapter: Any, top_k: int = 20
    ) -> list[dict[str, Any]]:
        """Semantic vector search over triples."""
        self._ensure_vector_index(knowledge_base_id, adapter, adapter.dim)
        if self._vector_index is None or not self._vector_rows:
            return []

        try:
            q_emb = adapter.embed([query])
        except Exception:
            logger.warning("Embedding query failed", exc_info=True)
            return []

        q_arr = np.array(q_emb, dtype=np.float32)
        q_arr = q_arr / (np.linalg.norm(q_arr, axis=1, keepdims=True).clip(min=1e-08))
        k = min(top_k, self._vector_index.ntotal)
        scores, idx = self._vector_index.search(q_arr, k)

        seen: set[tuple[str, str, str]] = set()
        results: list[dict[str, Any]] = []
        for score, i in zip(scores[0], idx[0]):
            if i < 0 or i >= len(self._vector_rows):
                continue
            row = self._vector_rows[i]
            key = (str(row.get("head", "")), str(row.get("relation", "")), str(row.get("tail", "")))
            if key in seen:
                continue
            seen.add(key)
            row = dict(row)
            row["_semantic_score"] = round(float(score), 4)
            results.append(row)
        return results

    def search_hybrid(
        self, knowledge_base_id: str, query_text: str, keywords: list[str],
        adapter: Any, top_k: int = 30,
    ) -> list[dict[str, Any]]:
        """Hybrid search: semantic + keyword, merged and deduplicated."""
        semantic_results = self.search_by_embedding(knowledge_base_id, query_text, adapter, top_k=top_k)
        keyword_results = self.search_triples(knowledge_base_id, keywords, limit=top_k)

        merged: dict[tuple[str, str, str], dict[str, Any]] = {}
        # Semantic first (higher quality signal)
        for row in semantic_results:
            key = (str(row.get("head", "")), str(row.get("relation", "")), str(row.get("tail", "")))
            merged[key] = row

        # Keyword: add missing, boost matched
        for row in keyword_results:
            key = (str(row.get("head", "")), str(row.get("relation", "")), str(row.get("tail", "")))
            if key in merged:
                merged[key]["_keyword_match"] = True
            else:
                row["_keyword_match"] = True
                merged[key] = row

        results = list(merged.values())
        # Sort: semantic score desc, then keyword match bonus
        def _sort_key(r: dict[str, Any]) -> float:
            sem = r.get("_semantic_score", 0.0)
            kw = 0.05 if r.get("_keyword_match") else 0.0
            return sem + kw
        results.sort(key=_sort_key, reverse=True)
        return results[:top_k]

    def query_entity(self, knowledge_base_id: str, name: str = "", limit: int = 20) -> list[dict[str, Any]]:
        clean_name = repair_text_encoding(str(name or "")).strip()
        def query_local() -> list[dict[str, Any]]:
            with self._lock:
                rows = [_clean_row(x) for x in self._in_memory if x.get("knowledge_base_id") == knowledge_base_id]
            if clean_name:
                rows = [x for x in rows if x["head"] == clean_name or x["tail"] == clean_name]
            # Mix oldest + newest rows so linker edges appear alongside original results
            if len(rows) > limit and not clean_name:
                half = max(1, limit // 2)
                rows = rows[:half] + rows[-half:]
            return rows[:limit]

        if not self._driver:
            return query_local()

        query_by_entity = """
        MATCH (h:Entity)-[r:RELATED_TO]->(t:Entity)
        WHERE r.knowledge_base_id = $knowledge_base_id
          AND (h.name = $name OR t.name = $name)
        RETURN h.name AS head, r.relation AS relation, t.name AS tail, r.evidence AS evidence
        LIMIT $limit
        """
        query_recent = """
        MATCH (h:Entity)-[r:RELATED_TO]->(t:Entity)
        WHERE r.knowledge_base_id = $knowledge_base_id
        RETURN h.name AS head, r.relation AS relation, t.name AS tail, r.evidence AS evidence
        LIMIT $limit
        """
        with self._driver.session() as session:
            try:
                if clean_name:
                    rows = session.run(query_by_entity, knowledge_base_id=knowledge_base_id, name=clean_name, limit=limit)
                else:
                    rows = session.run(query_recent, knowledge_base_id=knowledge_base_id, limit=limit)
                return [_clean_row(dict(record)) for record in rows]
            except (Neo4jError, ServiceUnavailable, OSError):
                return query_local()
