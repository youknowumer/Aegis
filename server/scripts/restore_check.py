"""Check that a backup file opens and show what is inside:   python scripts/restore_check.py backups/aegis-20261123-101500.db"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.db import DB  # noqa: E402

if len(sys.argv) != 2 or not Path(sys.argv[1]).is_file():
    sys.exit("usage: restore_check.py BACKUP_FILE")
st = DB(sys.argv[1]).stats()
print("OK:", ", ".join(f"{k}={v}" for k, v in st.items() if not isinstance(v, dict)), "| plans:", st["users_by_plan"])
