# Aegis v17: web control by voice, deeper feelings, better memory

## 1. Voice control of the web (new `extension/` folder + `webctl.js`)
- **Aegis Web Hands** (Chrome / Edge / Brave extension): Aegis can now drive your REAL browser, with your own sign-ins, even without the desktop app: open sites, switch/close tabs, read pages, list buttons, click, type, choose dropdowns, scroll, find text, press keys, screenshots, play YouTube.
  Same safety as the desktop app: never types passwords; buying/sending/posting/deleting/accepting asks first; running JavaScript always asks.
- Install: `chrome://extensions` > Developer mode > Load unpacked > `extension` folder. In Aegis: Settings > **Browser control** > Copy connection code, paste in the extension popup.
- Server: new `browser` websocket role. `chrome_*` tools go to the desktop app if linked, otherwise to the extension. Optional `AEGIS_EXTENSION_IDS=<id>` limits which extension may connect.
- `webctl.js`: instant (no quota) voice commands on the Aegis page itself: scroll up/down/top/bottom, back/forward/reload, zoom in/out, "show numbers" + "click 4", "click Settings", "type ...", "press enter", "clear field", read selection, "what can I click", copy link, print, fullscreen, download my memory, save this chat. Roman Urdu variants included.

## 2. Understands feelings more like a person (`emotion.py`)
- Contrast ("I'm fine, but honestly exhausted" = tired), laughter, Roman Urdu negation that follows the word ("khush nahi hoon"), many more everyday phrases, 4 new moods (playful, nostalgic, curious, apologetic), arousal level.
- Reads the **need** behind the feeling: heard / helped / reassured / celebrated with / given space / distracted / safety. Aegis now replies to that need, not just the label.
- `Tracker` (per conversation): notices **masking** ("no it's fine" after a hard moment), a feeling that will not lift (stops repeating the same comfort), sudden drops, relief after a bad patch, and blends in how the voice sounded (slow + low = tired).
- Fixed an old bug: a duplicate dictionary key silently threw away most of the "sad" phrases.

## 3. Better memory
- **Pin** memories (voice: "never forget this"): they never fade. API + tools: `pin_memory`, `remember(pin=true)`.
- **Rhythms**: notices when you tend to feel low (e.g. Sundays, late at night) from mood history, once a day, saved as `insight` memories. Tool `my_patterns`, API `/api/mood/insights`.
- **Topic feelings**: if you mention something that once stirred strong feeling (the exam), Aegis is ready for it.
- **People**: remembers who is who and how you feel about them. Tool `people`, API `/api/people`.
- Smarter recall: rare words count more; Roman Urdu / Urdu / English synonym groups (paisa/salary, dawai/medicine, shaadi/wedding, ...).
- **Export / import** memory: `GET /api/memory/export`, `POST /api/memory/import`, edit `PATCH /api/memory/{id}`, pin `POST /api/memory/{id}/pin`.

## Tests
`server/tests/test_v17.py` (18) and `tests/v17-webctl.test.js` (7). Whole suite: 414 Python + JS tests pass.
