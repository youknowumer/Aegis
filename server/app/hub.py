"""Tracks live websocket connections and routes requests between the AI and the user's devices."""
import asyncio
import uuid
from typing import Dict, Set

from fastapi import WebSocket

from . import settings


class Hub:
    def __init__(self):
        self.devices: Dict[int, WebSocket] = {}
        # v17: the browser extension ("Aegis Web Hands") is a second kind of device. It can only do the chrome_* tools,
        # but it drives the user's real browser on any computer, with no desktop app needed.
        self.browsers: Dict[int, WebSocket] = {}
        self.chats: Dict[int, Set[WebSocket]] = {}
        # request id -> (user_id, kind, future); kind is "device" or "confirm"
        self.pending: Dict[str, tuple] = {}

    # ---- presence ----
    def device_connected(self, uid: int) -> bool:
        return uid in self.devices

    def browser_connected(self, uid: int) -> bool:
        return uid in self.browsers

    def can_chrome(self, uid: int) -> bool:
        """True when some real browser (desktop app's Chrome or the extension) can run chrome_* tools."""
        return uid in self.devices or uid in self.browsers

    async def broadcast_status(self, uid: int):
        msg = {"type": "status", "device": self.device_connected(uid), "browser": self.browser_connected(uid)}
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

    async def set_browser(self, uid: int, ws: WebSocket):
        old = self.browsers.get(uid)
        self.browsers[uid] = ws
        if old is not None and old is not ws:
            try:
                await old.close(code=4000)
            except Exception:
                pass
        await self.broadcast_status(uid)

    async def drop_browser(self, uid: int, ws: WebSocket):
        if self.browsers.get(uid) is ws:
            del self.browsers[uid]
            for rid, (u, kind, fut) in list(self.pending.items()):
                if u == uid and kind == "browser" and not fut.done():
                    fut.set_result("Error: the browser extension disconnected before finishing.")
            await self.broadcast_status(uid)

    def add_chat(self, uid: int, ws: WebSocket):
        self.chats.setdefault(uid, set()).add(ws)

    def drop_chat(self, uid: int, ws: WebSocket):
        socks = self.chats.get(uid)
        if socks is not None:
            socks.discard(ws)
            if not socks:
                del self.chats[uid]  # no empty sets piling up for every user who ever connected

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
        # chrome_* tools go to the desktop app's Chrome when it is linked, otherwise to the browser extension
        if name.startswith("chrome_") and uid not in self.devices and uid in self.browsers:
            return await self._call(uid, self.browsers[uid], "browser", name, args,
                                    "Error: the browser extension did not respond in time.", "Error: could not reach the browser extension.")
        ws = self.devices.get(uid)
        if ws is None:
            return "Error: no desktop app is connected. Ask the user to open the Aegis desktop app."
        return await self._call(uid, ws, "device", name, args,
                                "Error: the desktop app did not respond in time.", "Error: could not reach the desktop app.")

    async def _call(self, uid: int, ws: WebSocket, kind: str, name: str, args: dict, timeout_msg: str, fail_msg: str) -> str:
        rid = uuid.uuid4().hex
        waiter = asyncio.ensure_future(self._wait(uid, rid, settings.DEVICE_CALL_TIMEOUT, kind))
        await asyncio.sleep(0)  # let the waiter register its future before we send
        try:
            await ws.send_json({"type": "tool_request", "id": rid, "name": name, "args": args})
            return str(await waiter)
        except asyncio.TimeoutError:
            return timeout_msg
        except Exception:
            waiter.cancel()
            return fail_msg

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
