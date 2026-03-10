import asyncio
from collections import defaultdict

from anyio import from_thread
from fastapi import WebSocket


class WorkspaceTaskStreamHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, workspace_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[workspace_id].add(websocket)

    async def disconnect(self, workspace_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            connections = self._connections.get(workspace_id)
            if connections is None:
                return
            connections.discard(websocket)
            if not connections:
                self._connections.pop(workspace_id, None)

    async def broadcast(self, workspace_id: str, payload: dict) -> None:
        async with self._lock:
            connections = list(self._connections.get(workspace_id, set()))

        stale_connections: list[WebSocket] = []
        for connection in connections:
            try:
                await connection.send_json(payload)
            except Exception:
                stale_connections.append(connection)

        for connection in stale_connections:
            await self.disconnect(workspace_id, connection)


task_stream_hub = WorkspaceTaskStreamHub()


def broadcast_task_changeset_from_thread(workspace_id: str, payload: dict) -> None:
    from_thread.run(task_stream_hub.broadcast, workspace_id, payload)
