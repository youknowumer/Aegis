"""Studio voice (optional): natural, emotional speech in many languages from a cloud text-to-speech service.

By default (no key needed) it uses the free neural voices of Microsoft Edge's read-aloud service through the `edge-tts` package: one
female voice, natural in every major language (see EDGE below). Set AEGIS_EDGE_TTS=0 to turn that off, or AEGIS_TTS_PROVIDER=off for no
studio voice at all. For the most human, emotional voice set ONE paid key (it then takes priority):
  OPENAI_API_KEY       uses OpenAI gpt-4o-mini-tts. It follows spoken-style instructions, so each sentence can be
                       "joyful", "gentle and slow", "urgent"... in the language of the text.
  ELEVENLABS_API_KEY   uses ElevenLabs eleven_multilingual_v2 (pick the voice with AEGIS_ELEVENLABS_VOICE).
Optional: AEGIS_TTS_PROVIDER (openai | elevenlabs), AEGIS_TTS_MODEL, AEGIS_TTS_VOICE, AEGIS_TTS_CHARS_PER_DAY (per user).
"""
import asyncio
import json
import os
import re
import time
import urllib.error
import urllib.request
from typing import Dict, Tuple

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
    return "edge" if edge_enabled() else ""


def available() -> bool:
    return bool(provider())


def daily_chars() -> int:
    default = "200000" if provider() == "edge" else "6000"  # the limit exists to protect paid keys; the free voice gets a generous one
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


def edge_voice(text: str, lang: str, voices=None) -> str:
    """Pick the female voice for this text. Checks the live list when we have it, so a renamed voice never breaks speech."""
    base = str(lang or "").split("-")[0].lower() or "en"
    voices = _list_edge_voices() if voices is None else voices
    names = {v.get("ShortName"): v for v in voices}
    if _is_romanized(text, base):
        prefs, base = _ROMAN_VOICES, "en"
    else:
        prefs = ([_AVA] if base in _AVA_LANGS else []) + _EDGE_PREFERRED.get(base, [])
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


def _edge_audio(text: str, voice: str, emotion: str) -> bytes:
    import edge_tts

    rate, pitch, volume = _EDGE_PROSODY.get(emotion, _EDGE_PROSODY["calm"])

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


def synthesize(text: str, emotion: str = "calm", lang: str = "") -> bytes:
    """Speak `text` (mp3 bytes). Raises TTSError with a message that is safe to show the user."""
    text = " ".join(str(text or "").split())
    if not text:
        raise TTSError("Nothing to say.")
    if len(text) > MAX_CHARS:
        raise TTSError(f"Too long: send at most {MAX_CHARS} characters at a time.")
    emo = emotion if emotion in EMOTIONS else "calm"
    style, stability, style_amt = EMOTIONS[emo]
    base = str(lang or "").split("-")[0].lower()
    which = provider()
    if which == "openai":
        language = LANG_NAMES.get(base)
        instructions = "You are Aegis, a warm, expressive female voice assistant. " + (f"Speak {language} like a native speaker. " if language else "Speak in the language of the text, like a native speaker. ") + f"Tone: {style} Sound human: natural pauses and real feeling, never robotic or flat."
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
    elif which == "edge":
        data = _edge_audio(text, edge_voice(text, lang), emo)
    else:
        raise TTSError("Studio voice is not set up on this server.")
    if not data or len(data) > MAX_AUDIO_BYTES:
        raise TTSError("The voice service sent back nothing usable.")
    return data
