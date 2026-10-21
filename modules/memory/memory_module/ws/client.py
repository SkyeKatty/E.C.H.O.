import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import websockets
from websockets.asyncio.client import ClientConnection

logger = logging.getLogger("memory.ws")

Handler = Callable[[dict, Any], Awaitable[Any] | Any]


class MemoryModuleClient:
    def __init__(
        self,
        controller_url: str,
        module_id: str,
        auth_token: str | None,
        registration: dict,
        handlers: dict[str, Handler],
    ) -> None:
        self.controller_url = controller_url
        self.module_id = module_id
        self.auth_token = auth_token
        self.registration = registration
        self.handlers = handlers
        self._ws: ClientConnection | None = None
        self._active: dict[str, asyncio.Event] = {}
        self._heartbeat_task: asyncio.Task | None = None

    async def run(self) -> None:
        while True:
            try:
                async with websockets.connect(
                    self.controller_url,
                    max_size=512 * 1024,
                    open_timeout=30,
                ) as ws:
                    self._ws = ws
                    await self._register(ws)
                    async for raw in ws:
                        await self._on_message(ws, json.loads(raw))
            except Exception as exc:
                logger.warning("Connection lost: %s", exc)
                await asyncio.sleep(min(30, 2))

    async def _register(self, ws: ClientConnection) -> None:
        payload = {**self.registration}
        if self.auth_token:
            payload["authToken"] = self.auth_token
        await ws.send(
            json.dumps(
                {
                    "protocolVersion": "1",
                    "type": "module.register",
                    "messageId": str(uuid.uuid4()),
                    "source": self.module_id,
                    "timestamp": _iso(),
                    "payload": payload,
                }
            )
        )

    async def _on_message(self, ws: ClientConnection, envelope: dict) -> None:
        etype = envelope.get("type")
        if etype == "module.registered":
            payload = envelope.get("payload") or {}
            if payload.get("accepted"):
                logger.info("Registered with controller")
                if self._heartbeat_task:
                    self._heartbeat_task.cancel()
                interval_ms = payload.get("heartbeatIntervalMs") or 15_000
                self._heartbeat_task = asyncio.create_task(self._heartbeat_loop(ws, interval_ms / 1000))
            else:
                logger.error("Registration rejected: %s", payload.get("reason"))
            return
        if etype == "request":
            await self._handle_request(ws, envelope)
        elif etype == "cancel":
            corr = envelope.get("correlationId")
            if corr and corr in self._active:
                self._active[corr].set()

    async def _handle_request(self, ws: ClientConnection, envelope: dict) -> None:
        payload = envelope.get("payload") or {}
        capability_id = payload.get("capabilityId")
        params = payload.get("params")
        handler = self.handlers.get(capability_id)
        cancel = asyncio.Event()
        self._active[envelope["messageId"]] = cancel
        try:
            if not handler:
                raise ValueError(f"No handler for {capability_id}")
            if asyncio.iscoroutinefunction(handler):
                result = await handler(envelope, params, cancel)
            else:
                result = handler(envelope, params, cancel)
            await self._respond(ws, envelope, capability_id, result=result)
        except Exception as exc:
            await self._respond(
                ws,
                envelope,
                capability_id or "unknown",
                error={"code": "HANDLER_ERROR", "message": str(exc)},
            )
        finally:
            self._active.pop(envelope["messageId"], None)

    async def _heartbeat_loop(self, ws: ClientConnection, interval_sec: float) -> None:
        sequence = 0
        while True:
            await asyncio.sleep(interval_sec)
            sequence += 1
            await ws.send(
                json.dumps(
                    {
                        "protocolVersion": "1",
                        "type": "module.heartbeat",
                        "messageId": str(uuid.uuid4()),
                        "source": self.module_id,
                        "timestamp": _iso(),
                        "payload": {"moduleId": self.module_id, "sequence": sequence},
                    }
                )
            )

    async def _respond(
        self,
        ws: ClientConnection,
        request: dict,
        capability_id: str,
        result: Any = None,
        error: dict | None = None,
    ) -> None:
        body: dict = {"capabilityId": capability_id}
        if error:
            body["error"] = error
        else:
            body["result"] = result
        await ws.send(
            json.dumps(
                {
                    "protocolVersion": "1",
                    "type": "response",
                    "messageId": str(uuid.uuid4()),
                    "correlationId": request["messageId"],
                    "source": self.module_id,
                    "destination": request.get("source"),
                    "timestamp": _iso(),
                    "payload": body,
                    **({"error": error} if error else {}),
                }
            )
        )


def _iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
