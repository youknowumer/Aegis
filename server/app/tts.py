"""Studio voice (optional): natural, emotional speech in many languages from a cloud text-to-speech service.

By default (no key needed) it uses the free neural voices of Microsoft Edge's read-aloud service through the `edge-tts` package: one
female voice, natural in every major language (see EDGE below). Set AEGIS_EDGE_TTS=0 to turn that off, or AEGIS_TTS_PROVIDER=off for no
studio voice at all. For the most human, emotional voice set ONE paid key (it then takes priority):
  OPENAI_API_KEY       uses OpenAI gpt-4o-mini-tts. It follows spoken-style instructions, so each sentence can be
                       "joyful", "gentle and slow", "urgent"... in the language of the text.
  ELEVENLABS_API_KEY   uses ElevenLabs eleven_multilingual_v2 (pick the voice with AEGIS_ELEVENLABS_VOICE).
Optional: AEGIS_TTS_PROVIDER (openai | elevenlabs | mms | edge | off), AEGIS_TTS_MODEL, AEGIS_TTS_VOICE, AEGIS_TTS_CHARS_PER_DAY (per user).
Local language voices: when Piper voices (piper_engine.py, ONNX, no PyTorch) or downloaded MMS models (mms.py) are present and no paid key is set,
each sentence is spoken on this machine by the best local voice of its own language: Piper first, then MMS, then the Edge voice, so speech never
stops. Every sentence is measured (observability.py): which voice spoke, how long it took, and why a fallback happened.
v21: the voice follows the LISTENER. The browser sends the person's region (PK, IN, GB, EG, MX...) with every sentence, so English is
spoken with the accent that listener hears best (a Pakistani or Indian listener gets Indian English, a British one British English...),
Arabic / Spanish / Portuguese / French / German / Chinese / Urdu / Bengali / Tamil use the regional variant that exists, and Urdu is spoken
by the neural Urdu voice first (AEGIS_TTS_EDGE_FIRST, default "ur"; 0 = local voices first as before) with the local voice as the offline fallback.
"""
import asyncio
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from typing import Dict, Tuple

from . import mms, piper_engine
from .observability import obs

log = logging.getLogger("aegis.tts")

MAX_CHARS = 700          # one request = a few sentences
MAX_AUDIO_BYTES = 4_000_000

LANG_NAMES = {
    "en": "English", "ur": "Urdu", "hi": "Hindi", "ar": "Arabic", "fa": "Persian", "bn": "Bengali", "pa": "Punjabi", "ta": "Tamil",
    "te": "Telugu", "gu": "Gujarati", "mr": "Marathi", "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese",
    "it": "Italian", "tr": "Turkish", "id": "Indonesian", "ms": "Malay", "nl": "Dutch", "pl": "Polish", "ru": "Russian",
    "uk": "Ukrainian", "zh": "Chinese", "ja": "Japanese", "ko": "Korean", "th": "Thai", "vi": "Vietnamese", "el": "Greek",
    "he": "Hebrew", "sv": "Swedish", "ro": "Romanian", "cs": "Czech", "sw": "Swahili", "fil": "Filipino",
}

# How each feeling should sound. OpenAI gets these as instructions; ElevenLabs gets the numbers (stability, style).
EMOTIONS: Dict[str, Tuple[str, float, float]] = {
    "calm": ("Calm, relaxed and clear.", 0.65, 0.15),
    "warm": ("Warm, friendly and welcoming, with a gentle smile in the voice.", 0.55, 0.30),
    "joy": ("Joyful and bright, smiling as you speak, with lifted energy.", 0.35, 0.60),
    "excited": ("Excited and energetic, delighted, a little faster.", 0.30, 0.75),
    "curious": ("Curious and inviting, with a light questioning lift.", 0.50, 0.35),
    "empathy": ("Soft, slow and deeply compassionate, like comforting a close friend. Lower and gentler.", 0.70, 0.30),
    "concern": ("Serious and caring, slightly slower, with real concern.", 0.60, 0.35),
    "urgent": ("Urgent and focused, quick and firm, but not shouting.", 0.40, 0.50),
    "confident": ("Confident, steady and reassuring.", 0.60, 0.30),
}


class TTSError(Exception):
    pass


def _edge_installed() -> bool:
    try:
        import edge_tts  # noqa: F401

        return True
    except Exception:
        return False


def edge_enabled() -> bool:
    return os.environ.get("AEGIS_EDGE_TTS", "1").strip() != "0" and _edge_installed()


def provider() -> str:
    want = os.environ.get("AEGIS_TTS_PROVIDER", "").strip().lower()
    have_o, have_e = bool(os.environ.get("OPENAI_API_KEY", "").strip()), bool(os.environ.get("ELEVENLABS_API_KEY", "").strip())
    if want == "off":
        return ""
    if want == "edge":
        return "edge" if edge_enabled() else ""
    if want == "piper":
        return "piper" if piper_engine.ready() else ""
    if want == "mms":
        return "mms" if mms.ready() else ""
    if want == "openai" and have_o:
        return "openai"
    if want == "elevenlabs" and have_e:
        return "elevenlabs"
    if want:  # asked for one that has no key: do not silently switch to another paid service
        return ""
    if have_o:
        return "openai"
    if have_e:
        return "elevenlabs"
    if piper_engine.ready():  # downloaded local voices beat the free cloud voice; a paid key above still wins. Piper first, MMS behind it
        return "piper"
    if mms.ready():
        return "mms"
    return "edge" if edge_enabled() else ""


def available() -> bool:
    return bool(provider())


def daily_chars() -> int:
    default = "200000" if provider() in ("edge", "mms", "piper") else "6000"  # the limit exists to protect paid keys; free voices get a generous one
    try:
        return max(0, int(os.environ.get("AEGIS_TTS_CHARS_PER_DAY", default)))
    except ValueError:
        return int(default)


# ---------------------------------------------------------------- EDGE: free neural female voice
# ONE voice for everyone: the multilingual neural voice "Ava" speaks English, Spanish, French, German, Italian, Portuguese,
# Japanese, Korean and Chinese as the same woman. Other languages use the best native female neural voice.
_AVA = "en-US-AvaMultilingualNeural"
_AVA_LANGS = ("en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh")
_EDGE_PREFERRED = {
    "ur": ["ur-PK-UzmaNeural", "ur-IN-GulNeural"], "hi": ["hi-IN-SwaraNeural"], "ar": ["ar-SA-ZariyahNeural", "ar-EG-SalmaNeural"],
    "fa": ["fa-IR-DilaraNeural"], "bn": ["bn-BD-NabanitaNeural", "bn-IN-TanishaaNeural"], "pa": ["ur-PK-UzmaNeural"],
    "ta": ["ta-IN-PallaviNeural"], "te": ["te-IN-ShrutiNeural"], "gu": ["gu-IN-DhwaniNeural"], "mr": ["mr-IN-AarohiNeural"],
    "tr": ["tr-TR-EmelNeural"], "ru": ["ru-RU-SvetlanaNeural"], "nl": ["nl-NL-ColetteNeural"], "pl": ["pl-PL-ZofiaNeural"],
    "uk": ["uk-UA-PolinaNeural"], "el": ["el-GR-AthinaNeural"], "he": ["he-IL-HilaNeural"], "sv": ["sv-SE-SofieNeural"],
    "ro": ["ro-RO-AlinaNeural"], "cs": ["cs-CZ-VlastaNeural"], "th": ["th-TH-PremwadeeNeural"], "vi": ["vi-VN-HoaiMyNeural"],
    "id": ["id-ID-GadisNeural"], "ms": ["ms-MY-YasminNeural"], "sw": ["sw-KE-ZuriNeural"], "fil": ["fil-PH-BlessicaNeural"],
    "es": ["es-ES-ElviraNeural"], "fr": ["fr-FR-DeniseNeural"], "de": ["de-DE-KatjaNeural"], "it": ["it-IT-ElsaNeural"],
    "pt": ["pt-BR-FranciscaNeural"], "ja": ["ja-JP-NanamiNeural"], "ko": ["ko-KR-SunHiNeural"], "zh": ["zh-CN-XiaoxiaoNeural"],
    "en": ["en-US-JennyNeural", "en-US-AriaNeural"],
}
_ROMAN_VOICES = ["en-IN-NeerjaNeural", "en-IN-NeerjaExpressiveNeural"]  # Roman Urdu / Hindi ("kya haal hai"): an Indian-English woman says it most naturally
_NON_LATIN = {"ur", "hi", "pa", "fa", "ar", "bn", "ta", "te", "gu", "mr", "he", "ru", "uk", "el", "th", "zh", "ja", "ko"}

# How each feeling sounds: (rate, pitch, volume) as the Edge service wants them.
_EDGE_PROSODY = {
    "calm": ("-3%", "+0Hz", "+0%"), "warm": ("-2%", "+3Hz", "+0%"), "joy": ("+6%", "+8Hz", "+5%"),
    "excited": ("+12%", "+12Hz", "+8%"), "curious": ("+2%", "+6Hz", "+0%"), "empathy": ("-12%", "-4Hz", "-5%"),
    "concern": ("-6%", "-2Hz", "+0%"), "urgent": ("+10%", "+2Hz", "+10%"), "confident": ("+0%", "-1Hz", "+0%"),
}

def scale_prosody(rate: str, pitch: str, volume: str, intensity: int = 3):
    """Feel it more or less: intensity 1 (barely) .. 3 (normal) .. 5 (overwhelming) scales how far rate, pitch and volume move from neutral."""
    k = {1: 0.5, 2: 0.75, 3: 1.0, 4: 1.35, 5: 1.7}[max(1, min(5, int(intensity or 3)))]

    def f(v: str, unit: str, cap: int) -> str:
        n = int(re.match(r"[+-]?\d+", v).group(0))
        n = max(-cap, min(cap, round(n * k)))
        return f"{n:+d}{unit}"
    return f(rate, "%", 40), f(pitch, "Hz", 30), f(volume, "%", 30)


# ---------------------------------------------------------------- REGION: the listener's country picks the accent (v21)
# Native female neural voices per locale. Names are checked against the live voice list when it is available, so a renamed voice
# never breaks speech; a name that is missing is skipped, and a failing regional voice falls back to the standard persona.
_EDGE_REGIONAL = {
    "en-GB": ["en-GB-SoniaNeural", "en-GB-LibbyNeural"], "en-AU": ["en-AU-NatashaNeural"], "en-CA": ["en-CA-ClaraNeural"],
    "en-IN": ["en-IN-NeerjaExpressiveNeural", "en-IN-NeerjaNeural"], "en-IE": ["en-IE-EmilyNeural"], "en-NZ": ["en-NZ-MollyNeural"],
    "en-ZA": ["en-ZA-LeahNeural"], "en-SG": ["en-SG-LunaNeural"], "en-HK": ["en-HK-YanNeural"], "en-KE": ["en-KE-AsiliaNeural"],
    "en-NG": ["en-NG-EzinneNeural"], "en-PH": ["en-PH-RosaNeural"], "en-TZ": ["en-TZ-ImaniNeural"],
    "ar-SA": ["ar-SA-ZariyahNeural"], "ar-EG": ["ar-EG-SalmaNeural"], "ar-AE": ["ar-AE-FatimaNeural"], "ar-IQ": ["ar-IQ-RanaNeural"],
    "ar-JO": ["ar-JO-SanaNeural"], "ar-KW": ["ar-KW-NouraNeural"], "ar-LB": ["ar-LB-LaylaNeural"], "ar-LY": ["ar-LY-ImanNeural"],
    "ar-MA": ["ar-MA-MounaNeural"], "ar-OM": ["ar-OM-AyshaNeural"], "ar-QA": ["ar-QA-AmalNeural"], "ar-SY": ["ar-SY-AmanyNeural"],
    "ar-TN": ["ar-TN-ReemNeural"], "ar-YE": ["ar-YE-MaryamNeural"], "ar-BH": ["ar-BH-LailaNeural"], "ar-DZ": ["ar-DZ-AminaNeural"],
    "es-ES": ["es-ES-ElviraNeural"], "es-MX": ["es-MX-DaliaNeural"], "es-AR": ["es-AR-ElenaNeural"], "es-CO": ["es-CO-SalomeNeural"],
    "es-US": ["es-US-PalomaNeural"], "es-CL": ["es-CL-CatalinaNeural"], "es-PE": ["es-PE-CamilaNeural"], "es-VE": ["es-VE-PaolaNeural"],
    "pt-BR": ["pt-BR-FranciscaNeural"], "pt-PT": ["pt-PT-RaquelNeural"],
    "fr-FR": ["fr-FR-DeniseNeural"], "fr-CA": ["fr-CA-SylvieNeural"], "fr-BE": ["fr-BE-CharlineNeural"], "fr-CH": ["fr-CH-ArianeNeural"],
    "de-DE": ["de-DE-KatjaNeural"], "de-AT": ["de-AT-IngridNeural"], "de-CH": ["de-CH-LeniNeural"],
    "zh-CN": ["zh-CN-XiaoxiaoNeural"], "zh-TW": ["zh-TW-HsiaoChenNeural"], "zh-HK": ["zh-HK-HiuGaaiNeural"],
    "ur-PK": ["ur-PK-UzmaNeural"], "ur-IN": ["ur-IN-GulNeural"], "bn-BD": ["bn-BD-NabanitaNeural"], "bn-IN": ["bn-IN-TanishaaNeural"],
    "ta-IN": ["ta-IN-PallaviNeural"], "ta-LK": ["ta-LK-SaranyaNeural"], "ta-SG": ["ta-SG-VenbaNeural"], "ta-MY": ["ta-MY-KaniNeural"],
    "hi-IN": ["hi-IN-SwaraNeural"],
}
# English for a listener whose own country has no English voice: the nearest accent they know best.
_ENGLISH_NEAR = {"PK": "IN", "BD": "IN", "LK": "IN", "NP": "IN", "BT": "IN", "MV": "IN", "AF": "IN"}
# Country names for the accent line given to the paid voices (they have no voice list, only instructions).
REGION_NAMES = {
    "PK": "Pakistan", "IN": "India", "BD": "Bangladesh", "LK": "Sri Lanka", "NP": "Nepal", "AF": "Afghanistan", "IR": "Iran", "TR": "Turkey",
    "SA": "Saudi Arabia", "AE": "the United Arab Emirates", "EG": "Egypt", "IQ": "Iraq", "JO": "Jordan", "KW": "Kuwait", "LB": "Lebanon",
    "LY": "Libya", "MA": "Morocco", "OM": "Oman", "QA": "Qatar", "SY": "Syria", "TN": "Tunisia", "YE": "Yemen", "BH": "Bahrain", "DZ": "Algeria",
    "GB": "the United Kingdom", "IE": "Ireland", "US": "the United States", "CA": "Canada", "AU": "Australia", "NZ": "New Zealand",
    "ZA": "South Africa", "SG": "Singapore", "HK": "Hong Kong", "KE": "Kenya", "NG": "Nigeria", "PH": "the Philippines", "TZ": "Tanzania",
    "ES": "Spain", "MX": "Mexico", "AR": "Argentina", "CO": "Colombia", "CL": "Chile", "PE": "Peru", "VE": "Venezuela", "BR": "Brazil", "PT": "Portugal",
    "FR": "France", "BE": "Belgium", "CH": "Switzerland", "DE": "Germany", "AT": "Austria", "IT": "Italy", "NL": "the Netherlands", "RU": "Russia",
    "CN": "China", "TW": "Taiwan", "JP": "Japan", "KR": "South Korea", "ID": "Indonesia", "MY": "Malaysia", "TH": "Thailand", "VN": "Vietnam",
}


def norm_region(value) -> str:
    """'PK', 'pk', 'ur-PK', 'en_GB' -> 'PK' / 'GB'. Anything that is not a two-letter code at the end of the value -> ''.
    A bare two-letter value is taken as a country (ES, PT, FR, DE... are countries as well as languages); a bare language such as 'ur' only ever
    becomes a code that no locale has, so it changes nothing."""
    s = str(value or "").strip().replace("_", "-")
    tail = s.split("-")[-1] if s else ""
    return tail.upper() if len(tail) == 2 and tail.isalpha() else ""


def edge_locale(base: str, region) -> str:
    """The Edge locale whose accent suits a listener in `region` who hears `base` ('en','PK' -> 'en-IN'). '' = no regional voice: use the standard persona."""
    base, region = str(base or "").split("-")[0].lower(), norm_region(region)
    if not base or not region:
        return ""
    have = f"{base}-{region}"
    if have in _EDGE_REGIONAL:
        loc = have
    elif base == "en" and f"en-{_ENGLISH_NEAR.get(region, '')}" in _EDGE_REGIONAL:
        loc = f"en-{_ENGLISH_NEAR[region]}"
    else:
        return ""
    return "" if loc == "en-US" else loc                    # US English keeps the default persona (Ava)


def accent_line(base: str, region, speaker: str = "") -> str:
    """One sentence for the paid voices: who is listening and where, so they pick the natural accent."""
    place, bits = REGION_NAMES.get(norm_region(region)), []
    language = LANG_NAMES.get(str(base or "").split("-")[0].lower())
    if place and language:
        bits.append(f"The listener is in {place}: use the accent and pronunciation that sound natural there when speaking {language}.")
    said = LANG_NAMES.get(str(speaker or "").split("-")[0].lower())
    if said and said != language:
        bits.append(f"The listener usually speaks {said}, so pronounce names and borrowed words the way a {said} speaker would.")
    return " ".join(bits)


_COUNTRY_HEADERS = ("cf-ipcountry", "cloudfront-viewer-country", "x-vercel-ip-country", "x-appengine-country", "x-country-code", "x-geo-country")


def request_profile(headers) -> dict:
    """Where the listener probably is and what they speak, from what the request itself says: the country header a CDN adds
    (Cloudflare, CloudFront, Vercel...) and the browser's Accept-Language. The browser can still override it in Settings."""
    region, source = "", ""
    for h in _COUNTRY_HEADERS:
        r = str(headers.get(h, "") or "").strip().upper()
        if len(r) == 2 and r.isalpha() and r not in ("XX", "T1", "ZZ"):
            region, source = r, "network"
            break
    langs = []
    for part in str(headers.get("accept-language", "") or "").split(",")[:8]:
        tag = part.split(";")[0].strip()
        if re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?", tag or ""):
            langs.append(tag)
    if not region:
        for tag in langs:
            r = norm_region(tag) if "-" in tag else ""
            if r:
                region, source = r, "browser"
                break
    return {"region": region, "region_name": REGION_NAMES.get(region, ""), "source": source, "languages": langs[:6]}


def _edge_first() -> set:
    """Languages whose neural online voice is tried BEFORE the local model (the local model stays as the offline fallback)."""
    raw = os.environ.get("AEGIS_TTS_EDGE_FIRST")
    raw = "ur" if raw is None else raw.strip().lower()
    if raw in ("", "0", "off", "none", "false", "no"):
        return set()
    return {x.strip() for x in raw.split(",") if x.strip()}


_voice_cache = {"at": 0.0, "voices": []}


def _list_edge_voices() -> list:
    """All voices the service offers (cached 12 h). Empty if the service cannot be reached: the preferred names are then used as they are."""
    now = time.time()
    if now - _voice_cache["at"] < (43200 if _voice_cache["voices"] else 300):
        return _voice_cache["voices"]
    try:
        import edge_tts

        voices = asyncio.run(asyncio.wait_for(edge_tts.list_voices(), 15))
    except Exception:
        voices = []
    _voice_cache.update(at=now, voices=voices)
    return voices


def _is_romanized(text: str, base: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters or base not in _NON_LATIN:
        return False
    return sum(1 for c in letters if c.isascii()) / len(letters) > 0.8


def edge_voice(text: str, lang: str, voices=None, region: str = "") -> str:
    """Pick the female voice for this text. Checks the live list when we have it, so a renamed voice never breaks speech.
    `region` (the listener's country, or the region inside `lang` such as 'en-GB') selects the regional variant when one exists."""
    base = str(lang or "").split("-")[0].lower() or "en"
    where = norm_region(region) or (norm_region(lang) if "-" in str(lang or "") else "")
    voices = _list_edge_voices() if voices is None else voices
    names = {v.get("ShortName"): v for v in voices}
    if _is_romanized(text, base):
        prefs, base = list(_ROMAN_VOICES), "en"
    else:
        loc = edge_locale(base, where)
        regional = list(_EDGE_REGIONAL.get(loc, [])) if loc else []
        if loc and voices:                                   # any other female neural voice of that locale, if the service has one
            extra = sorted((v["ShortName"] for v in voices if v.get("Gender") == "Female" and v.get("Locale") == loc and v.get("ShortName") not in regional), key=lambda n: ("Neural" not in n, n))
            regional += extra
        prefs = regional + ([_AVA] if base in _AVA_LANGS else []) + _EDGE_PREFERRED.get(base, [])
    if not voices:
        return prefs[0] if prefs else _AVA
    for p in prefs:
        if p in names:
            return p
    female = [v for v in voices if v.get("Gender") == "Female" and str(v.get("Locale", "")).split("-")[0].lower() == base]
    female.sort(key=lambda v: (0 if "Neural" in v.get("ShortName", "") else 1, v.get("ShortName", "")))
    if female:
        return female[0]["ShortName"]
    return _AVA if _AVA in names else (prefs[0] if prefs else "en-US-JennyNeural")


def _edge_audio(text: str, voice: str, emotion: str, intensity: int = 3) -> bytes:
    import edge_tts

    rate, pitch, volume = scale_prosody(*_EDGE_PROSODY.get(emotion, _EDGE_PROSODY["calm"]), intensity)

    async def go():
        out = bytearray()
        async for chunk in edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume).stream():
            if chunk.get("type") == "audio":
                out += chunk["data"]
                if len(out) > MAX_AUDIO_BYTES:
                    break
        return bytes(out)

    try:
        return asyncio.run(asyncio.wait_for(go(), 30))
    except Exception:
        raise TTSError("The voice service is not reachable right now.")


def _edge_speak(text: str, lang: str, emotion: str, intensity: int = 3, region: str = "") -> bytes:
    """Edge voice for this text and listener. If the regional voice fails, the standard voice of the language answers instead."""
    voice = edge_voice(text, lang, region=region) if region else edge_voice(text, lang)
    try:
        return _edge_audio(text, voice, emotion, intensity)
    except TTSError:
        if region:
            plain = edge_voice(text, lang)
            if plain != voice:
                return _edge_audio(text, plain, emotion, intensity)
        raise


# ---------------------------------------------------------------- LOCAL: Piper, then MMS, of the language being spoken
class _Spoken:
    """What _local_audio did: the audio, the voice that really spoke, and which local voice (if any) it replaced."""
    __slots__ = ("audio", "engine", "fell_back_from", "why")

    def __init__(self, audio: bytes, engine: str, fell_back_from: str = "", why: str = ""):
        self.audio, self.engine, self.fell_back_from, self.why = audio, engine, fell_back_from, why


def _local_audio(text: str, lang: str, emotion: str, intensity: int = 3, order: Tuple[str, ...] = ("piper", "mms"), region: str = "") -> _Spoken:
    """Speak with the best voice for this language and listener. `order` lists the engines to try: "piper" (ONNX, natural), "mms" (widest
    language list) and "edge" (neural online voice, put first for languages in AEGIS_TTS_EDGE_FIRST). Anything that cannot do it (no model for
    the language, model busy or broken, text it cannot read, no internet) passes to the next one, and the Edge voice is always the last resort,
    so the user always hears an answer in their language."""
    base = str(lang or "").split("-")[0].lower() or "en"
    rate, _pitch, volume = scale_prosody(*_EDGE_PROSODY.get(emotion, _EDGE_PROSODY["calm"]), intensity)  # local voices have speed and loudness, not pitch
    rate_pct, volume_pct = int(rate.rstrip("%")), int(volume.rstrip("%"))
    first_tried, why, edge_tried = "", "no local voice for this language", False
    for engine in order:
        if engine == "edge":
            if edge_enabled():
                edge_tried = True
                try:
                    return _Spoken(_edge_speak(text, lang, emotion, intensity, region), "edge", first_tried, why if first_tried else "")
                except TTSError as e:
                    first_tried, why = first_tried or "edge", str(e)
        elif engine == "piper" and piper_engine.ready():
            key = piper_engine.code_for(base, region) if region else piper_engine.code_for(base)
            if key:
                try:
                    return _Spoken(piper_engine.synthesize(text, key, rate_pct, volume_pct), "piper", first_tried, why if first_tried else "")
                except piper_engine.PiperError as e:
                    first_tried, why = first_tried or "piper", str(e)
        elif engine == "mms" and mms.ready():
            code = mms.code_for(base, _is_romanized(text, base))
            if code:
                try:
                    return _Spoken(mms.synthesize(text, code, base, rate_pct, volume_pct), "mms", first_tried, why if first_tried else "")
                except mms.MMSError as e:
                    first_tried, why = first_tried or "mms", str(e)
    if edge_enabled() and not edge_tried:
        log.info("Local voices fell back to the Edge voice (%s): %s", base, why)
        return _Spoken(_edge_speak(text, lang, emotion, intensity, region), "edge", first_tried or "local", why)
    raise TTSError("There is no local voice for this language yet." if not first_tried else "The local voice could not speak this sentence.")


def _mms_audio(text: str, lang: str, emotion: str, intensity: int = 3) -> bytes:
    """Kept for callers and tests that ask for the MMS path only (MMS, then Edge)."""
    return _local_audio(text, lang, emotion, intensity, order=("mms",)).audio


def local_languages() -> list:
    """Languages spoken by their own local voice right now (for the settings panel). Empty unless the local voices are the active provider."""
    if provider() not in ("piper", "mms"):
        return []
    langs = set(mms.languages()) if mms.ready() else set()
    if piper_engine.ready():
        langs |= set(piper_engine.languages())
    return sorted(langs)


def content_type(audio: bytes) -> str:
    """Local voices answer with WAV, the cloud voices with MP3."""
    return "audio/wav" if audio[:4] == b"RIFF" and audio[8:12] == b"WAVE" else "audio/mpeg"


class Quota:
    """Characters spoken per user per day (in memory: one server process, resets on restart)."""

    def __init__(self):
        self.used: Dict[Tuple[int, str], int] = {}

    def _key(self, uid: int):
        return (uid, time.strftime("%Y-%m-%d", time.gmtime()))

    def left(self, uid: int) -> int:
        return max(0, daily_chars() - self.used.get(self._key(uid), 0))

    def take(self, uid: int, n: int) -> bool:
        k = self._key(uid)
        if self.used.get(k, 0) + n > daily_chars():
            return False
        for old in [x for x in self.used if x[1] != k[1]]:
            del self.used[old]
        self.used[k] = self.used.get(k, 0) + n
        return True

    def refund(self, uid: int, n: int):
        k = self._key(uid)
        self.used[k] = max(0, self.used.get(k, 0) - n)


def _post(url: str, headers: dict, body: dict) -> bytes:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 (fixed https hosts)
            return r.read(MAX_AUDIO_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise TTSError({401: "The voice service refused the key.", 402: "The voice account has no credit left.", 429: "The voice service is busy or out of quota."}.get(e.code, f"The voice service answered {e.code}."))
    except Exception:
        raise TTSError("The voice service is not reachable right now.")


def synthesize(text: str, emotion: str = "calm", lang: str = "", intensity: int = 3, rid: str = "", region: str = "", speaker: str = "") -> bytes:
    """Speak `text` (mp3 bytes). Raises TTSError with a message that is safe to show the user."""
    text = " ".join(str(text or "").split())
    if not text:
        raise TTSError("Nothing to say.")
    if len(text) > MAX_CHARS:
        raise TTSError(f"Too long: send at most {MAX_CHARS} characters at a time.")
    emo = emotion if emotion in EMOTIONS else "calm"
    style, stability, style_amt = EMOTIONS[emo]
    try:
        intensity = max(1, min(5, int(intensity)))
    except (TypeError, ValueError):
        intensity = 3
    style_amt = max(0.0, min(1.0, style_amt * (0.5 + intensity / 6)))  # stronger feeling -> more expressive
    base = str(lang or "").split("-")[0].lower()
    region = norm_region(region)
    speaker = str(speaker or "").split("-")[0].lower()[:8]
    which = provider()
    t0 = time.perf_counter()
    spoken_by, fell_from, why = which, "", ""
    try:
        data, spoken_by, fell_from, why = _synthesize_with(which, text, emo, intensity, lang, base, style, stability, style_amt, region, speaker)
    except TTSError as e:
        obs.record_voice(which or "none", base or "und", "error", time.perf_counter() - t0, chars=len(text), why=str(e), rid=rid)
        raise
    obs.record_voice(spoken_by, base or "und", "ok", time.perf_counter() - t0, chars=len(text), size=len(data or b""), fell_back_from=fell_from, why=why, rid=rid)
    if not data or len(data) > MAX_AUDIO_BYTES:
        raise TTSError("The voice service sent back nothing usable.")
    return data


def _synthesize_with(which, text, emo, intensity, lang, base, style, stability, style_amt, region, speaker):
    fell_from, why = "", ""
    if which == "openai":
        language = LANG_NAMES.get(base)
        instructions = "You are Aegis, a warm, expressive female voice assistant. " + (f"Speak {language} like a native speaker. " if language else "Speak in the language of the text, like a native speaker. ") + f"Tone: {style} Feeling strength {intensity} out of 5. Sound human: natural pauses and real feeling, never robotic or flat. " + accent_line(base, region, speaker)
        data = _post(
            "https://api.openai.com/v1/audio/speech",
            {"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"].strip()},
            {"model": os.environ.get("AEGIS_TTS_MODEL", "gpt-4o-mini-tts"), "voice": os.environ.get("AEGIS_TTS_VOICE", "coral"), "input": text, "instructions": instructions, "response_format": "mp3"},
        )
    elif which == "elevenlabs":
        voice = os.environ.get("AEGIS_ELEVENLABS_VOICE", "EXAVITQu4vr4xnSDxMaL").strip()
        if not voice.replace("-", "").replace("_", "").isalnum():
            raise TTSError("AEGIS_ELEVENLABS_VOICE is not a valid voice id.")
        data = _post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
            {"xi-api-key": os.environ["ELEVENLABS_API_KEY"].strip()},
            {"text": text, "model_id": os.environ.get("AEGIS_TTS_MODEL", "eleven_multilingual_v2"), "voice_settings": {"stability": stability, "similarity_boost": 0.8, "style": style_amt, "use_speaker_boost": True}},
        )
    elif which in ("piper", "mms"):
        order = ("piper", "mms") if which == "piper" else ("mms", "piper")
        if base in _edge_first() and edge_enabled():           # e.g. Urdu: the neural voice first, the local model when offline
            order = ("edge",) + order
        r = _local_audio(text, lang, emo, intensity, order=order, region=region)
        data, which, fell_from, why = r.audio, r.engine, r.fell_back_from, r.why
    elif which == "edge":
        data = _edge_speak(text, lang, emo, intensity, region)
    else:
        raise TTSError("Studio voice is not set up on this server.")
    return data, which, fell_from, why
