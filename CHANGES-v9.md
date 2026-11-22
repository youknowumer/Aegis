# v9: a real installer, Outlook, YouTube

## Installer (desktop/)
- `Aegis-Setup.exe` is now **self-contained**: it ships its own Python and the server. On start the app launches the server on
  `127.0.0.1:8765` (this PC only), shows a splash screen, then opens the app. No deployment, nothing to install first.
  Data lives in `%APPDATA%\aegis-desktop` (survives updates and uninstall). Logs: `%APPDATA%\aegis-desktop\logs\server.log`.
- Proper Windows wizard (per-user, no admin, choose folder, desktop + Start menu shortcuts, run after install), app icon,
  wizard artwork, clean uninstaller. Not code-signed (SmartScreen shows "Unknown publisher" once).
- `npm run dist` builds it (`scripts/prepare-bundle.js` assembles Python + server, `scripts/build-installer.js` runs
  electron-builder; no wine needed on Linux/macOS). `.github/workflows/build-windows.yml` builds it on Windows and smoke-tests
  the bundled server and a silent install/uninstall.
- `AEGIS_SERVER` / `serverUrl` still point the app at a server you host yourself.
- Website: `DOWNLOAD_URL` in `config.js` can point the Download button at GitHub Releases.

## Outlook (desktop app, classic Outlook, no mail password)
- New tools: `outlook_today`, `outlook_read`, `outlook_draft` (opens a draft, never sends), `outlook_send` (the user approves the
  exact text first). Data goes to PowerShell as JSON on stdin, never inside a command. Email text is marked untrusted.
- The agent prompt teaches: summarise today's emails, draft replies, send only when asked.
- New Outlook / Outlook for Mac cannot be controlled; the tools say so and the agent falls back to Outlook on the web.

## YouTube
- New tool `chrome_youtube_play`: searches and starts the first real result. In the desktop app, "play X on YouTube" does it
  instantly (preload `playYoutube`, allowed only from the Aegis page). The controlled Chrome starts with autoplay allowed.

## Tests
- Desktop: 64 (62 run, 2 need Chrome). New: Outlook tool logic, `outlook.ps1` against a pretend Outlook, YouTube helpers, local server.
- Server: tool registry, `outlook_send` always asks, prompt content.
