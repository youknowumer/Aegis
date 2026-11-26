# v16: local language voices (Meta MMS): the voice follows the language you speak

Aegis already detected the language of every sentence and answered in it. Now each language can also be **spoken by its own local voice**, with no key and no per-character cost.

## What changed
- **`server/app/mms.py`** (new): loads Meta MMS-TTS (VITS) models with PyTorch/transformers, keeps the 3 most recent in memory, speaks one sentence per slot (`AEGIS_MMS_CONCURRENCY`), and gives up after `AEGIS_MMS_QUEUE_SECONDS` so a busy server hands the sentence to the fallback voice.
  Emotion changes speed and loudness (MMS has no pitch control). Digits are spoken as words (`num2words`); voices that need Latin letters (`is_uroman`) go through `uroman` first. Output is WAV.
- **31 languages + Roman Urdu**: en ur hi ar fa bn pa ta te gu mr es fr de pt tr id ms nl pl ru uk ko th vi el he sv ro sw fil. Every code was checked against the official MMS-TTS list.
  **Italian, Chinese, Japanese and Czech are not in MMS** and keep the Edge voice.
- **`tts.py`**: new `mms` provider. Order when nothing is forced: paid key, then downloaded local voices, then Edge. `AEGIS_TTS_PROVIDER=mms` forces it. Anything MMS cannot speak (no model, busy, unreadable text) falls back to Edge, or reports a clear error if Edge is off.
- **`main.py`**: `/api/tts` answers with the right content type (`audio/wav` or `audio/mpeg`); `/api/tts/status` adds `languages` and `roman_urdu` (no file paths).
- **`voice.js`**: Settings > Voice says "Local language voices are on (N languages + Roman Urdu)" and no longer claims "the same woman in every language" when local voices are active.
- **`server/scripts/mms_download.py`** (new): downloads voices in transformers format (config, tokenizer, safetensors only, resumable). `--langs ur,en,roman`, `--codes`, `--all`, `--list`, `--status`.
- **`install-voices.bat` / `install-voices.sh`**, **`server/requirements-mms.txt`**, Dockerfile `ARG WITH_MMS=0` (models stay on the `/data` volume, not in the image).
- Docs: SETUP.md (Local language voices), SCALING.md (capacity and licence), README (variables).

## It installs itself and protects small servers
- **Automatic download:** with PyTorch present, the first sentence in a new language is spoken by the Edge voice while that language's model downloads in the background (`AEGIS_MMS_AUTO`, default on). From the next sentence the local voice speaks. One download at a time, no duplicates, retried after 10 minutes if it fails, skipped when under 1 GB of disk is free. `scripts/mms_download.py` and the automatic path share the same code (`mms.download`).
- **Memory guard:** below 1500 MB of memory (the container limit, not the host's) the local voices switch themselves off and the Edge voice keeps speaking, so the same files are safe on a 512 MB Render Starter instance and use the local voices on a PC or a bigger server. `/api/tts/status` adds `downloading` and `local_reason`, and Settings > Voice shows them.
- **`render.yaml`:** optional commented lines for `WITH_MMS` and `AEGIS_MMS_CACHE`. Nothing changes for the current deployment.

## Not changed
Nothing is installed or switched on by default. Without PyTorch and downloaded models, Aegis starts and speaks exactly as in v15. `requirements.txt` is untouched.

## Read before you scale
- **MMS models are CC-BY-NC 4.0: non-commercial.** Before charging money use `AEGIS_MMS=0` and a paid voice key.
- Each loaded language is about 150 MB of RAM; the free Render tier is too small. Use a machine with 2 GB+.
- Each language is one fixed speaker (some male, some female) with speed and loudness feeling, not full emotion.
- Roman Urdu uses the `urd-script_latin` model, trained on standard Latin-script Urdu; casual chat spellings may sound less natural. `AEGIS_MMS_ROMAN=0` returns it to the old voice.

## Tests
- `server/tests/test_mms.py` (26, no PyTorch needed): language table vs the official list, install detection, provider order, per-language routing, Roman Urdu, fallback, API content type and status, downloader, memory guard (including reading the container limit), automatic download (first use, once only, auto list, failure backoff, full disk, small server, off switch, progress in the status).
- `server/tests/test_mms_engine.py` (13): the real PyTorch/transformers path on a tiny random VITS model: valid WAV, speed and loudness, determinism, digits, unspeakable text, uroman, cache eviction, busy gate, parallel sentences, broken model, end to end through `tts.synthesize`. Skipped when PyTorch is not installed.
- `tests/ui-smoke.test.js`: two new tests for the local-voices settings text (languages, downloading, why they are off).
- Not tested: real downloads from the Hugging Face Hub and the sound of the real models (this was built without access to either). Run `install-voices.bat`, then listen to a few languages.
