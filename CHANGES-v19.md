# v19: learning, instant voice browser control, fast reminders

## New
- `server/app/learning.py`: lessons from what you say, 👍/👎 feedback, habit profile, redaction, training export (openai / alpaca / kto JSONL) and an Ollama Modelfile. Tables `lessons`, `interactions`, `prefs`. Tools `teach`, `list_lessons`, `forget_lesson`.
- `server/app/fastpath.py`: reminders (set, snooze, list, cancel; English + Roman Urdu) and ~40 browser voice commands answered with no AI call and no quota, working even with no AI key.
- `chrome_media` tool (extension and desktop app): play, pause, mute, seek, speed, volume, next video, captions, fullscreen.
- `show numbers` draws numbered badges on the real page (extension and desktop); `click 4` then clicks it.
- `chrome_type` with no target types into the focused field, or the first visible search box.
- Browser mode in `webctl.js`: page commands act on your linked browser (switch with "control this page" / "control my browser").
- `learning.js`: Settings card (what was learned, delete, add, export) and voice shortcuts ("when I say X, do Y").
- REST: `/api/learning`, `/settings`, `/lessons`, `/export`, `/modelfile`, `DELETE /data`. WebSocket: `feedback` in, `feedback_ok` out; replies carry `iid`.
- `LEARNING.md`, `server/scripts/train_export.py`, tests `server/tests/test_v19.py`, `tests/v19-static.test.js`.

## Fixed
- `window.AegisApp` had no `token` / `apiBase`, so the Browser control connection code and "export my memory" by voice could not work. Added.

## Env
`AEGIS_LEARNING=0` (off), `AEGIS_KEEP_INTERACTIONS=3000`.

## Tests
Server 434 passed (14 new). The same 6 older tests fail as in the v18 zip (CSP `media-src` header, local-voice status wording); they are unrelated to this change. JS 54 passed, desktop 62 passed.
