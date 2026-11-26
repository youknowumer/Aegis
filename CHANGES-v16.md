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

## Not changed
Nothing is installed or switched on by default. Without PyTorch and downloaded models, Aegis starts and speaks exactly as in v15. `requirements.txt` is untouched.

## Read before you scale
- **MMS models are CC-BY-NC 4.0: non-commercial.** Before charging money use `AEGIS_MMS=0` and a paid voice key.
- Each loaded language is about 150 MB of RAM; the free Render tier is too small. Use a machine with 2 GB+.
- Each language is one fixed speaker (some male, some female) with speed and loudness feeling, not full emotion.
- Roman Urdu uses the `urd-script_latin` model, trained on standard Latin-script Urdu; casual chat spellings may sound less natural. `AEGIS_MMS_ROMAN=0` returns it to the old voice.

## Tests
- `server/tests/test_mms.py` (18, no PyTorch needed): language table vs the official list, install detection, provider order, per-language routing, Roman Urdu, fallback, API content type and status, downloader.
- `server/tests/test_mms_engine.py` (13): the real PyTorch/transformers path on a tiny random VITS model: valid WAV, speed and loudness, determinism, digits, unspeakable text, uroman, cache eviction, busy gate, parallel sentences, broken model, end to end through `tts.synthesize`. Skipped when PyTorch is not installed.
- `tests/ui-smoke.test.js`: one new test for the local-voices settings text.
- Not tested: real downloads from the Hugging Face Hub and the sound of the real models (this was built without access to either). Run `install-voices.bat`, then listen to a few languages.
