# v20: new local voices (Piper) + observability at scale

## New voices
- **Piper engine** (`server/app/piper_engine.py`): ONNX voices, no PyTorch, ~60 MB RAM each, ~0.2 s per sentence on CPU, quality tiers x_low..high.
- **Voice chain per sentence:** Piper voice of that language -> MMS voice -> Edge/cloud voice. Languages Piper lacks (Urdu, Punjabi, Tamil...) stay on MMS, so no language is lost.
- **Best voice per language is chosen from Piper's live `voices.json`** (pinned > known-good > best of the language at the wanted tier), so a renamed voice cannot break an install.
- `server/scripts/piper_download.py` (`--langs`, `--voices`, `--quality`, `--list`, `--status`), `server/requirements-piper.txt`.
- `install-voices.sh` / `.bat` now install Piper first, then MMS (`--piper-only`, `--high`, `--langs ...`). Dockerfile installs Piper by default (`WITH_PIPER=0` to skip) and stores voices in `/data/piper_models`.
- Auto-download on first use, same safety rules as MMS (one at a time, retry after 10 min, skipped when disk is low). Settings: `AEGIS_PIPER*` (see SETUP.md).

## Observability
- `server/app/observability.py`: labelled counters / gauges / histograms, p50/p95/p99, voice event log (why a fallback happened), process memory/threads, JSON logs (`AEGIS_LOG_JSON=1`), health verdict.
- `/metrics` now exports voice series and `aegis_http_request_seconds{method,route,status}` (route template, bounded labels), memory, threads, uptime.
- `/admin/voice` live dashboard, `/api/admin/voice` JSON, voice health inside `/api/admin/stats`. All 404 until `AEGIS_ADMIN_TOKEN` is set. Dashboard script is a separate file because the CSP forbids inline scripts.
- MMS and TTS are instrumented: queue wait, queue timeouts, model load time, downloads, per-sentence latency, engine, language, outcome. No user ids or spoken text are ever recorded.
- SCALING.md: Prometheus alert rules and a capacity rule of thumb.

## Tests
`server/tests/test_v20.py` (20 tests, including a real Piper voice when `AEGIS_TEST_PIPER_VOICE=/path/voice.onnx`). `conftest.py` switches Piper off by default like MMS.

## Licences
MMS: CC-BY-NC 4.0. Piper voices: each has its own licence (see its MODEL_CARD); the `piper-tts` package is GPL-3.0. Check before a commercial launch.

## Bugs fixed (7 tests that were failing before v20 now pass)
- **Landing video was blocked:** the CSP had no `media-src`, so the CloudFront hero videos could not load. Added.
- **Fonts and landing images were never served** by the default server mode (Docker/Render): `/fonts/...` and `/assets/...` returned 404, so the JetBrains Mono fonts silently fell back. Added safe routes (image/video/font files only, no `../`, no `.md`/code).
- `landing-halora.*` and `landing-ios.*` were missing from the served-files list. Added.
- `/api/tts/status` lacked `local_reason` and `downloading` (Settings could not say why local voices were off or which were downloading). Added; now covers Piper and MMS.
- "snooze" ignored the clock the caller passed in and used the wall clock, so it could say "nothing to snooze" for a reminder that just fired. Fixed.
- Piper had no memory check (MMS had). It now stays off below `AEGIS_PIPER_MIN_RAM_MB` (400) and says why; `AEGIS_PIPER_FORCE=1` overrides.

## Not changed / known
Voice model files are not in the zip (they download on your machine). Full server suite: 460 passed.
