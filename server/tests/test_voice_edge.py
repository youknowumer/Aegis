from test_server import *  # noqa: F401,F403
from test_server import auth, register

from app import tts

VOICES = [
    {"ShortName": n, "Gender": g, "Locale": n.rsplit("-", 1)[0]}
    for n, g in [
        ("en-US-AvaMultilingualNeural", "Female"), ("en-US-AndrewMultilingualNeural", "Male"),
        ("ur-PK-UzmaNeural", "Female"), ("ur-PK-AsadNeural", "Male"), ("hi-IN-SwaraNeural", "Female"), ("hi-IN-MadhurNeural", "Male"),
        ("en-IN-NeerjaNeural", "Female"), ("ar-SA-ZariyahNeural", "Female"), ("ar-SA-HamedNeural", "Male"),
        ("xx-YY-NoorNeural", "Female"), ("xx-YY-BobNeural", "Male"),
    ]
]


@pytest.fixture
def edge_env(monkeypatch):
    for k in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY", "AEGIS_TTS_PROVIDER", "AEGIS_TTS_CHARS_PER_DAY", "AEGIS_EDGE_TTS"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AEGIS_MMS", "0")   # these tests are about the Edge voice, even on a machine that has local MMS voices installed
    monkeypatch.setattr(tts, "_edge_installed", lambda: True)
    monkeypatch.setattr(tts, "_list_edge_voices", lambda: VOICES)
    calls = []
    monkeypatch.setattr(tts, "_edge_audio", lambda text, voice, emotion, intensity=3: (calls.append((text, voice, emotion)) or b"ID3edge"))
    return calls


def test_free_voice_is_the_default_without_keys(edge_env, monkeypatch):
    assert tts.provider() == "edge" and tts.available() and tts.daily_chars() == 200000
    monkeypatch.setenv("AEGIS_EDGE_TTS", "0")
    assert tts.provider() == ""
    monkeypatch.delenv("AEGIS_EDGE_TTS")
    monkeypatch.setenv("AEGIS_TTS_PROVIDER", "off")
    assert tts.provider() == ""


def test_paid_key_beats_the_free_voice(edge_env, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    assert tts.provider() == "openai" and tts.daily_chars() == 6000


def test_one_female_voice_across_languages():
    pick = lambda text, lang: tts.edge_voice(text, lang, VOICES)  # noqa: E731
    assert pick("Good morning", "en") == "en-US-AvaMultilingualNeural"
    assert pick("Buenos días", "es") == "en-US-AvaMultilingualNeural"      # same woman in Spanish
    assert pick("آپ کیسی ہیں؟", "ur") == "ur-PK-UzmaNeural"
    assert pick("आप कैसे हैं", "hi") == "hi-IN-SwaraNeural"
    assert pick("كيف حالك", "ar") == "ar-SA-ZariyahNeural"
    assert pick("kya haal hai, sab theek?", "ur") == "en-IN-NeerjaNeural"  # Roman Urdu: Latin letters under an Urdu tag
    assert pick("Dobry den", "qq") == "en-US-AvaMultilingualNeural"        # unknown language falls back to the main voice
    assert pick("salaam", "xx-YY") == "xx-YY-NoorNeural"                    # a language with only a native voice: its female one
    for lang in ("en", "ur", "hi", "ar", "es"):                               # never a male voice
        assert "Andrew" not in pick("x", lang) and "Madhur" not in pick("x", lang)


def test_unreachable_list_falls_back_to_preferred_names():
    assert tts.edge_voice("آپ کیسی ہیں", "ur", []) == "ur-PK-UzmaNeural"
    assert tts.edge_voice("hello", "en", []) == "en-US-AvaMultilingualNeural"


def test_native_female_found_in_the_list_when_not_preferred():
    voices = [{"ShortName": "ta-IN-RajNeural", "Gender": "Male", "Locale": "ta-IN"}, {"ShortName": "ta-IN-GeetNeural", "Gender": "Female", "Locale": "ta-IN"}]
    assert tts.edge_voice("வணக்கம்", "ta", voices) == "ta-IN-GeetNeural"     # preferred name missing: any female voice of that language


def test_api_speaks_with_edge_and_feeling(env, edge_env):
    c = env.client
    token = register(c)
    st = c.get("/api/tts/status", headers=auth(token)).json()
    assert st["available"] and st["provider"] == "edge" and st["chars_left"] == 200000
    r = c.post("/api/tts", json={"text": "I'm so sorry to hear that.", "emotion": "empathy", "lang": "en"}, headers=auth(token))
    assert r.status_code == 200 and r.content == b"ID3edge"
    assert edge_env[-1] == ("I'm so sorry to hear that.", "en-US-AvaMultilingualNeural", "empathy")
    assert c.get("/api/config").json()["studio_voice"] is True


def test_empathy_is_slower_and_lower_than_joy():
    rate = lambda e: int(tts._EDGE_PROSODY[e][0].rstrip("%"))  # noqa: E731
    pitch = lambda e: int(tts._EDGE_PROSODY[e][1].rstrip("Hz"))  # noqa: E731
    assert rate("empathy") < rate("calm") < rate("joy") < rate("excited")
    assert pitch("empathy") < pitch("joy") < pitch("excited")
    assert set(tts._EDGE_PROSODY) == set(tts.EMOTIONS)


def test_failure_costs_nothing(env, edge_env, monkeypatch):
    c = env.client
    token = register(c)

    def boom(text, voice, emotion, intensity=3):
        raise tts.TTSError("The voice service is not reachable right now.")

    monkeypatch.setattr(tts, "_edge_audio", boom)
    before = c.get("/api/tts/status", headers=auth(token)).json()["chars_left"]
    assert c.post("/api/tts", json={"text": "Hello"}, headers=auth(token)).status_code == 502
    assert c.get("/api/tts/status", headers=auth(token)).json()["chars_left"] == before
