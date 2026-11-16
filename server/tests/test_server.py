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
    assert {t["name"] for t in first["tools"]} == {"remember", "recall", "forget", "current_time"}
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
    assert home.status_code == 200 and "Get started" in home.text and "landing.js" in home.text
    app_page = c.get("/app.html")
    assert app_page.status_code == 200 and 'id="auth"' in app_page.text and 'id="composer"' in app_page.text
    r = c.get("/app", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/app.html"
    for f in ("/app.js", "/style.css", "/landing.css", "/landing.js"):
        assert c.get(f).status_code == 200, f
    # api routes must not be swallowed by the static mount
    assert c.get("/api/config").json()["app_name"] == "Aegis"
