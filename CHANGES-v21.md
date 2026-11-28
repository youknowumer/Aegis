# v21: the voice follows the listener, real-time talk, better Urdu

## 1. The voice follows the person (region + language)
- **Region.** The browser works out where the listener is: their own choice (Settings > Voice > *Voice region*) > the country the server sees (CDN header such as `CF-IPCountry`, new `GET /api/voice/profile`) > the time zone > the browser language tag (`en-US` is ignored, it is only the default of most browsers).
- **Accent per region.** English: Pakistan / India / Bangladesh / Sri Lanka / Nepal -> Indian English (`en-IN`), UK -> `en-GB`, Australia, Canada, Ireland, New Zealand, South Africa, Singapore, Hong Kong, Kenya, Nigeria, Philippines, Tanzania each get their own. Arabic: 16 regional voices (Saudi, Egyptian, Emirati, Iraqi, Moroccan...). Spanish (Spain, Mexico, Argentina, Colombia, Chile, Peru, Venezuela, US), Portuguese (Brazil / Portugal), French (France / Canada / Belgium / Switzerland), German (DE / AT / CH), Chinese (CN / TW / HK), Urdu (PK / IN), Bengali (BD / IN), Tamil (IN / LK / SG / MY). A region with no voice of its own falls back to the language's standard voice. US English keeps the usual Aegis persona.
- **What is sent.** Every studio-voice request now carries `region` (country) and `speaker` (the language the person speaks). The server uses `region` to pick the Edge voice (checked against the live voice list, retried with the standard voice if a regional voice fails) and a Piper voice made for that region when one is installed (`en_GB`, `pt_PT`, `es_MX`...; an owner's `AEGIS_PIPER_VOICES` pin still wins). OpenAI voices get the accent as an instruction ("the listener is in Pakistan...").
- **Browser voices** (no server): the region weighs more when choosing among installed voices, so Indian English beats US English for a listener in Pakistan if that voice is installed.

## 2. Urdu
- **Urdu is spoken by the neural voice first** (`ur-PK-UzmaNeural`, or `ur-IN-GulNeural` for a listener in India) and the local MMS model is the offline fallback. Switch with `AEGIS_TTS_EDGE_FIRST` (default `ur`; `ur,pa` adds Punjabi; `0` = local voices first, as in v20).
- **Words as well as voice:** a spoken Urdu / Roman Urdu answer now gets style guidance (everyday Pakistani Urdu, `۔ ؟ ،` for breaths, borrowed words in Urdu script so the voice does not switch accent; one steady Roman Urdu spelling).

## 3. Real-time talk (`talk.js`, new)
- **Speaks while the answer is still being written.** Each finished sentence is spoken at once (any script: `۔ ؟ । 。`; decimals, `Dr.`, `e.g.`, list numbers are not sentence ends; Chinese / Japanese / Korean are weighed by density). Sentences that finish while a chunk plays are spoken together afterwards. Switch: Settings > Voice > *Start speaking while I am still writing the answer*.
- **Interrupt by talking** (Voice mode). The microphone is watched while Aegis speaks, with echo cancellation on; the loudness of her own voice leaking in is measured first, and only speech clearly above it for a quarter of a second interrupts. She stops, stays quiet for the rest of that answer, and listens. **Off by default** (with open speakers she could hear herself); **on automatically when the speaker looks like headphones**; switch in Settings > Voice.
- `speak()` now reports whether it really started, so a chunk that cannot be spoken never stalls the rest.

## Fixed on the way
- `auth-ui.js` and `auth-ui.css` were loaded by `app.html` but missing from the served-files list: the server (Docker / Render) answered 404 for them. Added (with `talk.js`).
- `tests/ui-smoke.test.js` and `tests/v11-static.test.js` did not understand the `?v=1` cache-busting query on those two files, so they failed or were skipped. They now strip it.

## Tests
`server/tests/test_v21.py` (region tables, Edge voice choice, retry, Urdu order and offline fallback, Piper region, accent line, profile endpoint, Urdu prompt, served files) and `tests/v21-talk.test.js` (sentence cutting, live speech, interrupt detector, region logic, and the real app in jsdom). `server/tests/conftest.py` pins `AEGIS_TTS_EDGE_FIRST=0` so the older tests keep describing the local-first chain. Full suites: server 551 passed (2 skipped), browser 96 passed (jsdom).

## Not covered / honest limits
- The tests use stand-ins for the audio. Nobody has listened to the voices or spoken into a microphone here: try the voice region picker, a Urdu answer and Voice mode with headphones on your own machine.
- The interrupt detector needs a good microphone and echo cancellation; with open speakers keep it off.
- The Edge voices come from Microsoft's online read-aloud service through the `edge-tts` package (unofficial): Urdu now depends on it being reachable (MMS answers when it is not).
- Piper voices for other regions are not downloaded automatically: `python scripts/piper_download.py --voices en_GB-alba-medium` (any voice name) and a British listener gets it.
