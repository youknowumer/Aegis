"""v8: Aegis identity, calendar, live markets, smart home (Home Assistant), studio voice (cloud TTS)."""
import time
from datetime import datetime, timedelta

import pytest

from app import smarthome, tools, tts, utilities
from app.db import DB
from test_assistant import run_tools
from test_server import auth, connect, drain_until, env, register, resp, text  # noqa: F401  (env is a fixture)


def _local(days=0, hour=15, minute=0, tz="Asia/Karachi"):
    d = utilities.now_in(tz) + timedelta(days=days)
    return d.replace(hour=hour, minute=minute, second=0, microsecond=0)


# ---------------------------------------------------------------- identity, languages, feelings
def test_persona_is_aegis_speaks_every_language_and_tags_emotions(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [resp(text("[warm] Hello."))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "hi", "tz": "Asia/Karachi"})
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    system = fake.calls[0]["system"]
    assert "You are Aegis" in system
    assert "jarvis" not in system.lower()
    assert "Every language" in system and "Roman Urdu" in system
    assert "Feelings" in system and "[empathy]" in system and "EVERY sentence" in system


def test_no_jarvis_left_in_the_product():
    """The assistant is called Aegis everywhere: code, UI, docs, deploy files. (Tests are skipped: they name the old word to check it is gone.)"""
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[2]
    skip_dirs = {"node_modules", "tests", "__pycache__", ".pytest_cache", ".git"}
    offenders = []
    for p in root.rglob("*"):
        if not p.is_file() or skip_dirs & set(p.relative_to(root).parts) or p.name == "package-lock.json":
            continue
        if p.suffix in {".py", ".js", ".html", ".css", ".md", ".yaml", ".yml", ".sh", ".bat", ".json", ".example", ".txt"} and "jarvis" in p.read_text(encoding="utf-8", errors="ignore").lower():
            offenders.append(str(p.relative_to(root)))
    assert not offenders, offenders


# ---------------------------------------------------------------- calendar
def test_events_roundtrip_overlap_and_listing(tmp_path):
    db = DB(str(tmp_path / "e.db"))
    now = time.time()
    a = db.add_event(1, "Team sync", now + 3600, now + 7200, "Office")
    db.add_event(1, "Dentist", now + 86400 * 3, now + 86400 * 3 + 1800)
    db.add_event(2, "Someone else's", now + 3600, now + 7200)
    assert [e["title"] for e in db.events_between(1, now, now + 86400)] == ["Team sync"]
    assert [e["title"] for e in db.events_between(1, now, now + 86400 * 7)] == ["Team sync", "Dentist"]
    assert [e["title"] for e in db.events_between(1, now, now + 86400 * 7, "dent")] == ["Dentist"]
    assert [e["title"] for e in db.events_between(1, now + 5400, now + 5500)] == ["Team sync"]   # already running then
    assert db.delete_events_matching(1, "dentist") == 1 and db.delete_event(2, a) == 0 and db.delete_event(1, a) == 1


def test_calendar_tools_via_the_agent(env):
    tmr = _local(1)
    out = run_tools(
        env,
        ("add_event", {"title": "Project review", "start": tmr.strftime("%Y-%m-%d %H:%M"), "duration_minutes": 90, "location": "Room 4", "remind_minutes_before": 30}),
        ("add_event", {"title": "Past thing", "start": "2020-01-01 10:00"}),
        ("add_event", {"title": "", "start": tmr.strftime("%Y-%m-%d %H:%M")}),
    )
    assert out[0].startswith("Added to your calendar: Project review") and "Room 4" in out[0] and "30 minutes before" in out[0]
    assert out[1].startswith("Error") and "past" in out[1]
    assert out[2].startswith("Error")


def test_list_filter_errors_and_delete_rules(env):
    d1 = _local(1, 15).strftime("%Y-%m-%d %H:%M")
    day = _local(1).strftime("%Y-%m-%d")
    out = run_tools(
        env,
        ("add_event", {"title": "Design review", "start": d1, "duration_minutes": 60}),
        ("list_events", {"date": day}),
        ("list_events", {"days": 3, "query": "nothing like this"}),
        ("list_events", {"date": "garbage"}),
    )
    assert out[0].startswith("Added")
    assert "Design review" in out[1] and "15:00-16:00" in out[1]
    assert out[2].startswith("Nothing on the calendar")
    assert out[3].startswith("Error")


def test_overlap_warning_and_briefing_lists_today(tmp_path):
    from app.agent import Agent
    from app.hub import Hub

    db = DB(str(tmp_path / "b.db"))
    ag = Agent(None, db, Hub())
    soon = utilities.now_in("Asia/Karachi") + timedelta(minutes=30)
    start = soon.strftime("%Y-%m-%d %H:%M")
    assert ag._add_event(1, {"title": "Standup", "start": start, "duration_minutes": 60}, "Asia/Karachi").startswith("Added")
    again = ag._add_event(1, {"title": "Call with Sara", "start": start, "duration_minutes": 30}, "Asia/Karachi")
    assert "overlaps with Standup" in again
    import asyncio

    assert tools.BY_NAME["delete_event"].is_risky()                       # deleting always asks the user first
    assert asyncio.run(ag._run_server_tool(1, "delete_event", {"contains": "x"}, "Asia/Karachi")).startswith("Error")
    brief = ag._blocking_tool(1, "daily_briefing", {}, "Asia/Karachi")
    if soon.date() == utilities.now_in("Asia/Karachi").date():
        assert "Today's calendar" in brief and "Standup" in brief
    else:  # the half hour crossed midnight: the briefing still must not crash
        assert "Today's calendar" in brief
    assert asyncio.run(ag._run_server_tool(1, "delete_event", {"contains": "call with"}, "Asia/Karachi")) == "Deleted 1 event(s)."
    assert asyncio.run(ag._run_server_tool(1, "delete_event", {"contains": "call with"}, "Asia/Karachi")).startswith("No upcoming event")


# ---------------------------------------------------------------- markets
def test_market_price_crypto_and_stock(monkeypatch):
    seen = []

    def fake_get(url):
        seen.append(url)
        if "simple/price" in url:
            return {"bitcoin": {"usd": 91234.5, "pkr": 25400000.0, "usd_24h_change": 1.2, "pkr_24h_change": 1.1}}
        return {"coins": [{"id": "pepe"}]}

    monkeypatch.setattr(utilities, "_get", fake_get)
    out = utilities.market_price("BTC", "auto", "pkr")
    assert out.startswith("BTC (bitcoin): ") and "PKR" in out and "USD" in out and "+1.10% in 24 hours" in out and "CoinGecko" in out
    monkeypatch.setattr(utilities, "_fetch_raw", lambda url, accept="", mb=0: "Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-11-20,22:00:19,200.00,212.0,199.0,210.00,1000\n")
    out = utilities.market_price("aapl")
    assert out.startswith("AAPL.US: 210.00 USD (+5.00% from today's open)") and "Stooq" in out


def test_market_price_unknowns_and_errors(monkeypatch):
    monkeypatch.setattr(utilities, "_fetch_raw", lambda *a, **k: "Symbol,Date,Time,Open,High,Low,Close,Volume\nZZZZ.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D\n")
    monkeypatch.setattr(utilities, "_get", lambda url: {"coins": []})
    assert utilities.market_price("zzzz").startswith("No price found")
    assert utilities.market_price("bad symbol!").startswith("Error")
    monkeypatch.setattr(utilities, "_get", lambda url: (_ for _ in ()).throw(OSError("down")))
    assert utilities.market_price("eth", "crypto").startswith("Error: the price service")


# ---------------------------------------------------------------- smart home
class FakeHA:
    def __init__(self):
        self.calls = []
        self.items = [
            {"entity_id": "light.bedroom", "state": "off", "attributes": {"friendly_name": "Bedroom Light"}},
            {"entity_id": "light.kitchen", "state": "on", "attributes": {"friendly_name": "Kitchen Light"}},
            {"entity_id": "lock.front_door", "state": "locked", "attributes": {"friendly_name": "Front Door"}},
            {"entity_id": "climate.lounge", "state": "cool", "attributes": {"friendly_name": "Lounge AC"}},
            {"entity_id": "cover.garage", "state": "closed", "attributes": {"friendly_name": "Garage Door"}},
        ]

    def __call__(self, method, path, body=None):
        if method == "GET":
            return self.items
        self.calls.append((path, body))
        return []


@pytest.fixture
def ha(monkeypatch):
    monkeypatch.setenv("AEGIS_HA_URL", "http://ha.local:8123")
    monkeypatch.setenv("AEGIS_HA_TOKEN", "tok")
    fake = FakeHA()
    monkeypatch.setattr(smarthome, "_call", fake)
    smarthome._CACHE.update({"at": 0.0, "states": []})
    return fake


def test_home_tools_only_exist_when_configured(monkeypatch):
    monkeypatch.delenv("AEGIS_HA_URL", raising=False)
    monkeypatch.delenv("AEGIS_HA_TOKEN", raising=False)
    names = {t["name"] for t in tools.schemas(False)}
    assert "home_control" not in names and "add_event" in names and "market_price" in names
    monkeypatch.setenv("AEGIS_HA_URL", "http://ha.local:8123")
    monkeypatch.setenv("AEGIS_HA_TOKEN", "t")
    assert {"home_list", "home_control"} <= {t["name"] for t in tools.schemas(False)}


def test_home_list_and_safe_control_by_name(ha):
    listing = smarthome.list_devices("light")
    assert "light.bedroom (Bedroom Light): off" in listing and "lock.front_door" not in listing
    assert smarthome.control("bedroom light", "turn_on") == "Done: turn on Bedroom Light."
    assert ha.calls[-1] == ("/api/services/light/turn_on", {"entity_id": "light.bedroom"})
    assert smarthome.control("light.kitchen", "set_brightness", "40").startswith("Done")
    assert ha.calls[-1][1] == {"entity_id": "light.kitchen", "brightness_pct": 40}
    assert smarthome.control("Lounge AC", "set_temperature", "24").startswith("Done") and ha.calls[-1][1]["temperature"] == 24.0
    assert smarthome.control("light", "turn_on").startswith("Error: More than one device matches")
    assert smarthome.control("nothing here", "turn_on").startswith("Error: No device called")
    assert smarthome.control("climate.lounge", "set_temperature", "90").startswith("Error")


def test_locks_doors_and_unknown_devices_always_need_approval(ha):
    t = tools.BY_NAME["home_control"]
    smarthome.states(refresh=True)
    assert not t.is_risky({"entity": "light.bedroom", "action": "turn_on"})
    assert not t.is_risky({"entity": "Bedroom Light", "action": "turn_off"})        # known lamp by name
    assert t.is_risky({"entity": "lock.front_door", "action": "unlock"})
    assert t.is_risky({"entity": "Front Door", "action": "turn_on"})                 # a lock by friendly name
    assert t.is_risky({"entity": "cover.garage", "action": "open"})
    assert t.is_risky({"entity": "Mystery device", "action": "turn_on"})             # unknown: fail safe
    # defence in depth: even if the approval check were skipped, the module itself refuses without confirmation
    assert smarthome.control("lock.front_door", "unlock").startswith("Error: this device needs the user's approval")
    assert not any("/lock/" in c[0] for c in ha.calls)
    assert smarthome.control("lock.front_door", "unlock", confirmed=True) == "Done: unlock Front Door."
    assert ha.calls[-1] == ("/api/services/lock/unlock", {"entity_id": "lock.front_door"})
    assert smarthome.control("cover.garage", "open", confirmed=True).startswith("Done") and ha.calls[-1][0] == "/api/services/cover/open_cover"
    assert smarthome.control("light.bedroom", "unlock", confirmed=True).startswith("Error: 'unlock' does not work")


def test_home_errors_are_friendly(monkeypatch):
    monkeypatch.delenv("AEGIS_HA_URL", raising=False)
    assert smarthome.list_devices().startswith("Error: Home Assistant is not set up")
    assert smarthome.control("x", "explode").startswith("Error: action must be one of")


def test_home_control_through_the_agent_asks_before_unlocking(env, ha):
    c, fake = env.client, env.fake
    token = register(c, "home@example.com")
    from types import SimpleNamespace

    uses = [SimpleNamespace(type="tool_use", id="1", name="home_list", input={"query": "door"}),
            SimpleNamespace(type="tool_use", id="2", name="home_control", input={"entity": "lock.front_door", "action": "unlock"})]
    fake.script = [resp(*uses[:1]), resp(uses[1]), resp(text("ok"))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "open the door", "tz": "Asia/Karachi"})
        m = drain_until(s, "confirm")
        assert m["tool"] == "home_control"
        s.send_json({"type": "confirm_response", "id": m["id"], "ok": False})
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    assert not any("/lock/" in call[0] for call in ha.calls)


# ---------------------------------------------------------------- studio voice
@pytest.fixture
def voice_env(monkeypatch):
    for k in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY", "AEGIS_TTS_PROVIDER", "AEGIS_TTS_CHARS_PER_DAY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AEGIS_EDGE_TTS", "0")   # the free voice has its own tests (test_voice_edge.py)
    sent = []
    monkeypatch.setattr(tts, "_post", lambda url, headers, body: (sent.append((url, headers, body)) or b"ID3fake-mp3"))
    return sent


def test_studio_voice_is_off_without_a_key(env, voice_env):
    c = env.client
    token = register(c)
    assert c.get("/api/tts/status", headers=auth(token)).json()["available"] is False
    assert c.post("/api/tts", json={"text": "hello"}, headers=auth(token)).status_code == 503
    assert c.post("/api/tts", json={"text": "hello"}).status_code in (401, 403)
    assert c.get("/api/config").json()["studio_voice"] is False


def test_openai_voice_gets_emotion_and_language_instructions(env, voice_env, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    c = env.client
    token = register(c)
    assert c.get("/api/tts/status", headers=auth(token)).json()["provider"] == "openai"
    r = c.post("/api/tts", json={"text": "Mubarak ho! Aap jeet gaye.", "emotion": "joy", "lang": "ur-PK"}, headers=auth(token))
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3fake-mp3"
    url, headers, body = voice_env[0]
    assert url.endswith("/v1/audio/speech") and headers["Authorization"] == "Bearer sk-test"
    assert body["model"] == "gpt-4o-mini-tts" and body["voice"] == "coral" and body["input"] == "Mubarak ho! Aap jeet gaye."
    assert "Urdu" in body["instructions"] and "Joyful" in body["instructions"]
    # an unknown emotion falls back to calm instead of failing
    c.post("/api/tts", json={"text": "Hello", "emotion": "banana"}, headers=auth(token))
    assert "Calm" in voice_env[-1][2]["instructions"]


def test_elevenlabs_path_and_daily_allowance(env, voice_env, monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "el-test")
    monkeypatch.setenv("AEGIS_TTS_CHARS_PER_DAY", "30")
    c = env.client
    token = register(c)
    r = c.post("/api/tts", json={"text": "I am sorry to hear that.", "emotion": "empathy", "lang": "en"}, headers=auth(token))
    assert r.status_code == 200
    url, headers, body = voice_env[0]
    assert "elevenlabs.io/v1/text-to-speech/" in url and headers["xi-api-key"] == "el-test"
    assert body["voice_settings"]["stability"] == 0.70 and body["model_id"] == "eleven_multilingual_v2"
    assert c.post("/api/tts", json={"text": "This one is over the allowance."}, headers=auth(token)).status_code == 429
    assert c.get("/api/tts/status", headers=auth(token)).json()["chars_left"] == 30 - len("I am sorry to hear that.")


def test_studio_voice_limits_and_failures(env, voice_env, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    c = env.client
    token = register(c)
    assert c.post("/api/tts", json={"text": "x" * 800}, headers=auth(token)).status_code == 413
    assert c.post("/api/tts", json={"text": "   "}, headers=auth(token)).status_code == 400

    def boom(url, headers, body):
        raise tts.TTSError("The voice service is busy or out of quota.")

    monkeypatch.setattr(tts, "_post", boom)
    before = c.get("/api/tts/status", headers=auth(token)).json()["chars_left"]
    r = c.post("/api/tts", json={"text": "Hello there"}, headers=auth(token))
    assert r.status_code == 502 and "busy" in r.json()["detail"]
    assert c.get("/api/tts/status", headers=auth(token)).json()["chars_left"] == before   # a failed call costs nothing


def test_asked_for_provider_without_key_does_not_switch_to_another(monkeypatch):
    monkeypatch.setenv("AEGIS_TTS_PROVIDER", "elevenlabs")
    monkeypatch.setenv("OPENAI_API_KEY", "sk")
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    assert tts.provider() == "" and not tts.available()
