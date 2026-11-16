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
            self.conn.commit()

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
