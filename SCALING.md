# Taking Aegis to more users

An honest map of what v11 already handles, where the limits are, and what to do next. Read top to bottom once.

## What one server process can do today

Aegis is an async server (FastAPI + uvicorn). One process holds thousands of idle chat websockets, because waiting on the AI
provider costs almost nothing. The things that cost money or CPU are the AI calls (your Anthropic/Groq bill) and password
hashing at sign-in (scrypt, ~50 ms each, run in a thread pool). SQLite in WAL mode handles many readers plus one writer, which
is plenty for a few thousand active users. **Scale UP first** (a bigger machine, a persistent disk) before anything else.

Why Aegis must run as **one process** for now: chats, desktop-app links, pending approvals, reminder delivery and rate limits
live in that process's memory. If you start two copies (or `--workers 2`), a chat on copy A cannot reach the desktop app that is
connected to copy B, reminders may fire twice, and limits are per copy. The Dockerfile and `render.yaml` run one process on purpose.

## Do these before you open the doors

| Step | How |
|---|---|
| Stable logins | Set `AEGIS_JWT_SECRET` (long random text). Without it every restart signs everyone out. |
| Persistent database | Put `AEGIS_DB` on a volume / disk (`/data`). On Render, a free instance wipes the disk on redeploy. |
| HTTPS | Render / Railway / Fly give it to you. Self-hosting: `docker compose up -d` with the included Caddyfile. Then set `AEGIS_HSTS=1`. |
| Cost control | `AEGIS_PLAN_LIMITS` sets messages per day per plan. Free users cost you money: start low (the default is 15). |
| Closed beta | `AEGIS_OPEN_REGISTRATION=0`, or `AEGIS_MAX_USERS=200` to cap accounts. |
| Backups | `AEGIS_BACKUP_DIR=/data/backups` copies the database every few hours (keeps 7). Also copy it **off** the machine: `python scripts/backup.py`. Test a restore: `python scripts/restore_check.py FILE`. |
| Monitoring | Set `AEGIS_ADMIN_TOKEN`. Point an uptime monitor at `/readyz`. Prometheus can scrape `/metrics` with the `X-Admin-Token` header. |
| Running the business | `GET /api/admin/stats`, `GET /api/admin/users?q=`, `POST /api/admin/users/{id}/plan` `{"plan":"basic"}` after someone pays, `POST /api/admin/users/{id}/revoke`. |

Example: `curl -H "X-Admin-Token: $TOKEN" https://your-server/api/admin/stats`

## What v11 added for scale and safety

- SQLite WAL + busy timeout (no "database is locked"), daily housekeeping (old usage rows, fired reminders, chat messages beyond 500 per user).
- Sign-up race fixed (two identical sign-ups used to give one of them a 500 error).
- Rate-limit tables no longer grow forever; sign-in timing no longer reveals whether an email has an account.
- Sign out everywhere and password change really revoke old tokens (token versions). Users can download or delete all their data (privacy laws like GDPR expect this).
- Request IDs (`X-Request-ID`) in logs, slow/failed request warnings, `/readyz`, graceful shutdown, non-root Docker image with a health check, 1 MB websocket message cap.

## When you outgrow one process

Roughly: when you see sustained CPU on the one process, or you need zero-downtime deploys, or more than ~5,000 daily active users.
The path, in order of effort:

1. **Bigger machine.** Cheapest, no code. Do this first.
2. **Move the AI work out.** Nothing to change: the AI providers already do the heavy lifting.
3. **PostgreSQL instead of SQLite.** All SQL lives in `server/app/db.py` behind one `DB` class (about 40 small methods). Swap the connection layer
   (psycopg pool) and replace `?` placeholders with `%s`; the rest of the app does not know SQLite exists.
4. **Redis for shared state.** Hub presence + pending approvals (`hub.py`), rate limiters (`LoginLimiter`), TTS quota, and the reminder
   loop (use a lock so only one copy delivers). Websocket fan-out between copies goes through Redis pub/sub.
5. Then run N copies behind a load balancer with sticky sessions for websockets.

Steps 3 and 4 are a project of days, not hours. Do not start them before step 1 stops being enough.

## Local language voices (MMS) and scale

Setup is in SETUP.md. For capacity planning:

- It is **CPU and RAM on your server**, not an API bill. Each loaded language is about 150 MB (`AEGIS_MMS_CACHE` models stay loaded, default 3, least recently used is dropped), plus PyTorch itself. Plan for 2 GB or more.
- **A small server protects itself:** below `AEGIS_MMS_MIN_RAM_MB` (1500) the local voices stay off and the Edge voice speaks, instead of the server running out of memory. The container limit is what counts, not the host's RAM.
- Speech is generated **one sentence at a time per slot**: `AEGIS_MMS_CONCURRENCY` (default 1). A sentence that waits longer than `AEGIS_MMS_QUEUE_SECONDS` (default 20) is
  spoken by the fallback voice instead, so a busy server slows down gracefully and never piles up. Raise concurrency together with CPU cores, and measure on your own machine before promising anything.
- Voices **download themselves** on first use (one at a time, in the background, never twice, retried after 10 minutes if they fail, skipped when under 1 GB of disk is free). All 31 languages plus Roman Urdu are about 5 GB, so size the disk for the languages your users really speak.
- Per-user daily allowance still applies (`AEGIS_TTS_CHARS_PER_DAY`, default 200,000 for free voices).
- Models live on disk (`AEGIS_MMS_DIR`, `/data/mms_models` in Docker, so they survive redeploys).
- Two copies of the server each load their own models and download their own copies. That is another reason to stay at one process until you have moved shared state out (see below).
- **Licence: CC-BY-NC 4.0 = non-commercial.** This is the one scale limit that no hardware fixes. Before you charge money, switch to a voice you may use commercially (`AEGIS_MMS=0` plus `OPENAI_API_KEY` or `ELEVENLABS_API_KEY`).

## Observability at scale (v20)

Everything below needs only `AEGIS_ADMIN_TOKEN`. The data lives in the process (no extra service); Prometheus keeps the history.

- **Live page:** `/admin/voice`. **JSON:** `/api/admin/voice`. **Prometheus:** `/metrics`. **Structured logs:** `AEGIS_LOG_JSON=1`.
- **Voice metrics** (labels are only engine, 2-letter language, outcome, route template: the number of series stays small):
  `aegis_voice_requests_total`, `aegis_voice_synthesis_seconds_bucket`, `aegis_voice_fallbacks_total`, `aegis_voice_queue_wait_seconds_bucket`,
  `aegis_voice_queue_timeouts_total`, `aegis_voice_model_load_seconds_bucket`, `aegis_voice_model_downloads_total`, `aegis_voice_models_loaded`,
  `aegis_voice_models_installed`, `aegis_http_request_seconds_bucket`, `aegis_process_resident_memory_mb`, `aegis_process_threads`.
- **Alerts worth setting** (Prometheus):
  - Voice fallbacks climbing: `sum(rate(aegis_voice_fallbacks_total[5m])) / sum(rate(aegis_voice_requests_total[5m])) > 0.3` for 10 min. Models missing, broken or too slow.
  - Slow speech: `histogram_quantile(0.95, sum by (le,engine) (rate(aegis_voice_synthesis_seconds_bucket[5m]))) > 3`. Raise `AEGIS_PIPER_CONCURRENCY` / CPU, or lower quality tier.
  - Queue pressure: `rate(aegis_voice_queue_timeouts_total[5m]) > 0`. Sentences are waiting longer than the queue limit.
  - Memory: `aegis_process_resident_memory_mb > 0.85 * <your limit>`. Lower `AEGIS_PIPER_CACHE` / `AEGIS_MMS_CACHE`.
  - Errors: `rate(aegis_http_responses_5xx_total[5m]) > 0`.
- **Capacity rule of thumb for voices:** Piper ~0.2 to 0.6 s per sentence per CPU core and ~60 MB per loaded language; MMS ~1 to 3 s and ~150 MB. Sentences per second you can serve
  is about `AEGIS_PIPER_CONCURRENCY / seconds_per_sentence`; read the real seconds from `aegis_voice_synthesis_seconds` on your hardware before promising anything.

## Money

- `AEGIS_PLAN_LIMITS='{"free":15,"basic":150,"power":1000}'` is your pricing lever. Your cost per message is roughly one to a few model calls; check your AI provider's dashboard after the first week and set limits from real numbers.
- Users can bring their own key (Settings > AI provider): they pay the provider directly, you pay nothing for their chats.
- Studio voice and Groq on *your* keys have per-user daily caps (`AEGIS_TTS_CHARS_PER_DAY`, `AEGIS_SERVER_STT_PER_DAY`). The free Edge voice is not an official paid API, and the local MMS voices are non-commercial: for a commercial product use an OpenAI or ElevenLabs key.

## Before charging money (not code, but needed)

Terms of service and a privacy policy (Aegis stores chats, memories, moods and meeting transcripts), a way for users to reach you, and a payment
provider. The "download / delete my data" buttons in Settings > Account & data cover the data-rights part.
