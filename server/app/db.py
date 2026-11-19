import sqlite3
import threading
import time
from datetime import date

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
CREATE TABLE IF NOT EXISTS usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
"""


class DB:
    def __init__(self, path: str):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
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
    def add_fact(self, uid, text):
        return self.execute(
            "INSERT INTO facts (user_id, text, created) VALUES (?, ?, ?)", (uid, text.strip(), time.time())
        ).lastrowid

    def facts(self, uid):
        return self.all("SELECT id, text, created FROM facts WHERE user_id = ? ORDER BY id DESC", (uid,))

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

    # ---- outgoing email quota ----
    def emails_sent_today(self, uid) -> int:
        row = self.one("SELECT COUNT(*) AS n FROM email_log WHERE user_id = ? AND day = ?", (uid, date.today().isoformat()))
        return row["n"] if row else 0

    def log_email(self, uid):
        self.execute("INSERT INTO email_log (user_id, day, created) VALUES (?, ?, ?)", (uid, date.today().isoformat(), time.time()))
