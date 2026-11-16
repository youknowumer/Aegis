"""Tracks live websocket connections and routes requests between the AI and the user's devices."""
import asyncio
import uuid
from typing import Dict, Set

from fastapi import WebSocket

from . import settings


class Hub:
    def __init__(self):
        self.devices: Dict[int, WebSocket] = {}
        self.chats: Dict[int, Set[WebSocket]] = {}
        # request id -> (user_id, kind, future); kind is "device" or "confirm"
        self.pending: Dict[str, tuple] = {}

    # ---- presence ----
    def device_connected(self, uid: int) -> bool:
        return uid in self.devices

    async def broadcast_status(self, uid: int):
        msg = {"type": "status", "device": self.device_connected(uid)}
        for ws in list(self.chats.get(uid, ())):
            try:
                await ws.send_json(msg)
            except Exception:
                pass

    async def set_device(self, uid: int, ws: WebSocket):
        old = self.devices.get(uid)
        self.devices[uid] = ws
        if old is not None and old is not ws:
            try:
                await old.close(code=4000)
            except Exception:
                pass
        await self.broadcast_status(uid)

    async def drop_device(self, uid: int, ws: WebSocket):
        if self.devices.get(uid) is ws:
            del self.devices[uid]
            # Only device calls are failed here. Confirmations must never be auto-approved.
            for rid, (u, kind, fut) in list(self.pending.items()):
                if u == uid and kind == "device" and not fut.done():
                    fut.set_result("Error: the desktop app disconnected before finishing.")
            await self.broadcast_status(uid)

    def add_chat(self, uid: int, ws: WebSocket):
        self.chats.setdefault(uid, set()).add(ws)

    def drop_chat(self, uid: int, ws: WebSocket):
        self.chats.get(uid, set()).discard(ws)

    # ---- request/response plumbing ----
    def resolve(self, rid, value, uid: int):
        """Complete a pending request, but only if it belongs to this user."""
        entry = self.pending.get(rid)
        if not entry or entry[0] != uid:
            return
        self.pending.pop(rid, None)
        if not entry[2].done():
            entry[2].set_result(value)

    async def _wait(self, uid: int, rid: str, timeout: float, kind: str):
        fut = asyncio.get_running_loop().create_future()
        self.pending[rid] = (uid, kind, fut)
        try:
            return await asyncio.wait_for(fut, timeout)
        finally:
            self.pending.pop(rid, None)

    async def call_device(self, uid: int, name: str, args: dict) -> str:
        ws = self.devices.get(uid)
        if ws is None:
            return "Error: no desktop app is connected. Ask the user to open the Aegis desktop app."
        rid = uuid.uuid4().hex
        waiter = asyncio.ensure_future(self._wait(uid, rid, settings.DEVICE_CALL_TIMEOUT, "device"))
        await asyncio.sleep(0)  # let the waiter register its future before we send
        try:
            await ws.send_json({"type": "tool_request", "id": rid, "name": name, "args": args})
            return str(await waiter)
        except asyncio.TimeoutError:
            return "Error: the desktop app did not respond in time."
        except Exception:
            waiter.cancel()
            return "Error: could not reach the desktop app."

    async def ask_confirm(self, uid: int, ws: WebSocket, name: str, args: dict) -> bool:
        rid = uuid.uuid4().hex
        waiter = asyncio.ensure_future(self._wait(uid, rid, settings.CONFIRM_TIMEOUT, "confirm"))
        await asyncio.sleep(0)
        try:
            await ws.send_json({"type": "confirm", "id": rid, "tool": name, "args": args})
            return bool(await waiter)
        except Exception:
            waiter.cancel()
            return False
