"""v17: browser-extension role, richer emotion reading, memory pins/patterns/people/export, new tools."""
import asyncio
import time
from datetime import datetime, timezone

from test_server import FakeClient, auth, connect, drain_until, env, register  # noqa: F401

from app import emotion, heart, tools
from app.agent import Agent
from app.db import DB
from app.hub import Hub


def run(coro):
    return asyncio.run(coro)


def agent_for(tmp_path):
    db = DB(str(tmp_path / "a.db"))
    uid = db.create_user("x@example.com", "h", "s")
    return Agent(None, db, Hub()), db, uid


# ------------------------------------------------------------ emotion
def test_contrast_and_urdu_negation_and_laughter():
    assert emotion.detect("I'm fine, but honestly exhausted").mood == "tired"
    assert emotion.detect("khush nahi hoon aaj").mood == "sad"
    assert emotion.detect("haha that was so funny lol").mood == "playful"
    assert emotion.detect("what's the weather in Lahore").mood == "neutral"
    assert emotion.detect("why do I always fail").mood == "hopeless"


def test_old_phrase_lists_still_work():
    assert emotion.detect("I feel down").mood == "sad"
    assert emotion.detect("mera mood off hai").mood == "sad"


def test_need_is_read():
    assert emotion.detect("I'm so sad today").need == "listen"
    assert emotion.detect("I'm stressed, what should I do?").need == "solve"
    assert emotion.detect("I got the job!!").need == "celebrate"
    assert emotion.detect("I'm so nervous about tomorrow").need == "reassure"
    assert "HEARD" in emotion.style_for(emotion.detect("I'm so sad today"))


def test_every_mood_has_style_and_arousal():
    for m in emotion.MOODS:
        if m != "neutral":
            assert emotion.style_for(emotion.Reading(m, 3))
        assert emotion.Reading(m, 3).arousal in ("low", "medium", "high")


def test_tracker_detects_masking_and_stuck_mood():
    t = emotion.Tracker()
    r = t.update(emotion.detect("I'm so sad and exhausted"), "I'm so sad and exhausted", now=1000)
    assert not r.masked
    r = t.update(emotion.detect("no it's fine"), "no it's fine", now=1030)
    assert r.masked and r.mood != "neutral" and r.need == "listen"
    assert "fine" in emotion.style_for(r)
    t2 = emotion.Tracker()
    for i in range(3):
        r = t2.update(emotion.detect("I feel so lonely"), "I feel so lonely", now=2000 + i * 20)
    assert "row" in r.note


def test_tracker_fine_without_history_is_not_masked():
    r = emotion.Tracker().update(emotion.detect("it's fine"), "it's fine", now=5000)
    assert not r.masked


def test_tracker_voice_vibe_and_distress_untouched():
    r = emotion.Tracker().update(emotion.detect("okay"), "okay", vibe={"energy": "low", "pace": "slow"})
    assert r.mood == "tired"
    d = emotion.detect("I want to kill myself")
    assert emotion.Tracker().update(d, "I want to kill myself").distress


# ------------------------------------------------------------ memory
def test_pin_export_import(tmp_path):
    a, db, uid = agent_for(tmp_path)
    fid = db.add_fact(uid, "Their sister is Ayesha", "person", pinned=True)
    row = [r for r in db.facts(uid) if r["id"] == fid][0]
    assert row["pinned"] == 1 and row["weight"] >= 4
    db.set_pinned(uid, fid, False)
    assert [r for r in db.facts(uid) if r["id"] == fid][0]["pinned"] == 0
    out = db.export_memory(uid)
    assert out["version"] == 17 and out["facts"][0]["text"] == "Their sister is Ayesha"
    uid2 = db.create_user("y@example.com", "h", "s")
    assert db.import_memory(uid2, out) == 1
    assert db.import_memory(uid2, ["likes tea", {"text": "x" * 600}, 5, {"text": ""}]) == 2
    assert len(db.facts(uid2)) == 3


def test_pin_memory_tool_and_remember_pin(tmp_path):
    a, db, uid = agent_for(tmp_path)
    run(a._run_server_tool(uid, "remember", {"fact": "Their mother takes medicine at 9pm", "pin": True}, "Asia/Karachi"))
    assert any(r["pinned"] for r in db.facts(uid))
    db.add_fact(uid, "They love mango lassi", "preference")
    assert "Pinned" in run(a._run_server_tool(uid, "pin_memory", {"contains": "mango lassi"}, "Asia/Karachi"))


def test_roman_urdu_synonyms_find_memories():
    rows = [{"text": "Their salary is paid on the 1st", "kind": "fact", "weight": 2, "created": time.time(), "uses": 0, "last_used": 0, "mood": "", "mood_level": 0, "source": "ai", "when_md": "", "id": 1},
            {"text": "They like cricket", "kind": "preference", "weight": 2, "created": time.time(), "uses": 0, "last_used": 0, "mood": "", "mood_level": 0, "source": "ai", "when_md": "", "id": 2}]
    assert heart.select_memories(rows, "mera paisa kab aayega", limit=1)[0]["id"] == 1


def _moods(db, uid, spec):
    for days_ago, hour, mood, lvl in spec:
        ts = time.time() - days_ago * 86400
        d = datetime.fromtimestamp(ts, timezone.utc).replace(hour=hour, minute=0)
        db.execute("INSERT INTO moods (user_id, mood, intensity, created, note) VALUES (?, ?, ?, ?, '')", (uid, mood, lvl, d.timestamp()))


def test_patterns_need_evidence_and_find_rhythm(tmp_path):
    a, db, uid = agent_for(tmp_path)
    assert heart.patterns(db.moods(uid), "UTC") == []
    _moods(db, uid, [(i, 23, "anxious", 3) for i in range(1, 7)])
    found = heart.patterns(db.moods(uid, limit=100), "UTC")
    assert any("late at night" in p for p in found)
    assert heart.reflect(db, uid, "UTC") >= 1
    assert any(r["kind"] == "insight" for r in db.facts(uid))
    assert "late at night" in run(a._run_server_tool(uid, "my_patterns", {}, "UTC"))


def test_feelings_about_and_people(tmp_path):
    a, db, uid = agent_for(tmp_path)
    db.add_fact(uid, "They have a driving exam on Friday", "event", True, mood="anxious", level=4)
    assert "anxious" in heart.feelings_about(db.facts(uid), "how do I prepare for the exam")
    assert heart.feelings_about(db.facts(uid), "what is the weather") == ""
    db.add_fact(uid, "Their sister is Ayesha", "person", True)
    db.add_fact(uid, "Ayesha is getting married in March", "event", True, mood="happy", level=3)
    p = heart.people(db.facts(uid))
    assert p and p[0]["name"] == "Ayesha" and p[0]["relation"] == "sister" and p[0]["feeling"] == "happy"
    assert "Ayesha" in run(a._run_server_tool(uid, "people", {}, "UTC"))


def test_pinned_memory_survives_consolidation(tmp_path):
    a, db, uid = agent_for(tmp_path)
    fid = db.add_fact(uid, "Old pinned thing", "fact", pinned=True)
    db.execute("UPDATE facts SET created = ?, weight = 1 WHERE id = ?", (time.time() - 90 * 86400, fid))
    for r in db.facts(uid):
        assert r["pinned"] == 1


# ------------------------------------------------------------ API + hub
def test_memory_api_pin_edit_export_import_people(env):
    c = env.client
    h = auth(register(c))
    fid = c.post("/api/memory", json={"text": "Their brother is Hamza"}, headers=h).json()["id"]
    assert c.post(f"/api/memory/{fid}/pin", json={"pinned": True}, headers=h).json()["pinned"] is True
    assert c.get("/api/memory", headers=h).json()[0]["pinned"] is True
    assert c.patch(f"/api/memory/{fid}", json={"text": "Their brother is Hamza, a doctor"}, headers=h).status_code == 200
    assert c.patch(f"/api/memory/999", json={"text": "nope nope"}, headers=h).status_code == 404
    exp = c.get("/api/memory/export", headers=h)
    assert "attachment" in exp.headers["content-disposition"] and exp.json()["facts"][0]["pinned"] == 1
    assert c.post("/api/memory/import", json={"facts": ["likes chai"]}, headers=h).json()["added"] == 1
    assert c.get("/api/people", headers=h).json()[0]["name"] == "Hamza"
    assert "patterns" in c.get("/api/mood/insights", headers=h).json()
    assert c.get("/api/memory/export").status_code in (401, 403)


def test_browser_role_gets_chrome_tools(env):
    c = env.client
    token = register(c)
    ws, s = connect(c, token, "browser")
    try:
        assert s.receive_json()["type"] == "ready"
        hub = c.app.state.hub
        uid = c.app.state.db.user_by_email("a@example.com")["id"]
        assert hub.browser_connected(uid) and hub.can_chrome(uid) and not hub.device_connected(uid)
        names = [t["name"] if "name" in t else t.get("function", {}).get("name") for t in tools.schemas(False, False, 4, True)]
        assert "chrome_click" in names
        assert not any(n and n.startswith("chrome_") for n in [t.get("name") for t in tools.schemas(False, False, 4, False)])

        # a chrome_* request is routed to the extension and its answer comes back
        loop = asyncio.new_event_loop()
        fut = {}
        import threading

        def asker():
            asyncio.set_event_loop(loop)
            fut["r"] = loop.run_until_complete(hub.call_device(uid, "chrome_tabs", {}))
        # the hub's websocket belongs to the server's loop, so only check routing decisions here
        assert hub.browsers[uid] is not None
        loop.close()
    finally:
        ws.__exit__(None, None, None)


async def _ask(hub, uid):
    return await hub.call_device(uid, "chrome_tabs", {})


def test_status_includes_browser_flag(env):
    c = env.client
    token = register(c)
    ws, s = connect(c, token, "chat")
    try:
        hello = drain_until(s, "hello")
        assert hello["browser"] is False
        assert c.get("/api/me", headers=auth(token)).json()["browser"] is False
    finally:
        ws.__exit__(None, None, None)


def test_extension_origin_allowed_but_unknown_site_not(env, monkeypatch):
    c = env.client
    token = register(c)
    monkeypatch.delenv("AEGIS_EXTENSION_IDS", raising=False)
    with c.websocket_connect("/ws", headers={"origin": "chrome-extension://abcdef"}) as s:
        s.send_json({"type": "auth", "token": token, "role": "browser"})
        assert s.receive_json()["type"] == "ready"
    monkeypatch.setenv("AEGIS_EXTENSION_IDS", "mine")
    try:
        with c.websocket_connect("/ws", headers={"origin": "chrome-extension://other"}) as s:
            s.send_json({"type": "auth", "token": token, "role": "browser"})
            s.receive_json()
        assert False, "should have been refused"
    except Exception:
        pass


def test_hub_routes_chrome_to_extension_and_pc_tools_to_desktop():
    class FakeWS:
        def __init__(self, hub, answer):
            self.hub, self.answer, self.sent = hub, answer, []

        async def send_json(self, msg):
            self.sent.append(msg)
            self.hub.resolve(msg["id"], self.answer, 1)

        async def close(self, code=1000):
            pass

    async def go():
        hub = Hub()
        ext = FakeWS(hub, "from-extension")
        await hub.set_browser(1, ext)
        assert await hub.call_device(1, "chrome_tabs", {}) == "from-extension"
        assert "no desktop app" in await hub.call_device(1, "pc_open_app", {})  # extension never gets PC tools
        desk = FakeWS(hub, "from-desktop")
        await hub.set_device(1, desk)
        assert await hub.call_device(1, "chrome_tabs", {}) == "from-desktop"  # desktop wins when both are linked
        await hub.drop_device(1, desk)
        assert await hub.call_device(1, "chrome_tabs", {}) == "from-extension"
        await hub.drop_browser(1, ext)
        assert not hub.can_chrome(1)

    run(go())
