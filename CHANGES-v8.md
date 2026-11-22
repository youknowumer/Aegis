# Aegis v8: its own name, every language, real feelings, more abilities

Goal: Aegis is its own assistant (its own character, not a copy of another assistant), speaks and feels in any language, and does more of what a full personal assistant does.

## 1. The name is Aegis everywhere
- Persona, voice prompts, wake word, UI labels, landing page, docs, tests: no other assistant name is left (a test enforces it).
- Wake word: "Aegis" with the usual mis-hearings (ejis, edgis, aegus...) and the name written in Urdu, Arabic, Hindi, Bengali, Cyrillic, Japanese, Korean and Chinese script. Greetings in many languages work too ("hola Aegis", "hey Aegis", "ارے ایجس"). A custom wake word still works.

## 2. Talks in every language
- The persona now says: reply in the language and script of the user's last message (Urdu script, Roman Urdu, Hinglish, Arabic, Spanish, Chinese...), switch when they switch, and act as an interpreter on request.
- Listening: 20 languages in the language list (was 3); "switch to Spanish / French / Arabic / Japanese..." works by voice, in English, Roman Urdu or the language's own script.
- Whisper uses the full large-v3 model for every language except English (was only Urdu/Hindi/Punjabi).
- Each sentence is spoken with an installed voice of ITS OWN language, so a mixed answer (English + Urdu + Spanish) is read properly. Before this, anything that was not Arabic or Devanagari script was read with an English voice.
- Language detection (`AegisVoice.analyze`): by script (Urdu vs Arabic vs Persian, Chinese vs Japanese, Russian vs Ukrainian...) and by common words for Latin-script languages (Spanish, French, German, Portuguese, Italian, Turkish, Indonesian, Dutch, Roman Urdu/Hindi).
- Roman Urdu is spoken with an Indian-English voice if you have one, and sent to the studio voice as Urdu.
- More female voice names are recognised for Spanish, French, German, Italian, Portuguese, Russian, Turkish, Japanese, Korean, Chinese, Thai, Hindi, Arabic, Indonesian and others.

## 3. Feels in every language
- **The AI tags each sentence** with its feeling: `[calm] [warm] [joy] [excited] [curious] [empathy] [concern] [urgent] [confident]`. A language model understands feelings in any language, which a word list cannot. The tags are removed from the screen, the copy button and the speech; a tag covers the rest of its paragraph.
- When a sentence has no tag, a keyword engine guesses the feeling in 17 languages (English, Roman Urdu/Hindi, Urdu, Hindi, Arabic, Persian, Bengali, Spanish, French, German, Portuguese, Italian, Turkish, Indonesian, Russian, Chinese, Japanese, Korean). The old English/Urdu behaviour is unchanged (all earlier tests pass untouched).
- Sentence splitting understands `。 ！ ？ … ۔ ।` and keeps decimals whole ("3.5").
- **Emotional intelligence in the persona**: read the mood first (happy, stressed, sad, angry, lonely...), answer the feeling, then the task; natural interjections per language; a safe response if someone seems in danger.
- "Settings > Voice > Hear another language" plays a feeling-filled line in 12 languages.

## 4. Studio voice (optional, the real fix for voice quality)
- `server/app/tts.py` + `POST /api/tts`, `GET /api/tts/status`. Set `OPENAI_API_KEY` (gpt-4o-mini-tts, follows a tone instruction per sentence) or `ELEVENLABS_API_KEY` (multilingual v2, tuned stability/style per feeling).
- Neighbouring sentences with the same feeling and language are sent as one request; the next request is fetched while the current one plays.
- Per-user daily allowance (`AEGIS_TTS_CHARS_PER_DAY`, default 6000) and rate limit. Any failure, or running out, falls back to the browser voice for that part, so speech never stops. A toggle in Settings > Voice turns it off.

## 5. New abilities
| Tool | What it does |
|---|---|
| `add_event`, `list_events`, `delete_event` | Calendar: "dentist tomorrow 3pm, remind me 30 min before", "what is on today?", overlap warning. Today's events appear in `daily_briefing`. Deleting asks first. |
| `market_price` | Live crypto (CoinGecko) and stock/ETF (Stooq) prices, optional currency like PKR. No keys. |
| `home_list`, `home_control` | Smart home through Home Assistant (`AEGIS_HA_URL`, `AEGIS_HA_TOKEN`). Lights, fans, AC, volume, scenes, scripts. Locks, doors, garage covers, alarms and unknown devices always ask first, and the module refuses them even if the approval check were skipped. |
| WhatsApp | The assistant opens a prefilled `wa.me` link from a saved contact; you press send. |

## Tests
- Server: 103 tests (18 new in `tests/test_v8.py`: persona, calendar, markets, smart home and its approval rules, studio voice, quota, failures).
- JS: 37 tests. `tests/multilingual.test.js` (language detection, feelings in many languages, tags, per-sentence language, voice choice), more language-command tests, and `tests/ui-smoke.test.js`, which loads the real `app.html` with every script in jsdom (needs `npm install --no-save jsdom`; skipped otherwise) and checks the wake word, hidden tags, per-sentence voices, studio voice and its fallback, and the settings panel.

## Not verified here (please try once)
- Studio voice, market prices and Home Assistant were built from the providers' documented APIs and tested with fake responses. No live keys, accounts or home were available.
- No real browser was available. The UI was exercised in jsdom, which cannot judge how the voices sound or how the page looks. Click through it once.
- Voice quality for a language without studio voice depends on voices installed on the device; Urdu is commonly missing.
- Not done: the assistant cannot yet see the screen (screenshots are saved but not sent to the AI), and there is no Google Calendar / Spotify sync (they need OAuth apps registered by you).
