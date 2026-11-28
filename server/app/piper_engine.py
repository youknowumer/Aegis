"""Piper local voices (optional, new in v20): a second, lighter and faster local voice engine next to Meta MMS.

Why it exists. MMS is one 150 MB PyTorch model per language with a single fixed speaker. Piper voices are ONNX models (20 to 110 MB), run on the
CPU without PyTorch (about 60 MB of RAM each, a sentence in roughly 0.2 s), come in quality tiers (x_low / low / medium / high), and for the big
languages sound clearly more natural. Many Piper voices also carry licences that allow commercial use (check the MODEL_CARD / voice page of the
voice you ship: the licence belongs to each voice, not to Piper).

Order of preference for each sentence (see tts.py): Piper voice of that language -> MMS voice -> Edge/cloud voice. A language Piper does not have
(Urdu, Punjabi, Tamil...) simply skips to MMS, so adding Piper never removes a language.

    pip install -r requirements-piper.txt
    python scripts/piper_download.py            # best voice for every Aegis language that Piper has
    python scripts/piper_download.py --status

Environment (all optional):
  AEGIS_PIPER=0                switch Piper off
  AEGIS_PIPER_DIR              where voices live (default: server/piper_models; Docker: /data/piper_models)
  AEGIS_PIPER_AUTO=1           download a language's voice by itself the first time it is spoken (0 = never, or a list: en,es,de)
  AEGIS_PIPER_QUALITY=medium   preferred tier: high | medium | low | x_low (falls back to the nearest tier that exists)
  AEGIS_PIPER_CACHE=6          voices kept loaded (each about 60 MB)
  AEGIS_PIPER_CONCURRENCY=2    sentences synthesised at once
  AEGIS_PIPER_QUEUE_SECONDS=15 wait for a free slot before the next voice in the chain speaks
  AEGIS_PIPER_BASE             voice host (default https://huggingface.co/rhasspy/piper-voices/resolve/main), for a mirror or your own bucket
  AEGIS_PIPER_VOICES=en=en_US-amy-medium,de=de_DE-thorsten-high   pin an exact voice per language
  AEGIS_PIPER_MIN_FREE_MB=500  do not auto-download below this much free disk
  AEGIS_PIPER_MIN_RAM_MB=400   stay off on a server with less memory than this (AEGIS_PIPER_FORCE=1 ignores it)
"""
import importlib.util
import io
import json
import logging
import os
import shutil
import threading
import time
import urllib.request
import wave
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Optional

from . import mms
from .observability import obs

log = logging.getLogger("aegis.piper")

DEFAULT_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
QUALITY_ORDER = ["high", "medium", "low", "x_low"]
# Every Aegis language code. The index decides at download time which of them Piper really has; the rest stay on MMS / Edge.
LANGS = ["en", "ur", "hi", "ar", "fa", "bn", "pa", "ta", "te", "gu", "mr", "es", "fr", "de", "pt", "it", "tr", "id", "ms", "nl", "pl", "ru", "uk",
         "zh", "ja", "ko", "th", "vi", "el", "he", "sv", "ro", "cs", "sw", "fil"]
# Best-known voice per language, tried first. If the live index no longer lists one, the best voice of that language is used instead.
PREFERRED: Dict[str, List[str]] = {
    "en": ["en_US-lessac-high", "en_US-lessac-medium", "en_US-amy-medium"], "es": ["es_ES-davefx-medium", "es_MX-claude-high", "es_MX-ald-medium"],
    "fr": ["fr_FR-siwis-medium"], "de": ["de_DE-thorsten-high", "de_DE-thorsten-medium"], "it": ["it_IT-paola-medium", "it_IT-riccardo-x_low"],
    "pt": ["pt_BR-faber-medium", "pt_PT-tugao-medium"], "ru": ["ru_RU-irina-medium"], "uk": ["uk_UA-ukrainian_tts-medium"], "tr": ["tr_TR-dfki-medium"],
    "pl": ["pl_PL-gosia-medium", "pl_PL-darkman-medium"], "nl": ["nl_NL-mls-medium", "nl_BE-nathalie-medium"], "sv": ["sv_SE-nst-medium"],
    "cs": ["cs_CZ-jirka-medium"], "el": ["el_GR-rapunzelina-low"], "ar": ["ar_JO-kareem-medium"], "fa": ["fa_IR-amir-medium", "fa_IR-gyro-medium"],
    "hi": ["hi_IN-priyamvada-medium", "hi_IN-pratham-medium"], "vi": ["vi_VN-vais1000-medium"], "zh": ["zh_CN-huayan-medium"], "ro": ["ro_RO-mihai-medium"],
    "id": ["id_ID-news_tts-medium"], "sw": ["sw_CD-lanfrica-medium"], "te": ["te_IN-padmavathi-medium", "te_IN-venkatesh-medium"],
}


class PiperError(Exception):
    """This text could not be spoken by Piper. tts.py then tries the next voice in the chain."""


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        value = default
    return max(lo, min(hi, value))


def models_dir() -> Path:
    custom = os.environ.get("AEGIS_PIPER_DIR", "").strip()
    return Path(custom) if custom else Path(__file__).resolve().parent.parent / "piper_models"


def enabled() -> bool:
    return os.environ.get("AEGIS_PIPER", "1").strip() != "0"


def deps_ok() -> bool:
    try:
        return importlib.util.find_spec("piper") is not None and importlib.util.find_spec("onnxruntime") is not None
    except (ImportError, ValueError):
        return False


def base_url() -> str:
    return (os.environ.get("AEGIS_PIPER_BASE", "").strip() or DEFAULT_BASE).rstrip("/")


def wanted_quality() -> str:
    q = os.environ.get("AEGIS_PIPER_QUALITY", "medium").strip().lower().replace("-", "_")
    return q if q in QUALITY_ORDER else "medium"


def _pinned() -> Dict[str, str]:
    out = {}
    for part in os.environ.get("AEGIS_PIPER_VOICES", "").split(","):
        if "=" in part:
            lang, key = part.split("=", 1)
            if lang.strip() and key.strip():
                out[lang.strip().lower()] = key.strip()
    return out


def family_of(key: str) -> str:
    """'en_US-lessac-medium' -> 'en'. Also understands the older 'en-us-lessac-medium' style."""
    head = key.split("-", 1)[0]
    return head.replace("-", "_").split("_")[0].lower()


# ---------------------------------------------------------------- what is installed
_scan = {"at": 0.0, "dir": "", "found": {}}


def installed(force: bool = False) -> Dict[str, Path]:
    """voice key -> .onnx path, for every complete voice on disk (model + its .json). Cached 20 s."""
    folder = models_dir()
    now = time.time()
    if not force and _scan["dir"] == str(folder) and now - _scan["at"] < 20:
        return _scan["found"]
    found: Dict[str, Path] = {}
    try:
        for p in sorted(folder.glob("*.onnx")):
            if (p.parent / (p.name + ".json")).is_file() and p.stat().st_size > 0:
                found[p.name[:-5]] = p
    except OSError:
        found = {}
    _scan.update(at=now, dir=str(folder), found=found)
    return found


def _score(key: str) -> tuple:
    q = key.rsplit("-", 1)[-1]
    want = QUALITY_ORDER.index(wanted_quality())
    rank = QUALITY_ORDER.index(q) if q in QUALITY_ORDER else len(QUALITY_ORDER)
    return (abs(rank - want), rank, key)          # nearest to the wanted tier, then the higher one


def _region_of(lang_or_region: str) -> str:
    """'GB', 'en-GB', 'en_GB' -> 'GB'; a bare language or nothing -> ''."""
    s = str(lang_or_region or "").strip().replace("_", "-")
    tail = s.split("-")[-1]
    return tail.upper() if len(tail) == 2 and tail.isalpha() and ("-" in s or tail.upper() == tail) else ""


def voice_for(lang: str, region: str = "") -> Optional[str]:
    """The installed voice key to speak this language with, or None. An owner's pin always wins; after that a voice made for the listener's
    own region (en_GB for a British listener, pt_PT, es_MX...) beats the general best voice of the language."""
    base = str(lang or "").split("-")[0].lower() or "en"
    have = installed()
    pin = _pinned().get(base)
    if pin and pin in have:
        return pin
    where = _region_of(region)
    if where:
        local = sorted((k for k in have if family_of(k) == base and k.split("-", 1)[0].upper().endswith("_" + where)), key=_score)
        if local:
            return local[0]
    for key in PREFERRED.get(base, []):
        if key in have and key.rsplit("-", 1)[-1] == wanted_quality():
            return key
    options = sorted((k for k in have if family_of(k) == base), key=_score)
    return options[0] if options else None


def languages() -> List[str]:
    have = installed()
    return sorted({f for f in (family_of(k) for k in have) if f in LANGS})


def _auto_setting() -> str:
    return (os.environ.get("AEGIS_PIPER_AUTO") or "1").strip().lower()


def auto_allows(lang: str) -> bool:
    raw = _auto_setting()
    if raw in ("0", "off", "no", "false"):
        return False
    if raw in ("1", "all", "on", "yes", "true"):
        return True
    return lang in {t.strip() for t in raw.split(",") if t.strip()}


def min_ram_mb() -> int:
    return _env_int("AEGIS_PIPER_MIN_RAM_MB", 400, 0, 1 << 20)


def memory_ok() -> bool:
    """A Piper voice needs about 60 MB plus the engine; on a tiny server (below AEGIS_PIPER_MIN_RAM_MB) it stays off so the app itself keeps its memory.
    AEGIS_PIPER_FORCE=1 ignores the check. Unknown memory counts as enough."""
    if os.environ.get("AEGIS_PIPER_FORCE", "").strip() == "1":
        return True
    try:
        have = mms._ram_mb()
    except Exception:  # noqa: BLE001
        return True
    return not have or have >= min_ram_mb()


def reason() -> str:
    """Why Piper is not active although it is installed (shown in Settings). Empty when there is nothing to explain."""
    if not enabled() or not deps_ok():
        return ""
    if not memory_ok():
        return f"this server has about {mms._ram_mb()} MB of memory and Piper voices need {min_ram_mb()} MB"
    if not installed() and _auto_setting() in ("0", "off", "no", "false"):
        return "no Piper voices are downloaded yet"
    return ""


def ready() -> bool:
    """Piper can speak now, or can fetch a voice by itself."""
    return enabled() and deps_ok() and memory_ok() and (bool(installed()) or _auto_setting() not in ("0", "off", "no", "false"))


# ---------------------------------------------------------------- the voice index and downloads
_index = {"at": 0.0, "data": None}


def load_index(force: bool = False) -> dict:
    """voices.json from the voice host (cached 12 h). Raises PiperError when it cannot be fetched and no copy is cached or on disk."""
    now = time.time()
    if not force and _index["data"] and now - _index["at"] < 43200:
        return _index["data"]
    local = models_dir() / "voices.json"
    try:
        with urllib.request.urlopen(base_url() + "/voices.json", timeout=30) as r:   # noqa: S310 (https host from settings)
            data = json.loads(r.read(20_000_000))
        try:
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_text(json.dumps(data), encoding="utf-8")
        except OSError:
            pass
    except Exception as e:  # noqa: BLE001
        try:
            data = json.loads(local.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise PiperError(f"The Piper voice list could not be fetched: {str(e)[:120]}")
    _index.update(at=now, data=data)
    return data


def resolve(lang: str, index: dict) -> Optional[str]:
    """Which voice key to download for this language, judged from the live index (pinned > preferred > best of the language)."""
    pin = _pinned().get(lang)
    if pin and pin in index:
        return pin
    want = wanted_quality()
    for key in PREFERRED.get(lang, []):
        if key in index and key.rsplit("-", 1)[-1] == want:
            return key
    pool = [k for k, v in index.items() if str((v.get("language") or {}).get("family", family_of(k))).lower() == lang]
    pool.sort(key=lambda k: (_score(k)[0], 0 if k in PREFERRED.get(lang, []) else 1, _score(k)[1], k))
    return pool[0] if pool else None


def download(key: str, index: dict, root: Path) -> str:
    """Fetch one voice (.onnx and .onnx.json) into root. Returns 'skipped', 'done' or an error text. Partial files are never left behind."""
    root = Path(root)
    target = root / f"{key}.onnx"
    if target.is_file() and (root / f"{key}.onnx.json").is_file():
        return "skipped"
    entry = index.get(key)
    if not entry:
        return f"{key} is not in the Piper voice list"
    root.mkdir(parents=True, exist_ok=True)
    try:
        for rel in sorted(entry.get("files", {}), key=lambda p: not p.endswith(".onnx.json")):   # config first: it is tiny
            if not (rel.endswith(".onnx") or rel.endswith(".onnx.json")):
                continue
            dest = root / Path(rel).name
            tmp = dest.with_suffix(dest.suffix + ".part")
            with urllib.request.urlopen(base_url() + "/" + rel, timeout=120) as r, open(tmp, "wb") as f:   # noqa: S310
                shutil.copyfileobj(r, f)
            os.replace(tmp, dest)
    except Exception as e:  # noqa: BLE001
        for leftover in root.glob(f"{key}*.part"):
            leftover.unlink(missing_ok=True)
        return (str(e).splitlines() or [type(e).__name__])[0][:200]
    ok = target.is_file() and (root / f"{key}.onnx.json").is_file()
    return "done" if ok else "download finished but the voice files are incomplete"


_dl = {"lock": threading.Lock(), "queue": [], "active": None, "failed": {}, "thread": None}
RETRY_AFTER = 600


def _queue(lang: str) -> None:
    now = time.time()
    with _dl["lock"]:
        if lang in _dl["queue"] or lang == _dl["active"] or now - _dl["failed"].get(lang, 0.0) < RETRY_AFTER:
            return
        free = shutil.disk_usage(_nearest(models_dir())).free // (1024 * 1024)
        if free < _env_int("AEGIS_PIPER_MIN_FREE_MB", 500, 0, 1 << 22):
            _dl["failed"][lang] = now
            obs.inc("voice_model_downloads_total", engine="piper", result="no_disk")
            return
        _dl["queue"].append(lang)
        if _dl["thread"] is None:
            _dl["thread"] = threading.Thread(target=_worker, name="piper-download", daemon=True)
            _dl["thread"].start()


def _nearest(p: Path) -> Path:
    p = Path(p)
    while not p.exists() and p != p.parent:
        p = p.parent
    return p


def _worker() -> None:
    while True:
        with _dl["lock"]:
            if not _dl["queue"]:
                _dl["active"], _dl["thread"] = None, None
                return
            lang = _dl["active"] = _dl["queue"].pop(0)
        result = "no_voice"
        try:
            index = load_index()
            key = resolve(lang, index)
            result = download(key, index, models_dir()) if key else "no_voice"
        except Exception as e:  # noqa: BLE001
            result = str(e) or type(e).__name__
        ok = result in ("done", "skipped")
        obs.inc("voice_model_downloads_total", engine="piper", result="ok" if ok else ("no_voice" if result == "no_voice" else "error"))
        obs.event("download", engine="piper", lang=lang, result=result)
        if not ok:
            log.warning("Piper voice for %s could not be downloaded: %s", lang, result)
            with _dl["lock"]:
                _dl["failed"][lang] = time.time()
        installed(force=True)


def downloading() -> List[str]:
    with _dl["lock"]:
        return ([_dl["active"]] if _dl["active"] else []) + list(_dl["queue"])


def wait_downloads(timeout: float = 30.0) -> None:
    thread = _dl["thread"]
    if thread is not None:
        thread.join(timeout)


# ---------------------------------------------------------------- loaded voices and the synthesis gate
_cache: "OrderedDict[str, object]" = OrderedDict()
_cache_lock = threading.Lock()
_gate = {"n": 0, "sem": None}
_gate_lock = threading.Lock()


def _slot() -> threading.BoundedSemaphore:
    n = _env_int("AEGIS_PIPER_CONCURRENCY", 2, 1, 32)
    with _gate_lock:
        if _gate["sem"] is None or _gate["n"] != n:
            _gate.update(n=n, sem=threading.BoundedSemaphore(n))
        return _gate["sem"]


def _load(key: str):
    with _cache_lock:
        voice = _cache.get(key)
        if voice is not None:
            _cache.move_to_end(key)
            return voice
        path = installed().get(key)
        if path is None:
            raise PiperError(f"The {key} voice is not downloaded.")
        t0 = time.perf_counter()
        try:
            from piper import PiperVoice

            voice = PiperVoice.load(str(path), config_path=str(path) + ".json")
        except Exception as e:  # noqa: BLE001
            log.warning("Piper voice %s could not be loaded: %s", key, e)
            raise PiperError(f"The {key} voice could not be loaded.")
        obs.observe("voice_model_load_seconds", time.perf_counter() - t0, engine="piper")
        _cache[key] = voice
        while len(_cache) > _env_int("AEGIS_PIPER_CACHE", 6, 1, 64):
            _cache.popitem(last=False)
        obs.set_gauge("voice_models_loaded", len(_cache), engine="piper")
        return voice


def loaded() -> List[str]:
    with _cache_lock:
        return list(_cache)


def unload_all() -> None:
    with _cache_lock:
        _cache.clear()
    obs.set_gauge("voice_models_loaded", 0, engine="piper")


def code_for(lang: str, region: str = "") -> Optional[str]:
    """The installed voice for this language (and listener region), or None (and a background download starts when allowed)."""
    base = str(lang or "").split("-")[0].lower() or "en"
    key = voice_for(base, region)
    if key:
        return key
    if base in LANGS and enabled() and deps_ok() and auto_allows(base):
        _queue(base)
    return None


# ---------------------------------------------------------------- speak
def synthesize(text: str, key: str, rate_pct: int = 0, volume_pct: int = 0) -> bytes:
    """Speak `text` with voice `key`; returns WAV bytes (16-bit mono). Raises PiperError when it cannot.
    rate_pct / volume_pct carry the feeling (speed and loudness), the same contract as mms.synthesize."""
    sem = _slot()
    t_wait = time.perf_counter()
    if not sem.acquire(timeout=_env_int("AEGIS_PIPER_QUEUE_SECONDS", 15, 1, 120)):
        obs.inc("voice_queue_timeouts_total", engine="piper")
        raise PiperError("The Piper voice is busy right now.")
    obs.observe("voice_queue_wait_seconds", time.perf_counter() - t_wait, engine="piper")
    try:
        voice = _load(key)
        text = " ".join(str(text or "").split())
        if not any(c.isalnum() for c in text):
            raise PiperError("There is nothing to speak in this text.")
        from piper import SynthesisConfig

        cfg = SynthesisConfig(length_scale=1.0 / max(0.6, min(1.5, 1.0 + rate_pct / 100.0)), volume=max(0.5, min(1.5, 1.0 + volume_pct / 100.0)))
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            voice.synthesize_wav(text, w, syn_config=cfg)
        audio = buf.getvalue()
    except PiperError:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("Piper synthesis failed (%s): %s", key, e)
        raise PiperError("The Piper voice failed on this sentence.")
    finally:
        sem.release()
    if len(audio) < 200:
        raise PiperError("The Piper voice produced no sound.")
    return audio


def status() -> dict:
    return {"languages": languages(), "voices": sorted(installed()), "downloading": downloading(), "quality": wanted_quality()}
