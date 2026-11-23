# v11: bug fixes, account safety, running it for many people, and new assistant abilities

## Bugs and glitches fixed
- **Two identical sign-ups at the same moment** made one of them fail with a server error (500). Now a clean "account already exists" (409).
- **Rate limiters leaked memory**: every IP/email ever seen stayed in a table forever. Expired entries are now swept. Same for the per-day Groq usage table.
- **Sign-in timing leaked which emails have accounts** (unknown emails answered faster). Now the same work is done either way.
- **Half-saved chat turns**: if the AI failed or you pressed Stop, your message stayed in the saved history without a reply. A turn is now saved together (your message + the answer) and only on success.
- **Meeting action items** crashed "add to tasks" when the AI left out an owner or a due date. Missing fields are handled.
- **Chat bookkeeping** kept an empty entry for every user who ever connected. Cleaned up on disconnect.
- **SQLite settings**: write-ahead logging + busy timeout, so a backup or admin tool touching the file no longer causes "database is locked".
- **Phones in portrait** were blocked by a full-screen "Rotate to landscape" wall. The phone layout works, so the wall is gone (it can still be switched on with `body.want-rotate`).
- `.env.example` was referenced in README/SETUP but missing. Added, with every setting.

## Account safety (Settings > Account & data)
- Change password; **sign out everywhere** (old tokens stop working); **download all my data** (JSON); **delete my account** (everything is erased).
- REST: `POST /api/account/password`, `POST /api/account/logout-all`, `GET /api/export`, `POST /api/account/delete`. Old tokens keep working until you use these.

## Running it for many people (see SCALING.md)
- Admin API, off until `AEGIS_ADMIN_TOKEN` is set: `/api/admin/stats`, `/api/admin/users`, `/api/admin/users/{id}/plan`, `/api/admin/users/{id}/revoke`, `/api/admin/maintenance`.
- `/metrics` (Prometheus), `/readyz` (database check), request IDs, slow/failed request logging, graceful shutdown.
- `AEGIS_PLAN_LIMITS` (JSON), `AEGIS_OPEN_REGISTRATION`, `AEGIS_MAX_USERS`, `AEGIS_KEEP_MESSAGES`, automatic housekeeping, automatic backups (`AEGIS_BACKUP_DIR`) and `scripts/backup.py`, `scripts/restore_check.py`.
- Docker: runs as a normal user, health check, websocket message cap; `docker-compose.yml` + `Caddyfile` for self-hosting with automatic HTTPS; GitHub Actions workflow that runs all tests.

## New things Aegis can do
- **Spending tracker** (default PKR): "500 ka khana", "spent 1200 on petrol", "how much did I spend this month?" by category. Tools `log_expense`, `expense_summary`, `delete_last_expense`; REST `/api/expenses`.
- **Habits with streaks**: "track a habit: gym", "I went to the gym", "how are my habits?". Current streak, best streak, last 7 days. Open habits appear in the morning briefing. Tools `add_habit`, `habit_checkin`, `habit_status`, `delete_habit`; REST `/api/habits`.
- **Prayer times** for any city (Aladhan, no key, Karachi method by default, other methods on request) with the Islamic date. Tool `prayer_times`.
- **Search everything**: tasks, notes, memories, calendar, meetings and contacts at once. Tool `search_everything`; REST `/api/search?q=`.
- **Edit instead of delete and re-add**: `update_task` (rename / new due date), `update_event` (reschedule, keeps the length). Plus `delete_note` and `delete_contact` (both ask first).
- Slash commands: `/spent`, `/spending`, `/habits`, `/habit`, `/prayer`, `/search`.

## Tests
- Server: 267 pass (36 new in `tests/test_v11.py`: sign-up race, limiter sweep, token revocation, export/delete isolation between users, admin API, retention, backups, expenses, habits and streak maths, prayer times with a mocked service, every new AI tool, end to end through the chat). Front-end: all pass (`tests/v11-static.test.js` checks the new wiring).
