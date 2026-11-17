import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

os.environ["AEGIS_JWT_SECRET"] = "test-secret-test-secret-test-secret-0123456789"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from app import settings  # noqa: E402
from app.main import create_app  # noqa: E402


# ---------- fake Claude ----------
def resp(*blocks):
    return SimpleNamespace(content=list(blocks))


def tool(id_, name, **inp):
    return SimpleNamespace(type="tool_use", id=id_, name=name, input=inp)


def text(t):
    return SimpleNamespace(type="text", text=t)


class FakeClient:
    def __init__(self, script=()):
        self.script = list(script)
        self.calls = []
        self.messages = self

    async def create(self, **kw):
        kw["messages"] = list(kw["messages"])  # snapshot: the server keeps mutating its list
        self.calls.append(kw)
        if not self.script:
            raise RuntimeError("fake AI out of responses")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture
def env(tmp_path):
    fake = FakeClient()
    app = create_app(client=fake, db_path=str(tmp_path / "t.db"))
    # Context-manager form shares ONE event loop across websockets, like a real server.
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, fake=fake)


def register(c, email="a@example.com", pw="password123"):
    r = c.post("/api/register", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def connect(c, token, role="chat"):
    ws = c.websocket_connect("/ws")
    s = ws.__enter__()
    s.send_json({"type": "auth", "token": token, "role": role})
    return ws, s


def drain_until(s, kind):
    for _ in range(30):
        m = s.receive_json()
        if m["type"] == kind:
            return m
    raise AssertionError(f"never saw {kind}")


# ---------- REST ----------
def test_register_login_me(env):
    c = env.client
    token = register(c)
    assert c.post("/api/register", json={"email": "a@example.com", "password": "password123"}).status_code == 409
    assert c.post("/api/register", json={"email": "bad", "password": "password123"}).status_code == 400
    assert c.post("/api/register", json={"email": "b@example.com", "password": "short"}).status_code == 400
    assert c.post("/api/login", json={"email": "a@example.com", "password": "wrongwrong"}).status_code == 401
    t2 = c.post("/api/login", json={"email": "A@Example.com", "password": "password123"}).json()["token"]
    me = c.get("/api/me", headers=auth(t2)).json()
    assert me["email"] == "a@example.com" and me["plan"] == "free" and me["device"] is False
    assert c.get("/api/me").status_code == 401
    assert c.get("/api/me", headers=auth("garbage")).status_code == 401
    assert token


def test_login_throttle(env):
    c = env.client
    register(c)
    codes = [c.post("/api/login", json={"email": "a@example.com", "password": "nope-nope"}).status_code for _ in range(12)]
    assert 429 in codes


def test_security_headers(env):
    r = env.client.get("/healthz")
    assert r.headers["x-frame-options"] == "DENY"
    assert "default-src 'self'" in r.headers["content-security-policy"]


# ---------- websocket auth ----------
def test_ws_rejects_bad_token(env):
    with env.client.websocket_connect("/ws") as s:
        s.send_json({"type": "auth", "token": "bad"})
        with pytest.raises(WebSocketDisconnect) as e:
            s.receive_json()
        assert e.value.code == 4401


# ---------- chat + memory ----------
def test_chat_remember_and_memory_api(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [
        resp(tool("1", "remember", fact="Sister's birthday is Friday")),
        resp(text("Got it, I'll remember that.")),
    ]
    ws, s = connect(c, token)
    try:
        hello = s.receive_json()
        assert hello["type"] == "hello" and hello["device"] is False
        s.send_json({"type": "chat", "text": "remember my sister's birthday is Friday"})
        assert drain_until(s, "tool")["name"] == "remember"
        reply = drain_until(s, "reply")
        assert reply["text"] == "Got it, I'll remember that." and reply["used"] == 1
    finally:
        ws.__exit__(None, None, None)
    facts = c.get("/api/memory", headers=auth(token)).json()
    assert facts[0]["text"] == "Sister's birthday is Friday"
    # system prompt of the first call must tell the AI there is no desktop, and expose no desktop tools
    first = fake.calls[0]
    assert "NOT connected" in first["system"]
    from app import tools as tool_catalogue
    assert {t["name"] for t in first["tools"]} == {t.name for t in tool_catalogue.TOOLS if t.where == "server"}
    assert c.delete(f"/api/memory/{facts[0]['id']}", headers=auth(token)).status_code == 200
    assert c.get("/api/memory", headers=auth(token)).json() == []


def test_memory_is_per_user(env):
    c = env.client
    t1, t2 = register(c, "a@example.com"), register(c, "b@example.com")
    env.fake.script = [resp(tool("1", "remember", fact="secret of A")), resp(text("ok"))]
    ws, s = connect(c, t1)
    s.receive_json()
    s.send_json({"type": "chat", "text": "remember"})
    drain_until(s, "reply")
    ws.__exit__(None, None, None)
    assert c.get("/api/memory", headers=auth(t2)).json() == []


def test_history_persisted_and_sent_on_reconnect(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [resp(text("hello there"))]
    ws, s = connect(c, token)
    s.receive_json()
    s.send_json({"type": "chat", "text": "hi"})
    drain_until(s, "reply")
    ws.__exit__(None, None, None)
    ws, s = connect(c, token)
    hello = s.receive_json()
    ws.__exit__(None, None, None)
    assert [m["role"] for m in hello["history"]] == ["user", "assistant"]


# ---------- quota ----------
def test_daily_quota_and_refund_on_ai_failure(env, monkeypatch):
    monkeypatch.setitem(settings.PLAN_LIMITS, "free", 2)
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [RuntimeError("boom"), resp(text("one")), resp(text("two"))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "a"})
        assert "problem" in drain_until(s, "error")["text"]  # failed call is refunded
        s.send_json({"type": "chat", "text": "b"})
        assert drain_until(s, "reply")["used"] == 1
        s.send_json({"type": "chat", "text": "c"})
        assert drain_until(s, "reply")["used"] == 2
        s.send_json({"type": "chat", "text": "d"})
        assert "Daily limit" in drain_until(s, "error")["text"]
    finally:
        ws.__exit__(None, None, None)


# ---------- desktop device routing ----------
def test_device_tool_roundtrip(env):
    c, fake = env.client, env.fake
    token = register(c)
    dws, dev = connect(c, token, "device")
    assert dev.receive_json()["type"] == "ready"
    fake.script = [
        resp(tool("1", "system_health")),
        resp(text("Your PC is healthy.")),
    ]
    cws, chat = connect(c, token)
    try:
        hello = chat.receive_json()
        assert hello["device"] is True
        chat.send_json({"type": "chat", "text": "check my system"})
        req = dev.receive_json()
        assert req["type"] == "tool_request" and req["name"] == "system_health"
        dev.send_json({"type": "tool_result", "id": req["id"], "result": "cpu=5%"})
        assert drain_until(chat, "reply")["text"] == "Your PC is healthy."
        # the tool result reached the model
        last_user = fake.calls[1]["messages"][-1]["content"][0]
        assert last_user["content"] == "cpu=5%"
        assert "system_health" in {t["name"] for t in fake.calls[0]["tools"]}
    finally:
        cws.__exit__(None, None, None)
        dws.__exit__(None, None, None)


def test_risky_tool_needs_approval_and_decline_blocks_it(env):
    c, fake = env.client, env.fake
    token = register(c)
    dws, dev = connect(c, token, "device")
    dev.receive_json()
    fake.script = [
        resp(tool("1", "delete_file", path="~/Documents/x.txt")),
        resp(text("Okay, I left it alone.")),
    ]
    cws, chat = connect(c, token)
    try:
        chat.receive_json()
        chat.send_json({"type": "chat", "text": "delete x.txt"})
        conf = drain_until(chat, "confirm")
        assert conf["tool"] == "delete_file"
        chat.send_json({"type": "confirm_response", "id": conf["id"], "ok": False})
        assert drain_until(chat, "reply")["text"] == "Okay, I left it alone."
        declined = fake.calls[1]["messages"][-1]["content"][0]["content"]
        assert "declined" in declined
    finally:
        cws.__exit__(None, None, None)
        dws.__exit__(None, None, None)


def test_risky_tool_approved_runs_on_device(env):
    c, fake = env.client, env.fake
    token = register(c)
    dws, dev = connect(c, token, "device")
    dev.receive_json()
    fake.script = [resp(tool("1", "write_file", path="~/Documents/n.txt", content="hi")), resp(text("Saved."))]
    cws, chat = connect(c, token)
    try:
        chat.receive_json()
        chat.send_json({"type": "chat", "text": "write a note"})
        conf = drain_until(chat, "confirm")
        chat.send_json({"type": "confirm_response", "id": conf["id"], "ok": True})
        req = dev.receive_json()
        assert req["name"] == "write_file" and req["args"]["content"] == "hi"
        dev.send_json({"type": "tool_result", "id": req["id"], "result": "Wrote 2 chars"})
        assert drain_until(chat, "reply")["text"] == "Saved."
    finally:
        cws.__exit__(None, None, None)
        dws.__exit__(None, None, None)


def test_other_users_cannot_answer_my_confirmation(env):
    c, fake = env.client, env.fake
    t1, t2 = register(c, "a@example.com"), register(c, "b@example.com")
    dws, dev = connect(c, t1, "device")
    dev.receive_json()
    fake.script = [resp(tool("1", "delete_file", path="~/Documents/x")), resp(text("done"))]
    c1ws, chat1 = connect(c, t1)
    c2ws, chat2 = connect(c, t2)
    try:
        chat1.receive_json()
        chat2.receive_json()
        chat1.send_json({"type": "chat", "text": "delete"})
        conf = drain_until(chat1, "confirm")
        chat2.send_json({"type": "confirm_response", "id": conf["id"], "ok": True})  # attacker approves
        chat1.send_json({"type": "confirm_response", "id": conf["id"], "ok": False})  # owner declines
        drain_until(chat1, "reply")
        assert "declined" in fake.calls[1]["messages"][-1]["content"][0]["content"]
    finally:
        for w in (c1ws, c2ws, dws):
            w.__exit__(None, None, None)


def test_agent_step_cap(env, monkeypatch):
    monkeypatch.setattr(settings, "MAX_AGENT_STEPS", 3)
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [resp(tool(str(i), "current_time")) for i in range(5)]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "loop"})
        assert "too many steps" in drain_until(s, "reply")["text"]
    finally:
        ws.__exit__(None, None, None)


def test_failed_turn_does_not_corrupt_history(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [resp(tool("1", "current_time")), RuntimeError("boom"), resp(text("fine"))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "first"})
        drain_until(s, "error")
        s.send_json({"type": "chat", "text": "second"})
        assert drain_until(s, "reply")["text"] == "fine"
        msgs = fake.calls[-1]["messages"]
        assert [m["role"] for m in msgs] == ["user"]  # failed turn fully rolled back
    finally:
        ws.__exit__(None, None, None)


# ---------- pages ----------
def test_landing_and_app_pages(env):
    c = env.client
    home = c.get("/")
    assert home.status_code == 200 and "Start free" in home.text and "landing.js" in home.text
    app_page = c.get("/app.html")
    assert app_page.status_code == 200 and 'id="auth"' in app_page.text and 'id="composer"' in app_page.text
    r = c.get("/app", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/app.html"
    for f in ("/app.js", "/style.css", "/landing.css", "/landing.js"):
        assert c.get(f).status_code == 200, f
    # api routes must not be swallowed by the static mount
    assert c.get("/api/config").json()["app_name"] == "Aegis"


# ---------- frontend on another site (GitHub Pages) ----------
PAGES = "https://youknowumer.github.io"


@pytest.fixture
def cors_env(tmp_path):
    fake = FakeClient()
    app = create_app(client=fake, db_path=str(tmp_path / "c.db"), allowed_origins=[PAGES + "/"])
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, fake=fake)


def test_cors_preflight_and_headers_for_allowed_origin(cors_env):
    c = cors_env.client
    pre = c.options(
        "/api/login",
        headers={
            "Origin": PAGES,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )
    assert pre.status_code == 200
    assert pre.headers["access-control-allow-origin"] == PAGES
    r = c.post("/api/register", json={"email": "p@example.com", "password": "password123"}, headers={"Origin": PAGES})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == PAGES


def test_cors_not_granted_to_other_sites(cors_env):
    r = cors_env.client.get("/api/config", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_no_cors_headers_when_not_configured(env):
    r = env.client.get("/api/config", headers={"Origin": PAGES})
    assert "access-control-allow-origin" not in r.headers


def test_ws_origin_check(cors_env):
    c = cors_env.client
    token = register(c)
    # allowed website
    with c.websocket_connect("/ws", headers={"Origin": PAGES}) as s:
        s.send_json({"type": "auth", "token": token, "role": "chat"})
        assert s.receive_json()["type"] == "hello"
    # a random website cannot open the socket, even with a valid token
    with c.websocket_connect("/ws", headers={"Origin": "https://evil.example"}) as s:
        with pytest.raises(WebSocketDisconnect) as e:
            s.send_json({"type": "auth", "token": token, "role": "chat"})
            s.receive_json()
        assert e.value.code == 4403
    # no Origin header (the Electron desktop app) still works
    with c.websocket_connect("/ws") as s:
        s.send_json({"type": "auth", "token": token, "role": "device"})
        assert s.receive_json()["type"] == "ready"


# ---------- UI events ----------
def test_tool_events_have_id_and_completion(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [resp(tool("t1", "current_time")), resp(text("It is time."))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "time?"})
        start = drain_until(s, "tool")
        assert start["id"] == "t1" and start["name"] == "current_time" and start["risky"] is False
        done = drain_until(s, "tool_done")
        assert done["id"] == "t1" and done["ok"] is True
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)


def test_declined_tool_reports_not_ok(env):
    c, fake = env.client, env.fake
    token = register(c)
    dws, dev = connect(c, token, "device")
    dev.receive_json()
    fake.script = [resp(tool("d1", "delete_file", path="~/Documents/x")), resp(text("ok"))]
    cws, chat = connect(c, token)
    try:
        chat.receive_json()
        chat.send_json({"type": "chat", "text": "delete"})
        start = drain_until(chat, "tool")
        assert start["risky"] is True
        conf = drain_until(chat, "confirm")
        chat.send_json({"type": "confirm_response", "id": conf["id"], "ok": False})
        assert drain_until(chat, "tool_done")["ok"] is False
    finally:
        cws.__exit__(None, None, None)
        dws.__exit__(None, None, None)


# ---------- web search (opt-in) ----------
def test_web_search_tool_only_when_enabled(env, monkeypatch):
    c, fake = env.client, env.fake
    token = register(c)
    monkeypatch.setattr(settings, "WEB_SEARCH", True)
    fake.script = [resp(text("Rain in Lahore."))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "weather in Lahore"})
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    tools_sent = fake.calls[0]["tools"]
    assert any(t.get("type") == "web_search_20250305" and t["name"] == "web_search" for t in tools_sent)
    assert "search the web" in fake.calls[0]["system"]
    # the device tool no longer shares the name with Anthropic's web_search
    assert "browser_search" not in {t["name"] for t in tools_sent}  # no desktop connected here


def test_pause_turn_continues_the_loop(env):
    c, fake = env.client, env.fake
    token = register(c)
    paused = SimpleNamespace(content=[text("Searching...")], stop_reason="pause_turn")
    fake.script = [paused, resp(text("Final answer."))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "news"})
        assert drain_until(s, "reply")["text"] == "Final answer."
    finally:
        ws.__exit__(None, None, None)
    assert len(fake.calls) == 2


def test_config_endpoint_reports_features(env):
    j = env.client.get("/api/config").json()
    assert j["app_name"] == "Aegis" and j["web_search"] is False


def test_server_serves_all_frontend_files(env):
    c = env.client
    for name in ("config.js", "orb.js", "app.js", "style.css", "landing.js", "landing.css"):
        r = c.get("/" + name)
        assert r.status_code == 200, name
    assert "AEGIS_CONFIG" in c.get("/config.js").text
    for private in ("/server/app/main.py", "/aegis.db", "/.env", "/README.md"):
        assert c.get(private).status_code == 404, private


def test_safe_calc():
    from app.utilities import safe_calc
    assert safe_calc("2+3*4") == "14"
    assert safe_calc("(10+5)/4") == "3.75"
    assert safe_calc("2^10") == "1024"
    assert safe_calc("sqrt(144)+abs(-3)") == "15"
    assert safe_calc("15% of 200".replace("% of", "/100*")) == "30"
    assert safe_calc("1/0").startswith("Error")
    assert safe_calc("__import__('os').system('id')").startswith("Error")
    assert safe_calc("9**9**9").startswith("Error")


def test_new_tools_registered():
    from app import tools
    assert {"calculate", "get_weather"} <= {t["name"] for t in tools.schemas(False)}


# ---------- streaming, stop, tasks, reminders, notes, web safety ----------
class _Stream:
    def __init__(self, final, chunks):
        self.final, self.chunks = final, chunks

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def __aiter__(self):
        async def gen():
            for c in self.chunks:
                yield SimpleNamespace(type="text", text=c)
        return gen()

    async def get_final_message(self):
        return self.final


class FakeStreamClient:
    """Mimics anthropic.AsyncAnthropic().messages.stream(...)."""

    def __init__(self, script):
        self.script = list(script)
        self.messages = self

    def stream(self, **kw):
        final, chunks = self.script.pop(0)
        return _Stream(final, chunks)


def test_reply_is_streamed_in_deltas(tmp_path):
    fake = FakeStreamClient([(resp(text("Hello there")), ["Hel", "lo ", "there"])])
    app = create_app(client=fake, db_path=str(tmp_path / "s.db"))
    with TestClient(app) as c:
        token = register(c)
        ws, s = connect(c, token)
        try:
            s.receive_json()
            s.send_json({"type": "chat", "text": "hi"})
            seen = []
            for _ in range(20):
                m = s.receive_json()
                seen.append(m)
                if m["type"] == "reply":
                    break
            assert "".join(m["text"] for m in seen if m["type"] == "delta") == "Hello there"
            assert seen[-1]["text"] == "Hello there"
        finally:
            ws.__exit__(None, None, None)


def test_stop_cancels_and_refunds(tmp_path):
    import asyncio

    class Slow:
        def __init__(self):
            self.messages = self

        async def create(self, **kw):
            await asyncio.sleep(30)

    app = create_app(client=Slow(), db_path=str(tmp_path / "x.db"))
    with TestClient(app) as c:
        token = register(c)
        ws, s = connect(c, token)
        try:
            s.receive_json()
            s.send_json({"type": "chat", "text": "think hard"})
            s.send_json({"type": "stop"})
            assert drain_until(s, "stopped")["type"] == "stopped"
            assert c.get("/api/me", headers=auth(token)).json()["used"] == 0
            # the session is usable again afterwards
            s.send_json({"type": "chat", "text": "again"})
            s.send_json({"type": "stop"})
            drain_until(s, "stopped")
        finally:
            ws.__exit__(None, None, None)


def test_task_reminder_note_tools_via_chat(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [
        resp(tool("1", "add_task", text="Buy milk"), tool("2", "set_reminder", text="Call mum", in_minutes=30), tool("3", "save_note", title="Idea", content="Build Aegis mobile app")),
        resp(tool("4", "list_tasks"), tool("5", "list_reminders"), tool("6", "search_notes", query="aegis")),
        resp(text("All set.")),
    ]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "plan my evening", "tz": "Asia/Karachi"})
        assert drain_until(s, "reply")["text"] == "All set."
    finally:
        ws.__exit__(None, None, None)
    h = auth(token)
    assert [t["text"] for t in c.get("/api/tasks", headers=h).json()] == ["Buy milk"]
    assert [r["text"] for r in c.get("/api/reminders", headers=h).json()] == ["Call mum"]
    assert c.get("/api/notes", headers=h).json()[0]["title"] == "Idea"
    # the tool results fed back to the model
    results = fake.calls[2]["messages"][-1]["content"]
    assert "Buy milk" in results[0]["content"] and "Call mum" in results[1]["content"] and "Aegis mobile app" in results[2]["content"]
    # the system prompt carries the user's own local time zone
    assert "Asia/Karachi" in fake.calls[0]["system"]


def test_tasks_rest_and_isolation(env):
    c = env.client
    t1, t2 = register(c, "a@example.com"), register(c, "b@example.com")
    tid = c.post("/api/tasks", json={"text": "  Pay rent  "}, headers=auth(t1)).json()["id"]
    assert c.post("/api/tasks", json={"text": "   "}, headers=auth(t1)).status_code == 400
    assert c.post(f"/api/tasks/{tid}", json={"done": True}, headers=auth(t1)).status_code == 200
    assert c.get("/api/tasks", headers=auth(t1)).json()[0]["done"] == 1
    assert c.get("/api/tasks", headers=auth(t2)).json() == []
    assert c.delete(f"/api/tasks/{tid}", headers=auth(t2)).status_code == 404
    assert c.delete(f"/api/tasks/{tid}", headers=auth(t1)).status_code == 200


def test_due_reminder_is_pushed_on_connect(env):
    import time as _t

    c = env.client
    token = register(c)
    uid = 1  # first registered user in a fresh database
    c.app.state.db.add_reminder(uid, "Take medicine", _t.time() - 5)
    ws, s = connect(c, token)
    try:
        s.receive_json()
        m = drain_until(s, "reminder")
        assert m["text"] == "Take medicine"
    finally:
        ws.__exit__(None, None, None)
    assert c.get("/api/reminders", headers=auth(token)).json() == []  # fired once, not repeated


def test_fetch_url_refuses_private_addresses():
    from app import utilities

    for bad in ("http://127.0.0.1:8000/", "http://localhost/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "file:///etc/passwd", "ftp://example.com/x"):
        assert utilities.fetch_page(bad).startswith("Error"), bad


def test_resolve_due():
    from datetime import datetime, timezone
    from app import utilities

    now = datetime(2026, 11, 17, 10, 0, tzinfo=timezone.utc)  # 15:00 in Karachi
    ts, human = utilities.resolve_due({"in_minutes": 20}, "Asia/Karachi", now)
    assert ts == now.timestamp() + 1200
    ts, human = utilities.resolve_due({"at": "09:00"}, "Asia/Karachi", now)  # already past today -> tomorrow
    assert "Wednesday 18 November, 09:00" == human
    ts, human = utilities.resolve_due({"at": "2026-11-17 18:30"}, "Asia/Karachi", now)
    assert "18:30" in human
    for bad in ({}, {"in_minutes": -5}, {"in_minutes": "soon"}, {"at": "2026-11-17 09:00"}, {"at": "25:00"}, {"at": "banana"}):
        with pytest.raises(ValueError):
            utilities.resolve_due(bad, "Asia/Karachi", now)


def test_html_to_text_drops_scripts_and_nav():
    from app import utilities

    title, text = utilities.html_to_text("<html><title>Hi</title><nav>menu</nav><script>evil()</script><p>Hello <b>world</b></p></html>")
    assert title == "Hi" and text == "Hello world"
