"""v13: stronger feelings (1-5 scale, 11 new moods) and a memory that behaves like a person's (heart.py)."""
import asyncio
import sqlite3
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from types import SimpleNamespace

from test_server import FakeClient, auth, connect, drain_until, env, register, resp, text, tool  # noqa: F401

from app import chief, emotion, heart, tts
from app.agent import Agent
from app.db import DB
from app.hub import Hub

TZ = "Asia/Karachi"
KHI = ZoneInfo(TZ)
DAY = 86400


def mk(tmp_path):
    db = DB(str(tmp_path / "h.db"))
    return db, db.create_user("x@example.com", "h", "s")


# ---------------------------------------------------------------- emotions
def test_new_moods_are_understood_in_several_languages():
    cases = {
        "my grandfather passed away yesterday": "grief", "mere dada ka inteqal ho gaya": "grief",
        "I didn't get the job, I'm so disappointed": "disappointed", "thank god it's over, what a relief": "relieved",
        "fingers crossed for tomorrow": "hopeful", "I don't understand this at all": "confused", "I love you aegis": "loving",
        "I feel so embarrassed": "embarrassed", "so bored": "bored", "I am overwhelmed": "overwhelmed",
    }
    for msg, mood in cases.items():
        assert emotion.detect(msg).mood == mood, msg


def test_intensity_runs_from_1_to_5():
    assert emotion.detect("a bit tired").intensity == 1
    assert emotion.detect("I'm sad").intensity <= 2
    big = emotion.detect("I'm sooooo SAD!!! 😭😭 so lonely, heartbroken")
    assert big.mood in ("sad", "lonely") and big.intensity == 5
    assert emotion.detect("I want to die").intensity == 5


def test_strong_feelings_change_how_the_ai_is_told_to_answer():
    soft = emotion.style_for(emotion.Reading("sad", 2))
    hard = emotion.style_for(emotion.Reading("sad", 5))
    assert "no fixing yet" not in soft and "no fixing yet" in hard and "5 on a scale of 5" in hard
    assert "match it with real energy" in emotion.style_for(emotion.Reading("excited", 5))
    assert "grieving" in emotion.style_for(emotion.Reading("grief", 3))


def test_voice_prosody_scales_with_feeling():
    base = ("-12%", "-4Hz", "-5%")
    calm, normal, deep = (tts.scale_prosody(*base, i) for i in (1, 3, 5))
    assert normal == ("-12%", "-4Hz", "-5%")
    assert abs(int(deep[0][:-1])) > abs(int(normal[0][:-1])) > abs(int(calm[0][:-1]))
    assert tts.scale_prosody("+12%", "+12Hz", "+8%", 5)[0] == "+20%" and tts.scale_prosody("+40%", "+30Hz", "+30%", 5)[0] == "+40%"  # capped


# ---------------------------------------------------------------- auto-memory
NOW = datetime(2026, 11, 23, 12, 0)


def ex(t):
    return [(m["kind"], m["text"]) for m in heart.extract_memories(t, NOW)]


def test_extracts_people_dates_plans_and_losses():
    assert ("person", "Their sister is Ayesha") in ex("my sister is Ayesha and she is a doctor")
    assert ("person", "Their dost is Ali") in ex("mere dost ka naam ali hai")
    assert ("person", "Their name is Bilal") in ex("Hi, my name is bilal")
    r = heart.extract_memories("my birthday is on 5 December", NOW)
    assert r[0]["when_md"] == "12-05" and r[0]["important"]
    r = heart.extract_memories("Ayesha's birthday is March 14th", NOW)
    assert r[0]["when_md"] == "03-14" and "Ayesha's birthday" in r[0]["text"]
    assert any(k == "event" and "interview tomorrow" in t and "2026-11-23" in t for k, t in ex("I have an interview tomorrow"))
    assert any(k == "event" and "exam" in t for k, t in ex("mera exam kal hai"))
    assert any(k == "goal" and "learn guitar" in t for k, t in ex("I want to learn guitar this year"))
    assert any(k == "preference" and "love" in t for k, t in ex("I love biryani"))
    assert any(k == "fact" and "They live in Lahore" in t for k, t in ex("I live in Lahore"))
    grief = ex("my father passed away last week")
    assert any(k == "emotion" and "passed away" in t for k, t in grief)
    assert any(k == "emotion" and "sick" in t for k, t in ex("my mother is sick"))


def test_does_not_remember_questions_noise_or_jokes():
    assert ex("is my sister is Ayesha?") == []
    assert ex("what is my birthday?") == []
    assert ex("I like it when you answer fast") == []        # 'it' is not a thing they like
    assert ex("my friend is not here") == []                 # 'not' is not a name
    assert ex("x" * 500) == []
    assert ex("hello there") == []


def test_parse_month_day():
    assert heart.parse_month_day("on 5th Dec") == "12-05" and heart.parse_month_day("March 14") == "03-14"
    assert heart.parse_month_day("5 smarch") == "" and heart.parse_month_day("32 May") == "" and heart.parse_month_day("nothing") == ""


# ---------------------------------------------------------------- recall quality
def test_relevance_beats_recency_and_fuzzy_spelling_helps(tmp_path):
    db, uid = mk(tmp_path)
    db.add_fact(uid, "Their behen is Sana", "person")
    for i in range(20):
        db.add_fact(uid, f"Likes number {i} things on tuesdays {i * 7}", "fact")
    top = heart.select_memories(db.facts(uid), "how is my behan doing", 3)
    assert top[0]["text"] == "Their behen is Sana"


def test_strongly_felt_and_important_memories_outlast_casual_ones(tmp_path):
    db, uid = mk(tmp_path)
    old = time.time() - 120 * DAY
    a = db.add_fact(uid, "Said they like green tea", "preference")
    b = db.add_fact(uid, "Their father passed away", "emotion", True, mood="grief", level=5)
    db.execute("UPDATE facts SET created = ?", (old,))
    rows = db.facts(uid)
    ra, rb = next(r for r in rows if r["id"] == a), next(r for r in rows if r["id"] == b)
    assert heart.memory_score(rb, set(), time.time()) > heart.memory_score(ra, set(), time.time()) * 3


def test_memories_are_shown_with_age_and_feeling(tmp_path):
    db, uid = mk(tmp_path)
    fid = db.add_fact(uid, "Has an exam on Monday", "event", True, mood="anxious", level=4)
    db.execute("UPDATE facts SET created = ? WHERE id = ?", (time.time() - 2 * DAY, fid))
    out = heart.format_memories(db.facts(uid))
    assert "2 days ago" in out and "they felt anxious very strongly" in out and "[event]" in out


def test_using_a_memory_reinforces_it(tmp_path):
    db, uid = mk(tmp_path)
    fid = db.add_fact(uid, "Their sister is Sana", "person")
    db.touch_facts(uid, [fid])
    db.touch_facts(uid, [fid])
    r = db.facts(uid)[0]
    assert r["uses"] == 2 and r["last_used"] > 0


def test_merge_keeps_the_stronger_feeling(tmp_path):
    db, uid = mk(tmp_path)
    a = db.add_fact(uid, "Has an exam on Monday", "event", mood="anxious", level=4)
    b = db.add_fact(uid, "Has an exam on Monday", "event", mood="happy", level=1)
    r = db.facts(uid)[0]
    assert a == b and len(db.facts(uid)) == 1 and r["mood"] == "anxious" and r["mood_level"] == 4 and r["weight"] >= 2


def test_consolidate_merges_lookalikes_and_fades_the_forgettable(tmp_path):
    db, uid = mk(tmp_path)
    db.add_fact(uid, "They really like strong black coffee in the morning", "preference")
    db.add_fact(uid, "They like strong black coffee every morning", "preference")
    for i in range(10):
        db.add_fact(uid, f"unique casual remark number{i} about thing{i}", "fact")
    db.add_fact(uid, "Their father passed away", "emotion", True)
    db.execute("UPDATE facts SET created = ?", (time.time() - 90 * DAY,))
    out = heart.consolidate(db, uid, cap=8)
    left = [r["text"] for r in db.facts(uid)]
    assert out["merged"] == 1 and out["faded"] >= 2 and len(left) == 8
    assert "Their father passed away" in left                 # important memories never fade


# ---------------------------------------------------------------- the bond
def test_bond_grows_with_time_and_shared_feelings(tmp_path):
    db, uid = mk(tmp_path)
    assert heart.bond_level(db.bond_row(uid))["level"] == 1
    t = time.time()
    for day in range(1, 14):
        for _ in range(3):
            db.bond_tick(uid, f"2026-11-{day:02d}", emotional=(day % 2 == 0), now=t + day * DAY)
    b = heart.bond_level(db.bond_row(uid), facts=10)
    assert b["level"] >= 3 and 0 <= b["progress"] <= 100 and b["points"] > 100
    r = db.bond_row(uid)
    assert r["days"] == 13 and r["turns"] == 39 and r["shared"] == 18
    assert heart.bond_level({"turns": 5000, "days": 300, "shared": 500, "first": 0, "last": 0, "prev_last": 0}, 400)["progress"] == 100


def test_missing_you_only_after_real_absence(tmp_path):
    now = time.time()
    assert heart.absence_hint({"prev_last": 0}, now) == ""
    assert heart.absence_hint({"prev_last": now - DAY}, now) == ""
    assert "missed" in heart.absence_hint({"prev_last": now - 4 * DAY}, now)
    assert "14" in heart.absence_hint({"prev_last": now - 15 * DAY}, now) or "15" in heart.absence_hint({"prev_last": now - 15 * DAY}, now)


# ---------------------------------------------------------------- emotional arc
def moods(pattern, now):
    """pattern: {days_ago: (mood, intensity)}; newest first like db.moods."""
    rows = [{"mood": m, "intensity": i, "created": now - d * DAY - 3600} for d, (m, i) in sorted(pattern.items())]
    return rows


def test_trend_detects_rough_patch_and_recovery():
    now = time.time()
    rough = heart.trend(moods({0: ("sad", 3), 1: ("anxious", 2), 2: ("tired", 2), 3: ("stressed", 3)}, now), TZ, now)
    assert rough["rough_patch"] and "heavy few days" in heart.trend_hint(rough)
    up = heart.trend(moods({0: ("happy", 3), 1: ("happy", 2), 5: ("sad", 3), 6: ("stressed", 2)}, now), TZ, now)
    assert up["direction"] == "lifting" and not up["rough_patch"]
    glow = heart.trend(moods({0: ("happy", 2), 1: ("proud", 2), 2: ("excited", 3)}, now), TZ, now)
    assert glow["bright_streak"]
    assert heart.trend([], TZ, now)["direction"] == "unknown" and heart.trend_hint(heart.trend([], TZ, now)) == ""


# ---------------------------------------------------------------- following up
def test_callback_picks_a_recent_event_or_feeling_not_birthdays_or_old_news(tmp_path):
    db, uid = mk(tmp_path)
    a = db.add_fact(uid, "They have an interview tomorrow (said on 2026-11-22)", "event", True, mood="anxious", level=4)
    b = db.add_fact(uid, "Ayesha's birthday is on 5 December", "event", True)
    c = db.add_fact(uid, "Old news about a trip", "event", True)
    now = time.time()
    db.execute("UPDATE facts SET created = ? WHERE id = ?", (now - 2 * DAY, a))
    db.execute("UPDATE facts SET created = ? WHERE id = ?", (now - 2 * DAY, b))
    db.execute("UPDATE facts SET created = ? WHERE id = ?", (now - 40 * DAY, c))
    cb = heart.callback(db, uid, now)
    assert cb["id"] == a and cb["text"] == "They have an interview tomorrow" and cb["days_ago"] == 2
    assert chief.brief(db, uid, TZ)["callback"]["id"] == a


def test_birthday_alert_today_and_tomorrow_once_per_day(tmp_path):
    db, uid = mk(tmp_path)
    db.add_fact(uid, "Ayesha's birthday is on 24 November", "event", True, when_md="11-24")
    now = datetime(2026, 11, 23, 10, 0, tzinfo=KHI)
    a = [x for x in chief.proactive_alerts(db, uid, TZ, now) if x["key"].startswith("special:")]
    assert len(a) == 1 and "tomorrow" in a[0]["text"] and "Ayesha" in a[0]["text"]
    b = [x for x in chief.proactive_alerts(db, uid, TZ, now + timedelta(days=1)) if x["key"].startswith("special:")]
    assert len(b) == 1 and "today" in b[0]["text"] and b[0]["key"] != a[0]["key"]
    assert [x for x in chief.proactive_alerts(db, uid, TZ, now + timedelta(days=3)) if x["key"].startswith("special:")] == []


# ---------------------------------------------------------------- the whole thing through a chat
def test_chat_remembers_on_its_own_and_prompt_carries_memory_bond_and_feeling(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [resp(text("[empathy] I'm so sorry."))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "my sister is Ayesha and I have an interview tomorrow, I am SO nervous!!"})
        drain_until(s, "reply")
        fake.script = [resp(text("[warm] How did it go?"))]
        s.send_json({"type": "chat", "text": "how is ayesha"})
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    facts = c.get("/api/memory", headers=auth(token)).json()
    texts = [f["text"] for f in facts]
    assert "Their sister is Ayesha" in texts and any("interview tomorrow" in t for t in texts)
    interview = next(f for f in facts if "interview" in f["text"])
    assert interview["source"] == "auto" and interview["mood"] in ("anxious", "stressed") and interview["mood_level"] >= 3 and interview["important"]
    system = fake.calls[1]["system"]
    assert "Their sister is Ayesha" in system and "Your bond with them: level 1 of 5" in system
    assert "ago" in system or "just now" in system or "earlier today" in system
    bond = c.get("/api/bond", headers=auth(token)).json()
    assert bond["level"] == 1 and "tone" not in bond


def test_auto_memory_can_be_switched_off(env, monkeypatch):
    from app import settings
    monkeypatch.setattr(settings, "AUTO_MEMORY", False)
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [resp(text("[warm] ok"))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "my sister is Ayesha"})
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    assert c.get("/api/memory", headers=auth(token)).json() == []


def test_welcome_back_after_days_away(env):
    c, fake = env.client, env.fake
    token = register(c)
    db = c.app.state.db
    uid = db.user_by_email("a@example.com")["id"]
    old = time.time() - 5 * DAY
    db.execute("INSERT INTO bond (user_id, turns, days, shared, last_day, first, last, prev_last) VALUES (?, 40, 9, 3, '2026-11-10', ?, ?, ?)", (uid, old - 20 * DAY, old, old - DAY))
    ws, s = connect(c, token)
    try:
        hello = s.receive_json()
        assert hello["brief"]["away_days"] == 5 and hello["bond"]["level"] >= 2
        fake.script = [resp(text("[warm] I missed you!"))]
        s.send_json({"type": "chat", "text": "hi"})
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    assert "missed them" in fake.calls[0]["system"]


# ---------------------------------------------------------------- tools and REST
def test_remember_tool_captures_the_current_feeling_and_who_is_timeline_work(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [
        resp(tool("1", "remember", fact="Their brother Hamza is moving abroad", kind="person", important=True)),
        resp(SimpleNamespace(type="tool_use", id="2", name="who_is", input={"name": "Hamza"}), tool("3", "memory_timeline", days=7),
             SimpleNamespace(type="tool_use", id="4", name="who_is", input={"name": "Zed"})),
        resp(text("[empathy] That is a big change.")),
    ]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "I'm really sad, my brother Hamza is leaving"})
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    f = next(x for x in c.get("/api/memory", headers=auth(token)).json() if "Hamza" in x["text"])
    assert f["mood"] == "sad" and f["mood_level"] >= 2
    results = [b["content"] for m in fake.calls[2]["messages"] if isinstance(m["content"], list) for b in m["content"] if isinstance(b, dict) and b.get("type") == "tool_result"]
    assert any("What you remember about Hamza" in r and "felt sad" in r for r in results)
    assert any(r.startswith("- ") and "Hamza" in r for r in results)
    assert any("Nothing remembered about Zed" in r for r in results)


def test_rest_add_memory_and_privacy(env):
    c = env.client
    t1, t2 = register(c, "a@example.com"), register(c, "b@example.com")
    r = c.post("/api/memory", json={"text": "Mom's birthday is on 9 March", "kind": "event", "important": True}, headers=auth(t1))
    assert r.status_code == 200
    mem = c.get("/api/memory", headers=auth(t1)).json()
    assert mem[0]["source"] == "user" and mem[0]["when"]
    assert c.get("/api/memory", headers=auth(t2)).json() == []
    assert c.post("/api/memory", json={"text": " "}, headers=auth(t1)).status_code == 400
    assert c.get("/api/bond").status_code == 401


def test_export_and_delete_cover_the_bond(env):
    c = env.client
    tok = register(c)
    db = c.app.state.db
    uid = db.user_by_email("a@example.com")["id"]
    db.bond_tick(uid, "2026-11-23", True)
    assert c.get("/api/export", headers=auth(tok)).json()["bond"][0]["turns"] == 1
    assert c.post("/api/account/delete", json={"password": "password123"}, headers=auth(tok)).status_code == 200
    assert db.one("SELECT 1 FROM bond WHERE user_id = ?", (uid,)) is None


def test_old_databases_are_upgraded_in_place(tmp_path):
    path = str(tmp_path / "old.db")
    con = sqlite3.connect(path)
    con.executescript("CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL, created REAL NOT NULL);"
                      "INSERT INTO facts (user_id, text, created) VALUES (1, 'old memory', 1.0);")
    con.commit()
    con.close()
    db = DB(path)
    r = db.facts(1)[0]
    assert r["text"] == "old memory" and r["mood"] == "" and r["uses"] == 0 and r["source"] == "ai"
    assert db.add_fact(1, "new memory", "fact", mood="sad", level=3)


def test_maintenance_consolidates_memory(env):
    c = env.client
    register(c)
    db = c.app.state.db
    uid = db.user_by_email("a@example.com")["id"]
    db.add_fact(uid, "They really like strong black coffee in the morning", "preference")
    db.add_fact(uid, "They like strong black coffee every morning", "preference")
    out = c.app.state.run_maintenance()
    assert out["removed"]["memories_merged"] == 1 and len(db.facts(uid)) == 1
