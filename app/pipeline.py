from __future__ import annotations

import asyncio
import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from langgraph.graph import END, START, StateGraph

from .agents_fixed import DEFAULT_ONTOLOGY, RELATION_GROUPS, CombinedExtractionAgent, EntityAgent, FusionAgent, PlannerAgent, RelationAgent, _build_relation_groups, _dedupe_triples, _schema_values
from .config import Settings
from .data_utils import repair_text_encoding, split_text
from .embedding_adapter import EmbeddingAdapter
from .evaluation import evaluate_state
from .events import EventBus
from .graph_store import GraphStore
from .memory import MemoryManager
from .model_adapter import OpenAICompatibleAdapter
from .schemas import Entity, Triple
from .state import PipelineState


class KGPipeline:
    def __init__(
        self,
        settings: Settings,
        event_bus: EventBus,
        memory: MemoryManager,
        graph_store: GraphStore,
        model_adapter: OpenAICompatibleAdapter,
        embedding_adapter: EmbeddingAdapter | None = None,
    ) -> None:
        self._settings = settings
        self._event_bus = event_bus
        self._memory = memory
        self._graph_store = graph_store
        self._adapter = model_adapter
        self._embedding_adapter = embedding_adapter

        if embedding_adapter is not None:
            memory.set_embedding_adapter(embedding_adapter)

        self._planner = PlannerAgent(model_adapter)
        self._combined = CombinedExtractionAgent(model_adapter)
        self._entity = EntityAgent(model_adapter)
        self._relation = RelationAgent(model_adapter)
        self._fusion = FusionAgent()
        self._cache_file = Path(settings.data_dir) / "extraction_cache.json"
        self._cache_lock = asyncio.Lock()
        self._graphs = {
            "single": self._build_graph("single"),
            "ontology": self._build_graph("ontology"),
            "multi": self._build_graph("multi"),
        }

    async def _emit(self, run_id: str, event_type: str, payload: dict[str, Any]) -> None:
        await self._event_bus.publish(run_id=run_id, event_type=event_type, payload=payload)

    def _cache_key(self, strategy: str, text: str, ontology_schema: dict[str, Any]) -> str:
        payload = json.dumps(
            {
                "version": 2,
                "strategy": strategy,
                "model": self._settings.model_name,
                "combined": self._settings.model_combined_extraction,
                "ontology": ontology_schema,
                "text": text,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _load_extraction_cache(self) -> dict[str, Any]:
        if not self._settings.extraction_cache_enabled or not self._cache_file.exists():
            return {}
        try:
            data = json.loads(self._cache_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _save_extraction_cache(self, cache: dict[str, Any]) -> None:
        if not self._settings.extraction_cache_enabled:
            return
        self._cache_file.parent.mkdir(parents=True, exist_ok=True)
        self._cache_file.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")

    async def _get_cached_extraction(self, key: str) -> dict[str, Any] | None:
        if not self._settings.extraction_cache_enabled:
            return None
        async with self._cache_lock:
            item = self._load_extraction_cache().get(key)
        return item if isinstance(item, dict) else None

    async def _put_cached_extraction(self, key: str, entities: list[Entity], triples: list[Triple]) -> None:
        if not self._settings.extraction_cache_enabled:
            return
        async with self._cache_lock:
            cache = self._load_extraction_cache()
            cache[key] = {
                "candidate_entities": [x.model_dump() for x in entities],
                "candidate_triples": [x.model_dump() for x in triples],
            }
            self._save_extraction_cache(cache)

    def _build_graph(self, strategy: str):
        graph = StateGraph(PipelineState)
        graph.add_node("ingest", self._node_ingest)
        graph.add_node("planner", self._node_planner)
        graph.add_node("single_extract", self._node_single_extract)
        graph.add_node("entity_extract", self._node_entity_extract)
        graph.add_node("relation_extract", self._node_relation_extract)
        graph.add_node("fusion", self._node_fusion)

        graph.add_edge(START, "ingest")
        if strategy == "single":
            graph.add_edge("ingest", "single_extract")
            graph.add_edge("single_extract", "fusion")
        elif strategy == "ontology":
            graph.add_edge("ingest", "planner")
            graph.add_edge("planner", "single_extract")
            graph.add_edge("single_extract", "fusion")
        else:
            graph.add_edge("ingest", "planner")
            graph.add_edge("planner", "entity_extract")
            graph.add_edge("entity_extract", "relation_extract")
            graph.add_edge("relation_extract", "fusion")
        graph.add_edge("fusion", END)
        return graph.compile()

    async def run(
        self,
        run_id: str,
        strategy: str,
        text: str,
        document_id: str,
        chapter_id: str,
        knowledge_base_id: str,
        chunks: list[str] | None = None,
    ) -> dict[str, Any]:
        text = repair_text_encoding(text)
        if chunks:
            chunks = [repair_text_encoding(chunk) for chunk in chunks]
        else:
            sc = self._settings.chunk_size * 2 if strategy == "multi" else self._settings.chunk_size
            chunks = split_text(text=text, chunk_size=sc, overlap=self._settings.chunk_overlap)
        if not chunks:
            raise ValueError("Input text is empty after preprocessing.")
        source_chunk_count = len(chunks)
        run_chunk_limit = max(0, self._settings.run_chunk_limit)
        if run_chunk_limit and len(chunks) > run_chunk_limit:
            chunks = chunks[:run_chunk_limit]

        await self._emit(
            run_id,
            "run_started",
            {
                "strategy": strategy,
                "knowledge_base_id": knowledge_base_id,
                "document_id": document_id,
                "chapter_id": chapter_id,
                "chunk_count": len(chunks),
                "source_chunk_count": source_chunk_count,
                "run_chunk_limit": run_chunk_limit or None,
                "chunk_size": len(chunks[0]) if chunks else 0,
                "extraction_concurrency": max(1, self._settings.extraction_concurrency),
            },
        )

        compiled = self._graphs[strategy]

        async def process_chunk(i: int, chunk: str) -> tuple[int, dict[str, Any]]:
            initial_state: PipelineState = {
                "run_id": run_id,
                "strategy": strategy,
                "knowledge_base_id": knowledge_base_id,
                "document_id": document_id,
                "chapter_id": chapter_id,
                "chunk_id": i,
                "raw_text": chunk,
                "clean_text": "",
                "ontology_schema": dict(DEFAULT_ONTOLOGY),
                "candidate_entities": [],
                "candidate_triples": [],
                "triples": [],
                "validation_report": {},
                "graph_write_result": {},
                "evaluation_metrics": {},
                "errors": [],
                "vector_hits": [],
            }
            await self._emit(run_id, "chunk_started", {"chunk_id": i, "preview": chunk[:120]})
            state = await compiled.ainvoke(initial_state)
            self._memory.remember_text(chunk, {"run_id": run_id, "chunk_id": i, "chapter_id": chapter_id})
            await self._emit(
                run_id,
                "chunk_finished",
                {
                    "chunk_id": i,
                    "triple_count": len(state.get("triples", [])),
                },
            )
            return i, dict(state)

        concurrency = max(1, self._settings.extraction_concurrency)
        results: list[tuple[int, dict[str, Any]]] = []
        if concurrency == 1 or len(chunks) == 1:
            for i, chunk in enumerate(chunks, start=1):
                results.append(await process_chunk(i, chunk))
        else:
            semaphore = asyncio.Semaphore(concurrency)

            async def guarded_process_chunk(i: int, chunk: str) -> tuple[int, dict[str, Any]]:
                async with semaphore:
                    return await process_chunk(i, chunk)

            tasks = [
                asyncio.create_task(guarded_process_chunk(i, chunk))
                for i, chunk in enumerate(chunks, start=1)
            ]
            try:
                for task in asyncio.as_completed(tasks):
                    results.append(await task)
            except Exception:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                raise

        results.sort(key=lambda item: item[0])
        all_triples: list[dict[str, Any]] = []
        last_state: dict[str, Any] = {}
        for _, state in results:
            last_state = state
            all_triples.extend(state.get("triples", []))

        merged_state = deepcopy(last_state)
        merged_state["triples"] = all_triples
        merged_state["evaluation_metrics"] = evaluate_state(merged_state)

        return merged_state

    async def _node_ingest(self, state: PipelineState) -> PipelineState:
        run_id = state["run_id"]
        await self._emit(run_id, "node_started", {"node": "ingest", "chunk_id": state.get("chunk_id")})
        text = state["raw_text"]
        vector_hits = self._memory.retrieve_context(text, top_k=self._settings.vector_top_k)
        await self._emit(run_id, "node_finished", {"node": "ingest", "vector_hits": len(vector_hits)})
        return {"vector_hits": vector_hits}

    @staticmethod
    def _extraction_text(state: PipelineState) -> str:
        return state.get("clean_text") or state["raw_text"]

    async def _node_planner(self, state: PipelineState) -> PipelineState:
        run_id = state["run_id"]
        await self._emit(run_id, "node_started", {"node": "planner", "chunk_id": state.get("chunk_id")})
        result = await asyncio.to_thread(
            self._planner.run,
            text=state["raw_text"],
            retrieved_context=state.get("vector_hits", []),
        )
        await self._emit(
            run_id,
            "node_finished",
            {
                "node": "planner",
                "raw_len": len(state["raw_text"]),
                "clean_len": len(result.get("clean_text", "")),
            },
        )
        return {
            "ontology_schema": {
                "entity_types": result.get("entity_types", DEFAULT_ONTOLOGY["entity_types"]),
                "relations": result.get("relations", DEFAULT_ONTOLOGY["relations"]),
            },
            "clean_text": result.get("clean_text", state["raw_text"]),
        }

    async def _node_single_extract(self, state: PipelineState) -> PipelineState:
        run_id = state["run_id"]
        await self._emit(run_id, "node_started", {"node": "single_extract", "chunk_id": state.get("chunk_id")})
        schema = state.get("ontology_schema", DEFAULT_ONTOLOGY)
        text = self._extraction_text(state)
        cache_key = self._cache_key("single_extract", text, schema)
        cached = await self._get_cached_extraction(cache_key)
        cache_hit = cached is not None
        if cached:
            entities = [Entity(**x) for x in cached.get("candidate_entities", [])]
            triples = [Triple(**x) for x in cached.get("candidate_triples", [])]
        elif self._settings.model_combined_extraction:
            entities, triples = await asyncio.to_thread(
                self._combined.run,
                text=text,
                ontology_schema=schema,
                retrieved_context=state.get("vector_hits", []),
            )
            await self._put_cached_extraction(cache_key, entities, triples)
        else:
            entities = await asyncio.to_thread(
                self._entity.run,
                text=text,
                ontology_schema=schema,
                retrieved_context=state.get("vector_hits", []),
            )
            triples = await asyncio.to_thread(
                self._relation.run,
                text=text,
                entities=entities,
                ontology_schema=schema,
                retrieved_context=state.get("vector_hits", []),
            )
            await self._put_cached_extraction(cache_key, entities, triples)
        await self._emit(
            run_id,
            "node_finished",
            {
                "node": "single_extract",
                "entity_count": len(entities),
                "triple_count": len(triples),
                "combined": self._settings.model_combined_extraction,
                "cache_hit": cache_hit,
            },
        )
        return {
            "candidate_entities": [x.model_dump() for x in entities],
            "candidate_triples": [x.model_dump() for x in triples],
        }

    async def _node_entity_extract(self, state: PipelineState) -> PipelineState:
        run_id = state["run_id"]
        await self._emit(run_id, "node_started", {"node": "entity_extract", "chunk_id": state.get("chunk_id")})
        schema = state.get("ontology_schema", DEFAULT_ONTOLOGY)
        text = self._extraction_text(state)
        cache_key = self._cache_key("combined_extract", text, schema)
        cached = await self._get_cached_extraction(cache_key)
        cache_hit = cached is not None
        if cached:
            entities = [Entity(**x) for x in cached.get("candidate_entities", [])]
            triples = [Triple(**x) for x in cached.get("candidate_triples", [])]
        elif self._settings.model_combined_extraction:
            entities, triples = await asyncio.to_thread(
                self._combined.run,
                text=text,
                ontology_schema=schema,
                retrieved_context=state.get("vector_hits", []),
            )
            await self._put_cached_extraction(cache_key, entities, triples)
        else:
            entities = await asyncio.to_thread(
                self._entity.run,
                text=text,
                ontology_schema=schema,
                retrieved_context=state.get("vector_hits", []),
            )
            triples = []
            await self._put_cached_extraction(cache_key, entities, triples)
        await self._emit(
            run_id,
            "node_finished",
            {
                "node": "entity_extract",
                "entity_count": len(entities),
                "prefetched_triple_count": len(triples),
                "combined": self._settings.model_combined_extraction,
                "cache_hit": cache_hit,
            },
        )
        result = {"candidate_entities": [x.model_dump() for x in entities]}
        if triples:
            result["candidate_triples"] = [x.model_dump() for x in triples]
        return result

    async def _node_relation_extract(self, state: PipelineState) -> PipelineState:
        run_id = state["run_id"]
        await self._emit(run_id, "node_started", {"node": "relation_extract", "chunk_id": state.get("chunk_id")})
        if self._settings.model_combined_extraction and state.get("candidate_triples"):
            await self._emit(
                run_id,
                "node_finished",
                {
                    "node": "relation_extract",
                    "triple_count": len(state.get("candidate_triples", [])),
                    "model_call_skipped": True,
                },
            )
            return {}
        entities = [Entity(**x) for x in state.get("candidate_entities", [])]
        schema = state.get("ontology_schema", DEFAULT_ONTOLOGY)
        text = self._extraction_text(state)
        relation_cache_schema = dict(schema)
        relation_cache_schema["_entities"] = state.get("candidate_entities", [])
        cache_key = self._cache_key("relation_extract", text, relation_cache_schema)
        cached = await self._get_cached_extraction(cache_key)
        if cached:
            triples = [Triple(**x) for x in cached.get("candidate_triples", [])]
            await self._emit(
                run_id,
                "node_finished",
                {
                    "node": "relation_extract",
                    "triple_count": len(triples),
                    "cache_hit": True,
                },
            )
            return {"candidate_triples": [x.model_dump() for x in triples]}

        is_multi = state.get("strategy") == "multi"
        if is_multi and entities:
            allowed_relations = _schema_values(schema, "relations", DEFAULT_ONTOLOGY["relations"])
            groups = _build_relation_groups(allowed_relations)

            async def run_round(group: dict[str, Any]) -> list[Triple]:
                return await asyncio.to_thread(
                    self._relation.run,
                    text=text,
                    entities=entities,
                    ontology_schema=schema,
                    retrieved_context=state.get("vector_hits", []),
                    focus_relations=group["relations"],
                    focus_label=group["label"],
                )

            round_results: list[list[Triple]] = await asyncio.gather(*[run_round(g) for g in groups])
            all_triples: list[Triple] = []
            for triples in round_results:
                all_triples.extend(triples)
            fused = _dedupe_triples(all_triples)
            await self._put_cached_extraction(cache_key, entities, fused)
            await self._emit(
                run_id,
                "node_finished",
                {
                    "node": "relation_extract",
                    "triple_count": len(fused),
                    "rounds": len(groups),
                    "cache_hit": False,
                },
            )
            return {"candidate_triples": [x.model_dump() for x in fused]}

        triples = await asyncio.to_thread(
            self._relation.run,
            text=text,
            entities=entities,
            ontology_schema=schema,
            retrieved_context=state.get("vector_hits", []),
        )
        await self._put_cached_extraction(cache_key, entities, triples)
        await self._emit(run_id, "node_finished", {"node": "relation_extract", "triple_count": len(triples), "cache_hit": False})
        return {"candidate_triples": [x.model_dump() for x in triples]}

    async def _node_fusion(self, state: PipelineState) -> PipelineState:
        run_id = state["run_id"]
        await self._emit(run_id, "node_started", {"node": "fusion", "chunk_id": state.get("chunk_id")})
        entities = [Entity(**x) for x in state.get("candidate_entities", [])]
        triples = [Triple(**x) for x in state.get("candidate_triples", [])]
        fused_entities, fused_triples, report = self._fusion.run(
            entities=entities,
            triples=triples,
            ontology_schema=state.get("ontology_schema", DEFAULT_ONTOLOGY),
            normalizer=self._memory.normalize_entity,
        )
        for entity in fused_entities:
            for alias in entity.aliases:
                self._memory.register_alias(alias, entity.name)
        await self._emit(run_id, "node_finished", {"node": "fusion", "validation_report": report})
        return {
            "candidate_entities": [x.model_dump() for x in fused_entities],
            "triples": [x.model_dump() for x in fused_triples],
            "validation_report": report,
        }

    async def _node_write_graph(self, state: PipelineState) -> PipelineState:
        run_id = state["run_id"]
        await self._emit(run_id, "node_started", {"node": "write_graph", "chunk_id": state.get("chunk_id")})
        write_result = self._graph_store.upsert_triples(
            triples=state.get("triples", []),
            source=f"{state.get('document_id', 'doc')}:{state.get('chapter_id', 'chapter')}:{state.get('chunk_id', 0)}",
            knowledge_base_id=state.get("knowledge_base_id", "default"),
        )
        await self._emit(run_id, "node_finished", {"node": "write_graph", "write_result": write_result})
        return {"graph_write_result": write_result}

    async def _node_evaluate(self, state: PipelineState) -> PipelineState:
        run_id = state["run_id"]
        await self._emit(run_id, "node_started", {"node": "evaluate", "chunk_id": state.get("chunk_id")})
        metrics = evaluate_state(state)
        await self._emit(run_id, "node_finished", {"node": "evaluate", "metrics": metrics})
        return {"evaluation_metrics": metrics}
