"""Diagnose pipeline failure: step-by-step test."""
import sys, json, asyncio, traceback
sys.path.insert(0, ".")
from app.config import settings
from app.model_adapter import OpenAICompatibleAdapter
from app.memory import MemoryManager
from app.events import EventBus
from app.graph_store import GraphStore
from app.pipeline import KGPipeline
from app.embedding_adapter import EmbeddingAdapter
from app.agents_fixed import CombinedExtractionAgent, DEFAULT_ONTOLOGY
from pathlib import Path

data_dir = Path(settings.data_dir or "data")
adapter = OpenAICompatibleAdapter(settings)
emb_adapter = EmbeddingAdapter(settings)
memory = MemoryManager(dim=settings.vector_dim)
graph_store = GraphStore(
    uri=settings.neo4j_uri, user=settings.neo4j_user,
    password=settings.neo4j_password, local_path=data_dir / "graph_store.json",
)
event_bus = EventBus()

pipeline = KGPipeline(
    settings=settings, event_bus=event_bus, memory=memory,
    graph_store=graph_store, model_adapter=adapter,
    embedding_adapter=emb_adapter,
)

# Test 1: read test document text
doc_id = "5b588615-c103-4ff3-9c00-adb71b7fb08c"
kb_id = "3d2de97b-e458-406d-89a9-781b8d44b449"
doc_dir = data_dir / "documents" / kb_id
txt_path = doc_dir / f"{doc_id}.txt"
print(f"Text file: {txt_path}  exists={txt_path.exists()}")
if txt_path.exists():
    text = txt_path.read_text(encoding="utf-8")
    print(f"Text length: {len(text)} chars")

    # Test 2: direct extraction (bypass pipeline)
    agent = CombinedExtractionAgent(adapter)
    entities, triples = agent.run(text=text[:900], ontology_schema=DEFAULT_ONTOLOGY, retrieved_context=[])
    print(f"Direct extraction: {len(entities)} entities, {len(triples)} triples")
    for t in triples[:3]:
        print(f"  {t.head} -> {t.relation} -> {t.tail}")

# Test 3: run pipeline step by step
print("\n--- Pipeline test ---")
graph = pipeline._build_graph("single")
state = {
    "run_id": "diag-test",
    "strategy": "single",
    "knowledge_base_id": kb_id,
    "document_id": doc_id,
    "chapter_id": "test",
    "raw_text": text[:2000] if txt_path.exists() else "test",
    "chunk_id": 0,
}
try:
    result = graph.invoke(state)
    print(f"Status: triples={len(result.get('triples',[]))} entities={len(result.get('candidate_entities',[]))}")
except Exception as exc:
    traceback.print_exc()
