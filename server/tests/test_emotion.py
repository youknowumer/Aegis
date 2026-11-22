import time

from test_server import *  # noqa: F401,F403  (fixtures + helpers)
from test_server import auth, connect, drain_until, register, resp, text, tool

from app import emotion
from app.db import DB


# ---------- the reader ----------
@pytest.mark.parametrize(
    "msg,mood",
    [
        ("I am so stressed about the deadline", "stressed"),
        ("mera mood kharab hai bohat udaas hoon", "sad"),
        ("آج میں بہت خوش ہوں", "happy"),
        ("bohat thak gaya hoon yaar", "tired"),
        ("thanks a lot!!", "grateful"),
        ("I am not happy", "sad"),
        ("what's the weather in Lahore", "neutral"),
        ("open youtube and play a song", "neutral"),
    ],
)
def test_detect_moods(msg, mood):
    assert emotion.detect(msg).mood == mood


def test_detect_distress_beats_everything():
    for msg in ["I want to die", "mujhe khudkushi ka khayal aata hai", "میں خودکشی کرنا چاہتا ہوں"]:
        r = emotion.detect(msg)
        assert r.distress and r.mood == "distressed"
        assert "Drop any task" in emotion.style_for(r)


def test_negation_and_intensity():
    assert emotion.detect("I am not sad").mood == "neutral"
    assert emotion.detect("I'm FURIOUS!!").intensity >= 2


# ---------- memory ----------
def test_memory_dedupes_and_ranks(tmp_path):
    db = DB(str(tmp_path / "m.db"))
    a = db.add_fact(1, "Sister Ayesha's birthday is on Friday", "person", important=True)
    b = db.add_fact(1, "Sister Ayesha's birthday is on Friday!", "person")
    assert a == b and len(db.facts(1)) == 1
    assert db.facts(1)[0]["weight"] >= 3 and db.facts(1)[0]["kind"] == "person"
    db.add_fact(1, "Likes strong chai", "preference")
    assert len(db.facts(1)) == 2
    assert db.add_fact(1, "x", "nonsense") and {f["kind"] for f in db.facts(1)} >= {"fact"}


def test_old_database_is_migrated(tmp_path):
    import sqlite3

    p = str(tmp_path / "old.db")
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL, created REAL NOT NULL)")
    c.execute("INSERT INTO facts (user_id, text, created) VALUES (1, 'old memory', 1)")
    c.commit()
    c.close()
    db = DB(p)
    f = db.facts(1)[0]
    assert f["text"] == "old memory" and f["kind"] == "fact" and f["weight"] == 1


# ---------- mood history ----------
def test_summary_and_checkin(tmp_path):
    db = DB(str(tmp_path / "h.db"))
    now = time.time()
    db.execute("INSERT INTO moods (user_id, mood, intensity, created) VALUES (1,'sad',3,?)", (now - 86400,))
    db.execute("INSERT INTO moods (user_id, mood, intensity, created) VALUES (1,'tired',2,?)", (now - 2 * 86400,))
    rows = db.moods(1)
    s = emotion.summarize(rows, "UTC", 7, now)
    assert "sad" in s and "Yesterday" in s
    assert "ask once" in emotion.checkin_hint(rows, "UTC", now)
    db.add_mood(1, "happy", 2)  # they talked today already: no ambush
    assert emotion.checkin_hint(db.moods(1), "UTC") == ""


# ---------- end to end ----------
def test_chat_reads_mood_tunes_prompt_and_exposes_api(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [resp(text("[empathy] Oh no, I am sorry. What happened?"))]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "I feel so sad and lonely today"})
        m = drain_until(s, "mood")
        assert m["mood"] in ("sad", "lonely") and m["feeling"] == "empathy"
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    assert "How they seem right now" in fake.calls[0]["system"]
    info = c.get("/api/mood", headers=auth(token)).json()
    assert info["latest"] in ("sad", "lonely") and sum(info["counts"].values()) >= 1
    assert c.delete("/api/mood", headers=auth(token)).json()["cleared"] >= 1
    assert c.get("/api/mood", headers=auth(token)).json()["latest"] == ""


def test_mood_is_private_per_user(env):
    c = env.client
    t1, t2 = register(c, "a@example.com"), register(c, "b@example.com")
    env.fake.script = [resp(text("[empathy] ok"))]
    ws, s = connect(c, t1)
    s.receive_json()
    s.send_json({"type": "chat", "text": "I am so stressed"})
    drain_until(s, "reply")
    ws.__exit__(None, None, None)
    assert c.get("/api/mood", headers=auth(t2)).json()["latest"] == ""


def test_ai_tools_note_mood_remember_kind_and_recall(env):
    c, fake = env.client, env.fake
    token = register(c)
    fake.script = [
        resp(tool("1", "note_mood", mood="anxious", intensity=2, note="exam tomorrow"),
             tool("2", "remember", fact="Has an exam on Monday", kind="event", important=True)),
        resp(tool("3", "recall", query="exam"), tool("4", "mood_history", days=3)),
        resp(text("[warm] You've got this.")),
    ]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "ok"})
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    facts = c.get("/api/memory", headers=auth(token)).json()
    assert facts[0]["kind"] == "event" and facts[0]["important"] is True
    results = [b["content"] for m in fake.calls[2]["messages"] if isinstance(m["content"], list) for b in m["content"] if isinstance(b, dict) and b.get("type") == "tool_result"]
    assert any("exam on Monday" in r and "[event]" in r for r in results)
    assert any("anxious" in r and "exam tomorrow" in r for r in results)
