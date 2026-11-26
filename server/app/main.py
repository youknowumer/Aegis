"""FastAPI app: REST (auth, memory), websocket (chat + desktop device), static web UI.

Run:  uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
"""
import asyncio
import contextlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import sys
import time
import uuid
from collections import defaultdict, deque

from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import chief, emotion, extras, heart, meeting, mms, otter, providers, settings, smarthome, tts
from .agent import Agent, Session
from .auth import EMAIL_RE, hash_password, make_token, read_token_full, verify_password
from .db import DB
from .hub import Hub

log = logging.getLogger("aegis")
if not logging.getLogger().handlers:  # under uvicorn the app's own logger would otherwise stay silent below WARNING
    logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL, logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log.setLevel(getattr(logging, settings.LOG_LEVEL, logging.INFO))


class MemoryIn(BaseModel):
    text: str
    kind: str = "fact"
    important: bool = False


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


class TTSIn(BaseModel):
    text: str
    emotion: str = "calm"
    lang: str = ""
    intensity: int = 3


class MeetingIn(BaseModel):
    transcript: str
    title: str = ""
    duration: float = 0
    output_lang: str = "en"
    save: bool = True
    quick: bool = False


class Credentials(BaseModel):
    email: str
    password: str


class PasswordChange(BaseModel):
    current: str
    new: str


class PasswordOnly(BaseModel):
    password: str


class PlanIn(BaseModel):
    plan: str


class AskIn(BaseModel):
    question: str
    mid: int = 0  # 0 = ask across all of the user's meetings
    history: list = []


class ExtraIn(BaseModel):
    labels: list = []
    names: dict = {}
    highlights: list = []
    comments: list = []
    tags: list = []
    title: str = ""


class FollowupIn(BaseModel):
    tone: str = "friendly and professional"
    language: str = "English"


class ExpenseIn(BaseModel):
    amount: float
    currency: str = "PKR"
    category: str = "other"
    note: str = ""


class HabitIn(BaseModel):
    name: str


class HabitCheck(BaseModel):
    done: bool = True
    tz: str = ""


class LoginLimiter:
    """Tiny in-memory throttle: 10 attempts / 5 min per (ip, email). Use a real one behind multiple workers."""

    def __init__(self, max_attempts=10, window=300):
        self.max, self.window = max_attempts, window
        self.hits = defaultdict(deque)
        self._sweep_at = 0.0

    def _sweep(self, now):
        """Forget keys whose attempts have all expired, so the table cannot grow without bound."""
        for k in list(self.hits):
            q = self.hits[k]
            while q and now - q[0] > self.window:
                q.popleft()
            if not q:
                del self.hits[k]
        self._sweep_at = now + 30

    def check(self, key):
        now = time.time()
        if len(self.hits) > 2000 and now >= self._sweep_at:
            self._sweep(now)
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max:
            raise HTTPException(429, "Too many attempts. Try again in a few minutes.")
        q.append(now)


_DUMMY_HASH = hash_password("not-a-real-password")


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

    alerted = {}   # (user id, alert key) -> when it was sent, so each alert goes out once
    chat_tz = {}   # user id -> time zone of their open chat

    async def deliver_alerts(uid=None):
        """proactive proactive heads-ups (meeting in 15 minutes, habits still open, unusual spending)."""
        now = time.time()
        for k in [k for k, t in alerted.items() if now - t > 2 * 86400]:
            del alerted[k]
        for u in list(hub.chats):
            if uid is not None and u != uid:
                continue
            try:
                found = await asyncio.to_thread(chief.proactive_alerts, db, u, chat_tz.get(u, ""))
            except Exception:
                log.exception("alerts for user %s", u)
                continue
            for a in found:
                if (u, a["key"]) in alerted:
                    continue
                sent = False
                for sock in list(hub.chats.get(u, ())):
                    try:
                        await sock.send_json({"type": "alert", "key": a["key"], "level": a["level"], "text": a["text"]})
                        sent = True
                    except Exception:
                        pass
                if sent:
                    alerted[(u, a["key"])] = now

    async def alert_loop():
        while settings.PROACTIVE:
            try:
                await deliver_alerts()
            except Exception:
                log.exception("alert loop")
            await asyncio.sleep(30)

    def run_maintenance():
        """Old rows out, stale counters out, optional database copy. Safe to call any time."""
        removed = db.purge_old(keep_messages=settings.KEEP_MESSAGES)
        for u in db.all("SELECT id FROM users"):
            try:
                c = heart.consolidate(db, u["id"])
                removed["memories_merged"] = removed.get("memories_merged", 0) + c["merged"]
                removed["memories_faded"] = removed.get("memories_faded", 0) + c["faded"]
            except Exception:
                log.exception("memory consolidation")
        today = time.strftime("%Y-%m-%d")
        for k in [k for k in server_use if k[1] != today]:
            del server_use[k]
        backup = ""
        if settings.BACKUP_DIR:
            backup = extras.make_backup(db, settings.BACKUP_DIR, settings.BACKUP_KEEP)
        log.info("maintenance: removed %s%s", removed, f", backup {backup}" if backup else "")
        return {"removed": removed, "backup": backup}

    async def maintenance_loop():
        await asyncio.sleep(30)
        while True:
            try:
                await asyncio.to_thread(run_maintenance)
            except Exception:
                log.exception("maintenance loop")
            await asyncio.sleep(max(60, settings.MAINTENANCE_EVERY))

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        tasks = [asyncio.create_task(reminder_loop()), asyncio.create_task(maintenance_loop()), asyncio.create_task(alert_loop())]
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            # graceful shutdown: tell open chats to reconnect instead of just dropping them
            for socks in list(hub.chats.values()):
                for sock in list(socks):
                    with contextlib.suppress(Exception):
                        await sock.close(code=1012)

    app = FastAPI(title=settings.APP_NAME, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.db = db
    app.state.deliver_reminders = deliver_reminders
    app.state.deliver_alerts = deliver_alerts
    app.state.run_maintenance = run_maintenance
    metrics = defaultdict(int)  # simple in-process counters, exposed at /metrics
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
            allow_headers=["Authorization", "Content-Type", "X-Groq-Key", "X-Admin-Token"],
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
        rid = request.headers.get("x-request-id", "")[:40] or uuid.uuid4().hex[:12]
        t0 = time.perf_counter()
        try:
            resp = await call_next(request)
        except Exception:
            metrics["http_errors_total"] += 1
            log.exception("unhandled error rid=%s %s %s", rid, request.method, request.url.path)
            resp = Response("Internal server error", status_code=500)
        ms = (time.perf_counter() - t0) * 1000
        metrics["http_requests_total"] += 1
        metrics[f"http_responses_{resp.status_code // 100}xx_total"] += 1
        if resp.status_code >= 500 or ms > 2000:
            log.warning("rid=%s %s %s -> %s in %.0f ms", rid, request.method, request.url.path, resp.status_code, ms)
        resp.headers["X-Request-ID"] = rid
        if settings.HSTS:
            resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; connect-src 'self' ws: wss: https://api.open-meteo.com https://geocoding-api.open-meteo.com https://api.github.com; "
            "img-src 'self' data: https://d2ol7oe51mr4n9.cloudfront.net; "
            "style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
        )
        return resp

    # ---------- auth helpers ----------
    def user_for_token(token: str):
        """The user a token belongs to, or None. A token stops working when the account's token_ver moved on
        (password changed, 'sign out everywhere') or the account was deleted."""
        got = read_token_full(token, settings.JWT_SECRET)
        if not got:
            return None
        user = db.user_by_id(got[0])
        if not user or int(user["token_ver"]) != got[1]:
            return None
        if time.time() - user["last_seen"] > 300:
            db.touch_user(user["id"])
        return user

    def new_token(uid: int) -> str:
        row = db.user_by_id(uid)
        return make_token(uid, settings.JWT_SECRET, ver=int(row["token_ver"]) if row else 0)

    def current_user(authorization: str = Header(default="")):
        token = authorization[7:] if authorization.startswith("Bearer ") else ""
        user = user_for_token(token)
        if not user:
            raise HTTPException(401, "Not signed in")
        return user

    def client_ip(request: Request) -> str:
        return request.client.host if request.client else "?"

    admin_limiter = LoginLimiter(max_attempts=120, window=60)

    def admin_only(request: Request, x_admin_token: str = Header(default="")):
        """The admin API does not exist (404) until AEGIS_ADMIN_TOKEN is set. Compared in constant time."""
        if not settings.ADMIN_TOKEN:
            raise HTTPException(404, "Not found")
        admin_limiter.check((client_ip(request), "admin"))
        if not hmac.compare_digest(x_admin_token.encode(), settings.ADMIN_TOKEN.encode()):
            raise HTTPException(401, "Bad admin token")

    def limit_for(user) -> int:
        return settings.PLAN_LIMITS.get(user["plan"], settings.PLAN_LIMITS["free"])

    # ---------- REST ----------
    @app.get("/healthz")
    def healthz():
        # "ai" = the server has an Anthropic key (or an injected client). Lets the website say exactly what is missing.
        return {"ok": True, "ai": bool(state["client"] or os.environ.get("ANTHROPIC_API_KEY") or meeting.server_has_key()), "groq": meeting.server_has_key()}

    @app.get("/readyz")
    def readyz():
        """Load balancers and uptime monitors: 200 only when the database answers."""
        if not db.healthy():
            raise HTTPException(503, "database unavailable")
        return {"ok": True}

    @app.get("/api/config")
    def config():
        return {"app_name": settings.APP_NAME, "web_search": settings.WEB_SEARCH, "groq": meeting.server_has_key(), "studio_voice": tts.available(), "smart_home": smarthome.configured()}

    @app.get("/api/providers")
    def list_providers():
        # catalog for the website's AI Provider dialog. Says which providers the server already has a key for, never the key.
        return {"providers": providers.public_catalog(), "default_model": settings.MODEL, "max_tokens": settings.MAX_TOKENS, "local_urls": providers.allow_private_urls()}

    @app.post("/api/ai/test")
    async def test_ai(body: AIBody, request: Request, user=Depends(current_user)):
        limiter.check((client_ip(request), "ai-test"))
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
        limiter.check((client_ip(request), "register"))
        if not settings.OPEN_REGISTRATION:
            raise HTTPException(403, "Sign-ups are closed right now.")
        if settings.MAX_USERS and db.count_users() >= settings.MAX_USERS:
            raise HTTPException(403, "Aegis is full for now. Please try again later.")
        if db.user_by_email(email):
            raise HTTPException(409, "An account with this email already exists")
        h, salt = hash_password(c.password)
        try:
            uid = db.create_user(email, h, salt)
        except sqlite3.IntegrityError:  # two sign-ups with the same email at the same moment
            raise HTTPException(409, "An account with this email already exists")
        metrics["registrations_total"] += 1
        return {"token": new_token(uid)}

    @app.post("/api/login")
    def login(c: Credentials, request: Request):
        email = c.email.strip().lower()
        limiter.check((client_ip(request), email))
        user = db.user_by_email(email)
        if not user:
            verify_password(c.password, *_DUMMY_HASH)  # same work for unknown emails, so timing does not reveal who has an account
        if not user or not verify_password(c.password, user["pw_hash"], user["salt"]):
            metrics["login_failures_total"] += 1
            raise HTTPException(401, "Invalid email or password")
        return {"token": new_token(user["id"])}

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
        now = time.time()
        return [{"id": r["id"], "text": r["text"], "kind": r["kind"], "important": r["weight"] >= 3, "weight": r["weight"], "mood": r["mood"],
                 "mood_level": r["mood_level"], "source": r["source"], "uses": r["uses"], "when": heart.ago(r["created"], now)} for r in db.facts(user["id"])]

    @app.post("/api/memory")
    def add_memory(m: MemoryIn, user=Depends(current_user)):
        text = m.text.strip()[:500]
        if len(text) < 2:
            raise HTTPException(400, "Write what to remember")
        fid = db.add_fact(user["id"], text, m.kind, m.important, source="user", when_md=heart.parse_month_day(text) if m.kind == "event" else "")
        return {"id": fid}

    @app.get("/api/bond")
    def get_bond(user=Depends(current_user)):
        b = heart.bond_level(db.bond_row(user["id"]), len(db.facts(user["id"])))
        return {k: v for k, v in b.items() if k != "tone"}

    @app.delete("/api/memory/{fact_id}")
    def delete_memory(fact_id: int, user=Depends(current_user)):
        if not db.delete_fact(user["id"], fact_id):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    @app.get("/api/mood")
    def get_mood(days: int = 7, tz: str = "", user=Depends(current_user)):
        days = max(1, min(60, days))
        rows = db.moods(user["id"], since=time.time() - days * 86400)
        counts = {}
        for r in rows:
            counts[r["mood"]] = counts.get(r["mood"], 0) + 1
        return {
            "days": days,
            "summary": emotion.summarize(rows, tz, days),
            "counts": counts,
            "latest": rows[0]["mood"] if rows else "",
        }

    @app.delete("/api/mood")
    def clear_mood(user=Depends(current_user)):
        return {"cleared": db.clear_moods(user["id"])}

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

    # ---------- Studio voice (optional cloud text-to-speech) ----------
    tts_quota = tts.Quota()
    tts_limiter = LoginLimiter(max_attempts=60, window=60)

    @app.get("/api/tts/status")
    def tts_status(user=Depends(current_user)):
        on = tts.available()
        local = tts.local_languages()
        return {"available": on, "provider": tts.provider(), "chars_left": tts_quota.left(user["id"]) if on else 0, "max_chars": tts.MAX_CHARS,
                "languages": local, "roman_urdu": bool(local) and mms.roman_ready(),
                "downloading": mms.downloading() if tts.provider() == "mms" else [], "local_reason": mms.reason()}

    @app.post("/api/tts")
    async def tts_speak(body: TTSIn, user=Depends(current_user)):
        if not tts.available():
            raise HTTPException(503, "Studio voice is not set up on this server.")
        tts_limiter.check((user["id"], "tts"))
        text = " ".join(body.text.split())
        if not text:
            raise HTTPException(400, "Nothing to say.")
        if len(text) > tts.MAX_CHARS:
            raise HTTPException(413, f"Send at most {tts.MAX_CHARS} characters at a time.")
        if not tts_quota.take(user["id"], len(text)):
            raise HTTPException(429, "Today's studio-voice allowance is used up. The built-in voice takes over.")
        try:
            audio = await asyncio.to_thread(tts.synthesize, text, body.emotion, body.lang, body.intensity)
        except tts.TTSError as e:
            tts_quota.refund(user["id"], len(text))
            raise HTTPException(502, str(e))
        return Response(content=audio, media_type=tts.content_type(audio), headers={"Cache-Control": "no-store"})

    # ---------- Groq: speech-to-text + meeting notes ----------
    stt_limiter = LoginLimiter(max_attempts=90, window=60)
    notes_limiter = LoginLimiter(max_attempts=20, window=300)
    server_use = defaultdict(int)  # (user, day, kind) -> calls made with the SERVER's key (protects the owner's quota)

    def groq_key(request: Request, user, kind: str) -> str:
        """The user's own key (header) wins and is only used for this request. Otherwise the server's key, with a daily cap."""
        own = meeting.clean_key(request.headers.get("x-groq-key", ""))
        if own:
            return own
        key = meeting.resolve_key("")
        day = time.strftime("%Y-%m-%d")
        cap = settings.SERVER_STT_PER_DAY if kind == "stt" else settings.SERVER_NOTES_PER_DAY
        used = server_use[(user["id"], day, kind)]
        if used >= cap:
            raise meeting.GroqError("You've used today's share of the server's Groq key. Paste your own free key in Settings > Voice & meetings to keep going.", 429)
        server_use[(user["id"], day, kind)] = used + 1
        return key

    def groq_http(e: meeting.GroqError) -> HTTPException:
        return HTTPException(e.status if 400 <= e.status < 600 else 502, str(e))

    @app.get("/api/groq/status")
    def groq_status(user=Depends(current_user)):
        return {"server_key": meeting.server_has_key(), "stt_model": meeting.STT_MODEL_FAST, "stt_model_best": meeting.STT_MODEL_BEST, "chat_model": meeting.CHAT_MODEL, "max_audio_mb": meeting.MAX_AUDIO_BYTES // (1024 * 1024)}

    @app.post("/api/groq/test")
    async def groq_test(request: Request, user=Depends(current_user)):
        stt_limiter.check((user["id"], "test"))
        try:
            info = await meeting.check_key(meeting.resolve_key(request.headers.get("x-groq-key", "")))
        except meeting.GroqError as e:
            return {"ok": False, "error": str(e)}
        return {"ok": True, **info}

    @app.post("/api/transcribe")
    async def transcribe(request: Request, lang: str = "", prompt: str = "", best: int = 0, user=Depends(current_user)):
        """Body = raw audio bytes (webm / ogg / mp4 / wav / mp3 / m4a / flac). Returns text with timed segments."""
        stt_limiter.check((user["id"], "stt"))
        try:
            declared = int(request.headers.get("content-length") or 0)
            if declared > meeting.MAX_AUDIO_BYTES + 4096:
                raise meeting.GroqError(f"That audio is {declared // (1024 * 1024)} MB. The limit is {meeting.MAX_AUDIO_BYTES // (1024 * 1024)} MB per file. Record or upload it in shorter parts.", 413)
            audio = await request.body()
            ctype = (request.headers.get("content-type") or "application/octet-stream").split(";")[0].strip()
            ext = {"audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/x-m4a": "m4a", "audio/aac": "m4a"}.get(ctype, "webm")
            return await meeting.transcribe(audio, "audio." + ext, ctype, groq_key(request, user, "stt"), lang, prompt[:400], bool(best))
        except meeting.GroqError as e:
            raise groq_http(e)

    @app.post("/api/meetings")
    async def create_meeting(m: MeetingIn, request: Request, user=Depends(current_user)):
        """Transcript in -> structured notes out (and saved to the user's meeting history unless save=false)."""
        notes_limiter.check((user["id"], "notes"))
        text = m.transcript.strip()
        try:
            notes = await meeting.analyze(text, groq_key(request, user, "notes"), m.title.strip()[:120], m.output_lang, m.quick)
        except meeting.GroqError as e:
            raise groq_http(e)
        out = {"notes": notes, "markdown": meeting.to_markdown(notes, "", time.strftime("%d %B %Y"))}
        if m.save and not m.quick:
            out["id"] = db.add_meeting(user["id"], notes["title"], m.duration, text, json.dumps(notes, ensure_ascii=False))
        return out

    @app.get("/api/meetings")
    def list_meetings(user=Depends(current_user)):
        return db.meetings(user["id"])

    # ---------- Otter-style extras: search, ask, speakers, highlights, share, export, follow-up ----------
    def _meeting_or_404(uid: int, mid: int) -> dict:
        row = db.meeting(uid, mid)
        if not row:
            raise HTTPException(404, "Not found")
        return row

    @app.get("/api/meetings/search")
    def search_meetings(q: str = "", user=Depends(current_user)):
        terms = otter.search_terms(q)
        out = []
        for r in db.search_meetings(user["id"], terms):
            hit = otter.snippet(r["transcript"], terms) if any(t in r["transcript"].lower() for t in terms) else otter.snippet(r["notes"], terms)
            out.append({"id": r["id"], "title": r["title"], "duration": r["duration"], "created": r["created"], "snippet": hit})
        return out

    @app.post("/api/meetings/ask")
    async def ask_meetings(b: AskIn, request: Request, user=Depends(current_user)):
        q = b.question.strip()
        if len(q) < 2:
            raise HTTPException(400, "Ask a question first")
        notes_limiter.check((user["id"], "ask"))
        try:
            key = groq_key(request, user, "notes")
            if b.mid:
                row = _meeting_or_404(user["id"], b.mid)
                ans = await otter.ask_one(q, row["title"], row["transcript"], json.loads(row["notes"]), otter.load_extra(row["extra"]), key, b.history)
                return {"answer": ans, "sources": [{"id": row["id"], "title": row["title"]}]}
            return await otter.ask_many(q, db.meetings_full(user["id"]), key)
        except meeting.GroqError as e:
            raise groq_http(e)

    @app.get("/api/meetings/{mid}/extra")
    def meeting_extra(mid: int, user=Depends(current_user)):
        row = _meeting_or_404(user["id"], mid)
        ex = otter.load_extra(row["extra"])
        return {**ex, "share": row["share"], "insights": otter.insights(row["transcript"], ex, row["duration"])}

    @app.put("/api/meetings/{mid}/extra")
    def save_meeting_extra(mid: int, b: ExtraIn, user=Depends(current_user)):
        row = _meeting_or_404(user["id"], mid)
        ex = otter.clean_extra(b.model_dump(), len(otter.parse_lines(row["transcript"])))
        db.set_meeting_extra(user["id"], mid, json.dumps(ex, ensure_ascii=False))
        if b.title.strip():
            db.set_meeting_title(user["id"], mid, b.title)
        return {**ex, "insights": otter.insights(row["transcript"], ex, row["duration"])}

    @app.post("/api/meetings/{mid}/speakers")
    async def label_meeting_speakers(mid: int, request: Request, user=Depends(current_user)):
        row = _meeting_or_404(user["id"], mid)
        notes_limiter.check((user["id"], "spk"))
        try:
            got = await otter.label_speakers(row["transcript"], groq_key(request, user, "notes"))
        except meeting.GroqError as e:
            raise groq_http(e)
        ex = otter.load_extra(row["extra"])
        ex["labels"], ex["names"] = got["labels"], {**got["names"], **{k: v for k, v in ex["names"].items() if v}}
        db.set_meeting_extra(user["id"], mid, json.dumps(ex, ensure_ascii=False))
        return {**ex, "insights": otter.insights(row["transcript"], ex, row["duration"])}

    @app.post("/api/meetings/{mid}/followup")
    async def meeting_followup(mid: int, b: FollowupIn, request: Request, user=Depends(current_user)):
        row = _meeting_or_404(user["id"], mid)
        notes_limiter.check((user["id"], "mail"))
        try:
            return await otter.followup_email(json.loads(row["notes"]), row["title"], groq_key(request, user, "notes"), b.tone, b.language)
        except meeting.GroqError as e:
            raise groq_http(e)

    @app.post("/api/meetings/{mid}/share")
    def share_meeting(mid: int, user=Depends(current_user)):
        row = _meeting_or_404(user["id"], mid)
        tok = row["share"] or secrets.token_urlsafe(18)
        db.set_meeting_share(user["id"], mid, tok)
        return {"token": tok, "path": "/shared/" + tok}

    @app.delete("/api/meetings/{mid}/share")
    def unshare_meeting(mid: int, user=Depends(current_user)):
        _meeting_or_404(user["id"], mid)
        db.set_meeting_share(user["id"], mid, "")
        return {"ok": True}

    @app.get("/shared/{token}", include_in_schema=False)
    def shared_meeting(token: str):
        row = db.meeting_by_share(token)
        if not row:
            raise HTTPException(404, "This link is no longer shared")
        return HTMLResponse(otter.shared_html(row, json.loads(row["notes"]), otter.load_extra(row["extra"])), headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex"})

    @app.get("/api/meetings/{mid}/export")
    def export_meeting(mid: int, fmt: str = "txt", user=Depends(current_user)):
        row = _meeting_or_404(user["id"], mid)
        ex, notes = otter.load_extra(row["extra"]), json.loads(row["notes"])
        date = time.strftime("%d %B %Y", time.localtime(row["created"]))
        name = re.sub(r"[^\w-]+", "-", row["title"].lower()).strip("-")[:40] or "meeting"
        if fmt == "srt":
            body, mt = otter.to_srt(row["transcript"], ex), "application/x-subrip"
        elif fmt == "vtt":
            body, mt = otter.to_vtt(row["transcript"], ex), "text/vtt"
        elif fmt == "md":
            body, mt = meeting.to_markdown(notes, otter.to_txt(row["title"], row["transcript"], ex).split("\n", 3)[-1], date), "text/markdown"
        elif fmt == "json":
            body, mt = json.dumps({"title": row["title"], "created": row["created"], "duration": row["duration"], "notes": notes, "transcript": row["transcript"], "speakers": ex}, ensure_ascii=False, indent=1), "application/json"
        else:
            fmt, body, mt = "txt", otter.to_txt(row["title"], row["transcript"], ex), "text/plain"
        return Response(body, media_type=mt + "; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}.{fmt}"', "Cache-Control": "no-store"})

    @app.get("/api/meetings/{mid}")
    def get_meeting(mid: int, user=Depends(current_user)):
        row = db.meeting(user["id"], mid)
        if not row:
            raise HTTPException(404, "Not found")
        notes = json.loads(row["notes"])
        return {"id": row["id"], "title": row["title"], "duration": row["duration"], "created": row["created"], "transcript": row["transcript"], "notes": notes, "extra": otter.load_extra(row["extra"]), "share": row["share"],
                "markdown": meeting.to_markdown(notes, row["transcript"], time.strftime("%d %B %Y", time.localtime(row["created"])))}

    @app.delete("/api/meetings/{mid}")
    def delete_meeting(mid: int, user=Depends(current_user)):
        if not db.delete_meeting(user["id"], mid):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    @app.post("/api/meetings/{mid}/tasks")
    def meeting_to_tasks(mid: int, user=Depends(current_user)):
        row = db.meeting(user["id"], mid)
        if not row:
            raise HTTPException(404, "Not found")
        n = 0
        for a in json.loads(row["notes"]).get("action_items", []):
            if not isinstance(a, dict) or not str(a.get("task", "")).strip():
                continue
            owner = str(a.get("owner") or "").strip()
            db.add_task(user["id"], str(a["task"]).strip() + (f" ({owner})" if owner else ""), str(a.get("due") or ""))
            n += 1
        return {"added": n}

    # ---------- account: password, sign out everywhere, export, delete ----------
    @app.post("/api/account/password")
    async def change_password(b: PasswordChange, request: Request, user=Depends(current_user)):
        limiter.check((client_ip(request), f"pw{user['id']}"))
        if not await asyncio.to_thread(verify_password, b.current, user["pw_hash"], user["salt"]):
            raise HTTPException(403, "Your current password is wrong")
        if not (8 <= len(b.new) <= 200):
            raise HTTPException(400, "Password must be 8 to 200 characters")
        h, salt = await asyncio.to_thread(hash_password, b.new)
        db.set_password(user["id"], h, salt)
        return {"token": new_token(user["id"])}  # every other device is signed out; this one gets a fresh token

    @app.post("/api/account/logout-all")
    def logout_all(user=Depends(current_user)):
        db.revoke_tokens(user["id"])
        return {"token": new_token(user["id"])}

    @app.get("/api/export")
    def export_data(user=Depends(current_user)):
        data = db.export_user(user["id"])
        body = json.dumps(data, ensure_ascii=False, indent=1)
        return Response(body, media_type="application/json", headers={"Content-Disposition": 'attachment; filename="aegis-data.json"', "Cache-Control": "no-store"})

    @app.post("/api/account/delete")
    async def delete_account(b: PasswordOnly, request: Request, user=Depends(current_user)):
        limiter.check((client_ip(request), f"del{user['id']}"))
        if not await asyncio.to_thread(verify_password, b.password, user["pw_hash"], user["salt"]):
            raise HTTPException(403, "That password is wrong")
        uid = user["id"]
        db.delete_user(uid)
        for sock in list(hub.chats.get(uid, ())):
            with contextlib.suppress(Exception):
                await sock.close(code=4401)
        return {"ok": True}

    # ---------- search, expenses, habits ----------
    @app.get("/api/search")
    def search_all(q: str = "", user=Depends(current_user)):
        q = q.strip()[:80]
        if len(q) < 2:
            raise HTTPException(400, "Type at least 2 characters")
        return db.search_all(user["id"], q)

    @app.get("/api/alerts")
    def api_alerts(user=Depends(current_user)):
        """What Aegis would warn this user about right now (not de-duplicated)."""
        return chief.proactive_alerts(db, user["id"], chat_tz.get(user["id"], ""))

    @app.get("/api/review")
    def api_review(tz: str = "", user=Depends(current_user)):
        return {"text": chief.evening_review(db, user["id"], tz[:64])}

    @app.get("/api/expenses")
    def list_expenses(period: str = "month", tz: str = "", user=Depends(current_user)):
        lo, hi, label = extras.period_bounds(period, tz)
        rows = db.expenses_between(user["id"], lo, hi)
        return {"label": label, "items": rows[:200], **extras.expense_totals(rows)}

    @app.post("/api/expenses")
    def add_expense(e: ExpenseIn, user=Depends(current_user)):
        try:
            return {"id": db.add_expense(user["id"], e.amount, e.currency, e.category, e.note)}
        except ValueError as err:
            raise HTTPException(400, str(err))

    @app.delete("/api/expenses/{eid}")
    def delete_expense(eid: int, user=Depends(current_user)):
        if not db.delete_expense(user["id"], eid):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    @app.get("/api/habits")
    def list_habits(tz: str = "", user=Depends(current_user)):
        return extras.habit_report(db, user["id"], tz)

    @app.post("/api/habits")
    def add_habit(h: HabitIn, user=Depends(current_user)):
        name = h.name.strip()
        if not name:
            raise HTTPException(400, "Name the habit first")
        return {"id": db.add_habit(user["id"], name)}

    @app.post("/api/habits/{hid}/check")
    def check_habit(hid: int, c: HabitCheck, user=Depends(current_user)):
        if not db.habit_check(user["id"], hid, extras.today_in(c.tz).isoformat(), c.done):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    @app.delete("/api/habits/{hid}")
    def delete_habit(hid: int, user=Depends(current_user)):
        if not db.delete_habit(user["id"], hid):
            raise HTTPException(404, "Not found")
        return {"ok": True}

    # ---------- admin + monitoring (needs AEGIS_ADMIN_TOKEN) ----------
    @app.get("/api/admin/stats")
    def admin_stats(_=Depends(admin_only)):
        return {**db.stats(), "online_chats": sum(len(v) for v in hub.chats.values()), "online_devices": len(hub.devices), "counters": dict(metrics)}

    @app.get("/api/admin/users")
    def admin_users(limit: int = 50, offset: int = 0, q: str = "", _=Depends(admin_only)):
        return {"total": db.count_users(q.strip()), "users": db.list_users(limit, offset, q.strip())}

    @app.post("/api/admin/users/{uid}/plan")
    def admin_set_plan(uid: int, p: PlanIn, _=Depends(admin_only)):
        if p.plan not in settings.PLAN_LIMITS:
            raise HTTPException(400, f"plan must be one of {', '.join(settings.PLAN_LIMITS)}")
        user = db.user_by_id(uid)
        if not user:
            raise HTTPException(404, "No such user")
        db.set_plan(user["email"], p.plan)
        return {"ok": True, "email": user["email"], "plan": p.plan}

    @app.post("/api/admin/users/{uid}/revoke")
    def admin_revoke(uid: int, _=Depends(admin_only)):
        if not db.user_by_id(uid):
            raise HTTPException(404, "No such user")
        db.revoke_tokens(uid)
        return {"ok": True}

    @app.post("/api/admin/maintenance")
    async def admin_maintenance(_=Depends(admin_only)):
        return await asyncio.to_thread(run_maintenance)

    @app.get("/metrics")
    def prometheus(_=Depends(admin_only)):
        """Prometheus text format: scrape with the X-Admin-Token header (or put it behind your own proxy rules)."""
        st = db.stats()
        lines = [
            "# TYPE aegis_users gauge", f"aegis_users {st['users']}",
            "# TYPE aegis_active_users_today gauge", f"aegis_active_users_today {st['active_today']}",
            "# TYPE aegis_messages_today gauge", f"aegis_messages_today {st['messages_today']}",
            "# TYPE aegis_online_chats gauge", f"aegis_online_chats {sum(len(v) for v in hub.chats.values())}",
            "# TYPE aegis_online_devices gauge", f"aegis_online_devices {len(hub.devices)}",
            "# TYPE aegis_reminders_pending gauge", f"aegis_reminders_pending {st['reminders_pending']}",
        ]
        for k, v in sorted(metrics.items()):
            lines += [f"# TYPE aegis_{k} counter", f"aegis_{k} {v}"]
        return PlainTextResponse("\n".join(lines) + "\n")

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
        user = user_for_token(str(first.get("token", "")))
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
        chat_tz[uid] = tz
        metrics["ws_chat_connections_total"] += 1
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
                if sess.client is None and agent.client is None and meeting.server_has_key():
                    # No Claude key and no personal AI settings, but the owner gave the server a Groq key: use Groq.
                    gcfg = providers.parse_config({"provider": "groq", "model": settings.GROQ_MODEL}, settings.MODEL, settings.MAX_TOKENS)
                    sess.client, sess.cfg = providers.build_client(gcfg), gcfg
                if sess.client is None and agent.client is None:
                    db.refund(uid)
                    await send({"type": "error", "text": "No AI is set up yet. Open Settings > AI Provider and add your API key."})
                    return
                reply = await agent.run(sess, text, send)
                # saved together and only on success, so a failed or stopped turn never leaves a lonely user message behind
                db.add_message(uid, "user", text)
                db.add_message(uid, "assistant", reply)
                metrics["chat_messages_total"] += 1
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
                metrics["chat_errors_total"] += 1
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
                    "brief": chief.brief(db, uid, tz),
                    "bond": {k: v for k, v in heart.bond_level(db.bond_row(uid), len(db.facts(uid))).items() if k != "tone"},
                }
            )
            await deliver_reminders(uid)  # anything that came due while the user was away
            await deliver_alerts(uid)
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
                        sess.tz = chat_tz[uid] = str(msg["tz"])[:64]
                    sess.voice = bool(msg.get("voice"))
                    sess.callme = " ".join(str(msg.get("callme", "")).split())[:30]
                    sess.lang = "".join(ch for ch in str(msg.get("lang", "")).lower() if ch.isalpha() or ch == "-")[:16]
                    v = msg.get("vibe") if isinstance(msg.get("vibe"), dict) else {}
                    sess.vibe = {k: v[k] for k, ok in (("pace", ("slow", "normal", "fast")), ("energy", ("low", "normal", "high"))) if v.get(k) in ok}
                    if v.get("hesitant") is True:
                        sess.vibe["hesitant"] = True
                    sess.deep = msg.get("deep") is True
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
                elif kind == "wrap" and not sess.busy:
                    async def do_wrap():
                        try:
                            await get_agent().recap(sess)
                        except Exception:
                            log.exception("recap failed")  # a recap is a nicety: it must never disturb the chat
                    t = asyncio.create_task(do_wrap())
                    tasks.add(t)
                    t.add_done_callback(tasks.discard)
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
            if uid not in hub.chats:
                chat_tz.pop(uid, None)

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
        icons_dir = settings.WEB_DIR / "icons"
        if icons_dir.is_dir():
            def icon_file(name: str):
                p = icons_dir / name
                if "/" in name or "\\" in name or not p.is_file():
                    raise HTTPException(404)
                return FileResponse(p)
            app.add_api_route("/icons/{name}", icon_file, include_in_schema=False)
        if (settings.WEB_DIR / "index.html").is_file():
            app.add_api_route("/", serve("index.html"), include_in_schema=False)
    return app
