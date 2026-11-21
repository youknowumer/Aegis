# v5: a much more capable assistant

Goal: Aegis should *do things*: open files, read documents, send email, run multi-step jobs.
Everything below was added without removing any earlier feature, and every new action keeps the same safety model
(risky = you approve it first; files stay inside allowed folders).

## New: email
- `send_email` (server, SMTP). Asks for your approval first and shows To / Cc / Subject / text like a real email.
  Header injection, more than 10 recipients, empty subject/body and daily limit (default 20) are all enforced in code.
- `check_inbox` (server, IMAP). Read-only: opening mail never marks it read. Search by text, unread only by default.
- `compose_email` (desktop). Opens a fully pre-filled draft in your own mail app. Works with no server setup at all.
- Both server tools are hidden from the AI until you set `AEGIS_SMTP_*` / `AEGIS_IMAP_HOST` (see `.env.example`).
  Without them Aegis automatically falls back to `compose_email`.
- `save_contact` / `find_contact`: "email Ali the invoice" now works by name. Addresses are never guessed.

## New: documents and files (desktop app)
- `read_document`: Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF and any text file. Tables come out as tab-separated
  rows, Excel keeps sheet names, formulas never calculated by Excel show as `=...`. Long files are read in pages.
  `read_file` on an Office file or PDF now uses the same reader instead of failing.
- `search_in_files`: find which file *contains* a word (find_files still searches names).
- `make_folder`, `copy_file` (never overwrites), `append_file`, `file_info`, `open_folder`.
- `download_file`: https only, public hosts only (localhost / LAN / cloud-metadata refused, also after redirects and
  with the checked IP pinned), 50 MB cap, never overwrites, programs and scripts (.exe .bat .ps1 ...) always refused.
- Windows folders redirected to OneDrive (very common) are now allowed automatically. Extra folders: add
  `{"safeRoots": ["D:\\Work"]}` to `config.json` in the app's data folder.
- Bare names like "report.docx" are looked up in every allowed folder.
- `open_app` understands friendly names: Word, Excel, PowerPoint, VS Code, Power BI, Edge, Teams, Calculator, Terminal...

## New: routines, recurring reminders, smarter agent
- `save_routine` / `run_routine` / `list_routines` / `delete_routine`: say "start my morning routine" and Aegis performs
  every saved step (briefing, inbox, open apps...).
- Reminders can repeat: daily, weekdays, weekly, monthly, at the same clock time in your time zone. They survive server
  sleep (the next one is always scheduled in the future). Old databases upgrade automatically.
- Independent harmless tools now run in parallel (a briefing that needs weather + tasks + time is faster).
- More steps per request (16 instead of 12), better prompt: plan first, recover from tool errors, never claim success
  without a tool result.
- Prompt-injection defence: text from web pages and emails is marked untrusted, and the AI is told never to obey it.

## Fixes found by testing on real files
- PDF reading failed on Node's pooled buffers ("bad XRef entry"); fixed by passing a plain copy.
- Word tables printed a stray line break after every cell; fixed.
- The approval dialog showed emails as JSON with `\n`; it now reads like an email.
- The old test assumed every server tool is always offered; email tools are now conditional (test updated).

## Tests
`cd server && pytest` = 58 (was 43) | `cd desktop && npm test` = 31 (was 12) | `node --test tests/commands.test.js` = 6.

## Honest limits
- Not run against a real mail server, a real Windows PC or a live Claude key here. SMTP/IMAP use mocks; the Windows-only
  tools (open_app aliases, mailto opening, open_folder) are unit-tested only where they are pure code. Try each once.
- Scanned PDFs have no text layer, so `read_document` says so instead of guessing (no OCR).
- Old `.doc` / `.xls` / `.ppt` are not supported (docx / xlsx / pptx are).
- Sending email uses your account, so a daily limit and per-email approval are the safety net. Keep approvals on.
- No screen-reading / clicking automation yet: that is the next big step (see below).

## Suggested next steps
1. Screen understanding: screenshot into the model, then mouse/keyboard actions with approval.
2. Google Calendar and Gmail OAuth instead of app passwords.
3. Odoo tools (read-only first) so Aegis can answer from your ERP data.
4. Postgres + Redis for many users, and a signed installer for the desktop app.
