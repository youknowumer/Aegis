# v10: feelings and a better memory

## Feelings (server/app/emotion.py)
- Aegis reads how you feel in every message (English, Roman Urdu, Urdu, Hindi, Arabic word lists; no extra AI call):
  happy, excited, proud, grateful, stressed, anxious, sad, lonely, angry, tired, and a danger-sign check.
- The reply is shaped by it ("sad": slow, gentle, no rushing to fix; "stressed": calm, short, one thing off your plate...).
  Danger signs (self-harm words) override everything: Aegis drops the task, responds with care, encourages reaching a trusted
  person or emergency services, and does not use tools.
- Mood history: only the mood name, strength and time are stored (never your words). Aegis sees "Their mood lately" and, if you
  were low a day or two ago and have not talked today, may check in once, gently.
- New AI tools: `note_mood` (the AI records a feeling the word list missed, with an optional reason) and `mood_history`.
- Aegis has feelings of its own that it shows back (glad, concerned, curious) and never lets them take over when you need it.
- `GET /api/mood?days=7&tz=Asia/Karachi` (summary) and `DELETE /api/mood` (forget everything about how you felt).
- Website/app: a small line in the Memory panel ("You seem sad. Aegis is here with you.") and a "Forget how I have been feeling" link.
- Websocket: a `{"type":"mood","mood":..,"intensity":..,"feeling":..}` message is sent before each reply.

## Memory
- Memories now have a `kind` (fact, preference, person, event, goal, emotion) and an importance. `remember` takes
  `kind` and `important`; `recall` can filter by kind, or with no query returns what matters most.
- Near-duplicates are merged instead of piling up (same memory said twice becomes one, and more important).
- Smarter recall in every reply: matches for what you just said, plus the things that matter most (people, emotional moments,
  goals) even when you did not mention them; Aegis uses them like a friend, never like a database dump.
- The Memory panel shows each memory's kind and marks important ones. Old databases are upgraded automatically.

## Voice: one realistic female voice, free (server/app/tts.py)
- New default studio voice that needs **no key**: Microsoft Edge's neural read-aloud voices through the `edge-tts` package.
  It is bundled in the installer, so the desktop app no longer falls back to Windows' robotic voices.
- ONE woman in every language: the multilingual neural voice "Ava" speaks English, Spanish, French, German, Italian, Portuguese,
  Japanese, Korean and Chinese; other languages (Urdu, Hindi, Arabic, Persian, Bengali, Turkish, Russian...) use the best native female neural voice.
  A male voice is never chosen. Roman Urdu/Hindi ("kya haal hai") is spoken by an Indian-English female voice.
- The voice list is checked live, so a renamed voice never breaks speech; if the service is unreachable the browser voices take over.
- Each feeling changes speed, pitch and volume (empathy slower and softer, joy brighter, excited faster...).
- The AI is told to speak like one real woman on a phone call: natural reactions, answers the feeling first, brings up what it remembers.
  It is still honest if you sincerely ask whether it is an AI.
- Priority: OPENAI_API_KEY (gpt-4o-mini-tts, the most expressive) > ELEVENLABS_API_KEY > free Edge voice.
  `AEGIS_EDGE_TTS=0` turns the free voice off; `AEGIS_TTS_PROVIDER=off` turns all studio voices off; the Settings > Voice
  "studio voice" box turns it off per user. Limit: `AEGIS_TTS_CHARS_PER_DAY` (free voice default 200000 per user).
- Hearing any language: Settings > Voice & meetings (Groq) with a free Groq key. Whisper then detects the language you speak by itself.
- Privacy/licence note: with the free voice, the text Aegis speaks is sent to Microsoft's service. Edge's read-aloud service is not an
  official paid API, so for a commercial product use an OpenAI or ElevenLabs key instead.

## Tests
- server/tests/test_emotion.py (mood reading in 4 scripts, danger signs, negation, memory merge, old-database upgrade, mood history,
  check-in, privacy between users, the AI tools end to end). Server: 231 pass (test_voice_edge.py: voice choice per language, never male, Roman Urdu, fallbacks, API, limits). Front-end: all pass.

## Release note
- The desktop installer contains the server, so users get this through the auto-update: tag a new version (e.g. `v1.1.0`).
