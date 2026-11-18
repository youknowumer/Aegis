"""FastAPI app: REST (auth, memory), websocket (chat + desktop device), static web UI.

Run:  uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
"""
import asyncio
import contextlib
import logging
import os
import re
import sys
import time
from collections import defaultdict, deque

from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import providers, settings
from .agent import Agent, Session
from .auth import EMAIL_RE, hash_password, make_token, read_token, verify_password
from .db import DB
from .hub import Hub

log = logging.getLogger("aegis")


class TaskIn(BaseModel):
    text: str
    due: str = ""


class TaskPatch(BaseModel):
    done: bool = True


class NoteIn(BaseModel):
    title: str = ""
    body: str


class AIBody(BaseModel):
    provider: str
    api_key: str = ""
    model: str = ""
    base_url: str = ""
    max_tokens: int = 0
    temperature: float | None = None


class Credentials(BaseModel):
    email: str
    password: str


class LoginLimiter:
    """Tiny in-memory throttle: 10 attempts / 5 min per (ip, email). Use a real one behind multiple workers."""

    def __init__(self, max_attempts=10, window=300):
        self.max, self.window = max_attempts, window
        self.hits = defaultdict(deque)

    def check(self, key):
        now = time.time()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max:
            raise HTTPException(429, "Too many attempts. Try again in a few minutes.")
        q.append(now)


def create_app(client=None, db_path=None, allowed_origins=None) -> FastAPI:
    db = DB(db_path or settings.DB_PATH)
    hub = Hub()

    async def deliver_reminders(uid=None):
        """Push reminders that are due to the user's open chat windows. Left pending when nobody is connected,
        so they pop up the moment the user comes back."""
        for r in db.due_reminders():
            if uid is not None and r["user_id"] != uid:
                continue
            sent = False
            for sock in list(hub.chats.get(r["user_id"], ())):
                try:
                    await sock.send_json({"type": "reminder", "id": r["id"], "text": r["text"], "due": r["due"]})
                    sent = True
                except Exception:
                    pass
            if sent:
                db.mark_reminder_fired(r["id"])

    async def reminder_loop():
        while True:
            try:
                await deliver_reminders()
            except Exception:
                log.exception("reminder loop")
            await asyncio.sleep(5)

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        task = asyncio.create_task(reminder_loop())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title=settings.APP_NAME, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.db = db
    app.state.deliver_reminders = deliver_reminders
    limiter = LoginLimiter()
    state = {"client": client}
    origins = [o.rstrip("/") for o in (settings.ALLOWED_ORIGINS if allowed_origins is None else allowed_origins)]

    # Entries like https://*.pages.dev are wildcards (Cloudflare Pages preview URLs change per deploy).
    exact = [o for o in origins if "*" not in o]
    wild = [re.compile("^" + re.escape(o).replace(r"\*", "[A-Za-z0-9-]+") + "$") for o in origins if "*" in o]

    def origin_allowed(origin: str) -> bool:
        origin = origin.rstrip("/")
        return origin in exact or any(w.match(origin) for w in wild)

    # Frontend on another site (GitHub Pages / Cloudflare Pages) -> browser needs CORS to call this API.
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=exact,
            allow_origin_regex="|".join(w.pattern for w in wild) or None,
            allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
            max_age=600,
        )

    def origin_ok(origin: str, host: str) -> bool:
        """Websockets are not covered by CORS, so check the Origin header ourselves.
        No Origin header = not a browser (the Electron desktop app), which is fine: it still needs a valid token."""
        if not origin:
            return True
        if origin_allowed(origin):
            return True
        return urlparse(origin).netloc == host  # the UI served by this very server

    def friendly_ai_error(e: Exception) -> str:
        """Turn a provider failure into something the user can act on. Never includes the API key."""
        if isinstance(e, providers.ProviderError):
            return str(e)
        code = getattr(e, "status_code", None)
        if code:
            return {401: "The API key was rejected. Check it in AI Provider settings.", 403: "That key has no access to this model.",
                    404: "That model name wasn't found for this provider.", 429: "Rate limit reached or no credit left on that account."}.get(code, f"The AI provider returned an error (HTTP {code}): {str(getattr(e, 'message', ''))[:160]}")
        if isinstance(e, asyncio.TimeoutError):
            return "The AI provider took too long to answer."
        if e.__class__.__module__.startswith("httpx"):
            return "Couldn't reach the AI provider. Check the base URL and your connection."
        return "The AI service had a problem. Please try again."

    def get_client():
        if state["client"] is None and os.environ.get("ANTHROPIC_API_KEY"):
            import anthropic

            state["client"] = anthropic.AsyncAnthropic()
        return state["client"]

    # ---------- security headers ----------
    @app.middleware("http")
    async def headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; connect-src 'self' ws: wss: https://api.open-meteo.com https://geocoding-api.open-meteo.com; "
            "img-src 'self' data:; "
            "style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
        )
        return resp

    # ---------- auth helpers ----------
    def current_user(authorization: str = Header(default="")):
        token = authorization[7:] if authorization.startswith("Bearer ") else ""
        uid = read_token(token, settings.JWT_SECRET)
        user = db.user_by_id(uid) if uid else None
        if not user:
            raise HTTPException(401, "Not signed in")
        return user

    def limit_for(user) -> int:
        return settings.PLAN_LIMITS.get(user["plan"], settings.PLAN_LIMITS["free"])

    # ---------- REST ----------
    @app.get("/healthz")
    def healthz():
        # "ai" = the server has an Anthropic key (or an injected client). Lets the website say exactly what is missing.
        return {"ok": True, "ai": bool(state["client"] or os.environ.get("ANTHROPIC_API_KEY"))}

    @app.get("/api/config")
    def config():
        return {"app_name": settings.APP_NAME, "web_search": settings.WEB_SEARCH}

    @app.get("/api/providers")
    def list_providers():
        # catalog for the website's AI Provider dialog. Says which providers the server already has a key for, never the key.
        return {"providers": providers.public_catalog(), "default_model": settings.MODEL, "max_tokens": settings.MAX_TOKENS, "local_urls": providers.allow_private_urls()}

    @app.post("/api/ai/test")
    async def test_ai(body: AIBody, request: Request, user=Depends(current_user)):
        limiter.check((request.client.host if request.client else "?", "ai-test"))
        try:
            cfg = providers.parse_config(body.model_dump(), settings.MODEL, settings.MAX_TOKENS)
            await providers.validate_base_url(cfg)
            reply = await providers.ping(cfg)
        except providers.ConfigError as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:
            return {"ok": False, "error": friendly_ai_error(e)}
        return {"ok": True, "provider": cfg.provider.label, "model": cfg.model, "reply": reply}

    @app.post("/api/register")
    def register(c: Credentials, request: Request):
        email = c.email.strip().lower()
        if not EMAIL_RE.match(email) or len(email) > 200:
            raise HTTPException(400, "Enter a valid email address")
        if not (8 <= len(c.password) <= 200):
            raise HTTPException(400, "Password must be 8 to 200 characters")
        limiter.check((request.client.host if request.client else "?", "register"))
        if db.user_by_email(email):
            raise HTTPException(409, "An account with this email already exists")
        h, salt = hash_password(c.password)
        uid = db.create_user(email, h, salt)
        return {"token": make_token(uid, settings.JWT_SECRET)}

    @app.post("/api/login")
    def login(c: Credentials, request: Request):
        email = c.email.strip().lower()
        limiter.check((request.client.host if request.client else "?", email))
        user = db.user_by_email(email)
        if not user or not verify_password(c.password, user["pw_hash"], user["salt"]):
            raise HTTPException(401, "Invalid email or password")
        return {"token": make_token(user["id"], settings.JWT_SECRET)}

    @app.get("/api/me")
    def me(user=Depends(current_user)):
        return {
            "email": user["email"],
            "plan": user["plan"],
            "used": db.used_today(user["id"]),
            "limit": limit_for(user),
            "device": hub.device_connected(user["id"]),
            "app_name": settings.APP_NAME,
            "web_search": settings.WEB_SEARCH,
        }

    @app.get("/api/memory")
    def list_memory(user=Depends(current_user)):
        return [{"id": r["id"], "text": r["text"]} for r in db.facts(user["id"])]

    @app.delete("/api/memory/{fact_id}")
    def delete_memory(fact_id: int, user=Depends(current_user)):
        if not db.delete_fact(user["id"], fact_id):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    @app.get("/api/tasks")
    def list_tasks(user=Depends(current_user)):
        return db.tasks(user["id"])

    @app.post("/api/tasks")
    def add_task(t: TaskIn, user=Depends(current_user)):
        text = t.text.strip()
        if not text:
            raise HTTPException(400, "Write the task first")
        return {"id": db.add_task(user["id"], text, t.due)}

    @app.post("/api/tasks/{task_id}")
    def patch_task(task_id: int, p: TaskPatch, user=Depends(current_user)):
        if not db.set_task_done(user["id"], task_id, p.done):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    @app.delete("/api/tasks/{task_id}")
    def delete_task(task_id: int, user=Depends(current_user)):
        if not db.delete_task(user["id"], task_id):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    @app.get("/api/reminders")
    def list_reminders(user=Depends(current_user)):
        return db.reminders(user["id"])

    @app.delete("/api/reminders/{rid}")
    def delete_reminder(rid: int, user=Depends(current_user)):
        if not db.delete_reminder(user["id"], rid):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    @app.get("/api/notes")
    def list_notes(user=Depends(current_user)):
        return db.notes(user["id"])

    @app.post("/api/notes")
    def add_note(n: NoteIn, user=Depends(current_user)):
        if not n.body.strip():
            raise HTTPException(400, "The note is empty")
        return {"id": db.add_note(user["id"], n.title, n.body)}

    @app.delete("/api/notes/{nid}")
    def delete_note(nid: int, user=Depends(current_user)):
        if not db.delete_note(user["id"], nid):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    # ---------- websocket ----------
    agent_holder = {}

    def get_agent():
        # the agent is shared; each chat session may bring its own client (the user's AI Provider settings)
        c = get_client()
        if "agent" not in agent_holder:
            agent_holder["agent"] = Agent(c, db, hub)
        agent_holder["agent"].client = c
        return agent_holder["agent"]

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        if not origin_ok(ws.headers.get("origin", ""), ws.headers.get("host", "")):
            # accept first so the browser can read the close code and show a useful message
            await ws.close(code=4403)
            return
        try:
            first = await asyncio.wait_for(ws.receive_json(), 10)
            if not isinstance(first, dict) or first.get("type") != "auth":
                raise ValueError("expected auth")
        except Exception:
            await ws.close(code=4400)
            return
        uid = read_token(str(first.get("token", "")), settings.JWT_SECRET)
        user = db.user_by_id(uid) if uid else None
        if not user:
            await ws.close(code=4401)
            return
        try:
            if first.get("role") == "device":
                await run_device(ws, user["id"])
            else:
                await run_chat(ws, user, str(first.get("tz", ""))[:64])
        except WebSocketDisconnect:
            pass

    async def run_device(ws: WebSocket, uid: int):
        await hub.set_device(uid, ws)
        try:
            await ws.send_json({"type": "ready"})
            while True:
                msg = await ws.receive_json()
                if isinstance(msg, dict) and msg.get("type") == "tool_result":
                    hub.resolve(msg.get("id"), str(msg.get("result", "")), uid)
        except (WebSocketDisconnect, ValueError):
            pass
        finally:
            await hub.drop_device(uid, ws)

    async def run_chat(ws: WebSocket, user, tz: str = ""):
        uid = user["id"]
        history = [{"role": m["role"], "content": m["text"]} for m in db.recent_messages(uid, 20)]
        # history must start with a user turn
        while history and history[0]["role"] != "user":
            history.pop(0)
        sess = Session(uid, ws, history, tz)
        hub.add_chat(uid, ws)
        tasks = set()

        async def send(payload):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

        async def handle_chat(text: str):
            consumed = False
            try:
                fresh = db.user_by_id(uid)
                limit = limit_for(fresh)
                if not db.try_consume(uid, limit):
                    await send({"type": "error", "text": f"Daily limit reached ({limit} messages on the {fresh['plan']} plan)."})
                    return
                consumed = True
                agent = get_agent()
                if sess.client is None and agent.client is None:
                    db.refund(uid)
                    await send({"type": "error", "text": "No AI is set up yet. Open Settings > AI Provider and add your API key."})
                    return
                db.add_message(uid, "user", text)
                reply = await agent.run(sess, text, send)
                db.add_message(uid, "assistant", reply)
                await send({"type": "reply", "text": reply, "used": db.used_today(uid), "limit": limit})
            except asyncio.CancelledError:
                if not sess.stopped:
                    raise  # connection closed: just unwind
                sess.stopped = False  # the user pressed Stop: give the message back and say so
                if consumed:
                    db.refund(uid)
                await send({"type": "stopped"})
            except Exception:
                log.exception("agent failure")
                if consumed:
                    db.refund(uid)
                await send({"type": "error", "text": friendly_ai_error(sys.exc_info()[1])})
            finally:
                sess.busy = False

        try:
            await ws.send_json(
                {
                    "type": "hello",
                    "email": user["email"],
                    "plan": user["plan"],
                    "used": db.used_today(uid),
                    "limit": limit_for(user),
                    "device": hub.device_connected(uid),
                    "history": db.recent_messages(uid, 30),
                }
            )
            await deliver_reminders(uid)  # anything that came due while the user was away
            while True:
                msg = await ws.receive_json()
                if not isinstance(msg, dict):
                    continue
                kind = msg.get("type")
                if kind == "chat":
                    text = str(msg.get("text", "")).strip()[:4000]
                    if not text:
                        continue
                    if sess.busy:
                        await send({"type": "error", "text": "Still working on your last request."})
                        continue
                    sess.busy = True
                    if msg.get("tz"):
                        sess.tz = str(msg["tz"])[:64]
                    t = asyncio.create_task(handle_chat(text))
                    sess.task = t
                    tasks.add(t)
                    t.add_done_callback(tasks.discard)
                elif kind == "stop":
                    if sess.busy and sess.task and not sess.task.done():
                        sess.stopped = True
                        sess.task.cancel()
                elif kind == "ping":
                    pass
                elif kind == "set_ai" and not sess.busy:
                    try:
                        cfg = providers.parse_config(msg.get("config") or {}, settings.MODEL, settings.MAX_TOKENS)
                        await providers.validate_base_url(cfg)
                        sess.client, sess.cfg = providers.build_client(cfg), cfg
                        await send({"type": "ai_set", "ok": True, "provider": cfg.provider.id, "label": cfg.provider.label, "model": cfg.model})
                    except providers.ConfigError as e:
                        await send({"type": "ai_set", "ok": False, "error": str(e)})
                    except Exception:
                        log.exception("set_ai failed")
                        await send({"type": "ai_set", "ok": False, "error": "Couldn't apply those AI settings."})
                elif kind == "clear_ai" and not sess.busy:
                    sess.client = sess.cfg = None
                    await send({"type": "ai_set", "ok": True, "provider": "server", "label": "Server default", "model": settings.MODEL})
                elif kind == "confirm_response":
                    hub.resolve(msg.get("id"), bool(msg.get("ok")), uid)
                elif kind == "reset" and not sess.busy:
                    sess.history.clear()
                    db.clear_messages(uid)
                    await send({"type": "cleared"})
        except (WebSocketDisconnect, ValueError):
            pass
        finally:
            for t in tasks:
                t.cancel()
            hub.drop_chat(uid, ws)

    @app.get("/app", include_in_schema=False)
    def app_shortcut():
        return RedirectResponse("/app.html")

    # ---------- static files (must come last) ----------
    if settings.DOWNLOADS_DIR.exists():
        app.mount("/downloads", StaticFiles(directory=settings.DOWNLOADS_DIR), name="downloads")
    if os.environ.get("AEGIS_WEB_DIR") and settings.WEB_DIR.exists():
        app.mount("/", StaticFiles(directory=settings.WEB_DIR, html=True), name="web")
    else:
        def serve(name):
            def handler():
                return FileResponse(settings.WEB_DIR / name)
            return handler

        for name in settings.WEB_FILES:
            if (settings.WEB_DIR / name).is_file():
                app.add_api_route("/" + name, serve(name), include_in_schema=False)
        if (settings.WEB_DIR / "index.html").is_file():
            app.add_api_route("/", serve("index.html"), include_in_schema=False)
    return app
