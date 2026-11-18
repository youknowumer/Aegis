# v4: connectivity, voice and UI update

## Connecting the AI
- If the website is served by the Aegis server itself (Render / Docker / localhost) it links up automatically. `config.js` needs no edit.
- Top bar chip shows the live state: **AI online**, **AI key missing**, **Server offline**, **AI: not connected**. Click it to open the Connect dialog; **Test** reports whether the server is reachable and whether `ANTHROPIC_API_KEY` is set.
- `/healthz` now returns `{"ok": true, "ai": true|false}` (never the key).
- A link like `app.html?server=https://your-aegis.onrender.com` opens the dialog pre-filled. It is never applied silently.

## Fixes
- `ui-plus.js` and `features.js` were missing from the server file list and the Dockerfile (404 on server-hosted sites).
- Inline head script in `index.html` was blocked by the server CSP; moved to `theme-boot.js` (landing now defaults to dark).
- `window.open(..., "noopener")` always returns null, so every "open YouTube" also printed a false "blocked" message.
- Speech errors (`network`, `audio-capture`, `not-allowed`, unsupported language) no longer loop silently; they switch voice off and say why.
- Voice no longer waits for the AI socket (instant commands need no server). Voice mode now resumes after silent commands such as "mute".
- HUD latency now follows the real server (it ignored same-origin and the Connect dialog).
- GitHub Pages workflow publishes only the website files, not `server/` or `desktop/`.
- Added the missing `.env.example`.

## Voice commands added
play X / "X chalao", date batao, abhi time kya hai, focus mode on/off, chat saaf karo, mere notes dikhao, battery kitni hai, mausam batao, "A se B directions", "2400 ka 15 percent", bolna band karo, kaise ho.

## Tests
`cd server && pytest` (37), `node --test tests/commands.test.js` (6), `cd desktop && npm test` (unchanged, not re-run).
