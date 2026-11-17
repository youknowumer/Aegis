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
# Frontend files live in the project root (index.html, app.html, ...). Only these are ever served,
# so server code, the database and .env stay private. Set AEGIS_WEB_DIR to serve a separate folder instead.
WEB_DIR = Path(os.environ.get("AEGIS_WEB_DIR", BASE_DIR))
WEB_FILES = ("index.html", "app.html", "app.js", "orb.js", "config.js", "landing.js", "landing.css", "style.css", "hud.js", "commands.js")
DOWNLOADS_DIR = Path(os.environ.get("AEGIS_DOWNLOADS_DIR", BASE_DIR / "downloads"))

# Websites allowed to call this API from a browser (CORS) and to open its websocket.
# Needed when the frontend is hosted elsewhere, e.g. GitHub Pages:
#   AEGIS_ALLOWED_ORIGINS=https://youknowumer.github.io
# Comma separated, no trailing slash, scheme + host only (no /repo-name path).
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("AEGIS_ALLOWED_ORIGINS", "").split(",") if o.strip()]

# Live web search for the AI (Anthropic's server-side tool). Off by default because it must be enabled
# for your organization in the Anthropic Console first; set AEGIS_WEB_SEARCH=1 once it is.
WEB_SEARCH = os.environ.get("AEGIS_WEB_SEARCH", "0") == "1"
WEB_SEARCH_MAX_USES = int(os.environ.get("AEGIS_WEB_SEARCH_MAX_USES", "4"))

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
