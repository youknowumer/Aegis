"""Local language voices (optional): Meta MMS text-to-speech models running on THIS machine.

The voice follows the language you speak. voice.js already detects the language of every sentence and sends it to /api/tts; this
module answers with that language's own MMS voice (one VITS model of about 36 million parameters per language). No cloud service,
no key, no per-character cost. A language that has no downloaded model, or that MMS does not have (Italian, Chinese, Japanese,
Czech), is handed back to tts.py, which speaks it with the Edge/cloud voice, so speech never stops.

It is opt-in because it needs PyTorch and the model files:
    pip install -r requirements-mms.txt
    python scripts/mms_download.py              # the languages Aegis knows, about 150 MB each
Nothing here imports torch until a sentence is actually spoken, so servers without it start exactly as before.

LICENCE: the MMS checkpoints are CC-BY-NC 4.0, which means NON-COMMERCIAL use only. If Aegis becomes a paid product, set AEGIS_MMS=0
and use a paid voice key (OPENAI_API_KEY / ELEVENLABS_API_KEY) instead.

Environment (all optional):
  AEGIS_MMS=0                 switch local voices off even when models are installed
  AEGIS_MMS_DIR               where the models live (default: server/mms_models; Docker: /data/mms_models)
  AEGIS_MMS_CACHE=3           how many language models stay loaded in memory (each is about 150 MB); least recently used is dropped
  AEGIS_MMS_CONCURRENCY=1     sentences synthesised at the same time (raise it together with your CPU cores)
  AEGIS_MMS_QUEUE_SECONDS=20  how long a sentence waits for a free slot before tts.py uses the fallback voice
  AEGIS_MMS_THREADS           PyTorch CPU threads
  AEGIS_MMS_ROMAN=0           keep Roman Urdu ("kya haal hai") on the fallback voice instead of the Urdu-Latin model
"""
import importlib.util
import io
import logging
import os
import re
import threading
import time
import wave
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Optional

log = logging.getLogger("aegis.mms")

# Aegis language (the 2-letter code voice.js sends) -> MMS checkpoint (ISO 639-3). Every code is in the official list of 1,107 MMS-TTS
# languages (huggingface.co/facebook/mms-tts, checked 25 Nov 2026). MMS has no Italian, Chinese, Japanese or Czech voice.
CODES: Dict[str, str] = {
    "en": "eng", "ur": "urd-script_arabic", "hi": "hin", "ar": "ara", "fa": "fas", "bn": "ben", "pa": "pan", "ta": "tam",
    "te": "tel", "gu": "guj", "mr": "mar", "es": "spa", "fr": "fra", "de": "deu", "pt": "por", "tr": "tur", "id": "ind",
    "ms": "zlm", "nl": "nld", "pl": "pol", "ru": "rus", "uk": "ukr", "ko": "kor", "th": "tha", "vi": "vie", "el": "ell",
    "he": "heb", "sv": "swe", "ro": "ron", "sw": "swh", "fil": "tgl",
}
# Urdu or Hindi written in the English alphabet ("kya haal hai"). The official list has an Urdu model trained on Latin-script text.
ROMAN: Dict[str, str] = {"ur": "urd-script_latin", "hi": "urd-script_latin"}
# Folder names used by the earlier "MMS voice pack" download (models/english, models/urdu, ...). Point AEGIS_MMS_DIR at that models folder to reuse it.
ALIASES: Dict[str, str] = {
    "english": "eng", "urdu": "urd-script_arabic", "arabic": "ara", "hindi": "hin",
    "french": "fra", "spanish": "spa", "german": "deu", "korean": "kor",
}
REPO_PREFIX = "facebook/mms-tts-"


class MMSError(Exception):
    """This text could not be spoken locally. tts.py then uses the fallback voice (or reports it)."""


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        value = default
    return max(lo, min(hi, value))


def models_dir() -> Path:
    custom = os.environ.get("AEGIS_MMS_DIR", "").strip()
    return Path(custom) if custom else Path(__file__).resolve().parent.parent / "mms_models"


# ---------------------------------------------------------------- what is installed
_scan = {"at": 0.0, "dir": "", "found": {}}


def installed(force: bool = False) -> Dict[str, Path]:
    """MMS code -> folder, for every complete model on disk (config + weights). Cached for 20 s."""
    folder = models_dir()
    now = time.time()
    if not force and _scan["dir"] == str(folder) and now - _scan["at"] < 20:
        return _scan["found"]
    found: Dict[str, Path] = {}
    try:
        for p in sorted(folder.iterdir()):
            if p.is_dir() and (p / "config.json").is_file() and ((p / "model.safetensors").is_file() or (p / "pytorch_model.bin").is_file()):
                found.setdefault(ALIASES.get(p.name.lower(), p.name), p)
    except OSError:
        found = {}
    _scan.update(at=now, dir=str(folder), found=found)
    return found


def deps_ok() -> bool:
    try:
        return all(importlib.util.find_spec(m) is not None for m in ("torch", "transformers", "numpy"))
    except (ImportError, ValueError):
        return False


def enabled() -> bool:
    return os.environ.get("AEGIS_MMS", "1").strip() != "0"


def roman_on() -> bool:
    return os.environ.get("AEGIS_MMS_ROMAN", "1").strip() != "0"


def ready() -> bool:
    """True when local voices can speak: not switched off, PyTorch + transformers present, at least one model downloaded."""
    return enabled() and deps_ok() and bool(installed())


def languages() -> List[str]:
    """Aegis language codes that have a local voice right now."""
    have = installed()
    return sorted(lang for lang, code in CODES.items() if code in have)


def roman_ready() -> bool:
    return roman_on() and ROMAN["ur"] in installed()


def code_for(lang: str, roman: bool = False) -> Optional[str]:
    """The installed MMS model for this language, or None (then tts.py uses the fallback voice).

    roman=True means Latin letters under an Urdu/Hindi tag. Those can only go to the Latin-script Urdu model: the Urdu-script model
    cannot read them."""
    base = str(lang or "").split("-")[0].lower() or "en"
    code = (ROMAN.get(base) if roman_on() else None) if roman else CODES.get(base)
    return code if code in installed() else None


# ---------------------------------------------------------------- loaded models (small LRU) and the synthesis gate
class _Voice:
    __slots__ = ("tokenizer", "model", "lock", "uroman")

    def __init__(self, tokenizer, model):
        self.tokenizer, self.model, self.lock = tokenizer, model, threading.Lock()
        self.uroman = bool(getattr(tokenizer, "is_uroman", False))   # some checkpoints want Latin-letter input (see _romanize)


_cache: "OrderedDict[str, _Voice]" = OrderedDict()
_cache_lock = threading.Lock()
_gate = {"n": 0, "sem": None}
_gate_lock = threading.Lock()


def _slot() -> threading.BoundedSemaphore:
    n = _env_int("AEGIS_MMS_CONCURRENCY", 1, 1, 16)
    with _gate_lock:
        if _gate["sem"] is None or _gate["n"] != n:
            _gate.update(n=n, sem=threading.BoundedSemaphore(n))
        return _gate["sem"]


def _load(code: str) -> _Voice:
    with _cache_lock:
        voice = _cache.get(code)
        if voice is not None:
            _cache.move_to_end(code)
            return voice
        path = installed().get(code)
        if path is None:
            raise MMSError(f"The {code} voice is not downloaded.")
        try:
            import torch
            from transformers import AutoTokenizer, VitsModel

            from transformers.utils import logging as hf_logging

            hf_logging.set_verbosity_error()      # no progress bars or warnings in the server log for every model load
            hf_logging.disable_progress_bar()
            threads = _env_int("AEGIS_MMS_THREADS", 0, 0, 256)
            if threads:
                torch.set_num_threads(threads)
            tokenizer = AutoTokenizer.from_pretrained(str(path), local_files_only=True)
            model = VitsModel.from_pretrained(str(path), local_files_only=True)
            model.eval()
        except Exception as e:  # noqa: BLE001 (any load failure means: use the fallback voice)
            log.warning("MMS voice %s could not be loaded: %s", code, e)
            raise MMSError(f"The {code} voice could not be loaded.")
        voice = _cache[code] = _Voice(tokenizer, model)
        while len(_cache) > _env_int("AEGIS_MMS_CACHE", 3, 1, 64):
            _cache.popitem(last=False)
        return voice


def loaded() -> List[str]:
    with _cache_lock:
        return list(_cache)


def unload_all() -> None:
    with _cache_lock:
        _cache.clear()


# ---------------------------------------------------------------- text preparation
_DIGITS = re.compile(r"\d{1,15}")
_uroman = None


def _spell_numbers(text: str, base: str) -> str:
    """MMS has no digits in its alphabet, so "3 pm" would be spoken as "pm". Spell them out when num2words knows the language."""
    if not _DIGITS.search(text):
        return text
    try:
        from num2words import num2words
    except ImportError:
        return text

    def one(m):
        try:
            return " " + num2words(int(m.group(0)), lang=base) + " "
        except Exception:  # noqa: BLE001 (language not supported by num2words: leave the digits)
            return m.group(0)

    return _DIGITS.sub(one, text)


def _romanize(text: str) -> str:
    """Checkpoints whose tokenizer says is_uroman=True were trained on Latin-letter text, so other scripts go through uroman first."""
    global _uroman
    try:
        if _uroman is None:
            import uroman

            _uroman = uroman.Uroman()
        return _uroman.romanize_string(text)
    except ImportError:
        raise MMSError("This voice needs the 'uroman' package (pip install uroman).")
    except Exception as e:  # noqa: BLE001
        log.warning("uroman failed: %s", e)
        raise MMSError("The text could not be prepared for this voice.")


def _wav_bytes(samples, rate: int, volume_pct: int) -> bytes:
    import numpy as np

    x = np.nan_to_num(np.asarray(samples, dtype="float32"))
    x = np.clip(x * max(0.5, min(1.5, 1.0 + volume_pct / 100.0)), -1.0, 1.0)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(rate))
        w.writeframes((x * 32767).astype("<i2").tobytes())
    return buf.getvalue()


# ---------------------------------------------------------------- speak
def synthesize(text: str, code: str, lang: str = "en", rate_pct: int = 0, volume_pct: int = 0) -> bytes:
    """Speak `text` with the MMS model `code`; returns WAV bytes (16-bit mono). Raises MMSError when it cannot.

    rate_pct / volume_pct come from the emotion (tts.py): MMS can be sped up or slowed down and made louder or softer, but it has no
    pitch or style control, so the feeling is carried by speed and loudness here."""
    base = str(lang or "").split("-")[0].lower() or "en"
    sem = _slot()
    if not sem.acquire(timeout=_env_int("AEGIS_MMS_QUEUE_SECONDS", 20, 1, 120)):
        raise MMSError("The local voice is busy right now.")
    try:
        voice = _load(code)
        text = " ".join(_spell_numbers(str(text or ""), base).split())
        if not any(c.isalnum() for c in text):
            raise MMSError("There is nothing to speak in this text.")
        if voice.uroman:                          # newer transformers also does this inside the tokenizer; this keeps older ones working
            text = _romanize(text)
        with voice.lock:
            import torch

            inputs = voice.tokenizer(text, return_tensors="pt")
            if inputs["input_ids"].shape[-1] <= 1:    # every character was outside this voice's alphabet
                raise MMSError("Nothing in this text can be spoken by this voice.")
            voice.model.speaking_rate = max(0.6, min(1.5, 1.0 + rate_pct / 100.0))
            torch.manual_seed(0)  # VITS is random: a fixed seed gives the same voice for the same sentence
            with torch.inference_mode():
                wave_out = voice.model(**inputs).waveform
            samples = wave_out.squeeze().cpu().numpy()
            rate = int(voice.model.config.sampling_rate)
    except MMSError:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("MMS synthesis failed (%s): %s", code, e)
        raise MMSError("The local voice failed on this sentence.")
    finally:
        sem.release()
    if getattr(samples, "size", 0) < 100:
        raise MMSError("The local voice produced no sound.")
    return _wav_bytes(samples, rate, volume_pct)


def status() -> dict:
    """For /api/tts/status. No file paths: this is shown to signed-in users."""
    return {"languages": languages(), "roman_urdu": roman_ready()}
