"""Server settings, all from environment variables."""
import os
import secrets
import warnings
from pathlib import Path

APP_NAME = os.environ.get("AEGIS_APP_NAME", "Aegis")
MODEL = os.environ.get("AEGIS_MODEL", "claude-sonnet-5-5")
MAX_TOKENS = int(os.environ.get("AEGIS_MAX_TOKENS", "2048"))
MAX_AGENT_STEPS = 12

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DB_PATH = os.environ.get("AEGIS_DB", str(BASE_DIR / "aegis.db"))
WEB_DIR = Path(os.environ.get("AEGIS_WEB_DIR", BASE_DIR / "web"))
DOWNLOADS_DIR = Path(os.environ.get("AEGIS_DOWNLOADS_DIR", BASE_DIR / "downloads"))

JWT_SECRET = os.environ.get("AEGIS_JWT_SECRET", "")
if not JWT_SECRET:
    JWT_SECRET = secrets.token_hex(32)
    warnings.warn(
        "AEGIS_JWT_SECRET is not set: using a random secret. Logins will reset on every restart. "
        "Set AEGIS_JWT_SECRET in production."
    )

# Messages per day for each plan. Edit freely.
PLAN_LIMITS = {"free": 15, "basic": 150, "power": 1000}

DEVICE_CALL_TIMEOUT = 60  # seconds to wait for the desktop app to finish a tool
CONFIRM_TIMEOUT = 60  # seconds to wait for the user to approve a risky action
