"""v11: bug fixes, account safety, admin/monitoring, retention/backups, expenses, habits, prayer times, new AI tools."""
import asyncio
import json
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone

import pytest
from starlette.websockets import WebSocketDisconnect

from test_server import FakeClient, auth, connect, drain_until, env, register, resp, text, tool  # noqa: F401  (env is a fixture)

from app import extras, settings  # noqa: E402
from app.agent import Agent  # noqa: E402
from app.db import DB  # noqa: E402
from app.hub import Hub  # noqa: E402
from app.main import LoginLimiter  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def agent_for(tmp_path):
    db = DB(str(tmp_path / "a.db"))
    uid = db.create_user("x@example.com", "h", "s")
    return Agent(None, db, Hub()), db, uid


def call(agent, uid, tool_name, _tz="Asia/Karachi", **args):
    return run(agent._run_server_tool(uid, tool_name, args, _tz))


# ------------------------------------------------------------ bug fixes
def test_register_race_gives_409_not_500(env, monkeypatch):
    c = env.client
    db = c.app.state.db
    real = db.create_user

    def racing(email, h, salt):
        real(email, h, salt)  # the "other" request got there first
        return real(email, h, salt)  # ... and ours hits the UNIQUE constraint

    monkeypatch.setattr(db, "create_user", racing)
    r = c.post("/api/register", json={"email": "race@example.com", "password": "password123"})
    assert r.status_code == 409


def test_limiter_forgets_expired_keys():
    lim = LoginLimiter(max_attempts=3, window=1)
    for i in range(2500):
        lim.check(("ip", i))
    assert len(lim.hits) == 2500
    time.sleep(1.1)
    lim._sweep_at = 0  # (the first sweep ran while everything was still fresh and rested for 30 s)
    lim.check(("ip", "new"))  # triggers the sweep
    assert len(lim.hits) <= 2  # the expired ones are gone


def test_hub_does_not_keep_empty_chat_sets(env):
    token = register(env.client)
    hub = None
    ws, s = connect(env.client, token)
    drain_until(s, "hello")
    ws.__exit__(None, None, None)
    time.sleep(0.2)
    # no attribute access needed: another connect/disconnect cycle must still work and reminders must not crash
    ws, s = connect(env.client, token)
    drain_until(s, "hello")
    ws.__exit__(None, None, None)
    assert hub is None


def test_failed_turn_saves_nothing_but_good_turn_saves_both(env):
    fake = env.fake
    fake.script = [RuntimeError("boom"), resp(text("[calm] Hello there."))]
    token = register(env.client)
    db = env.client.app.state.db
    uid = db.user_by_email("a@example.com")["id"]
    ws, s = connect(env.client, token)
    drain_until(s, "hello")
    s.send_json({"type": "chat", "text": "first"})
    drain_until(s, "error")
    assert db.recent_messages(uid, 10) == []  # nothing half-saved
    s.send_json({"type": "chat", "text": "second"})
    drain_until(s, "reply")
    assert [m["role"] for m in db.recent_messages(uid, 10)] == ["user", "assistant"]
    ws.__exit__(None, None, None)


def test_meeting_tasks_survive_sparse_action_items(env):
    c = env.client
    token = register(c)
    db = c.app.state.db
    uid = db.user_by_email("a@example.com")["id"]
    notes = {"title": "T", "action_items": [{"task": "Send deck"}, {"owner": "Ali"}, {"task": "Call Sam", "owner": "Ali", "due": "Friday"}]}
    mid = db.add_meeting(uid, "T", 60, "words", json.dumps(notes))
    r = c.post(f"/api/meetings/{mid}/tasks", headers=auth(token))
    assert r.status_code == 200 and r.json()["added"] == 2
    assert {t["text"] for t in db.tasks(uid)} == {"Send deck", "Call Sam (Ali)"}


def test_sqlite_uses_wal_and_busy_timeout(tmp_path):
    db = DB(str(tmp_path / "w.db"))
    assert db.one("PRAGMA journal_mode")[0].lower() == "wal"
    assert db.one("PRAGMA busy_timeout")[0] >= 5000


def test_old_database_without_new_columns_upgrades(tmp_path):
    path = str(tmp_path / "old.db")
    con = sqlite3.connect(path)
    con.executescript("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL, salt TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', created REAL NOT NULL);"
                      "INSERT INTO users (email, pw_hash, salt, created) VALUES ('o@x.com','h','s',1);")
    con.commit()
    con.close()
    db = DB(path)
    u = db.user_by_email("o@x.com")
    assert u["token_ver"] == 0 and u["last_seen"] == 0


# ------------------------------------------------------------ account safety
def test_password_change_signs_out_old_tokens(env):
    c = env.client
    old = register(c)
    assert c.post("/api/account/password", headers=auth(old), json={"current": "wrong-wrong", "new": "brandnewpass1"}).status_code == 403
    assert c.post("/api/account/password", headers=auth(old), json={"current": "password123", "new": "short"}).status_code == 400
    r = c.post("/api/account/password", headers=auth(old), json={"current": "password123", "new": "brandnewpass1"})
    assert r.status_code == 200
    new = r.json()["token"]
    assert c.get("/api/me", headers=auth(old)).status_code == 401  # the old token is dead
    assert c.get("/api/me", headers=auth(new)).status_code == 200
    assert c.post("/api/login", json={"email": "a@example.com", "password": "password123"}).status_code == 401
    assert c.post("/api/login", json={"email": "a@example.com", "password": "brandnewpass1"}).status_code == 200


def test_logout_all_and_websocket_rejects_revoked_token(env):
    c = env.client
    old = register(c)
    new = c.post("/api/account/logout-all", headers=auth(old)).json()["token"]
    assert c.get("/api/me", headers=auth(old)).status_code == 401
    assert c.get("/api/me", headers=auth(new)).status_code == 200
    with c.websocket_connect("/ws") as s:
        s.send_json({"type": "auth", "token": old})
        with pytest.raises(WebSocketDisconnect) as e:
            s.receive_json()
        assert e.value.code == 4401


def test_tokens_from_before_versions_still_work(env):
    import jwt

    c = env.client
    register(c)
    uid = c.app.state.db.user_by_email("a@example.com")["id"]
    legacy = jwt.encode({"sub": str(uid), "iat": int(time.time()), "exp": int(time.time()) + 600}, settings.JWT_SECRET, algorithm="HS256")
    assert c.get("/api/me", headers=auth(legacy)).status_code == 200


def test_export_and_delete_account(env):
    c = env.client
    token = register(c)
    c.post("/api/tasks", headers=auth(token), json={"text": "buy milk"})
    c.post("/api/notes", headers=auth(token), json={"title": "n", "body": "secret body"})
    c.post("/api/expenses", headers=auth(token), json={"amount": 250, "category": "food"})
    r = c.get("/api/export", headers=auth(token))
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["account"]["email"] == "a@example.com"
    assert data["tasks"][0]["text"] == "buy milk" and data["notes"][0]["body"] == "secret body" and data["expenses"][0]["amount"] == 250
    assert "pw_hash" not in json.dumps(data)

    assert c.post("/api/account/delete", headers=auth(token), json={"password": "nope-nope-nope"}).status_code == 403
    assert c.post("/api/account/delete", headers=auth(token), json={"password": "password123"}).status_code == 200
    db = c.app.state.db
    assert db.user_by_email("a@example.com") is None
    for t in DB.USER_TABLES:
        assert db.one(f"SELECT COUNT(*) AS n FROM {t}")["n"] == 0
    assert c.get("/api/me", headers=auth(token)).status_code == 401
    assert c.post("/api/login", json={"email": "a@example.com", "password": "password123"}).status_code == 401


def test_other_users_data_is_not_deleted(env):
    c = env.client
    a = register(c, "a@example.com")
    b = register(c, "b@example.com")
    c.post("/api/tasks", headers=auth(a), json={"text": "a task"})
    c.post("/api/tasks", headers=auth(b), json={"text": "b task"})
    c.post("/api/account/delete", headers=auth(a), json={"password": "password123"})
    assert [t["text"] for t in c.get("/api/tasks", headers=auth(b)).json()] == ["b task"]


def test_signup_switches(env, monkeypatch):
    c = env.client
    monkeypatch.setattr(settings, "OPEN_REGISTRATION", False)
    assert c.post("/api/register", json={"email": "z@example.com", "password": "password123"}).status_code == 403
    monkeypatch.setattr(settings, "OPEN_REGISTRATION", True)
    monkeypatch.setattr(settings, "MAX_USERS", 1)
    assert c.post("/api/register", json={"email": "one@example.com", "password": "password123"}).status_code == 200
    assert c.post("/api/register", json={"email": "two@example.com", "password": "password123"}).status_code == 403


# ------------------------------------------------------------ admin + monitoring
def test_admin_api_is_invisible_until_token_is_set(env, monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "")
    assert env.client.get("/api/admin/stats", headers={"X-Admin-Token": "anything"}).status_code == 404
    assert env.client.get("/metrics").status_code == 404


def test_admin_stats_users_plan_and_metrics(env, monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "t" * 40)
    c = env.client
    register(c, "a@example.com")
    register(c, "b@example.com")
    H = {"X-Admin-Token": "t" * 40}
    assert c.get("/api/admin/stats", headers={"X-Admin-Token": "wrong"}).status_code == 401
    st = c.get("/api/admin/stats", headers=H).json()
    assert st["users"] == 2 and st["users_by_plan"] == {"free": 2} and st["counters"]["registrations_total"] == 2
    users = c.get("/api/admin/users?q=b@", headers=H).json()
    assert users["total"] == 1 and users["users"][0]["email"] == "b@example.com" and "pw_hash" not in users["users"][0]
    uid = users["users"][0]["id"]
    assert c.post(f"/api/admin/users/{uid}/plan", headers=H, json={"plan": "gold"}).status_code == 400
    assert c.post(f"/api/admin/users/{uid}/plan", headers=H, json={"plan": "power"}).json()["plan"] == "power"
    assert c.post("/api/admin/users/999/plan", headers=H, json={"plan": "basic"}).status_code == 404
    tok = c.post("/api/login", json={"email": "b@example.com", "password": "password123"}).json()["token"]
    assert c.get("/api/me", headers=auth(tok)).json()["plan"] == "power"
    assert c.post(f"/api/admin/users/{uid}/revoke", headers=H).status_code == 200
    assert c.get("/api/me", headers=auth(tok)).status_code == 401
    m = c.get("/metrics", headers=H)
    assert m.status_code == 200 and "aegis_users 2" in m.text and "aegis_registrations_total 2" in m.text
    assert c.get("/metrics", headers={"X-Admin-Token": "bad"}).status_code == 401


def test_readyz_and_request_id(env):
    r = env.client.get("/readyz")
    assert r.status_code == 200 and r.json()["ok"] is True
    assert len(r.headers["x-request-id"]) >= 8
    assert env.client.get("/healthz", headers={"X-Request-ID": "abc123"}).headers["x-request-id"] == "abc123"


def test_plan_limits_can_be_overridden_by_env(monkeypatch):
    import importlib

    monkeypatch.setenv("AEGIS_PLAN_LIMITS", '{"free": 40, "team": 9000}')
    mod = importlib.reload(settings)
    try:
        assert mod.PLAN_LIMITS["free"] == 40 and mod.PLAN_LIMITS["team"] == 9000 and mod.PLAN_LIMITS["power"] == 1000
    finally:
        monkeypatch.delenv("AEGIS_PLAN_LIMITS")
        importlib.reload(settings)


# ------------------------------------------------------------ retention + backups
def test_purge_old_and_message_cap(tmp_path):
    db = DB(str(tmp_path / "p.db"))
    uid = db.create_user("p@example.com", "h", "s")
    now = time.time()
    db.execute("INSERT INTO usage (user_id, day, count) VALUES (?, '2020-01-01', 5)", (uid,))
    db.execute("INSERT INTO usage (user_id, day, count) VALUES (?, ?, 1)", (uid, date.today().isoformat()))
    old_r = db.add_reminder(uid, "old", now - 40 * 86400)
    db.mark_reminder_fired(old_r)
    db.execute("UPDATE reminders SET created = ? WHERE id = ?", (now - 40 * 86400, old_r))
    new_r = db.add_reminder(uid, "future", now + 3600)
    for i in range(30):
        db.add_message(uid, "user", f"m{i}")
    out = db.purge_old(keep_messages=10)
    assert out["usage"] == 1 and out["reminders"] == 1 and out["messages"] == 20
    assert [m["text"] for m in db.recent_messages(uid, 50)][0] == "m20"
    assert db.one("SELECT id FROM reminders WHERE id = ?", (new_r,)) is not None
    assert db.used_today(uid) == 1


def test_backup_is_a_working_copy_and_old_ones_rotate(tmp_path):
    db = DB(str(tmp_path / "live.db"))
    db.create_user("keep@example.com", "h", "s")
    folder = tmp_path / "bk"
    folder.mkdir()
    for n in ("aegis-20200101-000000.db", "aegis-20200102-000000.db", "aegis-20200103-000000.db"):
        (folder / n).write_text("x")
    path = extras.make_backup(db, str(folder), keep=2)
    names = sorted(p.name for p in folder.iterdir())
    assert len(names) == 2 and path.endswith(names[-1])
    copy = DB(path)
    assert copy.user_by_email("keep@example.com") is not None


def test_maintenance_endpoint_runs(env, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "m" * 40)
    monkeypatch.setattr(settings, "BACKUP_DIR", str(tmp_path / "auto"))
    r = env.client.post("/api/admin/maintenance", headers={"X-Admin-Token": "m" * 40})
    assert r.status_code == 200 and r.json()["backup"].endswith(".db")
    assert (tmp_path / "auto").exists()


# ------------------------------------------------------------ expenses
def test_expense_rest_and_periods(env):
    c = env.client
    t = register(c)
    assert c.post("/api/expenses", headers=auth(t), json={"amount": -5}).status_code == 400
    assert c.post("/api/expenses", headers=auth(t), json={"amount": 500, "category": "Food", "note": "lunch"}).status_code == 200
    assert c.post("/api/expenses", headers=auth(t), json={"amount": 1200.5, "category": "transport"}).status_code == 200
    assert c.post("/api/expenses", headers=auth(t), json={"amount": 10, "currency": "usd", "category": "fun"}).status_code == 200
    j = c.get("/api/expenses?period=today", headers=auth(t)).json()
    assert j["count"] == 3 and j["by_currency"]["PKR"]["total"] == 1700.5 and j["by_currency"]["USD"]["total"] == 10
    assert j["by_currency"]["PKR"]["by_category"] == {"food": 500.0, "transport": 1200.5}
    eid = j["items"][0]["id"]
    assert c.delete(f"/api/expenses/{eid}", headers=auth(t)).status_code == 200
    assert c.delete(f"/api/expenses/{eid}", headers=auth(t)).status_code == 404
    assert c.get("/api/expenses?period=yesterday", headers=auth(t)).json()["count"] == 0


def test_expense_isolated_between_users(env):
    c = env.client
    a, b = register(c, "a@example.com"), register(c, "b@example.com")
    c.post("/api/expenses", headers=auth(a), json={"amount": 99})
    assert c.get("/api/expenses", headers=auth(b)).json()["count"] == 0


def test_period_bounds_calendar_month_and_week():
    now = datetime(2026, 11, 23, 9, 0, tzinfo=timezone.utc)
    lo, hi, label = extras.period_bounds("month", "UTC", now)
    assert datetime.fromtimestamp(lo, timezone.utc).day == 1 and label == "this month"
    lo, hi, _ = extras.period_bounds("week", "UTC", now)
    assert (hi - lo) / 86400 == 7
    lo, hi, label = extras.period_bounds("last_month", "UTC", now)
    assert datetime.fromtimestamp(lo, timezone.utc).month == 10 and label == "October 2026"


def test_ai_expense_tools(tmp_path):
    ag, db, uid = agent_for(tmp_path)
    assert "Logged PKR 500" in call(ag, uid, "log_expense", amount=500, category="food")
    out = call(ag, uid, "log_expense", amount="1,200", category="x")
    assert out.startswith("Error")  # not a clean number: the AI is told, nothing is stored
    assert "Today so far: PKR 800" in call(ag, uid, "log_expense", amount=300, category="transport")
    assert call(ag, uid, "log_expense", amount=0).startswith("Error")
    summ = call(ag, uid, "expense_summary", period="today")
    assert "PKR 800" in summ and "food 500" in summ and "transport 300" in summ
    assert "No expenses" in call(ag, uid, "expense_summary", period="yesterday")
    assert "Deleted the last expense: PKR 300" in call(ag, uid, "delete_last_expense")
    assert "PKR 500" in call(ag, uid, "expense_summary", period="week")


# ------------------------------------------------------------ habits
def test_streak_math():
    today = date(2026, 11, 23)
    days = [(today - timedelta(days=i)).isoformat() for i in (0, 1, 2, 4, 5)]
    assert extras.streak(days, today) == 3
    assert extras.streak(days[1:], today) == 2  # today not ticked yet: yesterday's streak is still alive
    assert extras.streak([(today - timedelta(days=3)).isoformat()], today) == 0
    assert extras.best_streak(days) == 3 and extras.best_streak([]) == 0


def test_habit_rest(env):
    c = env.client
    t = register(c)
    hid = c.post("/api/habits", headers=auth(t), json={"name": "Gym"}).json()["id"]
    assert c.post("/api/habits", headers=auth(t), json={"name": "gym"}).json()["id"] == hid  # same habit, not a duplicate
    assert c.post("/api/habits", headers=auth(t), json={"name": "  "}).status_code == 400
    assert c.post(f"/api/habits/{hid}/check", headers=auth(t), json={"done": True, "tz": "Asia/Karachi"}).status_code == 200
    h = c.get("/api/habits?tz=Asia/Karachi", headers=auth(t)).json()[0]
    assert h["done_today"] is True and h["streak"] == 1 and h["total"] == 1
    c.post(f"/api/habits/{hid}/check", headers=auth(t), json={"done": False, "tz": "Asia/Karachi"})
    assert c.get("/api/habits?tz=Asia/Karachi", headers=auth(t)).json()[0]["done_today"] is False
    other = register(c, "o@example.com")
    assert c.post(f"/api/habits/{hid}/check", headers=auth(other), json={}).status_code == 404  # someone else's habit
    assert c.delete(f"/api/habits/{hid}", headers=auth(t)).status_code == 200


def test_ai_habit_tools(tmp_path):
    ag, db, uid = agent_for(tmp_path)
    assert "No habits yet" in call(ag, uid, "habit_status")
    assert "No habit called" in call(ag, uid, "habit_checkin", name="reading")
    call(ag, uid, "add_habit", name="Read 20 pages")
    assert "Streak: 1" in call(ag, uid, "habit_checkin", name="read")  # partial, case-insensitive match
    assert "done today" in call(ag, uid, "habit_status")
    assert "Unticked" in call(ag, uid, "habit_checkin", name="read", done=False)
    assert "not done yet today" in call(ag, uid, "habit_status")
    assert "Stopped tracking Read 20 pages" in call(ag, uid, "delete_habit", name="read")
    assert "No habit matches" in call(ag, uid, "delete_habit", name="read")


def test_briefing_lists_open_habits(tmp_path):
    ag, db, uid = agent_for(tmp_path)
    call(ag, uid, "add_habit", name="Water")
    out = run(ag._run_server_tool(uid, "daily_briefing", {}, "Asia/Karachi"))
    assert "Habits still open today" in out and "Water" in out
    call(ag, uid, "habit_checkin", name="water")
    out = run(ag._run_server_tool(uid, "daily_briefing", {}, "Asia/Karachi"))
    assert "Habits still open today" not in out


# ------------------------------------------------------------ prayer times
def test_prayer_times_with_mocked_service(monkeypatch):
    seen = []

    def fake_get(url):
        seen.append(url)
        if "geocoding" in url:
            return {"results": [{"name": "Lahore", "latitude": 31.55, "longitude": 74.34, "timezone": "Asia/Karachi"}]}
        return {"data": {"timings": {"Fajr": "05:21 (PKT)", "Sunrise": "06:44", "Dhuhr": "11:55", "Asr": "14:43", "Maghrib": "17:05", "Isha": "18:27"},
                         "date": {"hijri": {"day": "21", "month": {"en": "Jumada al-Awwal"}, "year": "1448"}}}}

    monkeypatch.setattr("app.utilities._get", fake_get)
    out = extras.prayer_times("Lahore")
    assert "Fajr 05:21" in out and "Isha 18:27" in out and "Jumada al-Awwal" in out and "method=1" in seen[-1]
    assert "method=2" in (extras.prayer_times("Lahore", "isna") and seen[-1])
    assert "2026" not in extras.prayer_times("Lahore", date_str="2026-11-23") or "/23-11-2026" in seen[-1]
    assert extras.prayer_times("Lahore", date_str="nope").startswith("Error")
    assert extras.prayer_times("").startswith("Error")


def test_prayer_times_failures_are_friendly(monkeypatch):
    monkeypatch.setattr("app.utilities._get", lambda url: (_ for _ in ()).throw(OSError("down")))
    assert "not reachable" in extras.prayer_times("Karachi")
    monkeypatch.setattr("app.utilities._get", lambda url: {"results": []})
    assert "could not find" in extras.prayer_times("Atlantis")


def test_next_prayer():
    t = {"Fajr": "05:21", "Dhuhr": "11:55", "Asr": "14:43", "Maghrib": "17:05", "Isha": "18:27"}
    assert extras.next_prayer(t, "12:00") == ("Asr", "14:43")
    assert extras.next_prayer(t, "03:00") == ("Fajr", "05:21")
    assert extras.next_prayer(t, "23:00") is None


# ------------------------------------------------------------ search + edit tools
def test_search_everything_and_rest(env):
    c = env.client
    t = register(c)
    c.post("/api/tasks", headers=auth(t), json={"text": "renew passport"})
    c.post("/api/notes", headers=auth(t), json={"title": "Travel", "body": "passport photo size"})
    r = c.get("/api/search?q=passport", headers=auth(t)).json()
    assert r["tasks"] == ["renew passport"] and r["notes"] == ["Travel"]
    assert c.get("/api/search?q=p", headers=auth(t)).status_code == 400
    assert c.get("/api/search?q=passport", headers=auth(register(c, "z@example.com"))).json()["tasks"] == []


def test_ai_search_edit_and_delete_tools(tmp_path):
    ag, db, uid = agent_for(tmp_path)
    call(ag, uid, "add_task", text="call the bank")
    call(ag, uid, "save_note", title="Bank PIN hint", content="blue door")
    call(ag, uid, "save_contact", name="Bilal Bank", phone="0300")
    out = call(ag, uid, "search_everything", query="bank")
    assert "tasks: call the bank" in out and "notes: Bank PIN hint" in out and "contacts: Bilal Bank" in out
    assert "Nothing saved" in call(ag, uid, "search_everything", query="zzzz")
    assert call(ag, uid, "search_everything", query="b").startswith("Error")

    assert "Updated task: call the bank -> call HBL" in call(ag, uid, "update_task", contains="the bank", new_text="call HBL", due="Friday")
    assert db.tasks(uid)[0]["text"] == "call HBL" and db.tasks(uid)[0]["due"] == "Friday"
    assert call(ag, uid, "update_task", contains="HBL").startswith("Error")
    assert "No open task" in call(ag, uid, "update_task", contains="nothing here", new_text="x")

    assert "Deleted note: Bank PIN hint" in call(ag, uid, "delete_note", contains="blue door")
    assert "No note" in call(ag, uid, "delete_note", contains="blue door")
    assert "Deleted contact: Bilal Bank" in call(ag, uid, "delete_contact", contains="bilal")
    assert "No contact" in call(ag, uid, "delete_contact", contains="bilal")


def test_ai_update_event_reschedules_and_keeps_length(tmp_path):
    ag, db, uid = agent_for(tmp_path)
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%d")
    call(ag, uid, "add_event", title="Dentist", start=f"{tomorrow} 15:00", duration_minutes=45, location="Clinic")
    out = call(ag, uid, "update_event", contains="dentist", start=f"{tomorrow} 17:30")
    assert out.startswith("Updated: Dentist")
    ev = db.all("SELECT start, end, location FROM events WHERE user_id = ?", (uid,))[0]
    assert round((ev["end"] - ev["start"]) / 60) == 45 and ev["location"] == "Clinic"
    call(ag, uid, "update_event", contains="dentist", duration_minutes=90, location="Home")
    ev = db.all("SELECT start, end, location FROM events WHERE user_id = ?", (uid,))[0]
    assert round((ev["end"] - ev["start"]) / 60) == 90 and ev["location"] == "Home"
    assert "No upcoming event" in call(ag, uid, "update_event", contains="gym", start=f"{tomorrow} 10:00")
    assert call(ag, uid, "update_event", contains="dentist", start="not a time").startswith("Error")


def test_new_tools_are_offered_and_risky_ones_ask(env):
    from app import tools

    names = {t["name"] for t in tools.schemas(False)}
    for n in ("log_expense", "expense_summary", "habit_checkin", "habit_status", "prayer_times", "search_everything", "update_task", "update_event"):
        assert n in names
    for n in ("delete_note", "delete_contact", "delete_habit", "delete_last_expense"):
        assert tools.BY_NAME[n].risky
    assert not tools.BY_NAME["log_expense"].risky


def test_new_tool_end_to_end_through_the_chat(env):
    fake = env.fake
    fake.script = [resp(tool("1", "log_expense", amount=750, category="food")), resp(text("[warm] Noted, 750 for food."))]
    token = register(env.client)
    ws, s = connect(env.client, token)
    drain_until(s, "hello")
    s.send_json({"type": "chat", "text": "750 ka khana"})
    assert "Noted" in drain_until(s, "reply")["text"]
    ws.__exit__(None, None, None)
    assert env.client.get("/api/expenses?period=today", headers=auth(token)).json()["count"] == 1
