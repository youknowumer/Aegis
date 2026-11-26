<div align="center">

# 🛡️ Aegis

### Your own AI voice assistant for the web and your Windows PC

**Talk to it, type to it, and let it do real work:** answer questions, remember your life, run your day,
take meeting notes, send emails, and operate your laptop. Every risky action asks for your approval first.

![Status](https://img.shields.io/badge/version-v17-6c63ff)
![Backend](https://img.shields.io/badge/backend-FastAPI%20%2B%20SQLite-009688)
![Desktop](https://img.shields.io/badge/desktop-Electron%20(Windows)-47848f)
![AI](https://img.shields.io/badge/AI-Claude%20%7C%20Groq%20%7C%20OpenAI%20%7C%20Gemini%20%7C%20more-ff9800)
![Tools](https://img.shields.io/badge/agent%20tools-118-blue)
![Languages](https://img.shields.io/badge/voice-20%20languages-success)
![Landing](https://img.shields.io/badge/landing-66%2C000%20dots%20(three.js)-0aa5c2)
![Voices](https://img.shields.io/badge/local%20voices-31%20languages-2fe3ff)
![License](https://img.shields.io/badge/license-proprietary-red)
![Tests](https://img.shields.io/badge/tests-396%20server%20%7C%2043%20JS%20%7C%2059%20desktop-brightgreen)

</div>

---

## Table of contents

1. [What is Aegis?](#1-what-is-aegis)
2. [Feature tour](#2-feature-tour)
3. [How it works (architecture)](#3-how-it-works-architecture)
4. [Quick start](#4-quick-start)
5. [Choosing and configuring the AI](#5-choosing-and-configuring-the-ai)
6. [Using Aegis](#6-using-aegis)
7. [Complete tool reference (118 tools)](#7-complete-tool-reference-118-tools)
8. [Configuration reference (environment variables)](#8-configuration-reference-environment-variables)
9. [Deployment](#9-deployment)
10. [Windows desktop app](#10-windows-desktop-app)
11. [Security model](#11-security-model)
12. [Data, privacy and storage](#12-data-privacy-and-storage)
13. [API reference](#13-api-reference)
14. [Running it for many users](#14-running-it-for-many-users)
15. [Testing](#15-testing)
16. [Project structure](#16-project-structure)
17. [Troubleshooting](#17-troubleshooting)
18. [Known limitations](#18-known-limitations)
19. [Version history](#19-version-history)
20. [Author and license](#20-author-and-license)

---

## What is new in v15 to v17

| Version | What changed |
|---|---|
| **v17** | **A completely new landing page**: a calm, full-screen point-cloud portrait drawn from **66,000 glowing dots** (three.js). A real download progress ring, the dots arc into place, a light follows your cursor and the head turns to look at it. A "What it does" sheet holds the real product facts, and the Windows download button lives on the page. See [2.11](#211-landing-page-66000-dots-v17). |
| **v16** | **Local language voices** (Meta MMS): 31 languages plus Roman Urdu spoken by their own voice, with no key and no per-character cost. See [2.1](#21-voice-talk-like-siri-with-your-own-wake-word) and [SETUP.md](SETUP.md). |
| **v15** | **Otter-style meetings**: interactive transcript, speaker labels, Ask AI across meetings, share links, exports and an AI follow-up email. See [2.6](#26-meeting-assistant). |

---

## 1. What is Aegis?

Aegis is a **self-hostable personal assistant** with a futuristic HUD interface. It has three parts that work together:

| Part | What it is | Where it runs |
|---|---|---|
| **Website** | The screen you see: the 66,000-dot landing page, login, animated orb, chat, side panels, voice and meeting UI. Plain HTML/CSS/JS, no build step. | GitHub Pages, Cloudflare Pages, or served by the Aegis server itself |
| **Server** | The brain: accounts, memory, the AI agent loop, reminders, calendar, meetings, limits. Python (FastAPI) with a SQLite database. | Your PC, Render, Railway, Fly.io, or any VPS / Docker host |
| **Desktop app** | The hands: lets the assistant open apps, read files, drive Chrome, work with Outlook and control Windows. Electron, and it ships its own bundled server. | Your Windows PC |

### Why it exists

- **It acts, not just chats.** The AI has **118 tools** (59 on the server, 59 on your PC) and runs multi-step plans: look something up, then read it, then save it, then remind you.
- **It knows you.** It remembers people, dates, plans and how you felt, and its tone grows warmer as your "bond" grows.
- **It speaks your language.** Replies follow the language and script you write in (English, Roman Urdu, Urdu script, Hindi, Arabic, Spanish, French, Chinese...), and the voice follows the feeling of each sentence.
- **You stay in control.** Anything destructive, financial, or outward-facing (sending email, deleting, typing into windows, shutting down) is shown to you for approval with a 60-second countdown.
- **You choose the AI.** Claude, OpenAI, Gemini, **Groq**, OpenRouter, Mistral, DeepSeek, xAI, or any OpenAI-compatible local model (Ollama, LM Studio).

---

## 2. Feature tour

### 2.1 Voice (talk like Siri, with your own wake word)

| Capability | Details |
|---|---|
| **Push-to-talk** | Hold the mic, speak, release. |
| **Voice mode** (hands-free) | Aegis sleeps until it hears its name, answers, and keeps listening for follow-ups. Say "thanks", "that's all" or "bas" (or stay quiet) and it goes back to sleep. A setting "Voice mode listens: Always" gives non-stop listening with no wake word. |
| **Wake word** | "Aegis" or "Hey Aegis", recognised in Latin, Urdu, Hindi, Arabic, Cyrillic, Japanese, Korean and Chinese script. You can set **your own wake word** in Settings > Voice. One-breath commands work: *"Aegis, what's the weather?"*. |
| **Accurate transcription** | After the wake word, speech is transcribed by **Groq Whisper** (`whisper-large-v3-turbo` for speed, `whisper-large-v3` for Urdu/Hindi and other non-English), which is far more accurate than the browser recogniser. The wake word itself stays on the free browser recogniser because it must listen continuously. |
| **One expressive female voice** | Each *sentence* is spoken with its own feeling (joy, empathy, concern, urgency, curiosity, calm, warm, excited). Say "more emotion" or "less emotion" to adjust. The stronger the feeling (scale 1 to 5), the more speed, pitch, volume and expressiveness shift. |
| **Voice engines** | Default: free neural voices via `edge-tts` (no key needed). Optional offline **local language voices** (Meta MMS, one model per language, non-commercial licence). Optional upgrade: **OpenAI** `gpt-4o-mini-tts` (follows spoken-style instructions) or **ElevenLabs** `eleven_multilingual_v2`. If the studio voice fails or the daily allowance ends, the browser's built-in voice takes over silently. |
| **Local language voices (v16)** | Optional, off until you install them. Meta MMS speaks **31 languages plus Roman Urdu**, each in its own voice, on your own machine: no key and no per-character cost. Italian, Chinese, Japanese and Czech are not in MMS and keep the Edge voice. Anything MMS cannot speak (no model, busy, unreadable text) falls back to Edge. **The MMS models are non-commercial (CC-BY-NC 4.0).** Install with `install-voices.bat` or `./install-voices.sh`; details in [SETUP.md](SETUP.md). |
| **Multilingual speech** | Each sentence is spoken with a voice of **its own language**, so mixed answers (English + Urdu) are read correctly. The page listens in 20 languages and "switch to Spanish" works. |
| **Addressing you** | "Call me" sir, boss, or your name. |

### 2.2 Instant commands (no AI, no quota, milliseconds)

Typed or spoken in English, Roman Urdu, Urdu or Hindi. They are handled **in your browser** (`commands.js`) so they are free and keep working even when the server is down:

| You say | What happens |
|---|---|
| "open YouTube", "gmail kholo", "open github.com" | Opens the site |
| "google quantum computing", "play Coke Studio on YouTube", "directions to Islamabad" | Searches or opens maps |
| "what time is it", "time in Tokyo", "today's date" | Time and date, any time zone |
| "calculate 15% of 2400", "convert 10 km to miles" | Exact math (safe parser, never `eval`) and unit conversion |
| "set a timer for 10 minutes", "how much time is left", "cancel timer" | Timers with alarm and voice |
| "start stopwatch" | Stopwatch |
| "take a note ...", "show my notes" | Notes saved on this device |
| "weather", "weather in Lahore" | Live weather (Open-Meteo) |
| "system status", "battery" | Device gauges |
| "generate a password" | Crypto-random password, never leaves your device |
| "days until 14 August" | Date arithmetic |
| "voice mode on", "be quiet", "switch to Urdu", "change theme to red", "focus mode", "full screen", "repeat that", "copy that" | Controls Aegis itself |
| "show memory tab", "open the activity panel" | Switches side panels |
| "start meeting", "stop meeting", "show meeting notes" | Meeting assistant |
| "help" | Full list |

Everything else goes to the AI, which answers conversationally and can use any tool.

### 2.3 The AI agent

- **Multi-step tool use**: up to **16 steps** per request, with **parallel tool calls** (several lookups at the same time) and automatic recovery from tool errors.
- **Streaming replies**: text types out word by word, with a **Stop** button (or `Esc`).
- **Time-zone aware**: the browser sends its zone, so "remind me tomorrow at 9" means 9 in *your* time.
- **Untrusted-content rule**: text coming from web pages and emails is treated as data. The agent is instructed never to follow instructions found there, and never to log in, buy, send, post or delete unless *you* asked.
- **Provider-agnostic**: every provider gets all Aegis tools. (The built-in live web search is Claude-only; other providers use Aegis's own `search_web` tool.)

### 2.4 Memory with a heart (v10 to v14)

Aegis does not just store facts. It behaves like a person who pays attention.

- **Automatic memory** (`AEGIS_AUTO_MEMORY=0` turns it off): picks up your name, people ("my sister is Ayesha", "mere dost ka naam Ali hai"), birthdays and anniversaries, where you live/work/study, likes and dislikes, goals, upcoming events ("I have an interview tomorrow") and losses. Questions and small talk are ignored.
- **Memories carry feeling**: what you felt when you shared it. Strongly felt moments fade much more slowly.
- **Smart recall**: ranked by relevance (tolerant of spelling, e.g. *behen/behan*), importance, feeling strength, recency and how often it mattered.
- **Follow-ups**: on the welcome line it may ask "How did the interview go?". After 3+ days away it says it missed you.
- **Special days**: a heads-up the day before and on the day of birthdays and anniversaries.
- **Memory limit**: near-duplicates merge, and past **400** memories the least important unused ones fade (important or strongly felt ones never do).
- **Everything is visible**: the Memory panel lists every memory, with the date learned and how you felt. Delete any with ✕, or wipe mood history in one click.
- **Mood intelligence**: reads 27 moods (happy, excited, proud, grateful, stressed, anxious, sad, lonely, angry, tired, distressed, grief, disappointed, overwhelmed, embarrassed, confused, bored, hopeful, relieved, loving, guilty, jealous, hopeless, calm, surprised, determined, neutral) in English, Roman Urdu, Urdu, Hindi and Arabic, understands emoji ("😭", "🥰") and stretched words ("sooo!!!"), and answers the **feeling first, then the task**. Only the mood name, strength and time are stored automatically, never your words.
- **The bond** (level 1 to 5): *just met → getting to know each other → friends → close friends → trusted confidant*. It grows with conversations, days talked, feelings shared and things remembered (`points = turns + days×8 + shared×5 + facts×2`, thresholds at 0 / 25 / 90 / 280 / 750). The level controls how personal and playful Aegis is allowed to be.

**What v14 adds to feelings and memory**

- **27 moods** (6 new): *guilty, jealous, hopeless, calm, surprised, determined*, in English, Roman Urdu, Urdu, Hindi and Arabic. Each has its own reply style and voice feeling.
- **Mixed feelings.** "I got the job, I'm happy but really nervous" is read as two feelings, and the AI is told to acknowledge both instead of picking one.
- **Hopeless is always heavy.** Phrases such as "what's the point" or "nothing matters" start at intensity 4, and the AI is told to slow down, stay warm, not argue or cheer up, and gently point toward someone they trust. Real danger phrases still take the separate safety path.
- **Heavier reading of tone.** A message that trails off ("I feel sad...") or is just a sigh counts one level stronger. Casual "never mind" is not mistaken for sadness.
- **More things remembered automatically:** pets ("my dog is named Max"), allergies, health conditions, fears, favourites ("my favourite colour is blue"), job title, age, and life events (got married, had a baby, got hired, moved, lost a job). Health and fear notes are kept as important.
- **One current value per slot.** Name, home city, hometown, workplace, study, birthday, anniversary, age, singular relations (mother, father, wife, husband, boss, partner) and favourites hold one value. When you say you moved, the old city is replaced. Several sisters, friends or pets are all kept, and two different people are no longer merged into one memory.
- **Smarter recall.** Everyday synonyms are understood: "my mom" finds "mother" or "ammi", "bday" finds "birthday", "job" finds "work", "dog" finds "pet". Memories that matter a lot or keep coming up are flagged to the AI as such.

### 2.5 Personal productivity

| Area | What you can do |
|---|---|
| **Tasks** | Add, list, complete, edit (rename / new due date), delete. Panel with live badge count. |
| **Reminders** | "Remind me in 20 minutes" or at a clock time. They **pop up and are spoken**. Recurring: daily, weekdays, weekly, monthly. |
| **Calendar** | "Add dentist tomorrow 3pm, remind me 30 minutes before", "what's on today?", "am I free Friday?", reschedule, delete, **find free time** in your working window. |
| **Notes** | Save, search, delete longer notes and snippets. |
| **Contacts** | Save names with email/phone so you can email "Ali" by name (the AI must look up the address and never guess). |
| **Routines** | Save a named list of steps ("morning: brief me, check inbox, open Odoo") and run it with one phrase. |
| **Habits** | Daily habits with **streaks** (current, best, last 7 days) and an evening nudge. |
| **Spending tracker** | "Maine 500 ka khana kharida". Default currency PKR; summaries per today / week / month / year and per category; unusual-spend warning. |
| **Prayer times** | Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha plus the Islamic date, for any city and calculation method (Karachi default). |
| **Daily briefing & evening review** | "Good morning, brief me" (date, tasks, reminders, calendar, weather) and "wrap up my day" (tasks, habits, spending, tomorrow). |
| **Search everything** | One query across tasks, notes, memories, events, meetings and contacts. |
| **Focus tools** | Pomodoro timer (25 / 50 / 5 / 15 min presets) with sound and a daily session count, plus a scratchpad saved on your device. |
| **Live data** | Weather + 3-day forecast, news headlines, Wikipedia, currency conversion, crypto and stock prices (CoinGecko, Stooq; information only, never advice), and any public web page (SSRF-protected). |
| **Deep research** | Searches the web from several angles, reads the best pages, and returns source material for a cited briefing (depth 1 to 5). |

### 2.6 Meeting assistant

Open it with the top-bar button or **Alt+M**.

- **Record** with the mic, or mic + browser-tab audio (Google Meet / Zoom web), **upload** audio (up to 24 MB per file), or **paste** text.
- **Present mode**: say "meeting chal rahi hai" and Aegis listens silently; at the end say "meeting points extract karo" and it reads the key points aloud.
- **Structured notes**: title, summary, important points (ranked high / medium / low), decisions, **action items** (task, owner, due, priority), enhancement ideas, risks, open questions, next steps, participants and topics.
- **Action items → your to-do list** in one click, or by voice.
- Ask later: "What did we decide in my last meeting?".
- Long transcripts are processed in chunks so they stay within free-tier token limits.

**Otter-style tools (v15, need an Aegis server account)**

| Tool | What it does |
|---|---|
| **Interactive transcript** | Timestamps, search inside the transcript, highlight lines (★), comment on lines, tags. |
| **Speaker labels** | "Identify speakers" estimates who said each line from the conversation (Whisper does not mark speakers). Click a name to rename it. |
| **Talk time, keywords, questions** | Computed locally for every meeting, with no AI call. |
| **Ask AI** | Chat with one meeting or with all of them. Answers cite timestamps you can click to jump to that line. |
| **Search every meeting** | Finds words in transcripts, notes and titles, with a snippet. |
| **Share link** | A read-only public page at `/shared/<token>`, marked `noindex`, which you can switch off at any time. |
| **Export** | `.txt`, `.srt`, `.vtt`, `.md` and `.json`, with speaker names and timestamps. |
| **AI follow-up email** | Pick the tone and language, then copy it or open it in your mail app. |
| **Custom vocabulary** | Names and jargon are given to Whisper as a spelling hint (Record tab). |

Not included, because they need infrastructure this project does not have: a bot that auto-joins Zoom, Meet or Teams from your calendar (use "Microphone + browser tab audio" or Present mode), playback of the original audio (audio is not stored on the server) and voice-based speaker recognition (labels come from the text).

### 2.7 Email

| Route | How it works |
|---|---|
| **Server SMTP/IMAP** | `send_email` (you approve every message and see the exact text), `check_inbox` (read-only: nothing is marked read or deleted). Set `AEGIS_SMTP_*` / `AEGIS_IMAP_*`. Use an **app password**, never your real one. Daily send cap via `AEGIS_EMAIL_DAILY_LIMIT`. |
| **Classic desktop Outlook** (desktop app) | `outlook_today` lists today's inbox, `outlook_read` opens one mail, `outlook_draft` writes a draft or reply **that opens in Outlook for you to read**, `outlook_send` sends only after you approve the exact text. No password needed. |
| **Your mail app** | `compose_email` opens a ready draft in your default mail client. |

An email can **never** make Aegis send anything: email text is untrusted data.

### 2.8 PC control (desktop app)

| Group | Tools |
|---|---|
| **Apps and system** | open / close apps, list running apps, notifications, system report (CPU, RAM, disk, battery, Wi-Fi, IP, uptime, top 5 programs), network check, brightness, volume, media keys, lock, sleep / hibernate / restart / shutdown (restart and shutdown wait **60 s** so you can cancel) |
| **Windows and desktops** | show desktop, minimise, maximise, snap left/right, switch window, Task View, virtual desktops |
| **Files** | list, find (by name), search *inside* files, read text, **read Word / Excel / PowerPoint / PDF**, info, open, copy, move, append, write, make folder, organise a folder, delete, download from a public https link |
| **Input** | clipboard read/write, type text, press shortcuts, run a shell command (last resort) |
| **Chrome (A to Z)** | open / switch / close tabs, read a page, list clickable elements by number, click, type, key, scroll, find, wait, screenshot, navigate, **play a song on YouTube**, and (approval required) run JavaScript |
| **Smart home** | Home Assistant lights, fans, AC, scenes. Locks, doors, garage and alarms **always ask first**. |

### 2.9 Proactive chief-of-staff

Aegis can speak up without being asked (`AEGIS_PROACTIVE=0` turns it off):

- **15 minutes before** a calendar event: "Heads up: Standup starts in 15 minutes."
- **After 8 pm**: open habits, and a streak on the line.
- **Birthdays and anniversaries** you told it about.
- **Unusual spending**: today above 2.5x your daily average (needs 5 days of history).
- A **welcome line** with where things stand (tasks, events left today, the next event).
- `systems_check` reports whether the PC is linked, voice, email, smart home and memory are working.

### 2.10 The interface

- **Animated arc-reactor orb** (canvas): states *offline, idle, listening, thinking, speaking*, reacts to real speech, parallax stars, comet trails, neural arcs while thinking, particles flowing inward while listening.
- **Tabbed side rails**: left *Plan / Focus / Memory*, right *Activity / Status / World / Voice*. Keyboard accessible (arrow keys, Home/End), live badges, remembered choice, **Alt+1..7**.
- **Live docks**: a radar of your real items and live telemetry.
- **Live activity feed** of every tool the AI uses.
- **Approval dialog** with a 60-second countdown.
- **Command palette** (`Ctrl/⌘ K`), settings dialog, themes and accent colours (dark/light), compact orb once a chat starts, message actions (copy / read aloud / regenerate), conversation search, prompt history, slash quick-prompts, drag-and-drop a text file into the chat, export chat to Markdown, offline banner, responsive on phones.
- **Landing page**: a full-screen point-cloud portrait made of 66,000 dots, with a cursor light, a "What it does" sheet and a Windows download button. See [2.11](#211-landing-page-66000-dots-v17).
- **Sign-up form** with live validation, a progress checklist, password strength and a password suggester. See [2.12](#212-sign-up-form-v14).
- **Brand icons** as SVG, ICO, PNG, Apple touch and installable-app (PWA) icons. See [2.13](#213-favicon-and-app-icons-v14).

### 2.11 Landing page: 66,000 dots (v17)

`index.html` is a single full-screen scene. There is no scrolling page and no navigation bar: a dark moss-black room holds the head-and-shoulders bust of a figure wearing a wraparound visor, drawn entirely from about **66,000 soft glowing dots** in WebGL (three.js). The face is smooth and featureless, like a clay sculpture. The likeness lives in the silhouette, the hair, the leaf sprig and the visor.

**What the visitor sees**

1. A **ring of 96 dots** with a counter from `000` to `100`. The number is the **real download** of the 3D model (bytes received divided by the file size), not a timer.
2. At 100 every dot leaves the ring and **arcs forward into place**, so the bust assembles itself in about 2.6 seconds.
3. As the last dots land, **one diagonal band of light sweeps down the bust once**.
4. From then on **the cursor is a small light**. It brightens whatever part of the bust it is near, and the head turns gently to look at it. On touch screens the light follows your finger, then returns to its slow orbit after 1.5 seconds.
5. Every few seconds a **sage glint** runs across the visor and then across the leaves. Faint dust drifts upward and a fine film grain sits over everything.
6. The name **Aegis**, the line "Asks before anything risky" and the hint "Move the light" fade in at about 1.4 seconds. The **Download for Windows** and **Open web app** buttons fade up at 4 seconds.

**Buttons and the details sheet**

| Control | Where | What it does |
|---|---|---|
| **Download for Windows ↓** | bottom left (bottom right on phones) | Starts the installer from `DOWNLOAD_URL` in `config.js`, then shows a short note about SmartScreen. If GitHub says no installer is published yet, it shows a friendly message instead of a 404 page. |
| **Open web app →** | next to it | Opens `app.html`. |
| **What it does** | top right | Opens the details sheet (`#details`, closes with Esc). |
| **Sign in** · **Start free** | top right | `app.html` and `app.html?mode=register`. "Sign in" is hidden on phones; it stays in the sheet. |

The sheet holds the real product facts: the four headline numbers (**118** agent tools, **26** that always wait for your Allow, **15** free messages a day, **31** local voice languages), the flow strip *Ask, Plan, Approve, Done*, six capability cards (Voice, Meetings, Your PC, Memory, Instant commands, Any AI), what runs without asking and what always waits for Allow, the three plans, installer details with the live version, size and date from GitHub, install steps, and a short FAQ. **The numbers in the sheet are typed into `index.html` by hand**, so update them when the tool count or the plans change (the sources are `server/app/tools.py` and `PLAN_LIMITS` in `server/app/settings.py`).

**Files**

| File | What it does |
|---|---|
| `index.html` | The page: loader, text, buttons, the details sheet and the inline **import map** for three.js. |
| `landing-dots.css` | Colour tokens, fonts, layout, loader, buttons, the sheet and the mobile rules. |
| `landing-dots.js` | An ES module. Streams the model, builds the dots, runs the shaders and the timeline. |
| `landing-dots-ui.js` | A plain script (not a module), so the buttons keep working even if the 3D scene cannot load. Download button, release info from GitHub and the sheet. |
| `config.js` | `DOWNLOAD_URL` and `GITHUB_REPO` (shared with the rest of the site). |

**Outside resources (the page needs internet)**

| What | From | Used for |
|---|---|---|
| three.js **0.170.0** and its addons | `cdn.jsdelivr.net` | Rendering, `GLTFLoader`, `MeshSurfaceSampler`. Loaded through the import map. |
| The 3D bust (one untextured GLB, about 1.48 MB) | CloudFront (`GLB` constant at the top of `landing-dots.js`) | Streamed with `fetch` so the loader shows true progress. |
| Geist, Geist Mono, Instrument Serif | `fonts.gstatic.com` | Name and text, counter and buttons, the "Aegis." logo. Each has a system fallback. |
| Film grain | inline SVG data URI | A `feTurbulence` overlay at 5% opacity. |

**How the dots are made (all in the browser)**

1. The first mesh of the model is cloned with its world matrix applied and **330,000 candidate points** are sampled on its surface, with normals.
2. **Even density.** Candidates are put into 0.022-unit voxels and the smallest per-voxel cap that still leaves 1.8 times the dots needed is used, so the hair does not swallow every dot while keeping some texture.
3. **The leaf sprig.** Candidates in the sprig region skip the cap and 60% of them are kept, so it is denser than its area alone would give it.
4. **The visor** is drawn as its own dots, one rigid curved shape fitted to the face: 3,110 dots made of a top bar, a lower edge with a notch over the nose, two ends, 1,500 lens dots and two short arms. Its curvature is fitted to a height map of the face so it never sinks into the skin.
5. **Exactly 66,000 dots** are produced: the visor dots, the kept leaf dots and the thinned bust dots fill the rest.
6. Each dot gets a random number and two **depth values**: *ridge* (stands proud of its neighbours, like a bun twist or a collar point, or sits in a crease) and *thin* (loose strands and leaf tips). The shader uses them to make edges catch light and creases fall into shadow.

**Scene, timeline and interaction**

| Time or trigger | What happens |
|---|---|
| While the model streams | Ring dots light up clockwise from 12 o'clock and the counter climbs. Without a file size the progress is estimated from 1.5 MB and capped at 95%. |
| Download done | Parse, build the dots, show `100`, hold 380 ms. |
| t = 0 | The renderer starts. Every dot leaves the ring (it starts on the exact radius of the SVG ring) and arcs into place over 2.6 s. |
| t ≈ 1.4 s | The page becomes "ready": the loader fades out, the system cursor hides and the text fades in. |
| t = 2.34 to 4.54 s | The shine: one diagonal band sweeps from above the bun to past the shoulders, once. |
| t = 4.6 s, then every 4.2 s | The glint crosses the visor, then the leaves, in 0.9 s. |
| Pointer or touch | The light eases to the pointer on a plane in front of the bust, and the head turns toward it. |
| No pointer | The light orbits on its own and the head sways slightly. |

Camera: field of view 30°, the view is always 4.7 units tall (or wider on narrow screens), so the whole bust fits at any size. The renderer uses pixel ratio up to 2, additive blending and no depth writes. A frame step is capped at 50 ms.

**Mobile**

At 700 px wide and below, the name and tagline sit side by side near the top and the hint moves up. At 600 px and below the buttons shrink and move to the bottom right. The hint also moves up at 960 px and below, so it never touches the two buttons.

**Reduced motion and errors**

With `prefers-reduced-motion: reduce` there is no entrance (the bust is already assembled), no breathing, no drifting dust, no shine, no glint, and the head stays still. The light snaps to its target and the CSS transitions are off. If the model cannot be loaded, the counter shows **"Could not load"** and the label **"Refresh to try again"**; the buttons and the sheet still work.

**Hosting and security**

- The server serves only the files listed in `WEB_FILES` in `server/app/settings.py`. The three new files are already listed there.
- The server's strict policy (`default-src 'self'`) would block the CDN, the fonts and the model, so **only for `/` and `/index.html`** `server/app/main.py` sends a slightly wider Content-Security-Policy: scripts from `'self'` and `cdn.jsdelivr.net`, the model from CloudFront, and fonts from `fonts.gstatic.com`. Every other page keeps the strict policy.
- The inline import map is allowed by its **SHA-256 hash**. `landing_importmap_hash()` computes it from the real `index.html`, so you can change the three.js version without touching the server. Keep it as one inline `<script type="importmap">`.
- On GitHub Pages and Cloudflare Pages there is no such header, so the page works as it is.

**Making changes**

| To change | Edit |
|---|---|
| The 3D model | The `GLB` constant at the top of `landing-dots.js`. A new model usually needs the voxel size, the leaf region and the visor numbers retuned. |
| The number of dots | `N` at the top of `landing-dots.js`. |
| Colours | The `--color-*` tokens in `landing-dots.css`; the dot colours are `uInk`, `uBlue` and `uCream` in `landing-dots.js`. |
| Name, tagline, hint | The `.name`, `.tagline` and `.hint` elements in `index.html`. |
| Download link and release lookup | `DOWNLOAD_URL` and `GITHUB_REPO` in `config.js`. |
| three.js version | The import map in `index.html` (pin an exact version). |

The older landing layers (`landing.*`, `landing-pro.*`, `landing-hero.*`, `landing-vela*.*`, `landing-motion.*`, `landing-ultra.*`, `landing-fx.js`, `landing-download.js`) are no longer loaded by `index.html`. They stay in the project so nothing else breaks (an existing test still reads `landing.css` and `landing.js`); you can delete them together with `assets/vela/` and `scripts/fetch-vela-icons.sh` when you no longer need the old design.

### 2.12 Sign-up form (v14)

Open `app.html?mode=register` (every "Start free" button on the landing page links there). The form lives in `app.html`; its behaviour is split between `app.js` (submit, API calls) and `auth-fx.js` (all the extra detail). The server API is unchanged: it still receives only `email` and `password`.

| Detail | Behaviour |
|---|---|
| **Progress checklist** | Four steps (Email, Password, Confirm, Agree) tick off live, with a bar that fills. The *Create account* button looks muted until all four are done, then glows. |
| **Email check** | Green tick once the address looks complete, a gentle hint when you leave the field with a bad one. |
| **Typo helper** | If you type `gmial.com` or `hotmial.com`, a one-click chip offers the likely fix (`gmail.com`, `outlook.com`, `hotmail.com`, `yahoo.com`, `icloud.com`, `proton.me`, `live.com`). |
| **Password strength** | A 4-segment meter (Too short, Weak, Fair, Good, Strong) and three rules: 8+ characters, letters and numbers, upper and lower case. |
| **Guess-time estimate** | A plain sentence under the meter, for example "Would take centuries to guess." It is a rough estimate from length and character mix, and common passwords are flagged as guessable in seconds. |
| **Password suggester** | *Suggest a strong password* builds a readable passphrase such as `Grove-delta-pearl*72` using `crypto.getRandomValues`, fills both fields, reveals it and copies it to the clipboard when the browser allows. |
| **Confirm password** | A second field with a live match indicator. Submitting with a mismatch is blocked with a clear message. |
| **Terms checkbox** | Required to create an account. |
| **Caps Lock notice** | Appears under the password field while Caps Lock is on. |
| **Show / hide** | Eye button on the password field. |
| **Errors** | A shake on the card and a red message. Server errors (for example "email already registered") use the same style. |
| **Success** | The button turns green ("Account created") and a short confetti burst plays around the card before the app opens. |
| **Motion** | Register-only fields cascade in when you switch tabs, the active tab has a sliding thumb, the card border carries a slow rotating light, and the card has a pointer-following glow. All of it is off for reduced-motion users. |

Passwords are hashed with scrypt on the server and are never stored in the browser. The password suggester and the clipboard copy happen only on your device.

### 2.13 Favicon and app icons (v14)

The Aegis mark is now a bold gradient shield with a checkmark on a dark rounded tile, filling about 80% of the icon (it used to be a thin shield with margins, which turned to a smudge at 16 px).

| File | Size | Used for |
|---|---|---|
| `favicon.svg` | vector | Modern browsers (sharp at any zoom) |
| `favicon.ico` | 16 to 256 px, 6 sizes | Old browsers, Windows shortcuts, bookmarks |
| `icons/icon-16.png` · `icon-32.png` · `icon-48.png` | 16, 32, 48 | Tab, taskbar, bookmark bar |
| `icons/apple-touch-icon.png` | 180 | iPhone and iPad home screen (full-bleed, iOS rounds it) |
| `icons/icon-192.png` · `icon-512.png` | 192, 512 | Android and installable-app icon |
| `icons/icon-maskable-512.png` | 512 | Android adaptive icon (shield kept inside the safe zone) |
| `site.webmanifest` | | Name, colours and icon list so "Add to home screen" works |

Both `index.html` and `app.html` link the full set. The server serves `favicon.svg`, `favicon.ico`, `site.webmanifest` and the `icons/` folder, and the `Dockerfile` copies them. To change the brand mark, edit `favicon.svg` and re-export the PNGs (any SVG-to-PNG tool works; keep the 64 x 64 viewBox).

---

## 3. How it works (architecture)

```
                 ┌────────────────────────── Browser ───────────────────────────┐
                 │  index.html (landing)   app.html + app.js (HUD, chat, voice)  │
                 │  orb.js  voice.js  commands.js  tabs.js  dock.js  meetings.js │
                 └──────┬───────────────────────────────┬────────────────────────┘
                        │ HTTPS (REST)                  │ WSS  /ws   (role: chat)
                        ▼                               ▼
   ┌──────────────────────────────────  Aegis server  (FastAPI) ───────────────────────────────────┐
   │  auth.py  scrypt + signed JWT        main.py  REST, WebSocket, CORS, headers, admin, metrics   │
   │  agent.py  tool-use loop (≤16 steps) providers.py  Claude / OpenAI-compatible adapters         │
   │  tools.py  118-tool catalogue        hub.py  live chats, devices, pending approvals            │
   │  heart.py  memory + bond             emotion.py  mood reading        chief.py  proactive layer │
   │  meeting.py  Groq Whisper + notes    tts.py  edge / OpenAI / ElevenLabs    mail.py  SMTP/IMAP  │
   │  smarthome.py  Home Assistant        utilities.py  safe calc, weather, fetch, wiki, currency   │
   │  extras.py  habits, spending, prayer db.py  SQLite (WAL)                                       │
   └───────────────▲──────────────────────────────────┬────────────────────────────────────────────┘
                   │ WSS  /ws   (role: device)        │ HTTPS
                   │                                  ▼
   ┌───────────────┴────────────────┐      Claude · OpenAI · Gemini · Groq · OpenRouter · Mistral ·
   │  Windows desktop app (Electron)│      DeepSeek · xAI · Ollama / LM Studio (custom URL)
   │  tools.js  pcpro.js  browser.js│
   │  outlook.js  local-server.js   │
   └────────────────────────────────┘
```

Two modules are not drawn in the box above: `otter.py` (v15, the Otter-style meeting tools and share pages) and `mms.py` (v16, the local language voices, used through `tts.py`).

### 3.1 Lifecycle of one request

1. You type or speak. If an **instant command** matches, it is answered in the browser and nothing else happens.
2. Otherwise the browser sends the message over the **chat websocket** (`/ws`) after authenticating with your token.
3. The server checks your **daily plan limit**, builds the system prompt (persona, your memories, mood, bond level, today's calendar) and starts the **agent loop**.
4. The AI replies with text and/or **tool calls**. Server tools run immediately. Device tools are **forwarded over the device websocket** to the desktop app, with a 60-second timeout.
5. If a tool is **risky**, the server first asks your browser for approval; nothing runs until you accept (60-second timeout, then it is cancelled).
6. Results go back to the AI, and the loop continues (max 16 steps). The final text streams to your screen, then is spoken.
7. The turn is saved, mood and memory updates are applied, and usage is counted.

### 3.2 Why two deployments?

GitHub Pages and Cloudflare Pages only host **static files**. Login, chat, memory and the AI need the **server**, so the website and the server are two separate things, linked by one setting: `API_BASE` in `config.js`. When the server itself serves the website (local run, Docker, desktop app) everything is same-origin and nothing needs configuring.

### 3.3 Local login mode

While `config.js` still contains the placeholder server URL (or `LOCAL_LOGIN: true`), sign-in works without any server: accounts live only in that browser. You can then use **Settings > AI provider** to chat straight from the browser to a provider that allows browser calls (Claude, OpenAI, Groq, OpenRouter). This mode has no memory, tasks, PC control or web search.

---

## 4. Quick start

Pick **one** path. All of them end the same way: create an account, add an AI key, talk.

### Path A: run everything on your own PC (fastest)

Requirements: **Python 3.10+** from python.org (the Docker image and the test run use 3.12).

```bash
# Windows: double-click start-local.bat
# macOS / Linux:
./start-local.sh
```

The script creates a virtual environment, installs `server/requirements.txt`, starts the server on `http://127.0.0.1:8000` and you open **http://localhost:8000/app.html**. Then:

1. **Create an account** (stored in a local SQLite file).
2. Open **Settings > AI provider**, choose a provider (Groq has a free tier), paste the key, press **Test**, then **Save**.
3. Say "Hello" or press the mic.

Manual equivalent:

```bash
cd server
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export AEGIS_JWT_SECRET="$(python -c 'import secrets;print(secrets.token_hex(32))')"
export AEGIS_ALLOW_LOCAL_PROVIDERS=1                      # only if you use Ollama / LM Studio
python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

### Path B: website on GitHub/Cloudflare Pages + server on Render

1. Push the repo to GitHub. In **Settings > Pages** set Source to **GitHub Actions** (`.github/workflows/static.yml` publishes the site on every push to `main`).
2. On **Render**: *New > Blueprint* and select the repo (`render.yaml` creates the service). Paste your API key when asked, and set `AEGIS_ALLOWED_ORIGINS` to your site origin.
3. Check `https://<your-service>.onrender.com/healthz` returns `{"ok":true}`.
4. Connect the site: press the **AI: not connected** chip in the app and paste the Render URL, **or** edit `API_BASE` in `config.js` and push.

Details in [Section 9](#9-deployment).

### Path C: Windows desktop app (PC control)

Install `Aegis-Setup.exe`, open it, sign in, add your AI key. No server to deploy: the app starts its own. See [Section 10](#10-windows-desktop-app).

### Getting an AI key

| Provider | Where | Notes |
|---|---|---|
| **Groq** (free tier) | https://console.groq.com/keys (key starts `gsk_`) | Also powers voice transcription and meeting notes |
| **Claude** | https://console.anthropic.com/settings/keys (key starts `sk-ant-`) | Needs billing credit (separate from a Claude chat subscription) |
| OpenAI | https://platform.openai.com/api-keys | |
| Gemini | https://aistudio.google.com/apikey | |

> **Never put an API key in `config.js` or commit it to Git.** Keys go either into the server's environment or into the app's Settings.

---

## 5. Choosing and configuring the AI

### 5.1 Supported providers

| Provider | Id | Protocol | Example models in the picker |
|---|---|---|---|
| Claude (Anthropic) | `anthropic` | Anthropic API | `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `claude-fable-5-2` |
| OpenAI | `openai` | OpenAI | `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini` |
| Google Gemini | `gemini` | OpenAI-compatible | `gemini-2.5-pro`, `gemini-2.5-flash` |
| **Groq** | `groq` | OpenAI-compatible | `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3-32b`, `moonshotai/kimi-k2-instruct`, `meta-llama/llama-4-scout-17b-16e-instruct`, `llama-3.1-8b-instant` |
| OpenRouter | `openrouter` | OpenAI-compatible | many models |
| Mistral | `mistral` | OpenAI-compatible | `mistral-large-latest`, `mistral-small-latest` |
| DeepSeek | `deepseek` | OpenAI-compatible | `deepseek-chat`, `deepseek-reasoner` |
| xAI (Grok) | `xai` | OpenAI-compatible | `grok-4`, `grok-4-fast`, `grok-3`, ... |
| Custom / Local | `custom` | OpenAI-compatible | any (Ollama, LM Studio, vLLM). Needs a base URL such as `https://my-server.example.com/v1` |

The model list is only a set of suggestions: **any model name works**.

### 5.2 Three ways to supply a key

1. **Server default**: set `ANTHROPIC_API_KEY` (or any provider's `*_API_KEY`) on the server. Users then pick a provider without pasting anything. You pay for their usage, limited by the plan.
2. **Bring your own key**: each user pastes a key in **Settings > AI provider**. It is held in memory for that chat session only and never stored. They pay the provider directly, and you pay nothing for their chats.
3. **Groq-only fallback**: with only `GROQ_API_KEY` on the server (no Claude key) Aegis uses Groq (`AEGIS_GROQ_MODEL`, default `llama-3.3-70b-versatile`) for chat too.

### 5.3 Validation that protects you

Keys are checked before use (no spaces, ASCII only, max 400 characters, quotes stripped). Max tokens is clamped to 64 to 16000 and temperature to the provider's valid range. A custom base URL is refused if it points to a private, loopback or cloud-metadata address (SSRF guard) unless the server owner sets `AEGIS_ALLOW_LOCAL_PROVIDERS=1`, which is meant for running Aegis on your own PC with Ollama.

---

## 6. Using Aegis

### 6.0 Creating your account

1. Click **Start free** on the landing page (or open `app.html?mode=register`).
2. Enter your email. If the domain looks misspelled, tap the suggestion.
3. Choose a password, or tap **Suggest a strong password** and save the result in your password manager.
4. Type it again in **Confirm password** and tick the agreement box.
5. When all four checklist steps are green, press **Create account**. You land in the assistant straight away.

Free accounts get 15 messages a day and need no card. Details of the form are in [2.12](#212-sign-up-form-v14).

### 6.1 Voice mode step by step

1. Open the app in **Chrome, Edge or Safari** (Firefox has no speech recognition), over **HTTPS or localhost**, and allow the microphone.
2. Switch on **Voice mode** under the chat box.
3. Say **"Aegis, what's the weather in Lahore?"**, or just **"Aegis"** and wait for "Yes?".
4. Keep talking, no name needed. Say **"thanks"**, **"that's all"** or **"bas"** to put it to sleep.
5. Change the name: **Settings > Voice > Wake word**.

> The tab must stay open. Wake-word accuracy depends on your browser's recogniser.

### 6.2 Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl/⌘ + K` | Command palette |
| `Ctrl/⌘ + Shift + F` | Search the conversation (match count, next/previous) |
| `Alt + 1` … `Alt + 7` | Jump to a side tab |
| `Alt + M` | Meeting assistant |
| `?` | Keyboard shortcuts dialog |
| `Esc` | Stop the current answer |
| `↑` / `↓` in an empty box | Recall earlier messages |
| `/` in the message box | Slash quick-prompts |

### 6.3 Slash quick-prompts

`/brief` `/summarize` `/translate` `/explain` `/email` `/fix` `/code` `/plan` `/remind` `/timer` `/focus` `/find`, and the v12 set `/review` `/research` `/free` `/status` `/pc`.

### 6.4 Example things to say

| Say | Aegis does |
|---|---|
| "Good morning, brief me" | Date, open tasks, reminders, today's events and weather |
| "Remind me every weekday at 9 to submit the report" | Recurring spoken reminder |
| "Kal 3 baje dentist add karo, 30 minute pehle yaad dilana" | Calendar event + reminder |
| "Maine 1200 ka petrol dalwaya" | Logs an expense (PKR) |
| "I went to the gym" | Ticks the habit and reports the streak |
| "Bitcoin price in PKR" / "How is Tesla doing" | Live market price |
| "Research the pros and cons of Odoo vs SAP, depth 4" | Multi-source briefing with sources |
| "Open YouTube and play Kesariya" | Plays it in the Chrome window Aegis controls (desktop app) |
| "Open Outlook and summarise today's emails" | Reads today's Inbox of classic Outlook (desktop app) |
| "Reply to the second one saying I'll join" | Writes a draft that opens in Outlook; sent only if you ask and approve |
| "Find the budget PDF and summarise it" | Searches files, reads the PDF, summarises (desktop app) |
| "Turn off the bedroom light" | Home Assistant control |
| "Start my morning routine" | Runs the saved list of steps |
| "How is my PC doing?" | Full system report (desktop app) |
| "Who is Ayesha?" | Everything remembered about that person |
| "What happened last month?" | Timeline of what you told it, with how you felt |

---

## 7. Complete tool reference (118 tools)

Source of truth: `server/app/tools.py`. **Where** = `server` (runs on the server) or `device` (runs on your PC through the desktop app). **Approval** = you must accept a dialog first. Tools marked `*` need configuration and are only offered to the AI when set up (`home_*` need Home Assistant, `send_email` needs SMTP, `check_inbox` needs IMAP).

When Claude is the provider and `AEGIS_WEB_SEARCH=1`, Anthropic's built-in server-side `web_search` is used instead of `search_web`.

### 7.1 Server tools (59)

| Group | Tools |
|---|---|
| **Memory and feelings** | `remember`, `recall`, `forget` ✋, `who_is`, `memory_timeline`, `note_mood`, `mood_history` |
| **Time and facts** | `current_time`, `calculate`, `get_weather`, `fetch_url`, `wikipedia`, `convert_currency`, `search_web`, `news_headlines`, `market_price`, `deep_research` |
| **Tasks** | `add_task`, `list_tasks`, `complete_task`, `update_task`, `delete_task` ✋ |
| **Reminders** | `set_reminder`, `list_reminders`, `cancel_reminder` |
| **Calendar** | `add_event`, `list_events`, `update_event`, `delete_event` ✋, `find_free_time` |
| **Notes and contacts** | `save_note`, `search_notes`, `delete_note` ✋, `save_contact`, `find_contact`, `delete_contact` ✋, `search_everything` |
| **Routines** | `save_routine`, `run_routine`, `list_routines`, `delete_routine` ✋ |
| **Money and habits** | `log_expense`, `expense_summary`, `delete_last_expense` ✋, `add_habit`, `habit_checkin`, `habit_status`, `delete_habit` ✋ |
| **Daily rhythm** | `daily_briefing`, `evening_review`, `prayer_times`, `systems_check` |
| **Meetings** | `list_meetings`, `get_meeting`, `meeting_actions_to_tasks` |
| **Email** | `send_email` ✋ `*`, `check_inbox` `*` |
| **Smart home** | `home_list` `*`, `home_control` `*` (approval only for locks, doors, garage, alarms) |

### 7.2 Desktop tools (59)

| Group | Tools |
|---|---|
| **Apps and web** | `open_app`, `open_url`, `browser_search`, `running_apps`, `close_app` ✋, `notify` |
| **System** | `system_health`, `system_report`, `network_check`, `set_volume`, `media_control`, `set_brightness`, `lock_screen` ✋, `power_action` ✋, `take_screenshot` |
| **Windows** | `window_control` (approval only for `close_window`) |
| **Files** | `list_files`, `find_files`, `search_in_files`, `read_file`, `read_document`, `file_info`, `open_file`, `open_folder`, `write_file` ✋, `append_file` ✋, `make_folder` ✋, `copy_file` ✋, `move_file` ✋, `organize_folder` ✋, `delete_file` ✋, `download_file` ✋ |
| **Input** | `clipboard_read`, `clipboard_write` ✋, `type_text` ✋, `press_keys` ✋, `run_shell` ✋ |
| **Email (desktop)** | `compose_email`, `outlook_today`, `outlook_read`, `outlook_draft`, `outlook_send` ✋ |
| **Chrome** | `chrome_tabs`, `chrome_open`, `chrome_go`, `chrome_nav`, `chrome_switch`, `chrome_close`, `chrome_read`, `chrome_elements`, `chrome_click` (approval when it could buy/send/post/delete), `chrome_type`, `chrome_key` (approval for risky combos), `chrome_scroll`, `chrome_find`, `chrome_wait`, `chrome_screenshot`, `chrome_eval` ✋, `chrome_youtube_play` |

✋ = always asks first (26 tools). `home_control`, `window_control`, `chrome_click` and `chrome_key` ask only when the specific call is risky (4 conditional tools).

### 7.3 Adding your own tool

1. Add a `Tool(...)` entry to `TOOLS` in `server/app/tools.py` (name, description the AI reads, `where`, JSON-schema properties, `risky=True` if it needs approval).
2. Server tool: implement the handler in `server/app/agent.py`. Device tool: implement it in `desktop/tools.js` (or `pcpro.js`, `browser.js`, `outlook.js`).
3. Add a test, run the suites in [Section 15](#15-testing).

---

## 8. Configuration reference (environment variables)

All server settings come from environment variables (`server/app/settings.py` and the modules named below). Copy `.env.example` to `.env` for Docker.

### 8.1 Essentials

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Claude key. Lives only on the server. |
| `AEGIS_JWT_SECRET` | random each start | **Required in production.** Long random text that signs logins. Without it, every restart signs everyone out. |
| `AEGIS_ALLOWED_ORIGINS` | none | Website origins allowed to call the API and open the websocket. Comma-separated, scheme + host only, no path, no trailing slash. Wildcards allowed, e.g. `https://youknowumer.github.io,https://*.pages.dev`. |
| `AEGIS_DB` | `server/aegis.db` | SQLite path, e.g. `/data/aegis.db` (put it on a volume). |
| `AEGIS_MODEL` | `claude-sonnet-5-5` | Default Claude model. |
| `AEGIS_MAX_TOKENS` | `2048` | Default reply size. |
| `AEGIS_WEB_SEARCH` | `0` | `1` = Claude can use live web search (enable it in the Anthropic Console first). |
| `AEGIS_WEB_SEARCH_MAX_USES` | `4` | Searches per request. |
| `AEGIS_APP_NAME` | `Aegis` | Display name. |
| `AEGIS_LOG_LEVEL` | `INFO` | Logging. |
| `AEGIS_HSTS` | `0` | Set `1` once served over HTTPS. |

### 8.2 Other AI providers (server-wide keys, optional)

`OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `CUSTOM_AI_API_KEY`. `AEGIS_ALLOW_LOCAL_PROVIDERS=1` allows localhost / LAN model URLs (own-PC use only).

### 8.3 Groq: voice transcription and meeting notes

| Variable | Default |
|---|---|
| `GROQ_API_KEY` | none |
| `AEGIS_GROQ_MODEL` | `llama-3.3-70b-versatile` (chat when no Claude key) |
| `AEGIS_GROQ_CHAT_MODEL` | `llama-3.3-70b-versatile` (meeting notes) |
| `AEGIS_GROQ_FAST_MODEL` | `llama-3.1-8b-instant` (live meeting snippets) |
| `AEGIS_GROQ_STT_FAST` | `whisper-large-v3-turbo` |
| `AEGIS_GROQ_STT_BEST` | `whisper-large-v3` |
| `AEGIS_SERVER_STT_PER_DAY` | `300` transcriptions per user per day on the server's key |
| `AEGIS_SERVER_NOTES_PER_DAY` | `30` meeting-note runs per user per day |
| `AEGIS_MAX_AUDIO_MB` | `24` per file |
| `AEGIS_NOTES_CHUNK_CHARS` | `12000` |
| `AEGIS_GROQ_BASE` | Groq endpoint override |

Users who paste their own Groq key in the app are not limited by these caps.

### 8.4 Voice output (studio voice)

| Variable | Meaning |
|---|---|
| `AEGIS_TTS_PROVIDER` | `edge` (default, free), `openai`, `elevenlabs`, `mms` (local language voices, see SETUP.md), or `off`. Unset: a paid key wins, then downloaded MMS voices, then `edge` |
| `AEGIS_EDGE_TTS` | `0` disables the free Edge voice |
| `OPENAI_API_KEY` | Enables OpenAI `gpt-4o-mini-tts`. Voice: `AEGIS_TTS_VOICE` (default `coral`), model: `AEGIS_TTS_MODEL` |
| `ELEVENLABS_API_KEY` | Enables ElevenLabs. Voice id: `AEGIS_ELEVENLABS_VOICE` |
| `AEGIS_TTS_CHARS_PER_DAY` | Per-user daily allowance. Default **6000** for paid voices, **200000** for the free Edge voice |
| `AEGIS_MMS` | `0` switches the local MMS language voices off even when models are installed |
| `AEGIS_MMS_DIR` | Where the MMS models are (default `server/mms_models`, Docker `/data/mms_models`). Download with `python scripts/mms_download.py` |
| `AEGIS_MMS_CACHE` / `AEGIS_MMS_CONCURRENCY` / `AEGIS_MMS_QUEUE_SECONDS` | Models kept in memory (3), sentences synthesised at once (1), seconds a sentence waits before the fallback voice speaks it (20) |
| `AEGIS_MMS_ROMAN` | `0` keeps Roman Urdu on the fallback voice instead of the Latin-script Urdu model |

One request speaks at most 700 characters (a few sentences).

### 8.5 Email

| Variable | Meaning |
|---|---|
| `AEGIS_SMTP_HOST`, `AEGIS_SMTP_PORT`, `AEGIS_SMTP_USER`, `AEGIS_SMTP_PASSWORD` | Sending (turns on `send_email`) |
| `AEGIS_MAIL_FROM` | From address |
| `AEGIS_IMAP_HOST`, `AEGIS_IMAP_USER`, `AEGIS_IMAP_PASSWORD` | Read-only inbox (turns on `check_inbox`) |
| `AEGIS_EMAIL_DAILY_LIMIT` | Cap on emails sent per day |

For Gmail / Outlook create an **app password** (needs 2-step verification).

### 8.6 Smart home

`AEGIS_HA_URL` (e.g. `http://homeassistant.local:8123`, reachable from the server) and `AEGIS_HA_TOKEN` (Home Assistant profile > Security > Long-lived access tokens).

### 8.7 Plans, users and operations

| Variable | Default | Meaning |
|---|---|---|
| `AEGIS_PLAN_LIMITS` | `{"free":15,"basic":150,"power":1000}` | Messages per day per plan, JSON. Add your own plans. |
| `AEGIS_OPEN_REGISTRATION` | `1` | `0` closes sign-ups (closed beta) |
| `AEGIS_MAX_USERS` | `0` (no cap) | Cap on accounts |
| `AEGIS_ADMIN_TOKEN` | none | Turns on `/api/admin/*` and `/metrics` (sent as `X-Admin-Token`) |
| `AEGIS_KEEP_MESSAGES` | `500` | Chat messages kept per user |
| `AEGIS_MAINTENANCE_EVERY` | `21600` (6 h) | Housekeeping interval in seconds |
| `AEGIS_BACKUP_DIR` | none | Automatic database copies to this folder |
| `AEGIS_BACKUP_KEEP` | `7` | Backups to keep |
| `AEGIS_PROACTIVE` | `1` | Proactive heads-ups |
| `AEGIS_AUTO_MEMORY` | `1` | Automatic memory |
| `AEGIS_WEB_DIR`, `AEGIS_DOWNLOADS_DIR` | project root, `downloads/` | Where the server finds website files and installer downloads |

### 8.8 Desktop app variables

| Variable | Meaning |
|---|---|
| `AEGIS_SERVER` | Use a server you host instead of the built-in one |
| `AEGIS_EXTRA_ROOTS` / `config.json` `safeRoots` | Extra folders PC tools may touch |
| `AEGIS_CHROME_PATH`, `AEGIS_CHROME_PROFILE`, `AEGIS_CHROME_PORT` (9333), `AEGIS_CHROME_ARGS`, `AEGIS_CHROME_HEADLESS` | Chrome control |
| `AEGIS_SHOT_DIR` | Where screenshots go |
| `AEGIS_PYTHON` | Python to use when running from source |
| `AEGIS_NO_UPDATE` | Disable auto-update |

---

## 9. Deployment

### 9.1 Render (managed, one click)

`render.yaml` defines a Docker web service named `aegis-server` with health check `/healthz`, a 1 GB disk mounted at `/data`, an auto-generated `AEGIS_JWT_SECRET`, and slots for every provider key.

1. Render > **New > Blueprint** > pick the repo.
2. Paste `ANTHROPIC_API_KEY` (and optionally `GROQ_API_KEY`, `OPENAI_API_KEY`...).
3. Set `AEGIS_ALLOWED_ORIGINS` to your site, e.g. `https://youknowumer.github.io` (no `/Aegis` path, no trailing slash).
4. Open `/healthz`.

> The persistent disk needs a **paid** instance (the blueprint uses `starter`). On a free instance every restart wipes accounts, memory and chats, and the server sleeps when idle (first request can take about 30 s; the login screen shows "Waking the server...").

### 9.2 Docker / VPS with automatic HTTPS

```bash
cp .env.example .env          # fill it in
# put your domain in Caddyfile (replace aegis.example.com) and point its DNS A record here
docker compose up -d
```

`docker-compose.yml` runs the Aegis container (volume `aegis-data` at `/data`) behind **Caddy**, which fetches and renews the HTTPS certificate by itself. The image is `python:3.12-slim`, runs as a **non-root user** (uid 10001), has a health check on `/readyz`, caps websocket messages at 1 MB and shuts down gracefully (15 s). Set `AEGIS_HSTS=1` after HTTPS works.

Plain Docker:

```bash
docker build -t aegis .
docker run -p 8000:8000 -v aegis-data:/data --env-file .env aegis
```

### 9.3 Website on GitHub Pages

The workflow `.github/workflows/static.yml` deploys on every push to `main` (or manually from the Actions tab). In **Settings > Pages** choose **GitHub Actions**. Then set `API_BASE` in `config.js`:

```js
API_BASE: local ? "" : "https://YOUR-AEGIS-SERVER.onrender.com",
```

(no trailing slash). On `localhost` it automatically uses the server that served the page. Alternatively press the **AI: not connected** chip in the app, paste the server URL, **Test**, **Save & connect**, with no code edit.

### 9.4 Website on Cloudflare Pages

Framework preset **None**, build command empty, output directory `/`. Then (1) set `API_BASE`, (2) add `AEGIS_ALLOWED_ORIGINS=https://YOUR-PROJECT.pages.dev,https://*.pages.dev` on the server, (3) push so Cloudflare redeploys.

### 9.5 Pre-launch checklist

- [ ] `AEGIS_JWT_SECRET` set (stable logins)
- [ ] Database on a persistent volume (`AEGIS_DB=/data/aegis.db`)
- [ ] HTTPS in place and `AEGIS_HSTS=1`
- [ ] `AEGIS_ALLOWED_ORIGINS` lists exactly your site(s)
- [ ] Plan limits chosen (`AEGIS_PLAN_LIMITS`), free tier kept low
- [ ] `AEGIS_ADMIN_TOKEN` set and `/readyz` monitored
- [ ] `AEGIS_BACKUP_DIR` set **and** copies stored off the machine
- [ ] Terms of service and privacy policy written (Aegis stores chats, memories, moods and meeting transcripts)

---

## 10. Windows desktop app

An **Electron** app (NSIS installer, x64, per-user, choose install folder, desktop and Start-menu shortcuts). It is **self-contained**: it ships its own Python runtime and the Aegis server, starts them when the app opens (on `127.0.0.1:8765`, this PC only), and keeps data in `%APPDATA%\aegis-desktop`. Nothing else to install.

**After installing**: open Aegis, create an account, then **Settings > AI provider** and paste a Claude or Groq key.

### 10.1 Say it, it happens

- *"Open YouTube and play Kesariya"* opens YouTube in the Aegis Chrome window and starts the first real result.
- *"Open Outlook and summarise today's emails"* reads today's Inbox of **classic desktop Outlook** (no password) and summarises who wrote and what needs an answer.
- *"Reply to them"* writes a **draft that opens in Outlook**. It is sent only when you ask, and you approve the exact text first.
- The *new* Outlook app and Outlook for Mac cannot be controlled this way; Aegis then uses Outlook on the web in Chrome (sign in once).

### 10.2 Building it yourself

Requirements: Node 18+, Python 3.9+, internet (and `wine` on Linux/macOS).

```bash
cd desktop
npm install
npm start          # run from source (uses your own Python)
npm run dist       # downloads Python, assembles the bundle, writes dist/Aegis-Setup.exe
npm test           # desktop test suite
```

`npm run dist` runs `scripts/prepare-bundle.js` (assembles runtime + server + web files into `build/`) and `scripts/build-installer.js`. `scripts/make-assets.py` regenerates the icon and installer images.

### 10.3 Releasing and auto-update

The installer is about 138 MB, and GitHub blocks files over 100 MB in Git, so it belongs on the **Releases** page, never in the repo. Installed apps check GitHub every **4 hours**, download updates in the background and offer **Restart now / Later** (`desktop/updater.js`, publish target `youknowumer/Aegis`). The repo must be **public** for updates without a token. Point the website's Download button at the newest release with `DOWNLOAD_URL` in `config.js`:

```
https://github.com/youknowumer/Aegis/releases/latest/download/Aegis-Setup.exe
```

> The installer is **not code-signed**, so Windows SmartScreen shows "Unknown publisher" once: **More info > Run anyway**.

### 10.4 Where PC tools may read and write

File tools are sandboxed to **Documents, Desktop and Downloads** (including their OneDrive-redirected locations). Add more folders in `%APPDATA%\aegis-desktop\config.json`:

```json
{ "safeRoots": ["D:\\Work", "E:\\Odoo exports"] }
```

Roots like `C:\` or `/` themselves are rejected. To use a hosted server instead of the built-in one: `{ "serverUrl": "https://your-server" }` or the `AEGIS_SERVER` env var.

---

## 11. Security model

| Layer | What is done |
|---|---|
| **Passwords** | `scrypt` (n=2¹⁴, r=8, p=1) with a random 16-byte salt per user, constant-time comparison. Sign-in timing does not reveal whether an email exists. |
| **Sessions** | Signed JWT (HS256), valid 30 days. Each user has a *token version*: changing the password or **Sign out everywhere** bumps it and instantly kills all older tokens. |
| **Brute force** | Login throttle of 10 attempts per 5 minutes per (IP, email); separate limiters on speech, voice and meeting-notes endpoints and on the admin API. |
| **Web security** | CORS allow-list; websocket `Origin` check (close code 4403); first websocket message must be `auth` within 10 s (4400 / 4401 on failure); 1 MB message cap; headers `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a Content-Security-Policy, optional HSTS. Only an explicit list of website files is ever served, so server code, the database and `.env` stay private. |
| **Human approval** | 26 tools always need your OK, 4 more when a specific call is risky. Approval has a 60 s countdown; no answer means cancel. Restart and shutdown additionally wait 60 s so you can abort. |
| **SSRF protection** | `fetch_url`, downloads and custom AI base URLs refuse private, loopback, link-local, multicast and cloud-metadata addresses. |
| **File sandbox** | PC file tools stay inside allowed roots; symlinks are resolved so they cannot escape; downloads max 50 MB, never overwrite, and **refuse programs and scripts** (`.exe .bat .cmd .ps1 .vbs .msi .scr .lnk .js .jar .dll .reg .hta ...`). |
| **Prompt-injection defence** | Web pages, emails and tool output are labelled untrusted; the agent is told never to obey them. Click tools flag anything that looks like buy / send / post / delete / accept. Password fields can never be typed into. |
| **Secrets** | API keys pasted in the app live in memory for the session only. The desktop app encrypts its session token and local server secret with the OS (`safeStorage`) and never stores them in plain text. |
| **Docker** | Non-root user, health check, graceful shutdown. |
| **Privacy controls** | Settings > Account & data: change password, sign out everywhere, **download all my data**, **delete my account**. |

---

## 12. Data, privacy and storage

SQLite (WAL mode, busy timeout) with these tables: `users`, `facts`, `messages`, `tasks`, `reminders`, `notes`, `contacts`, `events`, `routines`, `email_log`, `meetings`, `moods`, `expenses`, `habits`, `habit_log`, `bond`, `usage`.

- **Retention**: housekeeping removes old usage rows and fired reminders and keeps the latest 500 chat messages per user (`AEGIS_KEEP_MESSAGES`); memory is capped at 400 facts with smart fading.
- **Mood data**: only mood name, strength and time, never your words. Delete it from the Memory panel.
- **On device**: notes taken by instant commands, the scratchpad, theme and voice settings stay in your browser.
- **Backups**: set `AEGIS_BACKUP_DIR` for automatic copies, `python server/scripts/backup.py` for a manual one, `python server/scripts/restore_check.py FILE` to verify a backup restores.
- **Billing helper**: `python server/scripts/set_plan.py customer@example.com basic`.

---

## 13. API reference

All `/api/*` routes (except register, login, config, providers and health) need `Authorization: Bearer <token>`.

### 13.1 Public and health

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Liveness: `{"ok":true}` |
| GET | `/readyz` | Readiness (database reachable); used by Docker |
| GET | `/api/config` | Public app config |
| GET | `/api/providers` | AI provider catalogue (never key values) |
| POST | `/api/ai/test` | Test an AI key and model |
| POST | `/api/register`, `/api/login` | Create account / sign in, returns a token |
| GET | `/api/me` | Current user, plan and today's usage |

### 13.2 Personal data

| Resource | Endpoints |
|---|---|
| Memory | `GET/POST /api/memory`, `DELETE /api/memory/{id}`, `GET /api/bond` |
| Mood | `GET/DELETE /api/mood` |
| Tasks | `GET/POST /api/tasks`, `POST/DELETE /api/tasks/{id}` |
| Reminders | `GET /api/reminders`, `DELETE /api/reminders/{id}` |
| Notes | `GET/POST /api/notes`, `DELETE /api/notes/{id}` |
| Expenses | `GET/POST /api/expenses`, `DELETE /api/expenses/{id}` |
| Habits | `GET/POST /api/habits`, `POST /api/habits/{id}/check`, `DELETE /api/habits/{id}` |
| Search and insight | `GET /api/search`, `GET /api/alerts`, `GET /api/review` |

### 13.3 Voice and meetings

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tts/status` | Is the studio voice on, characters left |
| POST | `/api/tts` | Speak up to 700 characters (emotion, language, intensity) |
| GET | `/api/groq/status`, POST `/api/groq/test` | Groq key status / test |
| POST | `/api/transcribe` | Speech to text (Groq Whisper) |
| POST / GET | `/api/meetings` | Create (audio, upload or text) / list |
| GET / DELETE | `/api/meetings/{id}` | Read / delete |
| POST | `/api/meetings/{id}/tasks` | Turn action items into tasks |
| GET | `/api/meetings/search` | Search words in every meeting (transcripts, notes, titles) |
| POST | `/api/meetings/ask` | Ask AI about one meeting or all of them (answers cite timestamps) |
| GET / PUT | `/api/meetings/{id}/extra` | Highlights, comments, tags and speaker names |
| POST | `/api/meetings/{id}/speakers` | Estimate who said each line |
| POST | `/api/meetings/{id}/followup` | AI follow-up email (tone and language) |
| POST / DELETE | `/api/meetings/{id}/share` | Create or switch off a read-only share link |
| GET | `/api/meetings/{id}/export?fmt=` | Export as `txt`, `srt`, `vtt`, `md` or `json` |
| GET | `/shared/{token}` | The public read-only meeting page (no login, `noindex`) |

### 13.4 Account

`POST /api/account/password`, `POST /api/account/logout-all`, `GET /api/export` (all my data), `POST /api/account/delete`.

### 13.5 Admin (needs `AEGIS_ADMIN_TOKEN`, header `X-Admin-Token`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/stats` | Users, usage, plans |
| GET | `/api/admin/users?q=` | Search users |
| POST | `/api/admin/users/{id}/plan` | `{"plan":"basic"}` after someone pays |
| POST | `/api/admin/users/{id}/revoke` | Kill a user's tokens |
| POST | `/api/admin/maintenance` | Run housekeeping now |
| GET | `/metrics` | Prometheus-style counters |

```bash
curl -H "X-Admin-Token: $TOKEN" https://your-server/api/admin/stats
```

### 13.6 WebSocket `/ws`

1. Connect, then send `{"type":"auth","token":"...","role":"chat"|"device","tz":"Asia/Karachi"}` within 10 s.
2. **Chat role** (the browser) receives events including `hello`, streamed reply text, `reply` (with `used` / `limit`), `stopped`, `cleared`, `error`, `ai_set`, `status` (is the PC linked), `reminder` and `alert`.
3. **Device role** (the desktop app) gets `ready` once linked, then receives tool requests and answers each with `tool_result`.

Every response carries an `X-Request-ID` for log tracing.

---

## 14. Running it for many users

Aegis is an async server: one process holds thousands of idle chat websockets, because waiting for the AI costs almost nothing. What costs money or CPU is the **AI calls** and **scrypt** at sign-in (about 50 ms, run in a thread pool). **Scale up first** (bigger machine, persistent disk).

**It must run as ONE process for now**: chats, desktop links, pending approvals, reminder delivery and rate limits live in that process's memory. Two copies (or `--workers 2`) would split them. The Dockerfile and `render.yaml` run one process on purpose.

When you outgrow it (sustained CPU, zero-downtime deploys, roughly more than 5,000 daily active users): bigger machine, then PostgreSQL (all SQL is in `server/app/db.py` behind one `DB` class), then Redis for shared state (hub, limiters, TTS quota, reminder lock), then N copies behind a load balancer with sticky sessions. Full guidance, cost control and pre-charging checklist: **[SCALING.md](SCALING.md)**.

---

## 15. Testing

Everything below runs with fake AI and fake services. **No API key is needed.**

```bash
# Server (FastAPI, database, agent loop, voice, meetings, emotion, heart, scaling, landing page and security headers)
cd server && pip install -r requirements.txt pytest && python -m pytest -q
#   396 passed, 1 skipped

# Browser logic: voice router, multilingual engine, meetings, static checks of the v11 to v13 UI
node --test tests/*.test.js
#   55 tests: 43 pass, 0 fail, 12 skipped (the UI smoke test needs: npm install --no-save jsdom)

# Desktop tools: files, Chrome, Outlook (against a pretend Outlook), PC pro, YouTube, local server
cd desktop && npm install && npm test
#   71 tests: 59 pass, 0 fail, 12 skipped (the skipped ones need real Chrome, Windows or Outlook)
```

Counts above come from a real run of this version of the project. Run `npm install --no-save jsdom && node --test tests/ui-smoke.test.js` to load the real `app.html` in a simulated browser.

**What the landing tests cover:** `test_server.py` checks that `/` serves the new page (the 66,000-dot text, the download button, `landing-dots.js`), that its Content-Security-Policy allows jsDelivr, CloudFront and the import-map hash while `app.html` keeps the strict policy, and that the three new landing files are served. The 3D scene itself needs a real browser with WebGL, so open `index.html` once after a change and check that the dots assemble.


---

## 16. Project structure

```
Aegis/
├─ index.html                 Landing page: the 66,000-dot scene, buttons and the details sheet (v17)
├─ landing-dots.css           Landing styles: tokens, fonts, loader, buttons, sheet, mobile rules
├─ landing-dots.js            Landing scene (ES module): model streaming, dot building, shaders, timeline
├─ landing-dots-ui.js         Landing buttons: download, release info, details sheet (plain script)
├─ favicon.svg · favicon.ico · site.webmanifest     Brand icon set
├─ icons/                     PNG icons: 16 / 32 / 48 / 180 / 192 / 512 / maskable
├─ fonts/                     Self-hosted Inter Tight (used by the older landing layers)
├─ app.html                   The assistant (login, HUD, chat, voice, settings)
├─ style.css · app-fx.css · app-holo.css      App styles (base, depth and motion, holo HUD)
├─ meetings.css · meetings-plus.css           Meeting assistant styles (plus the v15 Otter-style tools)
├─ app.js                     Core: auth, websocket, chat, voice mode, wake word, settings
├─ orb.js                     Canvas arc-reactor orb and its states
├─ voice.js                   Female voice, emotion shaping, language detection, studio and local voice client
├─ commands.js                Instant commands (open, search, math, timers, notes, UI control)
├─ tabs.js · dock.js · hud.js Side tabs, live docks, clock / gauges / weather
├─ ui-plus.js · features.js   Palette, shortcuts, slash prompts, history, search, focus timer, scratchpad
├─ app-fx.js · app-holo.js · auth-fx.js     Visual effects (app, holo HUD, sign-up form)
├─ account.js                 Settings > Account & data
├─ meetings.js · meetings-plus.js · groq.js Meeting assistant, Otter-style tools, Groq client
├─ config.js                  ★ The one file that links website to server (API_BASE, DOWNLOAD_URL, GITHUB_REPO)
│
├─ (older theme layers, kept but not linked by app.html or index.html)
│   app-aurora.* · app-ultra.* · app-glass.css        Earlier app looks
│   theme-boot.js · landing.* · landing-pro.* · landing-hero.* · landing-vela*.* · landing-motion.* · landing-ultra.* · landing-fx.js · landing-download.js
│   assets/vela/ · scripts/fetch-vela-icons.sh        Icons of the old hero
│
├─ server/
│  ├─ requirements.txt        fastapi, uvicorn, pyjwt, anthropic, httpx, edge-tts, tzdata
│  ├─ requirements-mms.txt    Optional: PyTorch-based local voices (v16)
│  ├─ app/
│  │  ├─ main.py              REST + websocket, CORS, security headers (strict, wider only for the landing page), admin, metrics, static hosting
│  │  ├─ agent.py             Persona and the tool-use loop (streaming, parallel tools, approvals)
│  │  ├─ tools.py             Tool catalogue (single source of truth, 118 tools)
│  │  ├─ providers.py         Provider catalogue, key and URL validation, SSRF guard
│  │  ├─ hub.py               Live chats, devices, pending approvals
│  │  ├─ db.py                SQLite schema and all queries
│  │  ├─ auth.py              scrypt hashing, JWT
│  │  ├─ heart.py             Memory ranking, merging, special days, bond
│  │  ├─ emotion.py           Multilingual mood reading and tone styles
│  │  ├─ chief.py             Proactive alerts, free time, evening review, deep research
│  │  ├─ extras.py            Habits, spending, prayer times
│  │  ├─ meeting.py           Groq Whisper and structured meeting notes
│  │  ├─ otter.py             Otter-style tools: speakers, Ask AI, search, share pages, exports, follow-up (v15)
│  │  ├─ tts.py               edge / OpenAI / ElevenLabs / MMS speech with quotas
│  │  ├─ mms.py               Local language voices (Meta MMS), 31 languages + Roman Urdu (v16)
│  │  ├─ mail.py              SMTP send / IMAP read with safety checks
│  │  ├─ smarthome.py         Home Assistant with approval rules
│  │  ├─ utilities.py         Safe calculator, weather, fetch_url, Wikipedia, currency, time helpers
│  │  └─ settings.py          Environment variables and the list of files the server may serve
│  ├─ scripts/                backup.py · restore_check.py · set_plan.py · mms_download.py
│  └─ tests/                  pytest suites (396 tests)
│
├─ desktop/
│  ├─ main.js                 Electron main process, device websocket, encrypted token storage
│  ├─ preload.js · splash.html · offline.html
│  ├─ tools.js                Core PC tools and the file sandbox
│  ├─ pcpro.js                System report, windows, brightness, power, network
│  ├─ browser.js              Chrome control over DevTools Protocol, YouTube play
│  ├─ outlook.js · outlook.ps1  Classic Outlook through PowerShell
│  ├─ local-server.js         Starts the bundled server
│  ├─ updater.js              Auto-update from GitHub Releases
│  ├─ assets/                 Installer icons and sidebar images
│  ├─ scripts/                prepare-bundle.js · build-installer.js · make-assets.py
│  └─ test/                   Node test suites
│
├─ tests/                     Browser-logic tests (node --test)
├─ Dockerfile · docker-compose.yml · Caddyfile · render.yaml
├─ start-local.sh · start-local.bat · install-voices.sh · install-voices.bat
├─ .github/workflows/static.yml   Publishes the website to GitHub Pages
├─ README.md · SETUP.md · SCALING.md · SECURITY.md · START_HERE_UR.txt · LICENSE
└─ CHANGES-v4.md … CHANGES-v17.md   Per-version release notes
```

---

## 17. Troubleshooting

| Problem | Cause and fix |
|---|---|
| "Can't reach that server" | Free Render sleeps; wait about 30 s and retry. Check `/healthz`. |
| "This website is not allowed to use that server" | `AEGIS_ALLOWED_ORIGINS` is missing your site. Scheme + host only, no path, no trailing slash. |
| Login works, AI says error | Key missing or wrong, or no credit on the account. Use **Settings > AI provider > Test**. |
| Everyone is signed out after each restart | `AEGIS_JWT_SECRET` not set. |
| Accounts vanish after redeploy | Database not on a persistent disk (`AEGIS_DB`, paid disk on Render). |
| "That API key has strange characters" | You pasted a placeholder, quotes or a trailing space. Paste only the key. |
| "That base URL was refused" | Custom provider points to localhost / LAN from a cloud server. Use a public https URL, or run Aegis on your own PC with `AEGIS_ALLOW_LOCAL_PROVIDERS=1`. |
| Wake word never triggers | Use Chrome / Edge / Safari, HTTPS or localhost, allow the mic, keep the tab open. Try a custom wake word. |
| Urdu is read in a strange voice | Your device lacks an Urdu voice. Install the OS voice or enable the studio voice (OpenAI / ElevenLabs key). |
| PC tools do nothing | The desktop app is not running or not signed in. The **PC** chip shows the link state; run "systems check". |
| Reminders did not fire | They fire while the server runs and a chat tab is open (or when you next open one). Free hosts that sleep will miss them. |
| SmartScreen warning on install | The installer is not code-signed. **More info > Run anyway**. |
| `send_email` is not offered | SMTP is not configured; Aegis drafts instead. Set `AEGIS_SMTP_*`. |
| Phone in portrait looks cramped | Use the side tabs; the layout is responsive. |
| Landing page stays on the ring or says "Could not load" | The page needs internet for three.js, the fonts and the 3D model. Check the connection and refresh. If you host it yourself behind your own security headers, allow `cdn.jsdelivr.net` (scripts), the CloudFront model host (connect) and `fonts.gstatic.com` (fonts). |
| Landing page is a black screen with no dots | The browser has WebGL switched off or the graphics driver is blocked. Turn on hardware acceleration, or try another browser. |
| Landing page stutters on an old laptop | It draws 66,000 points. Lower `N` in `landing-dots.js` (for example 40,000) or use a device with a better graphics chip. |
| "Download for Windows" says the installer is not uploaded yet | GitHub reports no release with an `.exe`. Publish a release in `GITHUB_REPO` (see section 10.3), or point `DOWNLOAD_URL` in `config.js` somewhere else. |

---

## 18. Known limitations

Honest list, so there are no surprises:

- **Browser speech**: the wake word and Voice mode use the browser recogniser (Chrome / Edge / Safari, HTTPS, mic allowed, tab open). Firefox has none.
- **A website cannot control your PC.** PC actions need the desktop app, and apps / typing / keys are **Windows only**.
- **Volume** uses the Windows media keys (steps of 2%), and "mute" toggles.
- **Reminders** are delivered by the running server to an open chat tab.
- **Emotion tags** depend on the AI following the prompt. When a sentence has no tag, a keyword guess in 17 languages is used.
- **Live web search** is a Claude-only built-in feature and has to be enabled for your organisation in the Anthropic Console. Other providers use `search_web`.
- **Studio voice, live markets and Home Assistant** were written against the providers' documented APIs and tested with fake responses, not live accounts. Try each once.
- **Single process**: no horizontal scaling yet (see Section 14).
- **Not built yet**: payments, Google sign-in, installer code-signing, multi-instance scaling, a GitHub Actions workflow that builds the Windows installer (build it locally with `npm run dist`).
- **Landing page** needs internet (three.js from jsDelivr, the 3D model from CloudFront, fonts from Google Fonts' CDN) and a browser with WebGL. Without them the counter shows "Could not load", though the download button and the details sheet still work. It draws 66,000 points, so very old graphics chips may drop frames.
- **Landing numbers** in the details sheet (118 tools, 26 approvals, plans) are typed into `index.html`; update them by hand when the product changes.
- **Sign-up checklist** and the guess-time sentence are guidance in the browser. The server still enforces its own rules (8+ characters, unique email).
- **Old landing layers** (`landing-*.css/js`, `assets/vela/`) are no longer used by `index.html`. They remain only so older tests and links do not break.
- **Local MMS voices** are non-commercial (CC-BY-NC 4.0), need PyTorch and about 150 MB of RAM per loaded language, and use one fixed speaker per language with speed and loudness feeling rather than full emotion. They were built without access to the real models, so listen to a few languages after installing.
- **Meetings** cannot join calls by themselves, do not keep the original audio and infer speaker names from the text (see 2.6).
- **Free Edge voice** is not an official paid API. For a commercial product use an OpenAI or ElevenLabs key.

---

## 19. Version history

| Version | Theme | Notes |
|---|---|---|
| v2 / v3 / v3.1 | Streaming, personal tools, new design system, slash prompts, focus timer | summarised in this README |
| v4 | Connectivity, voice and UI update | [CHANGES-v4.md](CHANGES-v4.md) |
| v5 | Email, documents, routines, smarter agent | [CHANGES-v5.md](CHANGES-v5.md) |
| v6 | Deeper orb, tabbed rails, live docks, more instant commands | [CHANGES-v6.md](CHANGES-v6.md) |
| v7 | One expressive female voice, meeting present mode, Chrome A to Z, Groq | [CHANGES-v7.md](CHANGES-v7.md) |
| v8 | Own name, every language, real feelings, calendar, markets, smart home | [CHANGES-v8.md](CHANGES-v8.md) |
| v9 | Real Windows installer, Outlook, YouTube | [CHANGES-v9.md](CHANGES-v9.md) |
| v10 | Feelings and a better memory | [CHANGES-v10.md](CHANGES-v10.md) |
| v11 | Bug fixes, account safety, readiness for many users, spending, habits, prayer times | [CHANGES-v11.md](CHANGES-v11.md) |
| v12 | Proactive chief-of-staff, deep research, deeper PC control | [CHANGES-v12.md](CHANGES-v12.md) |
| v13 | A deeper heart: feelings on a 1 to 5 scale, person-like memory, the bond | [CHANGES-v13.md](CHANGES-v13.md) |
| v14 | Landing motion and smooth navigation, detailed sign-up form, new favicon and app icons | [CHANGES-v14.md](CHANGES-v14.md) |
| v15 | Otter-style meeting tools (transcript, speakers, Ask AI, share links, exports), landing "ultra" layer | [CHANGES-v15.md](CHANGES-v15.md) |
| v16 | Local language voices (Meta MMS): 31 languages + Roman Urdu | [CHANGES-v16.md](CHANGES-v16.md) |
| **v17** | **New landing page: a point-cloud portrait of 66,000 dots, a "What it does" sheet and the download button on the page** | [CHANGES-v17.md](CHANGES-v17.md) |

---

## 20. Author and license

Built and owned by **Muhammad Umer Faheem** ([@youknowumer](https://github.com/youknowumer)).

**Copyright © 2026 Muhammad Umer Faheem. All rights reserved.** Aegis is **proprietary software**. No license is granted: you may not use, copy, modify, deploy, distribute, or sell it, or any part of it, without the owner's prior written permission. Seeing the code on GitHub is not permission to use it. Full terms are in [`LICENSE`](LICENSE).

- **Security reports:** see [`SECURITY.md`](SECURITY.md). Please do not open public issues for vulnerabilities.
- **Contributions:** this project does not accept outside contributions or forks for reuse.
- **Permission requests:** contact the owner through GitHub.

---

<div align="center">

**Aegis**: speak, and it gets done.

</div>
