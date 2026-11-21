# Aegis: your own AI voice assistant for web + Windows PC

**New here? Read `SETUP.md` (10-minute setup, including where the API key goes).**

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

## What's new in v2

- **Streaming replies**: answers type out word by word, with a **Stop** button (or `Esc`) to cancel a long answer.
- **Personal assistant tools**: to-do list, **reminders that pop up and are spoken at the right time**, notes, a
  `daily_briefing` ("good morning, brief me"), live currency conversion, Wikipedia lookups, and reading any public web
  page (`fetch_url`, SSRF-protected: private/LAN addresses are refused).
- **Time-zone aware**: the browser sends its zone, so "remind me tomorrow at 9" means 9 in *your* time.
- **More PC control** (desktop app): open files, find files, clipboard read/write, volume, media keys, notifications,
  list/close apps, lock screen. Anything destructive still asks first.
- **New interface**: command palette (`Ctrl K`), settings dialog (voice, accent colour, notifications), tasks and
  reminders panels, message actions (copy / read aloud), compact orb once a chat starts, focus mode.
- REST: `/api/tasks`, `/api/reminders`, `/api/notes` (all per-user).

## What's new in v3 (interface upgrade)

- **New design system** for the app: layered surfaces, consistent spacing and type scale, refined controls and status pills, icons throughout.
- **Sign-in screen** is now a split layout with the product promise next to the form.
- **Sidebar**: collapsible panels (remembered), count badges, user avatar card, **Export chat to Markdown**.
- **Chat**: copy button on code blocks, message timestamps, "Latest" jump button, character counter, cleaner bubbles.
- **Settings > Appearance**: compact layout, message text size, background effects on/off.
- **Keyboard shortcuts** dialog (`?`), usage meter turns amber/red near your daily limit.
- **Landing page**: light/dark toggle, interface preview, instant-commands section, capability icons, richer footer, back-to-top.
- New file `ui-plus.js` holds all the extra UI behaviour; `app.js` logic is unchanged.

## What's new in v3.1 (new features, all in `features.js`)

- **Slash quick-prompts**: type `/` in the message box for /brief, /summarize, /translate, /explain, /email, /fix, /code, /plan, /remind, /timer, /focus, /find.
- **Prompt history**: Up / Down in the empty box recalls your earlier messages.
- **Regenerate** button on the latest answer.
- **Conversation search** (`Ctrl Shift F` or the toolbar button) with match count and next/previous.
- **Focus timer** (Pomodoro presets 25 / 50 / 5 / 15 min) with sound, notification and a daily session count.
- **Scratchpad** saved on your device, with "Send to Aegis".
- **Drop a text file** onto the chat to add its content to your message.
- **Offline alert** banner; instant commands keep working.

## What's new in v5 (does real work: email, documents, routines). Details in `CHANGES-v5.md`

- **Email**: `send_email` (you approve each one), `check_inbox` (read-only), `compose_email` (opens a ready draft in your mail
  app), contacts by name. Set `AEGIS_SMTP_*` / `AEGIS_IMAP_HOST` (see `.env.example`); without them Aegis drafts instead.
- **Documents**: read Word / Excel / PowerPoint / PDF, search inside files, copy / append / make folders, download files
  (safe: public https only, no programs), OneDrive folders supported, friendly app names (Word, VS Code, Power BI...).
- **Routines and recurring reminders**: "start my morning routine"; "remind me every weekday at 9".
- **Smarter agent**: parallel lookups, recovers from tool errors, treats web/email text as untrusted.

## What's new in v6 (voices like Siri, deeper orb animation). Details in `CHANGES-v6.md`

- **Voice personalities** (replaced in v7 by one expressive female voice; see below).
- **Orb** reacts to real speech, with parallax stars, comet trails, neural arcs while thinking and inward particles while listening.
- **New instant commands**: stopwatch, password generator, days-until, say, copy that.

- **v6.1: tabbed side rails** (Plan / Focus / Memory and Activity / Status / World / Voice), Alt+1..7, plus a rotating state ring on the message box.

- **v6.2: live docks** (radar of your real items, live telemetry), a description on every panel, and action-led empty states.

## What's new in v7 (one expressive female voice, meeting present mode, full Chrome control). Details in `CHANGES-v7.md`

- **One female voice with emotions**: each sentence is spoken with its own feeling (joy, empathy, concern, urgency, curiosity...). "more emotion" / "less emotion".
- **Meeting present mode**: "meeting chal rahi hai" and Aegis listens silently; at the end say "meeting points extract karo" and it reads the key points aloud.
- **Chrome A to Z** (desktop app): `chrome_*` tools open / switch / close tabs, read pages, click, type, scroll, screenshot. Risky clicks and scripts ask first.

## What's new in v8 (every language, real feelings, calendar, markets, smart home). Details in `CHANGES-v8.md`

- **Aegis is its own assistant**: the name is Aegis everywhere (wake word, prompts, UI). Wake it with "Aegis" in Latin, Urdu, Hindi, Arabic, Cyrillic, Japanese, Korean or Chinese script, or set your own word.
- **Talks in every language**: replies follow the language and script you write (Urdu script, Roman Urdu, Hindi, Arabic, Spanish, French, Chinese...). The page can listen in 20 languages, and "switch to Spanish" works.
- **Feels in every language**: the AI tags each sentence with its feeling ([joy], [empathy], [concern]...), which shapes the voice. The tags are hidden. Each sentence is spoken with a voice of its own language, so mixed answers are read properly.
- **Studio voice (optional)**: add an OpenAI or ElevenLabs key on the server and replies are spoken by a natural cloud voice that follows each feeling in any language. Without a key nothing changes.
- **Calendar**: "kal 3 baje dentist add karo, 30 minute pehle yaad dilana", "what is on today?". Today's events are part of the daily briefing.
- **Markets**: live crypto and stock prices ("bitcoin price in PKR", "how is Tesla doing"), no API key.
- **Smart home** (optional, Home Assistant): lights, fans, AC, scenes by voice. Locks, doors and alarms always ask first.
- **Emotional intelligence**: Aegis answers your mood first (sad, stressed, happy, angry), then the task.

## Voice and instant commands

Typed or spoken (English, Roman Urdu, Urdu, Hindi), answered in the browser in milliseconds, free, no AI quota, and they
work even without the server (`commands.js`):

| Say | Does |
|---|---|
| "open YouTube", "gmail kholo", "open github.com" | opens the site |
| "google quantum computing", "play Coke Studio on YouTube", "directions to Islamabad" | searches / maps |
| "what time is it", "time in Tokyo", "today's date" | time and date |
| "calculate 15% of 2400", "convert 10 km to miles" | exact math and units |
| "set a timer for 10 minutes", "how much time is left", "cancel timer" | timers with alarm + voice |
| "take a note ...", "show my notes" | notes saved on this device |
| "weather", "weather in Lahore" | live weather |
| "system status", "battery" | device gauges |
| "voice mode on", "be quiet", "switch to Urdu", "change theme to red", "focus mode", "full screen", "repeat that" | controls Aegis itself |
| "help" | full list |

Everything else goes to the AI, which now answers any question conversationally (replies in your language and script,
short and natural for voice) and can use `calculate`, `get_weather`, memory, web search and PC tools.
Pick a voice and speed under the chat box. Replies are read in the language they are written in.

## Local login mode

While `config.js` still has the placeholder server URL (or `LOCAL_LOGIN: true`), sign-in works without a server:
accounts are stored only in this browser on this computer. Chat/AI needs the real server.

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

## 1b. Cloudflare Pages (website) + login

Cloudflare Pages is static hosting only (like GitHub Pages), so login will NOT work until the server from step 1 is
running elsewhere. Cloudflare Pages settings: framework preset **None**, build command empty, output directory `/`.
Then: (1) set `API_BASE` in `config.js` to your server URL, (2) on the server set
`AEGIS_ALLOWED_ORIGINS=https://YOUR-PROJECT.pages.dev,https://*.pages.dev` (wildcards allowed, no trailing slash),
(3) push to git so Cloudflare redeploys.

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
| `OPENAI_API_KEY` or `ELEVENLABS_API_KEY` | optional: switches on the **studio voice** (see `SETUP.md`). Also `AEGIS_TTS_PROVIDER`, `AEGIS_TTS_VOICE`, `AEGIS_ELEVENLABS_VOICE`, `AEGIS_TTS_CHARS_PER_DAY` (default 6000 per user) |
| `AEGIS_HA_URL`, `AEGIS_HA_TOKEN` | optional: connect **Home Assistant** for smart-home control |

Plans/limits: edit `PLAN_LIMITS` in `server/app/settings.py`. Activate a paying customer with
`python server/scripts/set_plan.py customer@example.com basic`.

## Tests

```
cd server  && pip install pytest httpx && pytest      # 103 tests, fake AI, no API key needed
cd desktop && npm test                                # 35 tests (includes real-Chrome end-to-end)
node --test tests/*.test.js                                          # voice router, multilingual voice engine, meetings
npm install --no-save jsdom && node --test tests/ui-smoke.test.js   # loads the real app.html in a simulated browser (skipped without jsdom)
```

## Layout

| Path | What it is |
|---|---|
| `index.html`, `landing.*` | Landing page |
| `app.html`, `style.css`, `app.js`, `orb.js` | The assistant UI (login, HUD, chat, voice) |
| `voice.js` | The one female voice, multilingual emotion engine, language detection, studio-voice client |
| `meetings.js`, `groq.js` | Meeting assistant, present mode, spoken read-out |
| `desktop/browser.js` | Chrome control (DevTools Protocol) |
| `commands.js` | Instant voice/text commands (open, search, time, math, timers, notes, UI control) |
| `ui-plus.js`, `features.js`, `theme-boot.js` | Extra UI behaviour, quick prompts/timer/scratchpad, landing theme bootstrap |
| `hud.js` | HUD widgets: date/time, live system gauges, weather (Open-Meteo), shortcuts |
| `config.js` | **Server address**: the only thing to edit after deploying |
| `server/app/agent.py` | AI tool-use loop and persona |
| `server/app/tools.py` | Tool list (add new tools here) |
| `server/app/mail.py` | Email sending (SMTP) and inbox reading (IMAP, read-only) with the safety checks |
| `server/app/tts.py` | Optional studio voice (OpenAI / ElevenLabs) with a daily per-user allowance |
| `server/app/smarthome.py` | Optional Home Assistant control with approval rules for locks and doors |
| `server/app/utilities.py` | Safe helpers: calculator, weather, web page reader, Wikipedia, currency, reminder times |
| `server/app/main.py` | Accounts, memory API, websocket, CORS, static hosting |
| `desktop/` | Electron app + the PC tools |
| `render.yaml`, `Dockerfile`, `.env.example` | Deployment |

## Honest limits

- Wake word and Voice mode use the browser's speech recognition: Chrome/Edge, HTTPS, mic permission, and the tab must
  stay open. Firefox has no speech recognition. Wake-word accuracy depends on the browser's recognizer.
- A website can't control your PC. PC actions need the desktop app (Windows only for apps/typing/keys).
- Streaming uses the Anthropic SDK stream and is covered by tests with a fake stream; try it once against your real key.
- Reminders fire while the server is running and a chat tab is open (or the next time you open one). Free hosts that sleep will miss them until you reconnect.
- Volume/mute use the Windows media keys (steps of 2%), and "mute" toggles.
- Web search is untested against a live account here; turn it on only after enabling it in the Anthropic Console.
- Studio voice, live market prices and Home Assistant were written against the providers' documented APIs and tested here with fake
  responses, not with live accounts or keys. Try each once. Without a studio key, voice quality in a language depends on the voices
  your device has installed (Urdu is often missing: install the OS Urdu voice or use the studio voice).
- Emotion tags depend on the AI following the prompt; when a sentence has no tag, a keyword guess in 17 languages is used instead.
- Not built: payments, Google sign-in, installer code-signing, multi-instance scaling (connections live in memory,
  run one process or add Redis).
- I could verify the server (35 tests), desktop tools (12) and the UI logic in a simulated browser (11 tests). I could not
  open a real browser here, so click through the UI once and check how it looks on your screen.
