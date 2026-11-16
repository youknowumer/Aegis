"""Give a user a plan after they pay:   python scripts/set_plan.py user@example.com basic"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import settings  # noqa: E402
from app.db import DB  # noqa: E402

if len(sys.argv) != 3 or sys.argv[2] not in settings.PLAN_LIMITS:
    sys.exit(f"usage: set_plan.py EMAIL {'|'.join(settings.PLAN_LIMITS)}")

n = DB(settings.DB_PATH).set_plan(sys.argv[1].strip().lower(), sys.argv[2])
print("updated" if n else "no user with that email")
