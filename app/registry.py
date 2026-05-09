from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


class RunRegistry:
    def __init__(self) -> None:
        self._runs: dict[str, dict[str, Any]] = {}

    def create(self, strategy: str, knowledge_base_id: str, document_id: str | None = None) -> str:
        run_id = str(uuid4())
        self._runs[run_id] = {
            "run_id": run_id,
            "strategy": strategy,
            "knowledge_base_id": knowledge_base_id,
            "document_id": document_id,
            "status": "running",
            "started_at": datetime.now(timezone.utc),
            "finished_at": None,
            "summary": {},
            "last_state": {},
            "error": None,
        }
        return run_id

    def update_state(self, run_id: str, state: dict[str, Any]) -> None:
        if run_id in self._runs:
            self._runs[run_id]["last_state"] = state

    def complete(self, run_id: str, summary: dict[str, Any]) -> None:
        if run_id in self._runs:
            self._runs[run_id]["status"] = "completed"
            self._runs[run_id]["finished_at"] = datetime.now(timezone.utc)
            self._runs[run_id]["summary"] = summary

    def fail(self, run_id: str, message: str) -> None:
        if run_id in self._runs:
            self._runs[run_id]["status"] = "failed"
            self._runs[run_id]["finished_at"] = datetime.now(timezone.utc)
            self._runs[run_id]["error"] = message

    def get(self, run_id: str) -> dict[str, Any] | None:
        return self._runs.get(run_id)

    def list(self, knowledge_base_id: str | None = None) -> list[dict[str, Any]]:
        rows = list(self._runs.values())
        if knowledge_base_id:
            rows = [x for x in rows if x.get("knowledge_base_id") == knowledge_base_id]
        return sorted(rows, key=lambda x: x["started_at"], reverse=True)
