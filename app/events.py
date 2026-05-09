from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, AsyncIterator


class EventBus:
    def __init__(self, history_limit: int = 3000) -> None:
        self._history_limit = history_limit
        self._history: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=self._history_limit))
        self._subscribers: dict[str, list[asyncio.Queue[dict[str, Any]]]] = defaultdict(list)
        self._seq: dict[str, int] = defaultdict(int)
        self._lock = asyncio.Lock()

    async def publish(self, run_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            self._seq[run_id] += 1
            event = {
                "run_id": run_id,
                "seq": self._seq[run_id],
                "event_type": event_type,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "payload": payload,
            }
            self._history[run_id].append(event)
            for queue in list(self._subscribers[run_id]):
                queue.put_nowait(event)
            return event

    async def snapshot(self, run_id: str) -> list[dict[str, Any]]:
        async with self._lock:
            return list(self._history.get(run_id, []))

    async def stream(self, run_id: str, from_seq: int = 0) -> AsyncIterator[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        async with self._lock:
            backlog = [x for x in self._history.get(run_id, []) if x["seq"] > from_seq]
            self._subscribers[run_id].append(queue)
        try:
            for event in backlog:
                yield event
            while True:
                event = await queue.get()
                yield event
        finally:
            async with self._lock:
                if queue in self._subscribers.get(run_id, []):
                    self._subscribers[run_id].remove(queue)

