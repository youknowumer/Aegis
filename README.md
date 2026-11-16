# Aegis: web app + Windows desktop app

One account, two front doors.

```
 Browser (web app) ──┐                         ┌── Claude API (the brain)
                     ├──►  Aegis server  ◄─────┤
 Desktop app (Electron)┘   FastAPI + SQLite     └── accounts, memory, daily limits
   └─ runs PC tools locally (open apps, files, screenshots, typing)
```

- **Server** holds the API key and the AI agent loop. The AI decides which tools to call.
- **Web app** is the chat interface (login, voice in English/Urdu/Hindi, memory panel). Works anywhere, but a browser cannot control a PC.
- **Desktop app** shows the same web app in a window and, once you sign in, also connects to the server as your "device". When the AI wants to open Chrome or organize a folder, the server sends the request to it and it runs on your PC.
- Risky actions (write/move/delete files, typing, shell commands, forgetting memory) always show an **Allow / Deny** dialog first.

## 1. Run the server

```
cd server
pip install -r requirements.txt
set ANTHROPIC_API_KEY=sk-ant-...        (Windows)   export ... on Mac/Linux
set AEGIS_JWT_SECRET=<long random string>
uvicorn app.main:create_app --factory --port 8000
```

Open http://localhost:8000. You get the landing page (`index.html`); click **Get started** or **Sign in** to reach the app (`/app.html`, also `/app`).
Create an account and chat. That is the web app.

## 2. Run the desktop app

```
cd desktop
npm install
npm start
```

It opens http://localhost:8000 by default. Sign in once, and the sidebar shows **Desktop app: Connected**.
Try: "Open Chrome and search for SpaceX launches", "Organize my Downloads folder".

To build the Windows installer: `npm run dist` (produces `dist/Aegis-Setup.exe`). Put that file in `downloads/`
and the web app will show a "Download for Windows" button automatically.

Before you ship the installer, set `DEFAULT_SERVER` at the top of `desktop/main.js` to your real https URL.

## 3. Put it online

Any host that runs Docker or Python works (Railway, Render, Fly.io, a VPS).

```
docker build -t aegis .
docker run -p 8000:8000 -v aegis-data:/data --env-file .env aegis
```

Use **HTTPS** in production (the host usually does this for you). Passwords and login tokens travel over the network.

## Plans and limits

Edit `PLAN_LIMITS` in `server/app/settings.py` (free 15 / basic 150 / power 1000 messages per day).
After a customer pays you, activate them:

```
python server/scripts/set_plan.py customer@example.com basic
```

## Tests

```
cd server  && pip install pytest httpx && pytest
cd desktop && npm test
```

The server tests use a fake AI, so they cost nothing and need no API key.

## Layout

| Path | What it is |
|---|---|
| `server/app/agent.py` | The AI tool-use loop |
| `server/app/tools.py` | List of tools the AI can use (add new ones here) |
| `server/app/hub.py` | Routes tool calls to the user's desktop app |
| `server/app/main.py` | Accounts, memory API, websocket, static hosting |
| `index.html` | Landing page (features, download button, links to sign in) |
| `app.html` + `app.js` | The app itself: login/register, chat, voice, memory |
| `desktop/tools.js` | Everything the AI can do on the PC |
| `desktop/main.js` | Electron window and secure connection to the server |

## Security notes

- The API key lives only on the server. The desktop app never sees it.
- Passwords are hashed with scrypt; login attempts are throttled; sessions are signed tokens.
- The desktop app stores its token encrypted by Windows, only accepts it from your server's page, and the web page gets no Node access.
- File tools are limited to Documents, Desktop and Downloads, and symlinks can't escape them.
- Users can only answer their own approval prompts.

## Not built yet (honest list)

- **Payments.** Add Stripe/Paddle/Easypaisa/JazzCash, then call `set_plan` from the payment webhook.
- **Google sign-in.** Email + password only for now.
- **Mac/Linux desktop tools.** App opening, typing and key presses are Windows-only.
- **Code signing.** Without a certificate Windows SmartScreen warns on install.
- **Live web search / reading pages** for the AI (the Claude API has a web search tool you can add in `agent.py`).
- **Wake word ("Hey Aegis")** and background tray mode.
- **Multiple server instances.** Connections live in memory, so run one process (or add Redis) when you grow.
- I could not run the Electron window or the browser UI here (no display). The server, the desktop tool code and the full
  server-to-desktop flow were tested; click through the UIs once yourself.
