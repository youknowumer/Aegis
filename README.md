# Aegis: Jarvis-style AI assistant for web + Windows PC

```
 GitHub Pages (static site)                       Aegis server (Render / Railway / Fly / VPS)
 index.html  app.html  app.js  orb.js  ──HTTPS──►  FastAPI + SQLite ──► Claude API (the brain)
 config.js  (API_BASE = your server URL)  ──WSS──►  accounts, memory, daily limits, agent loop
                                                           ▲
 Windows desktop app (Electron) ───── WSS ────────────────┘  runs PC tools locally
```

**Important:** GitHub Pages only hosts static files. Login, chat and memory need the **server**, so the
website (Pages) and the server (Render etc.) are two separate deployments. `config.js` is the single link between them.

## What you get

- **HUD interface**: animated arc-reactor orb that reacts to idle / listening / thinking / speaking, live activity feed
  of every tool the AI uses, memory panel, usage meter, approval dialog with a 60 s countdown, responsive on phones.
- **Voice**: push-to-talk, **Voice mode** (hands-free back-and-forth), **"Hey Aegis"** wake word, replies read aloud.
  English / Urdu / Hindi. Uses the browser's built-in speech (Chrome or Edge recommended).
- **Agent**: multi-step tool use, long-term memory, optional live web search, and (with the desktop app) PC control:
  open apps/URLs, files, screenshots, typing, shell. Risky actions always ask first.
- **Safe**: scrypt passwords, throttled logins, signed tokens, CORS + websocket origin allow-list, strict file sandbox.

## 1. Deploy the server (Render example)

1. Push this repo to GitHub (already done).
2. Render dashboard → **New → Blueprint** → select the repo. `render.yaml` creates the service.
3. When asked, paste `ANTHROPIC_API_KEY`. Check `AEGIS_ALLOWED_ORIGINS` is your Pages origin, e.g.
   `https://youknowumer.github.io` (scheme + host only: no `/Aegis`, no trailing slash).
4. Wait for the deploy, open `https://<your-service>.onrender.com/healthz` → should show `{"ok":true}`.

> The database is a SQLite file. `render.yaml` attaches a **persistent disk, which requires a paid instance**.
> On a free instance every restart wipes accounts and memory. For free-tier testing that is fine; for real users
> use the paid disk (or move `db.py` to Postgres). Free instances also sleep when idle, so the first login after a
> pause can take ~30 s. The login screen shows "Waking the server..." while that happens.

Other hosts work too: `docker build -t aegis . && docker run -p 8000:8000 -v aegis-data:/data --env-file .env aegis`.

## 2. Point the website at the server

Open `config.js` and replace the one URL:

```js
API_BASE: local ? "" : "https://YOUR-AEGIS-SERVER.onrender.com",
```

Commit and push. The workflow in `.github/workflows/static.yml` publishes **only** the website files to Pages.
(In repo Settings → Pages, Source must be **GitHub Actions**.) On `localhost` it automatically uses the local server.

## 3. Run locally

```
cd server
pip install -r requirements.txt
set ANTHROPIC_API_KEY=sk-ant-...        (Windows)   export ... on Mac/Linux
set AEGIS_JWT_SECRET=<long random string>
uvicorn app.main:create_app --factory --port 8000
```

Open http://localhost:8000 (the server also serves the website).

## 4. Windows desktop app (PC control)

```
cd desktop
npm install
npm start            # dev
npm run dist         # builds dist/Aegis-Setup.exe
```

Before building the installer set `DEFAULT_SERVER` at the top of `desktop/main.js` to your server's https URL
(or set `AEGIS_SERVER`). Put the built `Aegis-Setup.exe` in a `downloads/` folder in the repo: the site then shows a
"Download for Windows" button automatically. Sign in once in the desktop window; the sidebar shows **PC link: Connected**.

## Settings (environment variables on the server)

| Variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | required, lives only on the server |
| `AEGIS_JWT_SECRET` | required in production (long random string) |
| `AEGIS_ALLOWED_ORIGINS` | website(s) allowed to use the API, comma separated |
| `AEGIS_WEB_SEARCH` | `1` = AI can search the web (enable web search for your org in the Anthropic Console first) |
| `AEGIS_MODEL` | default `claude-sonnet-5-5` |
| `AEGIS_DB` | SQLite path, e.g. `/data/aegis.db` |

Plans/limits: edit `PLAN_LIMITS` in `server/app/settings.py`. Activate a paying customer with
`python server/scripts/set_plan.py customer@example.com basic`.

## Tests

```
cd server  && pip install pytest httpx && pytest      # 25 tests, fake AI, no API key needed
cd desktop && npm test                                # 9 tests
```

## Layout

| Path | What it is |
|---|---|
| `index.html`, `landing.*` | Landing page |
| `app.html`, `style.css`, `app.js`, `orb.js` | The assistant UI (login, HUD, chat, voice) |
| `config.js` | **Server address**: the only thing to edit after deploying |
| `server/app/agent.py` | AI tool-use loop and persona |
| `server/app/tools.py` | Tool list (add new tools here) |
| `server/app/main.py` | Accounts, memory API, websocket, CORS, static hosting |
| `desktop/` | Electron app + the PC tools |
| `render.yaml`, `Dockerfile`, `.env.example` | Deployment |

## Honest limits

- Wake word and Voice mode use the browser's speech recognition: Chrome/Edge, HTTPS, mic permission, and the tab must
  stay open. Firefox has no speech recognition. Wake-word accuracy depends on the browser's recognizer.
- A website can't control your PC. PC actions need the desktop app (Windows only for apps/typing/keys).
- Replies arrive whole (not streamed word by word).
- Web search is untested against a live account here; turn it on only after enabling it in the Anthropic Console.
- Not built: payments, Google sign-in, installer code-signing, multi-instance scaling (connections live in memory,
  run one process or add Redis).
- I could verify the server (25 tests), desktop tools (9) and the UI logic in a simulated browser (11 tests). I could not
  open a real browser here, so click through the UI once and check how it looks on your screen.
