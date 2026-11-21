# v7: one expressive female voice, meeting "present mode", full Chrome control

## 1. One female voice, with feeling (`voice.js`, `app.js`)
- The 10 personas are gone. There is **one voice: a warm female voice**. It picks the best female voice installed on the device
  (Neural / Natural / Premium / Siri first). A male voice is never chosen while a female one exists; Urdu and Hindi pages use
  an Urdu / Hindi female voice (Uzma, Swara...). If only a male voice is installed the pitch is lifted so it still leans female.
- **Emotion engine.** Every sentence is read for its feeling and spoken with its own pitch, speed, volume and pause:
  `joy`, `excited`, `empathy`, `concern`, `urgent`, `curious`, `warm`, `confident`, `calm`. It understands English, Roman Urdu
  and Urdu script ("mubarak ho!" = joy, "afsos hai..." = empathy, "abhi fori karo" = urgent, "?" = curious, "..." = slower and a longer pause).
  Sad sentences are slower, softer and linger; happy ones are brighter and quicker; a small drift keeps long text from sounding flat.
- Control it by voice: **"more emotion"**, **"less emotion"**, **"emotions off"**, **"emotions on"** (Roman Urdu: "zyada emotion add karo", "jazbaat kam karo"),
  or the *Emotion* slider in Settings > Voice and the Voice tab. "Hear my emotions" plays four sample lines.
- Asking for a male voice or another accent is answered honestly ("I only have one voice").

## 2. Meeting present mode (`meetings.js`, `commands.js`)
- **Present mode** = Aegis sits in on a meeting that is already running and listens **silently**: no spoken replies (they would be
  recorded into the meeting), voice mode is switched off so it never answers your colleagues, and a small floating pill shows the
  timer, a level meter, the latest caption and buttons (Extract points / Pause / Transcript).
- Start it by voice or text: **"present mode"**, **"join the meeting"**, **"meeting chal rahi hai"**, **"meeting suno"**, **"میٹنگ سنو"**, or the new
  *Present mode* button in the Meeting assistant.
- At the end say **"meeting points extract karo"** (also "extract meeting points", "meeting ke points nikalo", "meeting khatam karo aur points nikalo",
  "میٹنگ کے پوائنٹس نکالو"). Aegis stops listening, finishes the transcript, writes the notes (summary, important points, decisions, action
  items, risks, next steps) and **reads them aloud with feeling**: calm summary, confident decisions, concerned risks, warm next steps,
  urgent for high-importance points. The notes tab opens too. Works while the meeting is still running, while it is being transcribed, or afterwards.
- Read-out is spoken in the notes language you chose (English, Roman Urdu, Urdu, Hindi). Voice mode comes back by itself afterwards.
- **Windows desktop app:** it can capture everything the PC plays (Meet / Zoom / Teams in any app) through system-audio loopback, with your
  microphone mixed in, without a share-picker (`desktop/main.js`).

## 3. Full Chrome control (`desktop/browser.js`, 16 `chrome_*` tools)
Aegis drives a real Chrome window through the Chrome DevTools Protocol (no extension). Needs the desktop app + Google Chrome.
| Tool | Does |
|---|---|
| `chrome_tabs` / `chrome_open` / `chrome_switch` / `chrome_close` | list, open in a new tab, switch (by number or title), close tabs |
| `chrome_go` / `chrome_nav` | go to an address; back / forward / reload |
| `chrome_read` / `chrome_find` / `chrome_elements` | read the page text, find a phrase, list numbered clickable / editable controls |
| `chrome_click` / `chrome_type` / `chrome_key` | click (number, text or selector), type into fields and dropdowns, press keys and shortcuts |
| `chrome_scroll` / `chrome_wait` / `chrome_screenshot` | scroll, wait for text / selector, save a screenshot (full page optional) |
| `chrome_eval` | run JavaScript (always asks you first) |
- **Its own profile.** Chrome 136+ refuses a debugging port on your everyday profile, so Aegis starts Chrome with a dedicated profile
  (`%LOCALAPPDATA%\Aegis\chrome-profile`). Sign in to Gmail / LinkedIn / etc. **once** in that window; it stays signed in.
  Override with `AEGIS_CHROME_PATH`, `AEGIS_CHROME_PROFILE`, `AEGIS_CHROME_PORT` (default 9333, localhost only).
- **Safe by design.** Only http(s) pages (and chrome://history, downloads, version); no `file:`, `javascript:`, `data:`. Password fields are
  never typed into. Clicks and Ctrl+Enter that look like buy / pay / send / post / delete / accept / submit return `NEEDS_APPROVAL`; the AI
  must tell you and call again with `approved=true`, which pops the normal approval dialog (`Tool.risky_when` in `server/app/tools.py`).
  `chrome_eval` always asks. JavaScript alerts are handled so a tab can never freeze. Page text is treated as untrusted.

## Tests
- `node --test tests/*.test.js` : 17 (new: emotion engine, one-female-voice selection, present / extract routing, read-out script)
- `cd desktop && npm test` : 35, including **end-to-end tests against a real headless Chrome** (open, read, click, type, select, scroll, tabs, screenshot, approval gating, password refusal)
- `cd server && pytest` : 85 (new: tool registry, approval rules, approved click asks the user)

## Honest limits
- Voices are the ones your OS has. For a *studio-quality* emotional voice (real laughter, breathing, tone that changes inside a sentence),
  the next step is a cloud TTS (ElevenLabs / Azure / OpenAI) behind your server; the emotion engine already produces the per-sentence plan to feed it.
- Present mode in a plain browser records your microphone (and a shared tab's audio when you start it with a click and tick "Share tab audio").
  A voice command is not a click, so browsers may refuse the tab-share; it then falls back to the microphone. The Windows desktop app avoids this.
- Meeting transcription and notes need a Groq key (free) as before; speaker names are not identified.
- The Electron system-audio capture and the Windows-specific Chrome paths could not be run here (no Windows / Electron); the Chrome tools and the web UI were tested on Linux.
