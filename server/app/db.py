import sqlite3
import threading
import time
from datetime import date, timedelta

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, id);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  due TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, done);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  due REAL NOT NULL,
  fired INTEGER NOT NULL DEFAULT 0,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(fired, due);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  start REAL NOT NULL,
  end REAL NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, start);
CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_log_user ON email_log(user_id, day);
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  transcript TEXT NOT NULL,
  notes TEXT NOT NULL,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_user ON meetings(user_id, id);
CREATE TABLE IF NOT EXISTS moods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mood TEXT NOT NULL,
  intensity INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'auto',
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moods_user ON moods(user_id, created);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  category TEXT NOT NULL DEFAULT 'other',
  note TEXT NOT NULL DEFAULT '',
  spent REAL NOT NULL,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id, spent);
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
CREATE TABLE IF NOT EXISTS habit_log (
  habit_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (habit_id, day)
);
CREATE TABLE IF NOT EXISTS bond (
  user_id INTEGER PRIMARY KEY,
  turns INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 0,
  shared INTEGER NOT NULL DEFAULT 0,
  last_day TEXT NOT NULL DEFAULT '',
  first REAL NOT NULL DEFAULT 0,
  last REAL NOT NULL DEFAULT 0,
  prev_last REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
"""


class DB:
    def __init__(self, path: str):
        self.conn = sqlite3.connect(path, check_same_thread=False, timeout=15)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            # WAL lets readers and the writer work at the same time and survives a crash mid-write; busy_timeout stops
            # "database is locked" errors when another process (backup script, admin tool) touches the file.
            for pragma in ("journal_mode=WAL", "synchronous=NORMAL", "busy_timeout=15000", "temp_store=MEMORY"):
                try:
                    self.conn.execute("PRAGMA " + pragma)
                except sqlite3.DatabaseError:
                    pass  # e.g. :memory: databases do not support WAL
            self.conn.executescript(SCHEMA)
            self._migrate()
            self.conn.commit()

    def _migrate(self):
        """Add columns that older databases do not have yet (safe to run on every start)."""
        cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(reminders)")}
        if "repeat" not in cols:
            self.conn.execute("ALTER TABLE reminders ADD COLUMN repeat TEXT NOT NULL DEFAULT ''")
        if "tz" not in cols:
            self.conn.execute("ALTER TABLE reminders ADD COLUMN tz TEXT NOT NULL DEFAULT ''")
        ucols = {r["name"] for r in self.conn.execute("PRAGMA table_info(users)")}
        if "token_ver" not in ucols:
            self.conn.execute("ALTER TABLE users ADD COLUMN token_ver INTEGER NOT NULL DEFAULT 0")
        if "last_seen" not in ucols:
            self.conn.execute("ALTER TABLE users ADD COLUMN last_seen REAL NOT NULL DEFAULT 0")
        fcols = {r["name"] for r in self.conn.execute("PRAGMA table_info(facts)")}
        if "kind" not in fcols:
            self.conn.execute("ALTER TABLE facts ADD COLUMN kind TEXT NOT NULL DEFAULT 'fact'")
        if "weight" not in fcols:
            self.conn.execute("ALTER TABLE facts ADD COLUMN weight INTEGER NOT NULL DEFAULT 1")
        # v13: memories remember how the user felt, how often they mattered, where they came from, and yearly dates
        for col, ddl in (("last_used", "REAL NOT NULL DEFAULT 0"), ("uses", "INTEGER NOT NULL DEFAULT 0"), ("mood", "TEXT NOT NULL DEFAULT ''"),
                         ("mood_level", "INTEGER NOT NULL DEFAULT 0"), ("source", "TEXT NOT NULL DEFAULT 'ai'"), ("when_md", "TEXT NOT NULL DEFAULT ''")):
            if col not in fcols:
                self.conn.execute(f"ALTER TABLE facts ADD COLUMN {col} {ddl}")

    def execute(self, sql, params=()):
        with self.lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur

    def one(self, sql, params=()):
        with self.lock:
            return self.conn.execute(sql, params).fetchone()

    def all(self, sql, params=()):
        with self.lock:
            return self.conn.execute(sql, params).fetchall()

    # ---- users ----
    def create_user(self, email, pw_hash, salt):
        cur = self.execute(
            "INSERT INTO users (email, pw_hash, salt, created) VALUES (?, ?, ?, ?)",
            (email, pw_hash, salt, time.time()),
        )
        return cur.lastrowid

    def user_by_email(self, email):
        return self.one("SELECT * FROM users WHERE email = ?", (email,))

    def user_by_id(self, uid):
        return self.one("SELECT * FROM users WHERE id = ?", (uid,))

    def set_plan(self, email, plan):
        return self.execute("UPDATE users SET plan = ? WHERE email = ?", (plan, email)).rowcount

    def set_password(self, uid, pw_hash, salt):
        """Change a password. Bumps token_ver so every token issued before this moment stops working."""
        return self.execute("UPDATE users SET pw_hash = ?, salt = ?, token_ver = token_ver + 1 WHERE id = ?", (pw_hash, salt, uid)).rowcount

    def revoke_tokens(self, uid):
        """Sign the user out everywhere (all previously issued tokens become invalid)."""
        self.execute("UPDATE users SET token_ver = token_ver + 1 WHERE id = ?", (uid,))
        row = self.one("SELECT token_ver FROM users WHERE id = ?", (uid,))
        return row["token_ver"] if row else 0

    def touch_user(self, uid, now=None, every=300):
        """Remember when the user was last active (written at most every few minutes, so it costs almost nothing)."""
        now = now if now is not None else time.time()
        self.execute("UPDATE users SET last_seen = ? WHERE id = ? AND last_seen < ?", (now, uid, now - every))

    def count_users(self, q=""):
        if q:
            return self.one("SELECT COUNT(*) AS n FROM users WHERE email LIKE ?", (f"%{q}%",))["n"]
        return self.one("SELECT COUNT(*) AS n FROM users")["n"]

    def list_users(self, limit=50, offset=0, q=""):
        limit, offset = max(1, min(200, int(limit))), max(0, int(offset))
        sql = "SELECT id, email, plan, created, last_seen FROM users"
        params = []
        if q:
            sql += " WHERE email LIKE ?"
            params.append(f"%{q}%")
        sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
        return [dict(r) for r in self.all(sql, (*params, limit, offset))]

    # tables that hold one user's data, and how each is keyed to the user
    USER_TABLES = ("facts", "messages", "tasks", "reminders", "notes", "contacts", "events", "routines", "email_log", "meetings", "moods", "usage", "expenses", "habits", "habit_log", "bond")

    def delete_user(self, uid):
        """Erase the account and every row that belongs to it (right to be forgotten)."""
        with self.lock:
            for t in self.USER_TABLES:
                self.conn.execute(f"DELETE FROM {t} WHERE user_id = ?", (uid,))
            n = self.conn.execute("DELETE FROM users WHERE id = ?", (uid,)).rowcount
            self.conn.commit()
            return n

    def export_user(self, uid):
        """Everything stored about one user, as plain data (for the 'download my data' button)."""
        u = self.user_by_id(uid)
        if not u:
            return None
        data = {"account": {"email": u["email"], "plan": u["plan"], "created": u["created"]}}
        for t in ("facts", "messages", "tasks", "reminders", "notes", "contacts", "events", "routines", "meetings", "moods", "expenses", "habits"):
            data[t] = [{k: r[k] for k in r.keys() if k != "user_id"} for r in self.all(f"SELECT * FROM {t} WHERE user_id = ? ORDER BY id", (uid,))]
        data["bond"] = [{k: r[k] for k in r.keys() if k != "user_id"} for r in self.all("SELECT * FROM bond WHERE user_id = ?", (uid,))]
        data["habit_log"] = [dict(day=r["day"], habit_id=r["habit_id"]) for r in self.all("SELECT habit_id, day FROM habit_log WHERE user_id = ?", (uid,))]
        data["usage"] = [dict(day=r["day"], count=r["count"]) for r in self.all("SELECT day, count FROM usage WHERE user_id = ? ORDER BY day", (uid,))]
        return data

    def stats(self):
        """Counts for the admin dashboard / metrics endpoint."""
        day = date.today().isoformat()
        one = lambda sql, p=(): self.one(sql, p)["n"]  # noqa: E731
        return {
            "users": one("SELECT COUNT(*) AS n FROM users"),
            "users_by_plan": {r["plan"]: r["n"] for r in self.all("SELECT plan, COUNT(*) AS n FROM users GROUP BY plan")},
            "active_today": one("SELECT COUNT(*) AS n FROM usage WHERE day = ? AND count > 0", (day,)),
            "messages_today": one("SELECT COALESCE(SUM(count), 0) AS n FROM usage WHERE day = ?", (day,)),
            "new_users_7d": one("SELECT COUNT(*) AS n FROM users WHERE created >= ?", (time.time() - 7 * 86400,)),
            "reminders_pending": one("SELECT COUNT(*) AS n FROM reminders WHERE fired = 0"),
            "tasks_open": one("SELECT COUNT(*) AS n FROM tasks WHERE done = 0"),
            "meetings": one("SELECT COUNT(*) AS n FROM meetings"),
        }

    def purge_old(self, now=None, keep_messages=500, usage_days=60, fired_days=7, mood_days=180):
        """Housekeeping so the database does not grow forever. Returns how many rows were removed per table."""
        now = now if now is not None else time.time()
        out = {}
        with self.lock:
            cur = self.conn.execute("DELETE FROM usage WHERE day < ?", ((date.fromtimestamp(now) - timedelta(days=usage_days)).isoformat(),))
            out["usage"] = cur.rowcount
            cur = self.conn.execute("DELETE FROM email_log WHERE created < ?", (now - usage_days * 86400,))
            out["email_log"] = cur.rowcount
            cur = self.conn.execute("DELETE FROM reminders WHERE fired = 1 AND created < ? AND due < ?", (now - fired_days * 86400, now - fired_days * 86400))
            out["reminders"] = cur.rowcount
            cur = self.conn.execute("DELETE FROM moods WHERE created < ?", (now - mood_days * 86400,))
            out["moods"] = cur.rowcount
            # keep only the newest N chat messages per user
            cur = self.conn.execute(
                "DELETE FROM messages WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id DESC) AS rn FROM messages) WHERE rn > ?)",
                (keep_messages,),
            )
            out["messages"] = cur.rowcount
            self.conn.commit()
        return out

    def backup_to(self, dest_path):
        """Consistent online copy of the whole database (safe while the server is running)."""
        import sqlite3 as _s

        dest = _s.connect(dest_path)
        try:
            with self.lock:
                self.conn.backup(dest)
        finally:
            dest.close()

    def healthy(self):
        try:
            return self.one("SELECT 1 AS ok")["ok"] == 1
        except Exception:
            return False

    # ---- usage / quota ----
    def used_today(self, uid) -> int:
        row = self.one("SELECT count FROM usage WHERE user_id = ? AND day = ?", (uid, date.today().isoformat()))
        return row["count"] if row else 0

    def try_consume(self, uid, limit) -> bool:
        """Atomically count one message if under the limit."""
        day = date.today().isoformat()
        with self.lock:
            row = self.conn.execute(
                "SELECT count FROM usage WHERE user_id = ? AND day = ?", (uid, day)
            ).fetchone()
            used = row["count"] if row else 0
            if used >= limit:
                return False
            self.conn.execute(
                "INSERT INTO usage (user_id, day, count) VALUES (?, ?, 1) "
                "ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1",
                (uid, day),
            )
            self.conn.commit()
            return True

    def refund(self, uid):
        """Give back one message (used when the AI service itself failed)."""
        self.execute(
            "UPDATE usage SET count = MAX(count - 1, 0) WHERE user_id = ? AND day = ?",
            (uid, date.today().isoformat()),
        )

    # ---- memory ----
    FACT_KINDS = ("fact", "preference", "person", "event", "goal", "emotion")

    @staticmethod
    def _words(text):
        import re

        return set(re.findall(r"\w+", str(text).lower()))

    def add_fact(self, uid, text, kind="fact", important=False, mood="", level=0, source="ai", when_md=""):
        """Save a memory. A near-duplicate (80% same words) is merged into the old one instead of piling up.
        mood/level: how the user felt when it was shared (so strong moments are remembered more strongly)."""
        text = text.strip()
        kind = kind if kind in self.FACT_KINDS else "fact"
        level = max(0, min(5, int(level or 0)))
        new = self._words(text)
        for r in self.all("SELECT id, text, weight, mood, mood_level, when_md FROM facts WHERE user_id = ?", (uid,)):
            old = self._words(r["text"])
            if new and old and len(new & old) / len(new | old) >= 0.8:
                keep_mood = (mood, level) if (mood and level >= r["mood_level"]) else (r["mood"], r["mood_level"])
                self.execute(
                    "UPDATE facts SET text = ?, kind = ?, weight = ?, created = ?, mood = ?, mood_level = ?, when_md = ? WHERE id = ? AND user_id = ?",
                    (text, kind, min(5, max(r["weight"] + 1, 3 if important else 1)), time.time(), keep_mood[0], keep_mood[1], when_md or r["when_md"], r["id"], uid),
                )
                return r["id"]
        weight = 3 if important else 1
        if level >= 4:
            weight = max(weight, 3)  # something they felt strongly about matters
        return self.execute(
            "INSERT INTO facts (user_id, text, created, kind, weight, mood, mood_level, source, when_md) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (uid, text, time.time(), kind, weight, mood or "", level, source if source in ("ai", "auto", "user") else "ai", when_md or ""),
        ).lastrowid

    def facts(self, uid):
        return self.all("SELECT id, text, created, kind, weight, last_used, uses, mood, mood_level, source, when_md FROM facts WHERE user_id = ? ORDER BY id DESC", (uid,))

    def touch_facts(self, uid, ids):
        """A memory that gets used again matters more: remember when and how often."""
        ids = [int(i) for i in ids]
        if not ids:
            return 0
        marks = ",".join("?" * len(ids))
        return self.execute(f"UPDATE facts SET uses = uses + 1, last_used = ? WHERE user_id = ? AND id IN ({marks})", (time.time(), uid, *ids)).rowcount

    def update_fact_text(self, uid, fact_id, text, weight=None):
        if weight is None:
            return self.execute("UPDATE facts SET text = ? WHERE id = ? AND user_id = ?", (text, fact_id, uid)).rowcount
        return self.execute("UPDATE facts SET text = ?, weight = ? WHERE id = ? AND user_id = ?", (text, int(weight), fact_id, uid)).rowcount

    # ---- the bond between Aegis and the user (how well they know each other) ----
    def bond_tick(self, uid, day, emotional=False, now=None):
        """Count one chat turn. `day` is the user's local date (YYYY-MM-DD); `emotional` = they shared a real feeling."""
        now = now or time.time()
        row = self.one("SELECT * FROM bond WHERE user_id = ?", (uid,))
        if not row:
            self.execute("INSERT INTO bond (user_id, turns, days, shared, last_day, first, last, prev_last) VALUES (?, 1, 1, ?, ?, ?, ?, 0)",
                         (uid, 1 if emotional else 0, day, now, now))
            return
        new_day = row["last_day"] != day
        self.execute(
            "UPDATE bond SET turns = turns + 1, days = days + ?, shared = shared + ?, last_day = ?, prev_last = CASE WHEN ? THEN last ELSE prev_last END, last = ? WHERE user_id = ?",
            (1 if new_day else 0, 1 if emotional else 0, day, 1 if new_day else 0, now, uid),
        )

    def bond_row(self, uid):
        r = self.one("SELECT turns, days, shared, first, last, prev_last FROM bond WHERE user_id = ?", (uid,))
        return dict(r) if r else {"turns": 0, "days": 0, "shared": 0, "first": 0.0, "last": 0.0, "prev_last": 0.0}

    # ---- moods (how the user felt; only the mood name, never their words) ----
    def add_mood(self, uid, mood, intensity=1, note="", source="auto"):
        return self.execute(
            "INSERT INTO moods (user_id, mood, intensity, note, source, created) VALUES (?, ?, ?, ?, ?, ?)",
            (uid, mood, max(1, min(5, int(intensity))), str(note or "").strip()[:200], source, time.time()),
        ).lastrowid

    def moods(self, uid, since=0.0, limit=500):
        """Newest first."""
        return [
            dict(r)
            for r in self.all(
                "SELECT id, mood, intensity, note, source, created FROM moods WHERE user_id = ? AND created >= ? ORDER BY id DESC LIMIT ?",
                (uid, since, limit),
            )
        ]

    def clear_moods(self, uid):
        return self.execute("DELETE FROM moods WHERE user_id = ?", (uid,)).rowcount

    def delete_fact(self, uid, fact_id):
        return self.execute("DELETE FROM facts WHERE id = ? AND user_id = ?", (fact_id, uid)).rowcount

    def delete_facts_containing(self, uid, text):
        return self.execute(
            "DELETE FROM facts WHERE user_id = ? AND text LIKE ?", (uid, f"%{text}%")
        ).rowcount

    # ---- chat history ----
    def add_message(self, uid, role, text):
        self.execute(
            "INSERT INTO messages (user_id, role, text, created) VALUES (?, ?, ?, ?)",
            (uid, role, text, time.time()),
        )

    def recent_messages(self, uid, limit=30):
        rows = self.all(
            "SELECT role, text FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?", (uid, limit)
        )
        return [dict(r) for r in reversed(rows)]

    def clear_messages(self, uid):
        self.execute("DELETE FROM messages WHERE user_id = ?", (uid,))

    # ---- tasks ----
    def add_task(self, uid, text, due=""):
        return self.execute(
            "INSERT INTO tasks (user_id, text, due, created) VALUES (?, ?, ?, ?)",
            (uid, text.strip()[:300], str(due or "")[:40], time.time()),
        ).lastrowid

    def tasks(self, uid, include_done=True):
        sql = "SELECT id, text, due, done FROM tasks WHERE user_id = ?"
        if not include_done:
            sql += " AND done = 0"
        return [dict(r) for r in self.all(sql + " ORDER BY done, id DESC LIMIT 200", (uid,))]

    def set_task_done(self, uid, task_id, done=True):
        return self.execute(
            "UPDATE tasks SET done = ? WHERE id = ? AND user_id = ?", (1 if done else 0, task_id, uid)
        ).rowcount

    def complete_task_matching(self, uid, text):
        """Mark the newest open task whose text contains `text` as done. Returns the task text or None."""
        row = self.one(
            "SELECT id, text FROM tasks WHERE user_id = ? AND done = 0 AND text LIKE ? ORDER BY id DESC LIMIT 1",
            (uid, f"%{text}%"),
        )
        if not row:
            return None
        self.set_task_done(uid, row["id"], True)
        return row["text"]

    def delete_task_matching(self, uid, text):
        row = self.one("SELECT id, text FROM tasks WHERE user_id = ? AND text LIKE ? ORDER BY done, id DESC LIMIT 1", (uid, f"%{text}%"))
        if not row:
            return None
        self.delete_task(uid, row["id"])
        return row["text"]

    def delete_task(self, uid, task_id):
        return self.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, uid)).rowcount

    # ---- reminders ----
    def add_reminder(self, uid, text, due_ts, repeat="", tz=""):
        return self.execute(
            "INSERT INTO reminders (user_id, text, due, created, repeat, tz) VALUES (?, ?, ?, ?, ?, ?)",
            (uid, text.strip()[:300], float(due_ts), time.time(), repeat, str(tz)[:64]),
        ).lastrowid

    def reminders(self, uid):
        return [dict(r) for r in self.all(
            "SELECT id, text, due, repeat FROM reminders WHERE user_id = ? AND fired = 0 ORDER BY due LIMIT 100", (uid,))]

    def due_reminders(self, now=None):
        return [dict(r) for r in self.all(
            "SELECT id, user_id, text, due, repeat, tz FROM reminders WHERE fired = 0 AND due <= ? ORDER BY due LIMIT 100",
            (now if now is not None else time.time(),))]

    def due_reminders_for(self, uid, now=None):
        return [r for r in self.due_reminders(now) if r["user_id"] == uid]

    def mark_reminder_fired(self, rid):
        """Mark a reminder as delivered. A repeating one immediately schedules its next occurrence."""
        row = self.one("SELECT user_id, text, due, repeat, tz FROM reminders WHERE id = ?", (rid,))
        n = self.execute("UPDATE reminders SET fired = 1 WHERE id = ?", (rid,)).rowcount
        if row and row["repeat"]:
            from . import utilities

            nxt = utilities.next_occurrence(row["due"], row["repeat"], row["tz"])
            if nxt:
                self.add_reminder(row["user_id"], row["text"], nxt, row["repeat"], row["tz"])
        return n

    def delete_reminder(self, uid, rid):
        return self.execute("DELETE FROM reminders WHERE id = ? AND user_id = ?", (rid, uid)).rowcount

    def cancel_reminders_matching(self, uid, text):
        return self.execute(
            "DELETE FROM reminders WHERE user_id = ? AND fired = 0 AND text LIKE ?", (uid, f"%{text}%")
        ).rowcount

    # ---- notes ----
    def add_note(self, uid, title, body):
        return self.execute(
            "INSERT INTO notes (user_id, title, body, created) VALUES (?, ?, ?, ?)",
            (uid, title.strip()[:120] or "Untitled", body.strip()[:8000], time.time()),
        ).lastrowid

    def notes(self, uid, query=""):
        if query:
            like = f"%{query}%"
            rows = self.all(
                "SELECT id, title, body, created FROM notes WHERE user_id = ? AND (title LIKE ? OR body LIKE ?) "
                "ORDER BY id DESC LIMIT 20", (uid, like, like))
        else:
            rows = self.all("SELECT id, title, body, created FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT 100", (uid,))
        return [dict(r) for r in rows]

    def delete_note(self, uid, nid):
        return self.execute("DELETE FROM notes WHERE id = ? AND user_id = ?", (nid, uid)).rowcount

    # ---- contacts ----
    def save_contact(self, uid, name, email="", phone=""):
        """Add a contact, or update the one with the same name (case-insensitive)."""
        name = name.strip()[:80]
        row = self.one("SELECT id, email, phone FROM contacts WHERE user_id = ? AND lower(name) = lower(?)", (uid, name))
        if row:
            self.execute(
                "UPDATE contacts SET email = ?, phone = ? WHERE id = ?",
                ((email or row["email"]).strip()[:200], (phone or row["phone"]).strip()[:40], row["id"]),
            )
            return row["id"]
        return self.execute(
            "INSERT INTO contacts (user_id, name, email, phone, created) VALUES (?, ?, ?, ?, ?)",
            (uid, name, email.strip()[:200], phone.strip()[:40], time.time()),
        ).lastrowid

    def contacts(self, uid, query=""):
        if query:
            like = f"%{query}%"
            rows = self.all(
                "SELECT id, name, email, phone FROM contacts WHERE user_id = ? AND (name LIKE ? OR email LIKE ?) ORDER BY name LIMIT 20",
                (uid, like, like))
        else:
            rows = self.all("SELECT id, name, email, phone FROM contacts WHERE user_id = ? ORDER BY name LIMIT 100", (uid,))
        return [dict(r) for r in rows]

    def delete_contact(self, uid, cid):
        return self.execute("DELETE FROM contacts WHERE id = ? AND user_id = ?", (cid, uid)).rowcount

    # ---- routines (named multi-step workflows the AI runs on request) ----
    def save_routine(self, uid, name, steps):
        name = name.strip()[:60]
        row = self.one("SELECT id FROM routines WHERE user_id = ? AND lower(name) = lower(?)", (uid, name))
        if row:
            self.execute("UPDATE routines SET steps = ? WHERE id = ?", (steps.strip()[:2000], row["id"]))
            return row["id"]
        return self.execute(
            "INSERT INTO routines (user_id, name, steps, created) VALUES (?, ?, ?, ?)",
            (uid, name, steps.strip()[:2000], time.time()),
        ).lastrowid

    def routines(self, uid):
        return [dict(r) for r in self.all("SELECT id, name, steps FROM routines WHERE user_id = ? ORDER BY name LIMIT 50", (uid,))]

    def routine(self, uid, name):
        row = self.one("SELECT id, name, steps FROM routines WHERE user_id = ? AND lower(name) = lower(?)", (uid, name.strip()))
        if not row:
            row = self.one("SELECT id, name, steps FROM routines WHERE user_id = ? AND lower(name) LIKE lower(?) ORDER BY id DESC LIMIT 1", (uid, f"%{name.strip()}%"))
        return dict(row) if row else None

    def delete_routine(self, uid, name):
        return self.execute("DELETE FROM routines WHERE user_id = ? AND lower(name) = lower(?)", (uid, name.strip())).rowcount

    # ---- expenses ----
    def add_expense(self, uid, amount, currency="PKR", category="other", note="", spent_ts=None):
        amount = round(float(amount), 2)
        if not amount > 0 or amount > 1e12:
            raise ValueError("amount must be a positive number")
        return self.execute(
            "INSERT INTO expenses (user_id, amount, currency, category, note, spent, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (uid, amount, str(currency or "PKR").strip().upper()[:6] or "PKR", str(category or "other").strip().lower()[:30] or "other",
             str(note or "").strip()[:200], float(spent_ts if spent_ts is not None else time.time()), time.time()),
        ).lastrowid

    def expenses_between(self, uid, start_ts, end_ts):
        return [dict(r) for r in self.all(
            "SELECT id, amount, currency, category, note, spent FROM expenses WHERE user_id = ? AND spent >= ? AND spent < ? ORDER BY spent DESC LIMIT 2000",
            (uid, float(start_ts), float(end_ts)))]

    def delete_expense(self, uid, eid):
        return self.execute("DELETE FROM expenses WHERE id = ? AND user_id = ?", (int(eid), uid)).rowcount

    def delete_last_expense(self, uid):
        row = self.one("SELECT id, amount, currency, category, note FROM expenses WHERE user_id = ? ORDER BY id DESC LIMIT 1", (uid,))
        if not row:
            return None
        self.delete_expense(uid, row["id"])
        return dict(row)

    # ---- habits (daily check-ins with streaks) ----
    def add_habit(self, uid, name):
        name = str(name).strip()[:60]
        row = self.one("SELECT id FROM habits WHERE user_id = ? AND lower(name) = lower(?)", (uid, name))
        if row:
            return row["id"]
        return self.execute("INSERT INTO habits (user_id, name, created) VALUES (?, ?, ?)", (uid, name, time.time())).lastrowid

    def habits(self, uid):
        return [dict(r) for r in self.all("SELECT id, name FROM habits WHERE user_id = ? ORDER BY name LIMIT 50", (uid,))]

    def find_habit(self, uid, name):
        name = str(name).strip()
        row = self.one("SELECT id, name FROM habits WHERE user_id = ? AND lower(name) = lower(?)", (uid, name))
        if not row:
            row = self.one("SELECT id, name FROM habits WHERE user_id = ? AND instr(lower(name), lower(?)) > 0 ORDER BY id DESC LIMIT 1", (uid, name))
        return dict(row) if row else None

    def habit_check(self, uid, habit_id, day, done=True):
        if not self.one("SELECT 1 AS x FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)):
            return False
        if done:
            self.execute("INSERT OR IGNORE INTO habit_log (habit_id, user_id, day) VALUES (?, ?, ?)", (habit_id, uid, day))
        else:
            self.execute("DELETE FROM habit_log WHERE habit_id = ? AND user_id = ? AND day = ?", (habit_id, uid, day))
        return True

    def habit_days(self, uid, habit_id, limit=400):
        return [r["day"] for r in self.all("SELECT day FROM habit_log WHERE habit_id = ? AND user_id = ? ORDER BY day DESC LIMIT ?", (habit_id, uid, limit))]

    def delete_habit(self, uid, habit_id):
        self.execute("DELETE FROM habit_log WHERE habit_id = ? AND user_id = ?", (habit_id, uid))
        return self.execute("DELETE FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).rowcount

    # ---- notes / contacts / tasks / events: delete + edit helpers used by the AI ----
    def delete_note_matching(self, uid, text):
        row = self.one("SELECT id, title FROM notes WHERE user_id = ? AND (title LIKE ? OR body LIKE ?) ORDER BY id DESC LIMIT 1", (uid, f"%{text}%", f"%{text}%"))
        if not row:
            return None
        self.delete_note(uid, row["id"])
        return row["title"]

    def delete_contact_matching(self, uid, text):
        row = self.one("SELECT id, name FROM contacts WHERE user_id = ? AND name LIKE ? ORDER BY id DESC LIMIT 1", (uid, f"%{text}%"))
        if not row:
            return None
        self.delete_contact(uid, row["id"])
        return row["name"]

    def update_task_matching(self, uid, text, new_text="", due=None):
        row = self.one("SELECT id, text, due FROM tasks WHERE user_id = ? AND done = 0 AND text LIKE ? ORDER BY id DESC LIMIT 1", (uid, f"%{text}%"))
        if not row:
            return None
        self.execute("UPDATE tasks SET text = ?, due = ? WHERE id = ? AND user_id = ?",
                     ((new_text or row["text"]).strip()[:300], row["due"] if due is None else str(due)[:40], row["id"], uid))
        return row["text"]

    def update_event_matching(self, uid, text, start_ts=None, end_ts=None, title="", location=None):
        """Change the next upcoming event whose title contains `text`. Returns the updated row or None."""
        now = time.time()
        row = self.one("SELECT id, title, start, end, location FROM events WHERE user_id = ? AND instr(lower(title), lower(?)) > 0 AND (start >= ? OR end >= ?) ORDER BY start LIMIT 1",
                       (uid, str(text).strip(), now - 3600, now))
        if not row:
            return None
        new_start = float(start_ts) if start_ts is not None else row["start"]
        dur = (row["end"] - row["start"]) if row["end"] and row["end"] > row["start"] else 3600
        new_end = float(end_ts) if end_ts is not None else new_start + dur
        self.execute("UPDATE events SET title = ?, start = ?, end = ?, location = ? WHERE id = ? AND user_id = ?",
                     ((title or row["title"]).strip()[:200], new_start, new_end, row["location"] if location is None else str(location).strip()[:200], row["id"], uid))
        return {"id": row["id"], "title": (title or row["title"]).strip()[:200], "start": new_start, "end": new_end}

    # ---- search across everything the user has saved ----
    def search_all(self, uid, query, limit=5):
        q = f"%{str(query).strip()}%"
        out = {}
        out["tasks"] = [r["text"] for r in self.all("SELECT text FROM tasks WHERE user_id = ? AND text LIKE ? ORDER BY id DESC LIMIT ?", (uid, q, limit))]
        out["notes"] = [r["title"] for r in self.all("SELECT title FROM notes WHERE user_id = ? AND (title LIKE ? OR body LIKE ?) ORDER BY id DESC LIMIT ?", (uid, q, q, limit))]
        out["memory"] = [r["text"] for r in self.all("SELECT text FROM facts WHERE user_id = ? AND text LIKE ? ORDER BY id DESC LIMIT ?", (uid, q, limit))]
        out["events"] = [dict(r) for r in self.all("SELECT title, start FROM events WHERE user_id = ? AND (title LIKE ? OR location LIKE ?) ORDER BY start DESC LIMIT ?", (uid, q, q, limit))]
        out["meetings"] = [r["title"] for r in self.all("SELECT title FROM meetings WHERE user_id = ? AND (title LIKE ? OR notes LIKE ?) ORDER BY id DESC LIMIT ?", (uid, q, q, limit))]
        out["contacts"] = [r["name"] for r in self.all("SELECT name FROM contacts WHERE user_id = ? AND (name LIKE ? OR email LIKE ?) ORDER BY name LIMIT ?", (uid, q, q, limit))]
        return out

    # ---- outgoing email quota ----
    def emails_sent_today(self, uid) -> int:
        row = self.one("SELECT COUNT(*) AS n FROM email_log WHERE user_id = ? AND day = ?", (uid, date.today().isoformat()))
        return row["n"] if row else 0

    def log_email(self, uid):
        self.execute("INSERT INTO email_log (user_id, day, created) VALUES (?, ?, ?)", (uid, date.today().isoformat(), time.time()))

    # ---- meetings ----
    def add_meeting(self, uid, title, duration, transcript, notes_json):
        return self.execute(
            "INSERT INTO meetings (user_id, title, duration, transcript, notes, created) VALUES (?, ?, ?, ?, ?, ?)",
            (uid, title.strip()[:120] or "Meeting", float(duration or 0), transcript[:400000], notes_json, time.time()),
        ).lastrowid

    def meetings(self, uid, limit=50):
        return [dict(r) for r in self.all("SELECT id, title, duration, created FROM meetings WHERE user_id = ? ORDER BY id DESC LIMIT ?", (uid, limit))]

    def meeting(self, uid, mid):
        r = self.one("SELECT id, title, duration, transcript, notes, created FROM meetings WHERE id = ? AND user_id = ?", (mid, uid))
        return dict(r) if r else None

    def latest_meeting(self, uid, query=""):
        if query:
            r = self.one("SELECT id, title, duration, transcript, notes, created FROM meetings WHERE user_id = ? AND (title LIKE ? OR notes LIKE ?) ORDER BY id DESC LIMIT 1", (uid, f"%{query}%", f"%{query}%"))
        else:
            r = self.one("SELECT id, title, duration, transcript, notes, created FROM meetings WHERE user_id = ? ORDER BY id DESC LIMIT 1", (uid,))
        return dict(r) if r else None

    def delete_meeting(self, uid, mid):
        return self.execute("DELETE FROM meetings WHERE id = ? AND user_id = ?", (mid, uid)).rowcount

    # ---- calendar events ----
    def add_event(self, uid, title, start_ts, end_ts=0, location=""):
        return self.execute(
            "INSERT INTO events (user_id, title, start, end, location, created) VALUES (?, ?, ?, ?, ?, ?)",
            (uid, str(title).strip()[:200], float(start_ts), float(end_ts or 0), str(location or "").strip()[:200], time.time()),
        ).lastrowid

    def events_between(self, uid, start_ts, end_ts, query=""):
        """Events that start inside [start_ts, end_ts) or are still running at start_ts, oldest first."""
        rows = self.all(
            "SELECT id, title, start, end, location FROM events WHERE user_id = ? AND ((start >= ? AND start < ?) OR (end > ? AND start < ?)) ORDER BY start LIMIT 200",
            (uid, float(start_ts), float(end_ts), float(start_ts), float(end_ts)),
        )
        q = str(query or "").strip().lower()
        return [dict(r) for r in rows if not q or q in r["title"].lower() or q in r["location"].lower()]

    def delete_events_matching(self, uid, text):
        """Delete upcoming events whose title contains `text`. Past events are kept as history. Returns how many."""
        cur = self.execute(
            "DELETE FROM events WHERE user_id = ? AND instr(lower(title), lower(?)) > 0 AND (start >= ? OR end >= ?)",
            (uid, str(text).strip(), time.time() - 3600, time.time()),
        )
        return cur.rowcount

    def delete_event(self, uid, event_id):
        return self.execute("DELETE FROM events WHERE id = ? AND user_id = ?", (int(event_id), uid)).rowcount
