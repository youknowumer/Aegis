"""Export one user's chats as a fine-tuning dataset, from the command line.

  python server/scripts/train_export.py you@example.com --fmt openai --out aegis-train.jsonl
  python server/scripts/train_export.py you@example.com --fmt kto            # thumbs up / down
  python server/scripts/train_export.py you@example.com --modelfile Modelfile --base llama3.1

Emails, phone and card numbers, keys and passwords are removed first. Thumbs-down and instant commands are left out.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import learning, settings  # noqa: E402
from app.db import DB  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("email")
    ap.add_argument("--db", default=settings.DB_PATH)
    ap.add_argument("--fmt", default="openai", choices=["openai", "alpaca", "kto"])
    ap.add_argument("--out", default="")
    ap.add_argument("--rated-only", action="store_true", help="only replies you gave a thumbs up")
    ap.add_argument("--modelfile", default="", help="also write an Ollama Modelfile here")
    ap.add_argument("--base", default="llama3.1")
    a = ap.parse_args()
    db = DB(a.db)
    u = db.user_by_email(a.email.strip().lower())
    if not u:
        sys.exit("No such user in " + a.db)
    rows, lessons = db.interactions(u["id"]), db.lessons(u["id"])
    body = learning.training_jsonl(rows, lessons, a.fmt, include_unrated=not a.rated_only)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(body)
    else:
        sys.stdout.write(body)
    print(f"{len(body.splitlines())} examples", file=sys.stderr)
    if a.modelfile:
        open(a.modelfile, "w", encoding="utf-8").write(learning.modelfile(lessons, a.base))
        print("Modelfile written: ollama create aegis-me -f " + a.modelfile, file=sys.stderr)


if __name__ == "__main__":
    main()
