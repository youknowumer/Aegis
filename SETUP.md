# Aegis: setup in 10 minutes

Aegis has two parts. The **website** (Cloudflare Pages / GitHub Pages) is only the screen. The **server** (Render) is the
brain: login, memory and the AI. The website talks to the server, so you need both.

## Already live on GitHub Pages? It works without a server
Open your Pages site, sign in (local account), **Settings > AI provider**, pick Claude (or another), paste your key,
**Test**, **Save**. The chip shows "AI: Claude (direct)": plain chat goes from your browser straight to the provider.
Limits of this mode: no memory/tasks/PC control/web search (those need the server below), and the key lives in this
browser, so use it only on your own device. Some providers block browser calls; Claude, OpenAI, Groq and OpenRouter allow it.

## Fastest way: run it on your own PC
Windows: double-click `start-local.bat` (needs Python from python.org). Mac/Linux: `./start-local.sh`.
It opens `http://localhost:8000/app.html`, already linked to its own server. Create an account, then
**Settings > AI provider**, paste your key, **Test**, **Save**. No Render needed.

## 1. Get the AI key (this is "the API")
1. Go to **console.anthropic.com**, sign in, open **API keys**, press **Create key**, copy it (`sk-ant-...`).
2. Add billing credit in the console (the API is pay-as-you-go, separate from a Claude chat subscription).
3. **Never** paste this key into the website, `config.js` or GitHub. It only goes into the server (step 2).

### Other AIs (OpenAI, Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI, local models)
No server change needed: in the app open **Settings > AI provider**, pick the provider, paste *its* key, choose a model
(any model name works, the list is just suggestions) and press **Test**, then **Save**. The key goes only to your own
server for that chat session (memory only, never stored). Choose **Custom / Local** for any OpenAI-compatible URL
(Ollama, LM Studio, vLLM...). Local URLs only work if Aegis runs on that same PC with `AEGIS_ALLOW_LOCAL_PROVIDERS=1`.
Server owners can also set `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`,
`DEEPSEEK_API_KEY`, `XAI_API_KEY` so users can pick a provider without pasting a key. Note: live web search is a
Claude-only feature; other providers still get all the Aegis tools (memory, tasks, reminders, PC control, ...).

## 2. Deploy the server on Render
1. render.com -> **New -> Blueprint** -> pick your GitHub repo (`render.yaml` is already in it).
2. When asked, paste the key as `ANTHROPIC_API_KEY`.
3. Set `AEGIS_ALLOWED_ORIGINS` to your website address(es), comma separated, no trailing slash, for example
   `https://your-project.pages.dev,https://*.pages.dev`
4. Open `https://YOUR-SERVICE.onrender.com/healthz`. It must show `{"ok":true}`.

## 3. Connect the website to the server (no code editing)
If the website is served by the Render server itself it connects automatically. Otherwise press the **AI: not connected** chip (top right), paste the Render address, press **Test** (it tells you if the AI key is missing), then **Save & connect**. Create your account again
(local-mode accounts live only in your browser). Done: chat, memory, web voice and weather now run through the server.

Optional: to make it permanent for every visitor, put the same address in `config.js` (`API_BASE`) and push to git.

## 4. Windows PC control (optional)
Install `Aegis-Setup.exe` (build it with the GitHub Actions workflow or `cd desktop && npm install && npm run dist`), open Aegis, sign in once. The installer includes its own server. See README section 4.

## 5. Email (optional)
Without this, "email Ali ..." opens a ready draft in your mail app (desktop app needed) and you press Send.
To let Aegis send by itself (you still approve every email in a dialog), set these on the server (see `.env.example`):
`AEGIS_SMTP_HOST`, `AEGIS_SMTP_USER`, `AEGIS_SMTP_PASSWORD`; add `AEGIS_IMAP_HOST` to let it read your inbox.
For Gmail/Outlook, create an **app password** (needs 2-step verification) and use that, never your real password.

## Troubleshooting
| Problem | Fix |
|---|---|
| "Can't reach that server" | Free Render sleeps; wait 30 s and retry. Check `/healthz`. |
| "This website is not allowed to use that server" | `AEGIS_ALLOWED_ORIGINS` is missing your website address. |
| Login works but AI says error | Key missing/wrong, or no credit on the Anthropic account. |
| Accounts vanish after a restart | Free Render has no disk. Use a paid instance with the disk in `render.yaml`. |

## Groq: voice transcription + meeting notes (v7)

1. Free key: https://console.groq.com/keys (starts with `gsk_`).
2. Either paste it in the app (Settings > Voice & meetings (Groq) > Save & test), or set `GROQ_API_KEY` on the server
   (Render: Environment tab). With only `GROQ_API_KEY` set (no Claude key) Aegis also uses Groq for chat.
3. Voice: push-to-talk, Voice mode and follow-ups use Groq Whisper (accurate for Urdu/Hindi/English). "Hey Aegis" stays on browser speech.
4. Meetings: top-bar button or Alt+M. Record (mic, or mic + browser-tab audio for Meet/Zoom web), upload audio, or paste text.
   You get summary, important points, decisions, action items (-> your tasks), enhancement ideas, risks, open questions, next steps.
   Voice commands: "start meeting", "stop meeting", "show meeting notes". Ask "what was decided in my last meeting?" any time.

Optional env vars: `AEGIS_GROQ_MODEL`, `AEGIS_GROQ_CHAT_MODEL`, `AEGIS_GROQ_STT_BEST`, `AEGIS_GROQ_STT_FAST`,
`AEGIS_SERVER_STT_PER_DAY` (300) and `AEGIS_SERVER_NOTES_PER_DAY` (30) cap usage of the server's own key.
New assistant tools for every provider: `search_web`, `news_headlines`, `get_meeting`, `list_meetings`, `meeting_actions_to_tasks`, `delete_task`.

## Voice mode

Turn on **Voice mode** (under the chat box). Aegis then sleeps until you say its name: **"Aegis"**
(or your own word: Settings > Voice > Wake word). Say "Aegis, what's the weather?" in one go, or just "Aegis" and wait for
"Yes?". After that you can keep talking without the name. Say "thanks", "that's all" or "bas" (or stay quiet) and it goes back
to sleep. Replies are short, spoken, and addressed to you the way you choose ("Call me": sir, boss, your name).
The wake word needs Chrome/Edge/Safari and this tab open; after waking, your speech is transcribed by Groq Whisper.
Settings > Voice > "Voice mode listens: Always" gives the old non-stop listening with no wake word.

## Studio voice: natural, emotional speech in every language (optional)

Browser voices differ a lot between devices (Urdu is often missing). For one consistent, natural voice that sounds happy, gentle or
urgent in any language, add ONE key on the server (Render > Environment, or `.env`):

| Key | Voice |
|---|---|
| `OPENAI_API_KEY` | OpenAI `gpt-4o-mini-tts`: follows a spoken-style instruction per sentence. Change the voice with `AEGIS_TTS_VOICE` (default `coral`). |
| `ELEVENLABS_API_KEY` | ElevenLabs multilingual v2. Choose the voice with `AEGIS_ELEVENLABS_VOICE` (a voice id from your ElevenLabs library). |

Restart the server, open the app, then Settings > Voice shows "Studio voice is on". Each user has a daily allowance
(`AEGIS_TTS_CHARS_PER_DAY`, default 6000 characters) so cost stays under control; when it is used up, or the service fails, the
browser voice takes over without interruption. Untick "Studio voice" in the same place to switch it off.

### Piper voices (v20): newer, lighter, more natural local voices (optional, free, install themselves)

Piper is a second local voice engine that sits **in front of** MMS. Its voices are ONNX files (20 to 110 MB each), need no PyTorch, use about 60 MB of RAM
and speak a sentence in a fraction of a second on a normal CPU. For each sentence Aegis tries: **Piper voice of that language, then MMS, then the Edge/cloud
voice**, so a language Piper does not have (Urdu, Punjabi, Tamil...) is still spoken by MMS, and nothing ever goes silent.

- **Install:** `install-voices.bat` / `./install-voices.sh` now installs Piper first (about 1 GB for every language it has) and then MMS. Piper only: add `--piper-only`.
  Nicer but bigger voices: `--high`. Only some languages: `--langs en,es,de,hi`.
- **No pre-download needed:** with `pip install -r requirements-piper.txt` Aegis downloads a language's Piper voice by itself the first time it is spoken.
- **It picks the best voice for you** from Piper's live voice list (`voices.json`), so a renamed voice never breaks the install. Pin an exact voice with
  `AEGIS_PIPER_VOICES=en=en_US-amy-medium,de=de_DE-thorsten-high`. Quality tier: `AEGIS_PIPER_QUALITY` (`high` | `medium` | `low` | `x_low`).
- **Check:** `python scripts/piper_download.py --status` (inside `server`) lists installed voices and which languages still use MMS or Edge.
- **Settings:** `AEGIS_PIPER=0` turns it off, `AEGIS_PIPER_AUTO=0` stops automatic downloads (or give a list `en,es`), `AEGIS_PIPER_CACHE` (voices kept in memory, default 6),
  `AEGIS_PIPER_CONCURRENCY` (sentences at once, default 2), `AEGIS_PIPER_DIR`, `AEGIS_PIPER_BASE` (your own mirror/bucket).
- **Licences:** each Piper voice has its own licence (see the MODEL_CARD on its Hugging Face page) and the `piper-tts` engine package is GPL-3.0. Check both before a commercial launch.

### Observability: see how the voices (and the whole server) behave at scale

Set `AEGIS_ADMIN_TOKEN`, then:
- **`/admin/voice`** is a live dashboard (open it in a browser, paste the token): which engine spoke, requests and errors per language, latency p50/p95/p99,
  fallbacks (for example `piper > edge`), queue waits and timeouts, downloads, installed and loaded voices, memory, threads, and the latest voice events with why a fallback happened.
- **`/metrics`** (Prometheus, header `X-Admin-Token`) now also has labelled series: `aegis_voice_requests_total{engine,lang,outcome}`, `aegis_voice_synthesis_seconds` (histogram),
  `aegis_voice_fallbacks_total{from_engine,to_engine,lang}`, `aegis_voice_queue_wait_seconds`, `aegis_voice_queue_timeouts_total`, `aegis_voice_model_load_seconds`,
  `aegis_voice_model_downloads_total`, `aegis_http_request_seconds{method,route,status}`, `aegis_process_resident_memory_mb`. See SCALING.md for alert rules.
- **`/api/admin/voice`** gives the same data as JSON; `/api/admin/stats` now includes a voice health verdict (`ok` or `degraded`).
- **`AEGIS_LOG_JSON=1`** writes every log line as one JSON object (ready for Loki / Datadog / CloudWatch). Labels are fixed short words only: no user ids and no spoken text are ever recorded.

### Local language voices (MMS): the voice follows the language you speak (optional, free, installs itself)

Aegis already answers in the language and script you write or speak. This adds a **voice per language** that runs on your own
server or PC: Urdu, Hindi, Arabic, English, Spanish and 27 more are each spoken by their own Meta MMS model, with no key and no per-character cost.
Roman Urdu ("kya haal hai") has its own model too.

**The same files work everywhere.** Aegis checks the machine it is running on:
- **PC or a server with 1.5 GB+ of memory and PyTorch installed:** local voices switch on, and **each voice downloads itself the first time you speak that language**
  (about 150 MB). That first sentence is spoken by the free Edge voice; the next ones by the local voice. Nothing to run by hand.
- **Small server (for example Render Starter, 512 MB) or no PyTorch:** local voices stay off by themselves, and the free Edge voice, which also follows your language, keeps working.
  Settings > Voice says why ("this server has about 512 MB of memory...").

**On your PC (Windows):** run `install-voices.bat` once. It installs PyTorch and pre-downloads every language (about 5 GB) so even the first sentence is local.
Only some languages: `install-voices.bat --langs ur,en,hi,roman`. Then start Aegis with `start-local.bat`. Mac/Linux: `./install-voices.sh`.
You can skip the pre-download: install PyTorch only (`pip install -r requirements-mms.txt` inside `server`) and let the voices download as you speak.

**On the web (Render + Docker):** use a plan with 2 GB+ of RAM, raise the disk `sizeGB` to 6 or more, and add the variable `WITH_MMS=1` (see the commented lines in `render.yaml`).
That installs PyTorch in the image; the models then download themselves onto the `/data` disk. On a smaller plan the same setting is harmless: the memory check keeps the local voices off.
GitHub Pages only serves the page; the voice always comes from the server.

Check what is installed any time (inside `server`): `python scripts/mms_download.py --status` (MMS) or `python scripts/piper_download.py --status` (Piper).

How it chooses: each sentence is spoken by the voice of its own language. A paid key (`OPENAI_API_KEY` / `ELEVENLABS_API_KEY`) still wins if you set
one. A language with no local voice yet falls back to the free Edge voice, so Aegis never goes silent: **Italian, Chinese, Japanese and Czech have no
MMS model**, and any voice still downloading (or that failed to download) uses the fallback.

Good to know:
- **Licence: the MMS models are CC-BY-NC 4.0, non-commercial use only.** If Aegis becomes a paid product, set `AEGIS_MMS=0` and use a paid voice key.
- Each language is one fixed speaker (some are men, some women) with a speed and loudness range, not full emotion: the feeling of a sentence changes how fast and how loud it is said.
- Digits are spoken as words when the language is supported by `num2words`; otherwise MMS skips them.
- Roman Urdu uses the model trained on Latin-script Urdu. It was trained on standard spellings, so casual chat spellings may sound less natural.
  If you prefer the old voice for it, set `AEGIS_MMS_ROMAN=0`.
- Memory and speed: each loaded language is about 150 MB of RAM (the 3 most recent stay loaded: `AEGIS_MMS_CACHE`). The first sentence in a language takes a
  moment while its model loads.
- Automatic downloads: `AEGIS_MMS_AUTO=0` turns them off, `AEGIS_MMS_AUTO=ur,en,roman` limits them to those languages. A download that fails is retried after 10 minutes, and none starts when less than 1 GB of disk is free.
- Memory check: below 1500 MB the local voices stay off (`AEGIS_MMS_MIN_RAM_MB`; `AEGIS_MMS_FORCE=1` ignores it).
- Already downloaded the older MMS voice pack (folders `english`, `urdu`, ...)? Set `AEGIS_MMS_DIR` to its `models` folder and those voices are used as they are.
- The Windows installer (`Aegis-Setup.exe`) does not bundle PyTorch; use `start-local.bat` after `install-voices.bat` for local voices.

## Calendar, markets and smart home

- **Calendar** works out of the box: "add dentist tomorrow at 3pm, remind me 30 minutes before", "what is on today?", "am I free on Friday?". Events are stored on the server per user.
- **Markets**: "bitcoin price", "Tesla stock", "ETH in PKR". Free public data (CoinGecko, Stooq), may be delayed. Information only, never advice.
- **Smart home** needs Home Assistant. In Home Assistant open your profile > Security > Long-lived access tokens, create one, then set
  `AEGIS_HA_URL` (for example `http://homeassistant.local:8123`, reachable from the server) and `AEGIS_HA_TOKEN`. Say "turn off the bedroom light",
  "set the AC to 24", "movie scene". Locks, doors, garage and alarms always ask you to approve first.
