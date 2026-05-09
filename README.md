# Multi-Agent KG Tool (LangGraph)

This project is a reusable multi-agent knowledge graph extraction tool with:

- `LangGraph` orchestration (`single`, `ontology`, `multi`)
- OpenAI-compatible model adapter (works with OpenPangu-compatible endpoints)
- Document ingestion and parsing (`txt`, `docx`, `pdf`)
- Layered memory (short-term state + vector retrieval + entity alias normalization)
- Graph persistence (Neo4j when configured, in-memory fallback otherwise)
- Event-stream visualization (SSE) and graph explorer UI

## UI Pages

- `/ui/kb.html`: Knowledge base and document management
- `/ui/hub.html`: Multi-agent runtime hub (node-graph + event timeline + run inspector)
- `/ui/kg.html`: Knowledge graph explorer (query + graph view + triple table)

## Quick Start

1. Install dependencies:

```powershell
python -m pip install langgraph langchain-openai neo4j fastapi uvicorn sse-starlette pydantic-settings python-dotenv faiss-cpu chromadb python-multipart python-docx pypdf pymupdf pillow
```

2. Configure environment:

```powershell
Copy-Item '.env.example' '.env'
```

Optional:
- Set `MODEL_BASE_URL` to your OpenAI-compatible model endpoint.
- Set `MODEL_API_KEY`, `MODEL_NAME` as needed.
- Set `MODEL_AUTOSTART=true` and `MODEL_START_SCRIPT` to start the local model before the backend opens.
- Set `NEO4J_URI` if you want Neo4j persistence.
- For scanned/image-only PDFs, install Tesseract OCR with Chinese language data and set `TESSERACT_CMD` if it is not on PATH.
- Use `PDF_OCR_MAX_PAGES` for OCR test runs and `RUN_CHUNK_LIMIT` to keep large multi-agent runs bounded.
- Use larger `CHUNK_SIZE` values plus `PDF_OCR_CONCURRENCY` and `EXTRACTION_CONCURRENCY` to reduce full-book processing time. Start with `1` or `2` for local models.

3. Run:

```powershell
python run_server.py
```

4. Open:

`http://127.0.0.1:8090/ui/kb.html`

## Core API

- `GET /api/health`
- `POST /api/kbs`
- `GET /api/kbs`
- `POST /api/kbs/{kb_id}/documents/upload`
- `GET /api/kbs/{kb_id}/documents`
- `POST /api/kbs/{kb_id}/runs/start`
- `GET /api/kbs/{kb_id}/runs`
- `GET /api/kbs/{kb_id}/runs/{run_id}`
- `GET /api/kbs/{kb_id}/runs/{run_id}/events` (SSE)
- `GET /api/kbs/{kb_id}/graph/query?entity=<name>&limit=20`
- `POST /api/kbs/{kb_id}/experiments/run`

Backward-compatible endpoints under `/api/runs/*`, `/api/graph/query`, `/api/experiments/run` are still available and mapped to `default` KB.
