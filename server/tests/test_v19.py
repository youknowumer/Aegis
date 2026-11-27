"""v19: learning (lessons, feedback, training export), instant reminders, and voice browser control without the AI."""
import asyncio
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from test_server import FakeClient, auth, connect, drain_until, env, register, resp, text  # noqa: F401

from app import fastpath, learning
from app.db import DB
from app.hub import Hub

NOW = datetime(2026, 11, 27, 8, 30, tzinfo=ZoneInfo("Asia/Karachi"))
TZ = "Asia/Karachi"


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------ lessons
def test_detects_standing_rules_and_ignores_tasks_and_questions():
    one = lambda t: [x["text"] for x in learning.detect_lessons(t, "what is x")]  # noqa: E731
    assert one("from now on keep answers short") == ["Keep replies short and to the point"]
    assert one("urdu mein jawab do") == ["Reply in Urdu (Urdu script)"]
    assert one("stop calling me sir") == ['Do not call them "sir"']
    assert one("never use emojis") == ["Never use emojis"]
    assert one("don't forget to buy milk") == []
    assert one("should I keep answers short?") == []
    assert "corrected you" in one("no, I meant the other one")[0]


def test_slot_replaces_older_lesson_and_duplicates_merge(tmp_path):
    db = DB(str(tmp_path / "l.db"))
    uid = db.create_user("a@x.com", "h", "s")
    db.add_lesson(uid, "Keep replies short and to the point", "style", "length")
    db.add_lesson(uid, "Give fuller, more detailed answers", "style", "length")
    assert [l["text"] for l in db.lessons(uid)] == ["Give fuller, more detailed answers"]
    db.add_lesson(uid, "Give fuller, more detailed answers", "style", "length")
    assert len(db.lessons(uid)) == 1 and db.lessons(uid)[0]["weight"] == 2
    block = learning.lessons_block(db.lessons(uid))
    assert "binding" not in block and "Give fuller" in block


def test_learning_switch_stops_learning(tmp_path):
    db = DB(str(tmp_path / "l.db"))
    uid = db.create_user("a@x.com", "h", "s")
    db.set_pref(uid, "learn", "0")
    assert learning.learn(db, uid, "from now on keep answers short") == []
    db.set_pref(uid, "learn", "1")
    assert learning.learn(db, uid, "from now on keep answers short")


def test_style_profile_reads_ratings():
    rows = [{"user_text": "hi there", "reply": "word " * 60, "rating": -1, "voice": 0, "source": "ai", "ts": i} for i in range(4)]
    rows += [{"user_text": "ok then", "reply": "short answer here", "rating": 1, "voice": 0, "source": "ai", "ts": 10 + i} for i in range(4)]
    assert "briefer" in learning.style_profile(rows)
    assert learning.style_profile(rows[:3]) == ""


# ------------------------------------------------------------ redaction + export
def test_redact_and_training_export():
    assert "[email]" in learning.redact("mail me at ali@example.com")
    assert "hunter2" not in learning.redact("my password is hunter2")
    assert "4111" not in learning.redact("card 4111 1111 1111 1111")
    rows = [
        {"id": 1, "ts": 1, "user_text": "what is 2+2", "reply": "[calm] Four.", "tools": "[]", "voice": 0, "source": "ai", "rating": 1},
        {"id": 2, "ts": 2, "user_text": "bad one", "reply": "nonsense", "tools": "[]", "voice": 0, "source": "ai", "rating": -1},
        {"id": 3, "ts": 3, "user_text": "scroll down", "reply": "Done.", "tools": "[]", "voice": 0, "source": "fast", "rating": 0},
        {"id": 4, "ts": 4, "user_text": "hello", "reply": "Hi!", "tools": "[]", "voice": 0, "source": "ai", "rating": 0},
    ]
    lessons = [{"text": "Keep replies short", "kind": "style", "active": 1, "weight": 1, "created": 0}]
    out = [json.loads(l) for l in learning.training_jsonl(rows, lessons, "openai").splitlines()]
    assert [o["messages"][2]["content"] for o in out] == ["Four.", "Hi!"]          # thumbs-down and instant commands left out, tags removed
    assert "Keep replies short" in out[0]["messages"][0]["content"]
    assert len(learning.training_jsonl(rows, lessons, "openai", include_unrated=False).splitlines()) == 1
    kto = [json.loads(l) for l in learning.training_jsonl(rows, lessons, "kto").splitlines()]
    assert sorted(k["label"] for k in kto) == [False, True]
    assert learning.modelfile(lessons).startswith("FROM llama3.1") and "Keep replies short" in learning.modelfile(lessons)


# ------------------------------------------------------------ reminders
def test_reminder_parsing_english_and_roman_urdu():
    p = fastpath.parse_reminder("remind me in 20 minutes to call Ali", TZ, NOW)
    assert p["text"] == "Call Ali" and p["due"] == NOW.timestamp() + 1200
    p = fastpath.parse_reminder("remind me tomorrow at 9 to submit the report", TZ, NOW)
    assert datetime.fromtimestamp(p["due"], ZoneInfo(TZ)).strftime("%d %H:%M") == "28 09:00" and p["text"] == "Submit the report"
    p = fastpath.parse_reminder("remind me at 5pm to call mom", TZ, NOW)
    assert datetime.fromtimestamp(p["due"], ZoneInfo(TZ)).hour == 17
    p = fastpath.parse_reminder("mujhe 20 minute baad yaad dilana ki chai peeni hai", TZ, NOW)
    assert p["text"] == "Chai peeni hai" and p["due"] == NOW.timestamp() + 1200
    p = fastpath.parse_reminder("kal subah 9 baje yaad dilana ki meeting hai", TZ, NOW)
    assert datetime.fromtimestamp(p["due"], ZoneInfo(TZ)).strftime("%d %H") == "28 09"
    p = fastpath.parse_reminder("remind me every weekday at 8am to take medicine", TZ, NOW)
    assert p["repeat"] == "weekdays" and datetime.fromtimestamp(p["due"], ZoneInfo(TZ)).weekday() < 5
    assert fastpath.parse_reminder("remind me about it", TZ, NOW) is None             # no time: the AI asks
    assert fastpath.parse_reminder("what are my reminders", TZ, NOW) is None


def test_reminders_snooze_list_cancel_without_the_ai(tmp_path):
    db = DB(str(tmp_path / "r.db"))
    uid = db.create_user("a@x.com", "h", "s")
    hub = Hub()
    r = run(fastpath.try_fast(uid, "remind me in 20 minutes to call Ali", TZ, hub, db, NOW))
    assert "call Ali" in r["reply"] and r["tools"] == ["set_reminder"] and len(db.reminders(uid)) == 1
    assert "Call Ali" in run(fastpath.try_fast(uid, "what are my reminders", TZ, hub, db, NOW))["reply"]
    assert "Cancelled 1" in run(fastpath.try_fast(uid, "cancel reminder about call Ali", TZ, hub, db, NOW))["reply"]
    assert db.reminders(uid) == []
    # something just went off -> snooze brings it back
    rid = db.add_reminder(uid, "Stretch", NOW.timestamp() - 60, "", TZ)
    db.mark_reminder_fired(rid)
    assert "5 minutes" in run(fastpath.try_fast(uid, "snooze 5 minutes", TZ, hub, db, NOW))["reply"]
    assert [x["text"] for x in db.reminders(uid)] == ["Stretch"]


# ------------------------------------------------------------ browser plans
def test_browser_plans_in_english_and_roman_urdu():
    P = fastpath.parse_browser
    assert P("next tab")["steps"] == [("tab_delta", 1)] and P("agla tab")["steps"] == [("tab_delta", 1)]
    assert P("switch to tab two")["steps"] == [("call", "chrome_switch", {"tab": "2"})]
    assert P("go to the gmail tab")["steps"] == [("call", "chrome_switch", {"tab": "gmail"})]
    assert P("search for cats on youtube")["steps"][0][2]["url"].startswith("https://www.youtube.com/results?search_query=cats")
    assert P("search python tutorials and open the first result")["steps"][-1] == ("open_result", 1)
    assert P("play despacito on youtube")["steps"] == [("call", "chrome_youtube_play", {"query": "despacito"})]
    assert P("scroll down a lot")["steps"] == [("call", "chrome_scroll", {"direction": "down", "amount": 3})]
    assert P("neeche scroll karo")["steps"][0][2]["direction"] == "down"
    assert P("click number for")["steps"] == [("call", "chrome_click", {"index": 4})]
    assert P("pause the video")["steps"] == [("call", "chrome_media", {"action": "pause"})]
    assert P("type hello into the search box and press enter")["steps"][0][2] == {"text": "hello", "field": "search", "submit": True}
    assert P("open youtube in a new tab")["steps"] == [("call", "chrome_open", {"url": "https://www.youtube.com"})]


def test_browser_plans_leave_the_rest_to_the_ai():
    P = fastpath.parse_browser
    for t in ("what is the weather", "click next then buy", "summarize this page", "search my notes for tax", "type a note to myself", "remind me to scroll"):
        assert P(t) is None, t


class FakeHub:
    """Stands in for the real hub: records chrome_* calls and answers like the browser extension would."""
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def can_chrome(self, uid):
        return True

    async def call_device(self, uid, name, args):
        self.calls.append((name, args))
        a = self.answers.get(name, "ok")
        return a(args) if callable(a) else a


def test_next_tab_wraps_and_open_result_clicks_the_right_link(tmp_path):
    db = DB(str(tmp_path / "b.db"))
    hub = FakeHub({
        "chrome_tabs": "1  Inbox — https://mail.google.com/\n2* Docs — https://docs.google.com/\n3  News — https://news.com/\n(* = the tab Aegis is working in)",
        "chrome_switch": "Switched to: News — https://news.com/",
        "chrome_open": "Opened in a new tab: x",
        "chrome_elements": ("Results — https://www.google.com/search?q=x\n"
                            "1 [link] Images → https://www.google.com/imghp\n"
                            "2 [link] Python Tutorial - W3Schools → https://www.w3schools.com/python/\n"
                            "3 [link] Learn Python - Official docs site → https://www.python.org/about/gettingstarted/\n"),
        "chrome_click": "Clicked it",
    })
    r = run(fastpath.try_fast(1, "next tab", TZ, hub, db))
    assert hub.calls[-1] == ("chrome_switch", {"tab": "3"}) and "News" in r["reply"]
    r = run(fastpath.try_fast(1, "open the second result", TZ, hub, db))
    assert hub.calls[-1] == ("chrome_click", {"index": 3}) and "python" in r["reply"].lower()
    r = run(fastpath.try_fast(1, "read the results", TZ, hub, db))
    assert "W3Schools" in r["reply"] and "Images" not in r["reply"]


def test_a_risky_click_is_handed_to_the_ai_and_errors_are_spoken(tmp_path):
    db = DB(str(tmp_path / "b.db"))
    hub = FakeHub({"chrome_click": "NEEDS_APPROVAL: Clicking \"Buy now\" looks like it could buy something."})
    assert run(fastpath.try_fast(1, "click buy now", TZ, hub, db)) is None
    hub = FakeHub({"chrome_scroll": "Error: this page cannot be controlled"})
    assert "cannot be controlled" in run(fastpath.try_fast(1, "scroll down", TZ, hub, db))["reply"]


def test_no_browser_linked(tmp_path):
    db = DB(str(tmp_path / "b.db"))
    hub = Hub()
    assert "Aegis Web Hands" in run(fastpath.try_fast(1, "next tab", TZ, hub, db))["reply"]
    assert run(fastpath.try_fast(1, "scroll down", TZ, hub, db)) is None                # plain page commands stay with the page / the AI


# ------------------------------------------------------------ over the websocket + REST
def test_fast_reply_over_websocket_costs_no_quota_and_feedback_is_saved(env):
    c = env.client
    token = register(c)
    ws, s = connect(c, token)
    try:
        s.receive_json()
        s.send_json({"type": "chat", "text": "remind me in 20 minutes to call Ali", "tz": TZ})
        r = drain_until(s, "reply")
        assert r["fast"] is True and r["used"] == 0 and r["iid"] and "call Ali" in r["text"]
        s.send_json({"type": "feedback", "iid": r["iid"], "rating": 1})
        fb = drain_until(s, "feedback_ok")
        assert fb["saved"] is True and fb["rating"] == 1
        env.fake.script = [resp(text("Sure, short it is."))]
        s.send_json({"type": "chat", "text": "from now on keep answers short"})
        ai = drain_until(s, "reply")
        assert ai["used"] == 1 and ai["iid"] != r["iid"]
    finally:
        ws.__exit__(None, None, None)
    info = c.get("/api/learning", headers=auth(token)).json()
    assert info["enabled"] and info["stats"]["instant"] == 1 and info["stats"]["up"] == 0     # up counts replies the AI wrote
    assert [l["text"] for l in info["lessons"]] == ["Keep replies short and to the point"]


def test_lesson_reaches_the_next_prompt_and_rest_api(env):
    c = env.client
    token = register(c)
    h = auth(token)
    lid = c.post("/api/learning/lessons", json={"text": "Always answer in Roman Urdu"}, headers=h).json()["id"]
    ws, s = connect(c, token)
    try:
        s.receive_json()
        env.fake.script = [resp(text("Theek hai."))]
        s.send_json({"type": "chat", "text": "what is a prime number"})
        iid = drain_until(s, "reply")["iid"]
        s.send_json({"type": "feedback", "iid": iid, "rating": 1})
        drain_until(s, "feedback_ok")
    finally:
        ws.__exit__(None, None, None)
    assert "Always answer in Roman Urdu" in env.fake.calls[0]["system"]
    body = c.get("/api/learning/export?fmt=openai", headers=h)
    assert body.status_code == 200 and json.loads(body.text.splitlines()[0])["messages"][2]["content"] == "Theek hai."
    assert "Roman Urdu" in c.get("/api/learning/modelfile", headers=h).text
    assert c.post("/api/learning/settings", json={"enabled": False}, headers=h).json()["enabled"] is False
    assert c.delete(f"/api/learning/lessons/{lid}", headers=h).status_code == 200
    assert c.get("/api/learning/export", headers=auth(register(c, "b@example.com"))).status_code == 404   # nothing to export, and not someone else's data
    assert c.delete("/api/learning/data", headers=h).json()["removed"] >= 1
