"""Server settings, all from environment variables."""
import os
import secrets
import warnings
from pathlib import Path

APP_NAME = os.environ.get("AEGIS_APP_NAME", "Aegis")
MODEL = os.environ.get("AEGIS_MODEL", "claude-sonnet-5-5")
MAX_TOKENS = int(os.environ.get("AEGIS_MAX_TOKENS", "2048"))
MAX_AGENT_STEPS = 16

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DB_PATH = os.environ.get("AEGIS_DB", str(BASE_DIR / "aegis.db"))
# Frontend files live in the project root (index.html, app.html, ...). Only these are ever served,
# so server code, the database and .env stay private. Set AEGIS_WEB_DIR to serve a separate folder instead.
WEB_DIR = Path(os.environ.get("AEGIS_WEB_DIR", BASE_DIR))
WEB_FILES = (
    "index.html", "app.html", "app.js", "orb.js", "config.js", "landing.js", "landing.css", "style.css", "hud.js", "commands.js", "webctl.js",
    "ui-plus.js", "features.js", "theme-boot.js", "voice.js", "tabs.js", "dock.js", "auth-fx.js", "app-fx.js", "app-fx.css", "app-holo.js", "app-holo.css", "landing-fx.js", "landing-pro.css", "landing-pro.js", "landing-hero.css", "landing-hero.js",
    "groq.js", "meetings.js", "meetings.css", "meetings-plus.js", "meetings-plus.css", "account.js",
    "learning.js", "landing-vela.css", "landing-vela.js", "landing-vela-page.css", "landing-vela-page.js", "landing-motion.css", "landing-motion.js", "landing-ultra.css", "landing-ultra.js", "landing-download.js",
    "favicon.svg", "favicon.ico", "site.webmanifest",
)
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

# Groq (https://console.groq.com/keys): free key. Powers voice transcription (Whisper), meeting notes, and chat when no Claude key is set.
GROQ_MODEL = os.environ.get("AEGIS_GROQ_MODEL", "llama-3.3-70b-versatile")
# Caps for people using the SERVER's Groq key (users who paste their own key are not limited by us).
SERVER_STT_PER_DAY = int(os.environ.get("AEGIS_SERVER_STT_PER_DAY", "300"))
SERVER_NOTES_PER_DAY = int(os.environ.get("AEGIS_SERVER_NOTES_PER_DAY", "30"))

# Messages per day for each plan. Edit freely, or override without touching code:
#   AEGIS_PLAN_LIMITS='{"free": 20, "basic": 200, "power": 1500, "team": 5000}'
PLAN_LIMITS = {"free": 15, "basic": 150, "power": 1000}
try:
    import json as _json

    _custom = _json.loads(os.environ.get("AEGIS_PLAN_LIMITS", "") or "{}")
    if isinstance(_custom, dict):
        PLAN_LIMITS.update({str(k): int(v) for k, v in _custom.items() if int(v) >= 0})
except (ValueError, TypeError):
    warnings.warn("AEGIS_PLAN_LIMITS is not valid JSON like {\"free\": 20}; using the defaults.")

# ---- running it for many people ----
# Admin API (/api/admin/*, /metrics): off until you set a long random token. Send it as the X-Admin-Token header.
ADMIN_TOKEN = os.environ.get("AEGIS_ADMIN_TOKEN", "")
# Closed beta switches: AEGIS_OPEN_REGISTRATION=0 stops new sign-ups; AEGIS_MAX_USERS=500 caps the number of accounts (0 = no cap).
OPEN_REGISTRATION = os.environ.get("AEGIS_OPEN_REGISTRATION", "1") != "0"
MAX_USERS = int(os.environ.get("AEGIS_MAX_USERS", "0") or 0)
# Housekeeping: old usage rows, fired reminders and chat messages beyond this many per user are removed once a day.
KEEP_MESSAGES = int(os.environ.get("AEGIS_KEEP_MESSAGES", "500"))
MAINTENANCE_EVERY = int(os.environ.get("AEGIS_MAINTENANCE_EVERY", "21600"))  # seconds
# Optional automatic database copies (a folder). Keeps the newest AEGIS_BACKUP_KEEP files.
BACKUP_DIR = os.environ.get("AEGIS_BACKUP_DIR", "")
BACKUP_KEEP = int(os.environ.get("AEGIS_BACKUP_KEEP", "7"))
LOG_LEVEL = os.environ.get("AEGIS_LOG_LEVEL", "INFO").upper()
# Set to 1 once the site is served over https, to add the HSTS header.
HSTS = os.environ.get("AEGIS_HSTS", "0") == "1"

DEVICE_CALL_TIMEOUT = 60  # seconds to wait for the desktop app to finish a tool
CONFIRM_TIMEOUT = 60  # seconds to wait for the user to approve a risky action

# v12: proactive heads-ups (meeting starting, habits still open, unusual spending). Set AEGIS_PROACTIVE=0 to turn off.
PROACTIVE = os.environ.get("AEGIS_PROACTIVE", "1").strip().lower() not in ("0", "false", "no", "off")

# v13: pick up names, people, dates, plans and losses from what the user says and remember them (AEGIS_AUTO_MEMORY=0 turns it off).
AUTO_MEMORY = os.environ.get("AEGIS_AUTO_MEMORY", "1").strip().lower() not in ("0", "false", "no", "off")

# v19: learn standing rules, habits and feedback from conversations, and keep a redacted log usable as training data (AEGIS_LEARNING=0 turns it off).
LEARNING = os.environ.get("AEGIS_LEARNING", "1").strip().lower() not in ("0", "false", "no", "off")
KEEP_INTERACTIONS = int(os.environ.get("AEGIS_KEEP_INTERACTIONS", "3000"))
