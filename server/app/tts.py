"""Studio voice (optional): natural, emotional speech in many languages from a cloud text-to-speech service.

Without a key the app keeps using the browser's built-in voices, so nothing breaks. To switch it on, set ONE of:
  OPENAI_API_KEY       uses OpenAI gpt-4o-mini-tts. It follows spoken-style instructions, so each sentence can be
                       "joyful", "gentle and slow", "urgent"... in the language of the text.
  ELEVENLABS_API_KEY   uses ElevenLabs eleven_multilingual_v2 (pick the voice with AEGIS_ELEVENLABS_VOICE).
Optional: AEGIS_TTS_PROVIDER (openai | elevenlabs), AEGIS_TTS_MODEL, AEGIS_TTS_VOICE, AEGIS_TTS_CHARS_PER_DAY (per user).
"""
import json
import os
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


def provider() -> str:
    want = os.environ.get("AEGIS_TTS_PROVIDER", "").strip().lower()
    have_o, have_e = bool(os.environ.get("OPENAI_API_KEY", "").strip()), bool(os.environ.get("ELEVENLABS_API_KEY", "").strip())
    if want == "openai" and have_o:
        return "openai"
    if want == "elevenlabs" and have_e:
        return "elevenlabs"
    if want:  # asked for one that has no key: do not silently switch to another paid service
        return ""
    return "openai" if have_o else "elevenlabs" if have_e else ""


def available() -> bool:
    return bool(provider())


def daily_chars() -> int:
    try:
        return max(0, int(os.environ.get("AEGIS_TTS_CHARS_PER_DAY", "6000")))
    except ValueError:
        return 6000


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
    else:
        raise TTSError("Studio voice is not set up on this server.")
    if not data or len(data) > MAX_AUDIO_BYTES:
        raise TTSError("The voice service sent back nothing usable.")
    return data
