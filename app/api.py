from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from .config import settings
from .data_utils import split_text
from .embedding_adapter import EmbeddingAdapter
from .evaluation import evaluate_against_ground_truth, evaluate_state, evaluate_triples_with_model
from .events import EventBus
from .graph_linker import link_entities
from .graph_store import GraphStore
from .kb_store import KnowledgeBaseStore
from .memory import MemoryManager
from .model_adapter import OpenAICompatibleAdapter
from .pipeline import KGPipeline
from .registry import RunRegistry
from .schemas import (
    ChatRequest,
    ChatResponse,
    CreateKBRequest,
    ExperimentItem,
    ExperimentRequest,
    ExperimentResponse,
    KBRunStartRequest,
    KBRunStartResponse,
    RunRequest,
    StartRunResponse,
)


class Services:
    def __init__(self) -> None:
        project_dir = Path(__file__).resolve().parent.parent
        data_dir = project_dir / settings.data_dir

        self.registry = RunRegistry()
        self.events = EventBus(history_limit=settings.event_history_limit)
        self.memory = MemoryManager(dim=settings.vector_dim)
        self.graph_store = GraphStore(
            uri=settings.neo4j_uri,
            user=settings.neo4j_user,
            password=settings.neo4j_password,
            local_path=data_dir / "graph_store.json",
        )
        self.kb_store = KnowledgeBaseStore(
            base_dir=data_dir,
            pdf_ocr_enabled=settings.pdf_ocr_enabled,
            pdf_ocr_language=settings.pdf_ocr_language,
            pdf_ocr_dpi=settings.pdf_ocr_dpi,
            pdf_ocr_max_pages=settings.pdf_ocr_max_pages,
            pdf_ocr_timeout_seconds=settings.pdf_ocr_timeout_seconds,
            pdf_ocr_concurrency=settings.pdf_ocr_concurrency,
            pdf_ocr_min_chars_per_page=settings.pdf_ocr_min_chars_per_page,
            tesseract_cmd=settings.tesseract_cmd,
        )
        self.model_adapter = OpenAICompatibleAdapter(settings)
        self.embedding_adapter = EmbeddingAdapter(settings)
        # A local llama.cpp/OpenPangu process is effectively a single GPU worker.
        # Serializing pipeline runs prevents batch actions from flooding the model.
        self.pipeline_semaphore = asyncio.Semaphore(1)
        self.pipeline = KGPipeline(
            settings=settings,
            event_bus=self.events,
            memory=self.memory,
            graph_store=self.graph_store,
            model_adapter=self.model_adapter,
            embedding_adapter=self.embedding_adapter,
        )


services = Services()
app = FastAPI(title="Multi-agent KG Orchestrator", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_kb_exists(kb_id: str) -> dict[str, Any]:
    kb = services.kb_store.get_kb(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="knowledge_base_not_found")
    return kb


async def _run_pipeline_task(
    run_id: str,
    knowledge_base_id: str,
    strategy: str,
    text: str,
    document_id: str,
    chapter_id: str,
    chunks: list[str] | None = None,
) -> None:
    try:
        if services.pipeline_semaphore.locked():
            await services.events.publish(
                run_id,
                "run_queued",
                {"reason": "local_model_busy", "message": "等待本地 OpenPangu 模型空闲"},
            )
        async with services.pipeline_semaphore:
            summary = await services.pipeline.run(
                run_id=run_id,
                strategy=strategy,
                text=text,
                document_id=document_id,
                chapter_id=chapter_id,
                knowledge_base_id=knowledge_base_id,
                chunks=chunks,
            )
            all_triples = summary.get("triples", [])

            # Semantic linking — works on in-memory triples, does not write to graph yet
            await services.events.publish(run_id, "node_started", {"node": "link"})
            link_result = await asyncio.to_thread(
                link_entities,
                graph_store=services.graph_store,
                knowledge_base_id=knowledge_base_id,
                adapter=services.model_adapter,
                triples=all_triples,
                write_to_graph=False,
            )
            linked_edges = link_result.get("edges", [])
            await services.events.publish(
                run_id,
                "node_finished",
                {
                    "node": "link",
                    "cooccurrence": link_result.get("cooccurrence", 0),
                    "embedding": link_result.get("embedding", 0),
                    "written": link_result.get("written", 0),
                },
            )
            summary["link_result"] = link_result

            # Model-based quality evaluation on all triples (original + linked)
            await services.events.publish(run_id, "node_started", {"node": "evaluate"})
            all_combined = all_triples + linked_edges
            quality_eval = evaluate_triples_with_model(services.model_adapter, all_combined)
            await services.events.publish(
                run_id,
                "node_finished",
                {
                    "node": "evaluate",
                    "rated": quality_eval.get("rated", 0),
                    "passed": quality_eval.get("passed", 0),
                    "score": quality_eval.get("score", 0.0),
                    "note": quality_eval.get("note", ""),
                },
            )
            summary["quality_eval"] = quality_eval

            # Write everything to graph as the final step
            await services.events.publish(run_id, "node_started", {"node": "write_graph"})
            source = f"{document_id}:{chapter_id}:all"
            write_result = services.graph_store.upsert_triples(
                triples=all_combined,
                source=source,
                knowledge_base_id=knowledge_base_id,
            )
            summary["graph_write_result"] = write_result
            await services.events.publish(
                run_id,
                "node_finished",
                {"node": "write_graph", "write_result": write_result},
            )

            await services.events.publish(run_id, "run_finished", {"summary_metrics": summary.get("evaluation_metrics", {})})

        services.registry.update_state(run_id, summary)
        services.registry.complete(run_id, summary.get("evaluation_metrics", {}))
    except Exception as exc:
        services.registry.fail(run_id, str(exc))
        await services.events.publish(run_id, "run_failed", {"error": str(exc)})


async def _parse_document_task(kb_id: str, document_id: str) -> None:
    try:
        await asyncio.to_thread(
            services.kb_store.parse_document,
            kb_id=kb_id,
            document_id=document_id,
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )
    except Exception as exc:
        await asyncio.to_thread(
            services.kb_store.mark_document_failed,
            kb_id,
            document_id,
            f"{type(exc).__name__}: {exc}",
        )


def _resolve_run_input(kb_id: str, req: KBRunStartRequest) -> tuple[str, str, list[str] | None]:
    if req.document_id:
        doc = services.kb_store.get_document(kb_id=kb_id, document_id=req.document_id)
        if not doc:
            raise HTTPException(status_code=404, detail="document_not_found")
        if doc["status"] in {"uploaded", "parsing"}:
            raise HTTPException(status_code=409, detail="document_still_parsing")
        if doc["status"] not in {"parsed", "parsed_low_quality"}:
            doc = services.kb_store.parse_document(
                kb_id=kb_id,
                document_id=req.document_id,
                chunk_size=settings.chunk_size,
                chunk_overlap=settings.chunk_overlap,
            )
        if doc["status"] not in {"parsed", "parsed_low_quality"}:
            raise HTTPException(status_code=400, detail=f"document_parse_failed: {doc.get('error')}")
        text = services.kb_store.get_document_text(kb_id=kb_id, document_id=req.document_id)
        if not text:
            raise HTTPException(status_code=400, detail="empty_document_text")
        chunks = split_text(text, chunk_size=settings.chunk_size, overlap=settings.chunk_overlap)
        return text, req.document_id, chunks or None

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text_or_document_required")
    return text, "manual-input", None


@app.get("/api/health")
def health() -> dict[str, Any]:
    kb_count = len(services.kb_store.list_kbs())
    doc_count = sum(len(services.kb_store.list_documents(kb["id"])) for kb in services.kb_store.list_kbs())
    return {
        "ok": True,
        "model_adapter_enabled": services.model_adapter.enabled,
        "model_adapter_diagnostics": services.model_adapter.diagnostics(),
        "neo4j_enabled": bool(settings.neo4j_uri),
        "knowledge_base_count": kb_count,
        "document_count": doc_count,
    }


@app.post("/api/kbs")
def create_kb(req: CreateKBRequest) -> dict[str, Any]:
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="kb_name_required")
    return services.kb_store.create_kb(name=req.name, description=req.description)


@app.get("/api/kbs")
def list_kbs() -> list[dict[str, Any]]:
    return services.kb_store.list_kbs()


@app.delete("/api/kbs/{kb_id}")
def delete_kb(kb_id: str) -> dict[str, Any]:
    _ensure_kb_exists(kb_id)
    try:
        result = services.kb_store.delete_kb(kb_id)
    except ValueError as exc:
        detail = str(exc)
        status_code = 400 if detail == "default_kb_cannot_be_deleted" else 404
        raise HTTPException(status_code=status_code, detail=detail) from exc
    graph_result = services.graph_store.delete_knowledge_base(kb_id)
    result["graph"] = graph_result
    return result


@app.post("/api/kbs/{kb_id}/documents/upload")
async def upload_document(kb_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    _ensure_kb_exists(kb_id)
    payload = await file.read()
    doc = services.kb_store.create_document(kb_id=kb_id, filename=file.filename or "unknown.txt", file_bytes=payload)
    queued = services.kb_store.mark_document_parsing(kb_id=kb_id, document_id=doc["id"])
    asyncio.create_task(_parse_document_task(kb_id=kb_id, document_id=doc["id"]))
    return queued


@app.get("/api/kbs/{kb_id}/documents")
def list_documents(kb_id: str) -> list[dict[str, Any]]:
    _ensure_kb_exists(kb_id)
    return services.kb_store.list_documents(kb_id=kb_id)


@app.delete("/api/kbs/{kb_id}/documents/{document_id}")
def delete_document(kb_id: str, document_id: str) -> dict[str, Any]:
    _ensure_kb_exists(kb_id)
    try:
        result = services.kb_store.delete_document(kb_id=kb_id, document_id=document_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    result["graph"] = services.graph_store.delete_document(knowledge_base_id=kb_id, document_id=document_id)
    return result


@app.post("/api/kbs/{kb_id}/runs/start", response_model=KBRunStartResponse)
async def start_kb_run(kb_id: str, req: KBRunStartRequest) -> KBRunStartResponse:
    _ensure_kb_exists(kb_id)
    text, document_id, chunks = _resolve_run_input(kb_id, req)
    run_id = services.registry.create(strategy=req.strategy, knowledge_base_id=kb_id, document_id=document_id)
    asyncio.create_task(
        _run_pipeline_task(
            run_id=run_id,
            knowledge_base_id=kb_id,
            strategy=req.strategy,
            text=text,
            document_id=document_id,
            chapter_id=req.chapter_id,
            chunks=chunks,
        )
    )
    return KBRunStartResponse(run_id=run_id, status="running", knowledge_base_id=kb_id)


@app.get("/api/kbs/{kb_id}/runs")
def list_kb_runs(kb_id: str) -> list[dict[str, Any]]:
    _ensure_kb_exists(kb_id)
    return services.registry.list(knowledge_base_id=kb_id)


@app.get("/api/kbs/{kb_id}/runs/{run_id}")
def get_kb_run(kb_id: str, run_id: str) -> dict[str, Any]:
    _ensure_kb_exists(kb_id)
    run = services.registry.get(run_id)
    if not run or run.get("knowledge_base_id") != kb_id:
        raise HTTPException(status_code=404, detail="run_not_found")
    return run


@app.get("/api/kbs/{kb_id}/runs/{run_id}/events")
async def stream_kb_events(kb_id: str, run_id: str, from_seq: int = Query(default=0, ge=0)):
    _ensure_kb_exists(kb_id)
    run = services.registry.get(run_id)
    if not run or run.get("knowledge_base_id") != kb_id:
        raise HTTPException(status_code=404, detail="run_not_found")

    async def event_gen():
        async for event in services.events.stream(run_id=run_id, from_seq=from_seq):
            yield {
                "id": str(event["seq"]),
                "data": json.dumps(event, ensure_ascii=False),
            }

    return EventSourceResponse(event_gen(), ping=15)


@app.get("/api/kbs/{kb_id}/graph/query")
def query_kb_graph(kb_id: str, entity: str = "", limit: int = 20) -> dict[str, Any]:
    _ensure_kb_exists(kb_id)
    return {"rows": services.graph_store.query_entity(knowledge_base_id=kb_id, name=entity, limit=limit)}


@app.get("/api/kbs/{kb_id}/graph/neo4j/status")
def neo4j_graph_status(kb_id: str) -> dict[str, Any]:
    _ensure_kb_exists(kb_id)
    return services.graph_store.neo4j_status(knowledge_base_id=kb_id)


@app.post("/api/kbs/{kb_id}/graph/neo4j/sync")
def sync_kb_graph_to_neo4j(kb_id: str) -> dict[str, Any]:
    _ensure_kb_exists(kb_id)
    result = services.graph_store.sync_local_to_neo4j(knowledge_base_id=kb_id)
    if result.get("error"):
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@app.post("/api/kbs/{kb_id}/experiments/run", response_model=ExperimentResponse)
async def run_kb_experiments(kb_id: str, req: ExperimentRequest) -> ExperimentResponse:
    _ensure_kb_exists(kb_id)
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text_required")

    items: list[ExperimentItem] = []
    for strategy in ["single", "ontology", "multi"]:
        run_id = services.registry.create(strategy=strategy, knowledge_base_id=kb_id, document_id="manual-input")
        try:
            state = await services.pipeline.run(
                run_id=run_id,
                strategy=strategy,
                text=text,
                document_id="manual-input",
                chapter_id=req.chapter_id,
                knowledge_base_id=kb_id,
            )
            services.registry.update_state(run_id, state)
            services.registry.complete(run_id, state.get("evaluation_metrics", {}))
            await services.events.publish(run_id, "run_finished", {"summary_metrics": state.get("evaluation_metrics", {})})
            items.append(ExperimentItem(strategy=strategy, run_id=run_id, metrics=state.get("evaluation_metrics", {})))
        except Exception as exc:
            services.registry.fail(run_id, str(exc))
            await services.events.publish(run_id, "run_failed", {"error": str(exc)})
            items.append(ExperimentItem(strategy=strategy, run_id=run_id, metrics={"error": str(exc)}))
    return ExperimentResponse(items=items)


def _extract_keywords(text: str) -> list[str]:
    """Chinese/English keyword extraction with synonym expansion for KG search."""
    import re

    import jieba

    stopwords = {
        "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
        "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
        "自己", "这", "他", "她", "它", "们", "那", "什么", "怎么", "如何", "哪些",
        "哪个", "为什么", "可以", "能够", "应该", "需要", "因为", "所以", "但是",
        "如果", "虽然", "而且", "或者", "还是", "关于", "对于", "根据", "通过",
        "什么", "怎样", "多少", "几个", "请问", "一下", "吗", "呢", "吧", "啊",
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "can", "shall", "you", "me", "i", "we", "they",
        "he", "she", "it", "and", "or", "but", "if", "of", "in", "on", "at", "to",
        "for", "with", "from", "by", "about", "as", "into", "through", "during",
        "what", "which", "who", "whom", "how", "where", "when", "why",
    }
    words = list(jieba.cut(text.lower()))
    result = []
    for w in words:
        w = w.strip()
        if len(w) < 2:
            continue
        if w in stopwords:
            continue
        if re.match(r"^[\u4e00-\u9fa5a-zA-Z0-9]+$", w):
            result.append(w)
    return result[:15]


def _clean_answer(raw: str) -> str:
    """Strip chain-of-thought fluff from base-model output."""
    import re

    text = raw.strip()

    # Filter out lines that are clearly chain-of-thought
    _cot_patterns = [
        r"^(好的|嗯[，,]|首先[，,]|让我|我需要|用户问|根据|我来|我们|现在|接下来[，,]|那么[，,]|所以[，,])",
        r"^[我我们].{0,10}(?:需要|应该|可以|要).{0,10}(?:查看|分析|整理|找出|阅读|仔细|注意|考虑|找到|确定|归纳)",
        r"^(?:文档|文本|材料|数据).{0,8}(?:中|里).{0,6}(?:提到|说到|指出|显示|表明|包含|有)",
        r"^(?:首先|然后|接着|此外|另外|最后)[，,].{0,15}(?:需要|应该|可以|要|是|有)",
        r"^(?:接下来|下面).{0,5}(?:需要|应该|可以|要|我)",
    ]
    lines = text.split("\n")
    cleaned = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        # First line: filter CoT regardless of length; subsequent: only if short
        max_len = 9999 if i == 0 else 100
        if any(re.search(p, stripped) for p in _cot_patterns) and len(stripped) < max_len:
            continue
        cleaned.append(stripped)

    if not cleaned:
        return ""

    result = "".join(cleaned)
    result = re.sub(r"([。！？，、；：])\1+", r"\1", result)
    result = re.sub(r"^[：:，,、。；;！!\s]+", "", result)
    result = re.sub(r"(.{6,40}?)\1{4,}", r"\1", result)  # remove repetition loops
    return result


@app.post("/api/kbs/{kb_id}/chat", response_model=ChatResponse)
def chat(kb_id: str, req: ChatRequest) -> ChatResponse:
    _ensure_kb_exists(kb_id)

    keywords = _extract_keywords(req.question)
    if services.embedding_adapter.enabled:
        sources = services.graph_store.search_hybrid(
            knowledge_base_id=kb_id, query_text=req.question, keywords=keywords,
            adapter=services.embedding_adapter, top_k=20,
        )
        for s in sources:
            s.pop("_semantic_score", None)
            s.pop("_keyword_match", None)
    else:
        sources = services.graph_store.search_triples(
            knowledge_base_id=kb_id, keywords=keywords, limit=20
        )

    # Convert triples to natural Chinese sentences
    _rel_map = {
        "组成部分": "由{tail}组成",
        "包含": "包含{tail}",
        "包括": "包括{tail}",
        "属于": "属于{tail}",
        "用于": "用于{tail}",
        "使用": "使用{tail}",
        "采用": "采用{tail}",
        "应用": "应用于{tail}",
        "作用": "作用于{tail}",
        "影响": "影响{tail}",
        "导致": "导致{tail}",
        "需要": "需要{tail}",
        "描述": "描述为{tail}",
        "具有": "具有{tail}",
        "分为": "分为{tail}",
        "位于": "位于{tail}",
        "describes": "描述为{tail}",
        "uses": "用于{tail}",
        "includes": "包含{tail}",
        "belongs_to": "属于{tail}",
        "co_occurrence": "与{tail}共现相关",
        "semantic_related": "与{tail}语义相关",
        "related_to": "与{tail}相关",
    }
    facts = []
    for s in sources:
        h, r, t = s["head"], s["relation"], s["tail"]
        template = _rel_map.get(r)
        if template:
            facts.append(f"{h}{template.format(tail=t)}。")
        else:
            facts.append(f"{h}的{r}是{t}。")
    facts_text = "".join(facts)

    if not services.model_adapter.enabled:
        if sources:
            return ChatResponse(
                answer=f"（模型未连接，以下为知识图谱中的相关信息）\n\n{facts_text}",
                sources=sources,
            )
        return ChatResponse(answer="你好！当前知识图谱中暂无相关数据。", sources=[])

    # Build prompt: if we have triples, ground in facts; otherwise casual chat
    if sources:
        prompt = f"{facts_text}\n\n{req.question}："
    else:
        prompt = f"朋友说：{req.question}\n我回答说："

    try:
        raw = services.model_adapter.chat_text_completion(
            system_prompt="",
            user_prompt="",
            max_tokens=800,
            raw_prompt=prompt,
        )
        answer = raw.strip()
        # Clean obvious CoT: if answer starts with reasoning, try to find real content after it
        cleaned = _clean_answer(answer)
        if cleaned and len(cleaned) > 30:
            answer = cleaned
    except Exception:
        if sources:
            return ChatResponse(
                answer=f"模型调用失败，以下为知识图谱中的相关信息：\n\n{facts_text}",
                sources=sources,
            )
        return ChatResponse(answer="抱歉，暂时无法回答这个问题。", sources=[])

    return ChatResponse(answer=answer, sources=sources)


@app.post("/api/kbs/{kb_id}/evaluation/run")
async def run_evaluation(kb_id: str) -> dict:
    _ensure_kb_exists(kb_id)

    gt_path = Path(__file__).resolve().parent.parent / "data" / "ground_truth.json"
    if not gt_path.exists():
        raise HTTPException(status_code=404, detail="ground_truth_file_not_found")

    try:
        gt_items = json.loads(gt_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"failed_to_load_ground_truth: {exc}") from exc

    results: list[dict] = []
    for strategy in ["single", "ontology", "multi"]:
        overall_tp = 0
        overall_fp = 0
        overall_fn = 0
        per_item: list[dict] = []

        for item in gt_items:
            text = item.get("text", "")
            gt_triples = item.get("triples", [])
            if not text:
                continue

            run_id = services.registry.create(strategy=strategy, knowledge_base_id=kb_id, document_id="manual-input")
            try:
                state = await services.pipeline.run(
                    run_id=run_id,
                    strategy=strategy,
                    text=text,
                    document_id="manual-input",
                    chapter_id="chapter-1",
                    knowledge_base_id=kb_id,
                )
                services.registry.update_state(run_id, state)
                services.registry.complete(run_id, state.get("evaluation_metrics", {}))
                await services.events.publish(run_id, "run_finished", {"summary_metrics": state.get("evaluation_metrics", {})})
                predicted = state.get("triples", [])
                metrics = evaluate_against_ground_truth(predicted, gt_triples)
                overall_tp += metrics["tp"]
                overall_fp += metrics["fp"]
                overall_fn += metrics["fn"]
                per_item.append({
                    "item_id": item.get("id", ""),
                    "domain": item.get("domain", ""),
                    "metrics": {k: v for k, v in metrics.items() if k != "details"},
                })
            except Exception as exc:
                services.registry.fail(run_id, str(exc))
                await services.events.publish(run_id, "run_failed", {"error": str(exc)})

        total_pred = overall_tp + overall_fp
        total_gt = overall_tp + overall_fn
        precision = overall_tp / total_pred if total_pred > 0 else 0.0
        recall = overall_tp / total_gt if total_gt > 0 else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

        results.append({
            "strategy": strategy,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "tp": overall_tp,
            "fp": overall_fp,
            "fn": overall_fn,
            "items": per_item,
        })

    return {"kb_id": kb_id, "results": results}


@app.post("/api/kbs/{kb_id}/link")
def link_kb_entities(kb_id: str) -> dict[str, Any]:
    _ensure_kb_exists(kb_id)
    return link_entities(
        graph_store=services.graph_store,
        knowledge_base_id=kb_id,
        adapter=services.model_adapter,
    )


# Backward-compatible APIs mapped to default KB.
@app.post("/api/runs/start", response_model=StartRunResponse)
async def start_run(req: RunRequest) -> StartRunResponse:
    kb_id = req.knowledge_base_id or "default"
    _ensure_kb_exists(kb_id)
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text_required")
    run_id = services.registry.create(strategy=req.strategy, knowledge_base_id=kb_id, document_id="manual-input")
    asyncio.create_task(
        _run_pipeline_task(
            run_id=run_id,
            knowledge_base_id=kb_id,
            strategy=req.strategy,
            text=text,
            document_id="manual-input",
            chapter_id=req.chapter_id,
            chunks=None,
        )
    )
    return StartRunResponse(run_id=run_id, status="running")


@app.get("/api/runs")
def list_runs() -> list[dict[str, Any]]:
    return services.registry.list()


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    run = services.registry.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    return run


@app.get("/api/runs/{run_id}/events")
async def stream_events(run_id: str, from_seq: int = Query(default=0, ge=0)):
    async def event_gen():
        async for event in services.events.stream(run_id=run_id, from_seq=from_seq):
            yield {
                "id": str(event["seq"]),
                "data": json.dumps(event, ensure_ascii=False),
            }

    return EventSourceResponse(event_gen(), ping=15)


@app.get("/api/graph/query")
def query_graph(entity: str = "", limit: int = 20) -> dict[str, Any]:
    return {"rows": services.graph_store.query_entity(knowledge_base_id="default", name=entity, limit=limit)}


@app.post("/api/experiments/run", response_model=ExperimentResponse)
async def run_experiments(req: ExperimentRequest) -> ExperimentResponse:
    return await run_kb_experiments(kb_id=req.knowledge_base_id or "default", req=req)


frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/ui", StaticFiles(directory=str(frontend_dir), html=True), name="ui")


@app.get("/")
def root() -> RedirectResponse:
    return RedirectResponse(url="/ui/kb.html")
