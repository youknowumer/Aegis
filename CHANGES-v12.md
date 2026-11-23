# v12: a proactive chief-of-staff (heads-ups, research, day review, deeper PC control)

Aegis no longer waits to be asked. Everything below is additive; v11 behaviour is unchanged.

## Proactive heads-ups (server pushes them, the app speaks them)
- **Meeting starting**: "Heads up: Standup starts in 12 minutes at Room 2." (15 minutes ahead, once per event.)
- **Habits still open** after 8 pm, with the streak that is on the line. Once per evening.
- **Unusual spending**: today's PKR spending is far above your usual day (needs 5 days of history).
- Each alert is sent once. Turn the whole thing off with `AEGIS_PROACTIVE=0`. REST: `GET /api/alerts`.
- A welcome line after sign-in (once per browser session): "All systems online. Good evening. Your next event is ...".
  It is read aloud only when "read replies aloud" is on.

## New things Aegis can do
- `deep_research`: searches the web from several angles in parallel, reads the best pages (one per site), and writes a briefing
  with findings, disagreements, sources and what is uncertain. A failing search or page never breaks the rest.
- `find_free_time`: "when am I free tomorrow for an hour?" Gaps between calendar events inside your working hours.
- `evening_review`: "how did my day go / wrap up / good night": tasks, habits, spending, tomorrow's calendar, reminders, mood.
  REST: `GET /api/review`.
- `systems_check`: "status report": is the PC linked, voice, email, smart home, memory, what is waiting.
- Chief-of-staff behaviour in the system prompt: anticipates the next need in one short sentence, does several asks at once,
  treats a "protocol" as a saved routine ("initiate the work protocol").
- Slash commands: `/review`, `/research`, `/free`, `/status`, `/pc`.

## New PC abilities (Windows desktop app, `desktop/pcpro.js`)
- `system_report`: CPU load, memory, disk, battery and charging, uptime, IP and the 5 hungriest programs.
- `window_control`: show desktop, minimize all, minimize / maximize / restore, snap left / right, switch window, virtual desktops,
  Task View, screenshot tool. Closing a window asks first.
- `set_brightness`, `network_check` (internet, ping, Wi-Fi name and signal).
- `power_action`: sleep, hibernate, restart, shutdown, cancel. Always asks first, and restart / shutdown wait 60 seconds so you can cancel.

## Tests
- Server: 281 pass (14 new in `tests/test_v12.py`). Desktop: new `test/pcpro.test.js`. Front-end: new `tests/v12-static.test.js`
  (also checks that every desktop tool the server offers really exists in the desktop app).
