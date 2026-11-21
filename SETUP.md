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
`cd desktop && npm install && npm run dist`, install `Aegis-Setup.exe`, sign in once. See README.

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

## Calendar, markets and smart home

- **Calendar** works out of the box: "add dentist tomorrow at 3pm, remind me 30 minutes before", "what is on today?", "am I free on Friday?". Events are stored on the server per user.
- **Markets**: "bitcoin price", "Tesla stock", "ETH in PKR". Free public data (CoinGecko, Stooq), may be delayed. Information only, never advice.
- **Smart home** needs Home Assistant. In Home Assistant open your profile > Security > Long-lived access tokens, create one, then set
  `AEGIS_HA_URL` (for example `http://homeassistant.local:8123`, reachable from the server) and `AEGIS_HA_TOKEN`. Say "turn off the bedroom light",
  "set the AC to 24", "movie scene". Locks, doors, garage and alarms always ask you to approve first.
