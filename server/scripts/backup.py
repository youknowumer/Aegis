"""Make a safe copy of the live database (works while the server is running).

    python scripts/backup.py                      # -> ./backups/aegis-YYYYmmdd-HHMMSS.db, keeps the newest 7
    python scripts/backup.py /mnt/backups 14      # another folder, keep 14

Run it from cron / a scheduled job, then copy the file somewhere else (S3, another machine). A backup that lives only on the
same disk as the database is not a backup.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import extras, settings  # noqa: E402
from app.db import DB  # noqa: E402

folder = sys.argv[1] if len(sys.argv) > 1 else str(Path(settings.DB_PATH).resolve().parent / "backups")
keep = int(sys.argv[2]) if len(sys.argv) > 2 else settings.BACKUP_KEEP
print(extras.make_backup(DB(settings.DB_PATH), folder, keep))
