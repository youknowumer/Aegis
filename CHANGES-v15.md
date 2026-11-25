# v15: Otter-style meeting features + landing page "ultra" layer

## Meetings (needs an Aegis server account)
- **Interactive transcript** tab: timestamps, search inside the transcript, highlight lines (★), comment on lines, tags.
- **Speaker labels**: "Identify speakers" estimates who said each line from the conversation (Whisper itself does not mark speakers), click a name to rename it.
- **Talk time + keywords + question count** per meeting (computed locally, no AI call).
- **Ask AI** tab: chat with one meeting or with all your meetings. Answers cite timestamps you can click to jump to that line.
- **Search every meeting** (History tab): finds words in transcripts, notes and titles, with a snippet.
- **Share link** (`/shared/<token>`): read-only public page, noindex, can be switched off any time.
- **Export**: .txt, .srt, .vtt, .md, .json (speaker names and timestamps included).
- **AI follow-up email** with tone and language choice, copy or open in your mail app.
- **Custom vocabulary** (Record tab): names and jargon are fed to Whisper as a spelling hint.
- API: `GET /api/meetings/search`, `POST /api/meetings/ask`, `GET|PUT /api/meetings/{id}/extra`, `POST /api/meetings/{id}/speakers`,
  `POST /api/meetings/{id}/followup`, `POST|DELETE /api/meetings/{id}/share`, `GET /api/meetings/{id}/export?fmt=`, `GET /shared/{token}`.
- Files: `server/app/otter.py`, `meetings-plus.js`, `meetings-plus.css`; `meetings` table gained `extra` and `share` columns (auto-migrated).
- Tests: `server/tests/test_otter.py` (9 tests, Groq faked).

## Not included (Otter has them, they need infrastructure this project does not have)
- A bot that auto-joins Zoom / Meet / Teams from your calendar. Use "Microphone + browser tab audio" or Present mode instead.
- Playback of the original audio synced to the transcript (audio is not stored on the server).
- Voice-based speaker recognition (labels are inferred from the text).

## Landing page
- `landing-ultra.css` / `landing-ultra.js`: vivid colour field, gradient headline, word-by-word heading reveals, staggered card reveals,
  pointer spotlight and animated borders on cards, scroll-drawn "how it works" line, parallax stickers.
