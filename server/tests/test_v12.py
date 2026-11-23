"""v12: proactive alerts, free-time finder, evening review, deep research, systems check, new tools wiring."""
import asyncio
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from test_server import FakeClient, auth, connect, drain_until, env, register, resp, text, tool  # noqa: F401

from app import chief, tools
from app.agent import Agent
from app.db import DB
from app.hub import Hub

KHI = ZoneInfo("Asia/Karachi")
TZ = "Asia/Karachi"


def mk(tmp_path):
    db = DB(str(tmp_path / "a.db"))
    return db, db.create_user("x@example.com", "h", "s")


def at(h, m=0, day=0):
    d = datetime(2026, 11, 23, h, m, tzinfo=KHI) + timedelta(days=day)
    return d


# ---------------------------------------------------------------- proactive alerts
def test_alert_for_event_starting_soon_only(tmp_path):
    db, uid = mk(tmp_path)
    now = at(10, 0)
    db.add_event(uid, "Standup", at(10, 12).timestamp(), at(10, 30).timestamp(), "Room 2")
    db.add_event(uid, "Lunch", at(13, 0).timestamp(), at(14, 0).timestamp())      # too far away
    db.add_event(uid, "Old", at(9, 0).timestamp(), at(9, 30).timestamp())           # already over
    db.add_event(uid, "Running", at(9, 30).timestamp(), at(10, 30).timestamp())     # already started
    a = chief.proactive_alerts(db, uid, TZ, now)
    assert len(a) == 1
    assert a[0]["level"] == "urgent" and "Standup starts in 12 minutes at Room 2" in a[0]["text"]
    assert a[0]["key"].startswith("event:")


def test_habit_nudge_only_in_the_evening_and_mentions_streak(tmp_path):
    db, uid = mk(tmp_path)
    hid = db.add_habit(uid, "gym")
    for d in range(1, 5):
        db.habit_check(uid, hid, (at(21).date() - timedelta(days=d)).isoformat())
    assert chief.proactive_alerts(db, uid, TZ, at(15)) == []
    a = chief.proactive_alerts(db, uid, TZ, at(21))
    assert len(a) == 1 and "gym" in a[0]["text"] and "4-day streak" in a[0]["text"]
    assert a[0]["key"] == "habits:2026-11-23"
    db.habit_check(uid, hid, at(21).date().isoformat())
    assert chief.proactive_alerts(db, uid, TZ, at(21)) == []


def test_unusual_spending_alert_needs_history_and_a_big_day(tmp_path):
    db, uid = mk(tmp_path)
    now = at(18)
    db.add_expense(uid, 5000, spent_ts=now.timestamp() - 3600)
    assert chief.proactive_alerts(db, uid, TZ, now) == []                           # no history yet: stay quiet
    for d in range(1, 8):
        db.add_expense(uid, 500, spent_ts=(now - timedelta(days=d)).timestamp())
    a = [x for x in chief.proactive_alerts(db, uid, TZ, now) if x["key"].startswith("spend:")]
    assert len(a) == 1 and "5,000" in a[0]["text"].replace(",", ",")


# ---------------------------------------------------------------- free time
def test_free_slots_around_meetings(tmp_path):
    db, uid = mk(tmp_path)
    db.add_event(uid, "A", at(10).timestamp(), at(11).timestamp())
    db.add_event(uid, "B", at(14).timestamp(), at(15, 30).timestamp())
    out = chief.free_slots(db, uid, TZ, "2026-11-24", 60, 9, 18)   # tomorrow: nothing is "in the past"
    assert "No free gap" not in out
    out = chief.free_slots(db, uid, TZ, "2026-11-23", 60, 9, 18, now=at(8))
    assert "09:00-10:00 (60 min free)" in out and "11:00-14:00 (180 min free)" in out and "15:30-18:00 (150 min free)" in out
    assert "10:00-11:00" not in out


def test_free_slots_today_starts_from_now_and_handles_bad_input(tmp_path):
    db, uid = mk(tmp_path)
    out = chief.free_slots(db, uid, TZ, "", 30, 9, 18, now=at(16, 2))
    assert "16:05-18:00" in out
    assert chief.free_slots(db, uid, TZ, "", 30, 9, 18, now=at(19)).startswith("The working window")
    assert chief.free_slots(db, uid, TZ, "tomorrow", 30).startswith("Error")
    assert chief.free_slots(db, uid, TZ, "", 30, 18, 9).startswith("Error")
    assert chief.free_slots(db, uid, TZ, "", "abc").startswith("Error")


# ---------------------------------------------------------------- evening review
def test_evening_review_collects_the_day(tmp_path):
    db, uid = mk(tmp_path)
    now = at(21)
    db.add_task(uid, "Send invoice")
    tid = db.add_task(uid, "Buy milk")
    db.set_task_done(uid, tid)
    hid = db.add_habit(uid, "read")
    db.habit_check(uid, hid, now.date().isoformat())
    db.add_habit(uid, "gym")
    db.add_expense(uid, 800, category="food", spent_ts=now.timestamp() - 600)
    db.add_event(uid, "Dentist", at(15, day=1).timestamp(), at(16, day=1).timestamp(), "Clinic")
    out = chief.evening_review(db, uid, TZ, now)
    assert "1 completed" in out and "1 still open" in out and "Send invoice" in out
    assert "1 of 2 done today" in out and "Not yet: gym" in out
    assert "food" in out and "Dentist" in out and "@ Clinic" in out


def test_evening_review_empty_account_does_not_crash(tmp_path):
    db, uid = mk(tmp_path)
    out = chief.evening_review(db, uid, TZ, at(22))
    assert "nothing logged" in out and "nothing scheduled" in out


# ---------------------------------------------------------------- deep research
def test_deep_research_one_page_per_site_and_survives_failures():
    def search(q):
        if "pros" in q:
            raise RuntimeError("boom")                                  # one angle failing must not break the rest
        return [("Alpha", "https://a.com/1", "snippet a"), ("Alpha 2", "https://www.a.com/2", "dup site"), ("Beta", "https://b.org/x", "snippet b")]

    def fetch(u):
        return "Error: blocked" if "b.org" in u else "Full text of " + u

    out = chief.deep_research("solar power", 4, search=search, fetch=fetch)
    assert out.startswith("Research material on: solar power. Write a clear briefing")
    assert "Full text of https://a.com/1" in out
    assert "https://www.a.com/2" not in out                             # same site, skipped
    assert "snippet b" in out                                           # fetch failed -> falls back to the snippet


def test_deep_research_validates_and_reports_no_results():
    assert chief.deep_research("a").startswith("Error")
    assert chief.deep_research("quantum", search=lambda q: [], fetch=lambda u: "").startswith("Error")


# ---------------------------------------------------------------- systems check and agent wiring
def test_systems_report_reflects_device_and_counts(tmp_path):
    db, uid = mk(tmp_path)
    db.add_task(uid, "x")
    off = chief.systems_report(db, uid, False, tz=TZ)
    on = chief.systems_report(db, uid, True, tz=TZ)
    assert "offline" in off and "online (PC control available)" in on
    assert "Open tasks: 1" in on and "Memory: 0 things remembered" in on


def test_new_server_tools_run_through_the_agent(tmp_path):
    db, uid = mk(tmp_path)
    agent = Agent(None, db, Hub())
    run = lambda n, **a: asyncio.run(agent._run_server_tool(uid, n, a, TZ))
    assert "Free time of at least 45 minutes" in run("find_free_time", minutes=45, date="2026-12-01")
    assert "Tomorrow's calendar" in run("evening_review")
    assert "systems check" in run("systems_check")
    assert run("deep_research", topic="x").startswith("Error")


def test_tool_catalogue_has_the_new_tools():
    names = {t.name for t in tools.TOOLS}
    for n in ("deep_research", "find_free_time", "evening_review", "systems_check", "system_report", "window_control", "set_brightness", "power_action", "network_check"):
        assert n in names
    assert tools.BY_NAME["power_action"].is_risky({"action": "sleep"})
    assert tools.BY_NAME["window_control"].is_risky({"action": "close_window"})
    assert not tools.BY_NAME["window_control"].is_risky({"action": "snap_left"})
    server_only = {t["name"] for t in tools.schemas(False)}
    assert "deep_research" in server_only and "power_action" not in server_only


# ---------------------------------------------------------------- websocket: hello brief + alerts
def test_hello_carries_a_brief_and_alerts_arrive_once(env):
    c = env.client
    tok = register(c)
    db = c.app.state.db
    uid = db.user_by_email("a@example.com")["id"]
    db.add_task(uid, "Pay rent")
    db.add_event(uid, "Board call", time.time() + 8 * 60, time.time() + 40 * 60)
    ws, s = connect(c, tok)
    try:
        hello = drain_until(s, "hello")
        assert hello["brief"]["tasks_open"] == 1 and hello["brief"]["part"] in ("morning", "afternoon", "evening", "night")
        al = drain_until(s, "alert")
        assert "Board call" in al["text"] and al["level"] == "urgent"
        # a second sweep must not repeat it
        asyncio_run(c.app.state.deliver_alerts())
        s.send_json({"type": "ping"})
        s.send_json({"type": "reset"})
        nxt = drain_until(s, "cleared")  # would have hit another "alert" first if it had been repeated
        assert nxt["type"] == "cleared"
    finally:
        ws.__exit__(None, None, None)


def asyncio_run(coro):
    # TestClient(app) runs the app's loop in a portal thread; deliver_alerts only needs the hub sockets, so run it on a fresh loop
    return asyncio.new_event_loop().run_until_complete(coro)


def test_alert_and_review_rest_endpoints_need_login_and_work(env):
    c = env.client
    assert c.get("/api/alerts").status_code == 401
    tok = register(c)
    assert c.get("/api/alerts", headers=auth(tok)).json() == []
    r = c.get("/api/review", headers=auth(tok), params={"tz": TZ})
    assert r.status_code == 200 and "Tomorrow's calendar" in r.json()["text"]
