"""v21: the voice follows the listener (region + language), Urdu is spoken by the neural voice first, the profile endpoint.

The synthesis itself is stubbed (no PyTorch, no model files, no internet), exactly like test_mms.py."""
from test_server import *  # noqa: F401,F403
from test_server import auth, register
from test_mms import WAV, add_model, local  # noqa: F401  (the `local` fixture: local voices on, recording stubs for MMS and Edge)

import pytest

from app import piper_engine, tts


def _voice(name, locale, gender="Female"):
    return {"ShortName": name, "Locale": locale, "Gender": gender}


LIVE = [
    _voice("en-US-AvaMultilingualNeural", "en-US"), _voice("en-US-JennyNeural", "en-US"),
    _voice("en-GB-SoniaNeural", "en-GB"), _voice("en-GB-RyanNeural", "en-GB", "Male"),
    _voice("en-IN-NeerjaNeural", "en-IN"), _voice("en-IN-NeerjaExpressiveNeural", "en-IN"),
    _voice("ur-PK-UzmaNeural", "ur-PK"), _voice("ur-IN-GulNeural", "ur-IN"),
    _voice("ar-SA-ZariyahNeural", "ar-SA"), _voice("ar-EG-SalmaNeural", "ar-EG"),
    _voice("es-ES-ElviraNeural", "es-ES"), _voice("es-MX-DaliaNeural", "es-MX"),
    _voice("pt-BR-FranciscaNeural", "pt-BR"), _voice("pt-PT-RaquelNeural", "pt-PT"),
]


# ---------------------------------------------------------------- region helpers
def test_norm_region_accepts_countries_and_locales_and_nothing_else():
    assert tts.norm_region("PK") == "PK" and tts.norm_region("pk") == "PK"
    assert tts.norm_region("en-GB") == "GB" and tts.norm_region("ur_PK") == "PK"
    assert tts.norm_region("ES") == "ES" and tts.norm_region("pt") == "PT"           # Spain and Portugal share their code with a language: still countries
    assert tts.norm_region("") == "" and tts.norm_region(None) == ""
    assert tts.norm_region("<script>") == "" and tts.norm_region("PAK") == "" and tts.norm_region("a1") == ""
    assert tts.edge_locale("en", "en") == "" and tts.edge_locale("ur", "ur") == ""   # a bare language given as a region changes nothing


@pytest.mark.parametrize("base,region,expected", [
    ("en", "PK", "en-IN"), ("en", "BD", "en-IN"), ("en", "IN", "en-IN"), ("en", "GB", "en-GB"), ("en", "AU", "en-AU"),
    ("en", "US", ""), ("en", "", ""), ("en", "JP", ""),                    # US keeps the default persona; no region, no change
    ("ur", "PK", "ur-PK"), ("ur", "IN", "ur-IN"), ("ur", "GB", ""),
    ("ar", "EG", "ar-EG"), ("ar", "SA", "ar-SA"), ("ar", "PK", ""),
    ("es", "MX", "es-MX"), ("es", "ES", "es-ES"), ("pt", "PT", "pt-PT"), ("pt", "BR", "pt-BR"),
    ("fr", "CA", "fr-CA"), ("de", "AT", "de-AT"), ("zh", "TW", "zh-TW"),
])
def test_edge_locale_picks_the_accent_a_listener_in_that_country_hears_best(base, region, expected):
    assert tts.edge_locale(base, region) == expected


def test_every_regional_voice_name_belongs_to_its_own_locale_and_is_a_neural_voice():
    for loc, names in tts._EDGE_REGIONAL.items():
        assert names and all(n.startswith(loc + "-") and n.endswith("Neural") for n in names), loc


# ---------------------------------------------------------------- Edge voice choice
def test_without_a_region_nothing_changes():
    assert tts.edge_voice("Good morning", "en", LIVE) == "en-US-AvaMultilingualNeural"
    assert tts.edge_voice("Good morning", "en-US", LIVE) == "en-US-AvaMultilingualNeural"
    assert tts.edge_voice("آپ کیسی ہیں؟", "ur", LIVE) == "ur-PK-UzmaNeural"
    assert tts.edge_voice("Hola", "es", LIVE) == "en-US-AvaMultilingualNeural"                 # the one multilingual persona, as before


def test_a_listener_in_pakistan_or_india_hears_indian_english_a_british_one_british_english():
    assert tts.edge_voice("Good morning", "en", LIVE, region="PK") == "en-IN-NeerjaExpressiveNeural"
    assert tts.edge_voice("Good morning", "en", LIVE, region="IN") == "en-IN-NeerjaExpressiveNeural"
    assert tts.edge_voice("Good morning", "en", LIVE, region="GB") == "en-GB-SoniaNeural"
    assert tts.edge_voice("Good morning", "en-GB", LIVE) == "en-GB-SoniaNeural"          # the region inside the language tag counts too
    assert tts.edge_voice("Good morning", "en", LIVE, region="US") == "en-US-AvaMultilingualNeural"


def test_regional_voices_for_urdu_arabic_spanish_portuguese():
    assert tts.edge_voice("آپ کیسی ہیں؟", "ur", LIVE, region="PK") == "ur-PK-UzmaNeural"
    assert tts.edge_voice("آپ کیسی ہیں؟", "ur", LIVE, region="IN") == "ur-IN-GulNeural"
    assert tts.edge_voice("مرحبا", "ar", LIVE, region="EG") == "ar-EG-SalmaNeural"
    assert tts.edge_voice("مرحبا", "ar", LIVE, region="PK") == "ar-SA-ZariyahNeural"      # no Pakistani Arabic: the standard Arabic voice
    assert tts.edge_voice("Hola", "es", LIVE, region="MX") == "es-MX-DaliaNeural"
    assert tts.edge_voice("Olá", "pt", LIVE, region="PT") == "pt-PT-RaquelNeural"


def test_a_regional_voice_the_service_no_longer_offers_falls_back_to_the_standard_persona():
    live = [v for v in LIVE if not v["ShortName"].startswith("en-GB")]
    assert tts.edge_voice("Good morning", "en", live, region="GB") == "en-US-AvaMultilingualNeural"


def test_roman_urdu_keeps_its_voice_whatever_the_region():
    for region in ("", "PK", "GB", "US"):
        assert tts.edge_voice("kya haal hai, sab theek?", "ur", LIVE, region=region) in ("en-IN-NeerjaNeural", "en-IN-NeerjaExpressiveNeural")


def test_without_the_live_list_the_first_regional_name_is_used():
    assert tts.edge_voice("Good morning", "en", [], region="GB") == "en-GB-SoniaNeural"
    assert tts.edge_voice("Good morning", "en", []) == "en-US-AvaMultilingualNeural"


def test_a_failing_regional_voice_is_retried_with_the_standard_voice(monkeypatch):
    monkeypatch.setattr(tts, "_list_edge_voices", lambda: LIVE)
    said = []

    def edge(text, voice, emotion, intensity=3):
        said.append(voice)
        if voice.startswith("en-GB"):
            raise tts.TTSError("voice gone")
        return b"ID3ok"

    monkeypatch.setattr(tts, "_edge_audio", edge)
    assert tts._edge_speak("Good morning", "en", "calm", 3, "GB") == b"ID3ok"
    assert said == ["en-GB-SoniaNeural", "en-US-AvaMultilingualNeural"]
    with pytest.raises(tts.TTSError):                        # the standard voice failing too is a real failure
        monkeypatch.setattr(tts, "_edge_audio", lambda *a, **k: (_ for _ in ()).throw(tts.TTSError("down")))
        tts._edge_speak("Good morning", "en", "calm", 3, "GB")


# ---------------------------------------------------------------- Urdu: neural voice first, local model as the offline fallback
def test_urdu_is_spoken_by_the_neural_voice_first_and_mms_when_offline(local, monkeypatch):
    monkeypatch.delenv("AEGIS_TTS_EDGE_FIRST", raising=False)                  # the real default ("ur")
    add_model(local.root, "urd-script_arabic")
    add_model(local.root, "eng")
    out = tts.synthesize("آپ کیسی ہیں؟", lang="ur", region="PK")
    assert out == b"ID3edge" and local.calls["edge"] and not local.calls["mms"]
    assert local.calls["edge"][-1][1] == "ur-PK-UzmaNeural"                                    # (no live list in this fixture: the first regional name)

    def offline(text, voice, emotion, intensity=3):
        raise tts.TTSError("The voice service is not reachable right now.")

    monkeypatch.setattr(tts, "_edge_audio", offline)
    assert tts.synthesize("آپ کیسی ہیں؟", lang="ur", region="PK") == WAV           # internet gone: the local Urdu model answers
    assert local.calls["mms"][-1][1] == "urd-script_arabic"


def test_english_stays_local_first_and_urdu_can_be_switched_back(local, monkeypatch):
    add_model(local.root, "urd-script_arabic")
    add_model(local.root, "eng")
    monkeypatch.delenv("AEGIS_TTS_EDGE_FIRST", raising=False)
    tts.synthesize("Good morning", lang="en")
    assert local.calls["mms"][-1][1] == "eng" and not local.calls["edge"]
    monkeypatch.setenv("AEGIS_TTS_EDGE_FIRST", "0")
    tts.synthesize("آپ کیسی ہیں؟", lang="ur")
    assert local.calls["mms"][-1][1] == "urd-script_arabic" and not local.calls["edge"]
    monkeypatch.setenv("AEGIS_TTS_EDGE_FIRST", "ur, en")
    assert tts._edge_first() == {"ur", "en"}
    monkeypatch.setenv("AEGIS_TTS_EDGE_FIRST", "")
    assert tts._edge_first() == set()


def test_edge_first_without_edge_installed_goes_straight_to_the_local_voice(local, monkeypatch):
    monkeypatch.delenv("AEGIS_TTS_EDGE_FIRST", raising=False)
    monkeypatch.setattr(tts, "_edge_installed", lambda: False)
    add_model(local.root, "urd-script_arabic")
    assert tts.synthesize("آپ کیسی ہیں؟", lang="ur") == WAV and not local.calls["edge"]


# ---------------------------------------------------------------- Piper: a voice made for the listener's region
def test_piper_prefers_a_voice_of_the_listeners_region_and_never_beats_an_owner_pin(monkeypatch):
    have = {k: object() for k in ("en_US-lessac-medium", "en_GB-alba-medium", "en_GB-jenny_dioco-medium", "pt_BR-faber-medium", "pt_PT-tugao-medium")}
    monkeypatch.setattr(piper_engine, "installed", lambda force=False: have)
    monkeypatch.delenv("AEGIS_PIPER_VOICES", raising=False)
    assert piper_engine.voice_for("en") == "en_US-lessac-medium"
    assert piper_engine.voice_for("en", "GB").startswith("en_GB-")
    assert piper_engine.voice_for("en", "en-GB").startswith("en_GB-")
    assert piper_engine.voice_for("pt", "PT") == "pt_PT-tugao-medium"
    assert piper_engine.voice_for("pt", "BR") == "pt_BR-faber-medium"
    assert piper_engine.voice_for("en", "PK") == "en_US-lessac-medium"              # no Pakistani voice: the general best one
    monkeypatch.setenv("AEGIS_PIPER_VOICES", "en=en_US-lessac-medium")
    assert piper_engine.voice_for("en", "GB") == "en_US-lessac-medium"             # the owner's pin wins


# ---------------------------------------------------------------- paid voices get the accent as an instruction
def test_accent_line_names_the_country_and_the_listeners_language():
    line = tts.accent_line("en", "PK", "ur")
    assert "Pakistan" in line and "English" in line and "Urdu" in line
    assert tts.accent_line("en", "", "en") == "" and tts.accent_line("en", "ZZ", "") == ""


def test_openai_instructions_carry_the_accent(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    seen = {}

    def post(url, headers, body):
        seen.update(body)
        return b"ID3openai"

    monkeypatch.setattr(tts, "_post", post)
    assert tts.synthesize("Good morning", lang="en", region="IN", speaker="hi") == b"ID3openai"
    assert "India" in seen["instructions"] and "Hindi" in seen["instructions"]
    tts.synthesize("Good morning", lang="en")
    assert "listener is in" not in seen["instructions"]


# ---------------------------------------------------------------- what the request itself says about the listener
def test_request_profile_reads_the_cdn_country_then_the_browser_language():
    p = tts.request_profile({"cf-ipcountry": "pk", "accept-language": "en-GB,en;q=0.9,ur;q=0.8"})
    assert p["region"] == "PK" and p["source"] == "network" and p["region_name"] == "Pakistan" and p["languages"][:3] == ["en-GB", "en", "ur"]
    p = tts.request_profile({"accept-language": "ur-PK,ur;q=0.9"})
    assert p["region"] == "PK" and p["source"] == "browser"
    p = tts.request_profile({"cf-ipcountry": "XX", "accept-language": "en"})
    assert p["region"] == "" and p["source"] == ""
    p = tts.request_profile({"x-vercel-ip-country": "<b>", "accept-language": "en-US;q=0.8, <x>"})
    assert p["region"] == "US" and p["languages"] == ["en-US"]


# ---------------------------------------------------------------- through the real HTTP API
def test_api_passes_region_and_speaker_and_reports_the_profile(env, local, monkeypatch):
    monkeypatch.delenv("AEGIS_TTS_EDGE_FIRST", raising=False)
    add_model(local.root, "eng")
    c = env.client
    token = register(c)
    seen = {}
    real = tts.synthesize

    def spy(text, emotion="calm", lang="", intensity=3, rid="", region="", speaker=""):
        seen.update(region=region, speaker=speaker, lang=lang)
        return real(text, emotion, lang, intensity, rid, region, speaker)

    monkeypatch.setattr(tts, "synthesize", spy)
    r = c.post("/api/tts", json={"text": "Good morning", "lang": "en", "region": "gb", "speaker": "ur"}, headers=auth(token))
    assert r.status_code == 200 and seen == {"region": "gb", "speaker": "ur", "lang": "en"}
    r = c.post("/api/tts", json={"text": "Good morning", "lang": "en", "region": "<GB>!!", "speaker": "ur;drop"}, headers=auth(token))
    assert r.status_code == 200 and seen["region"] == "GB" and seen["speaker"] == "urdrop"[:8]
    st = c.get("/api/tts/status", headers=auth(token)).json()
    assert st["region_aware"] is True and "ur" in st["edge_first"]
    prof = c.get("/api/voice/profile", headers={**auth(token), "CF-IPCountry": "AE", "Accept-Language": "ar-AE,ar;q=0.9"}).json()
    assert prof["region"] == "AE" and prof["source"] == "network" and prof["languages"][0] == "ar-AE"
    assert c.get("/api/voice/profile").status_code in (401, 403)             # signed-in users only


# ---------------------------------------------------------------- the words are as important as the voice: spoken Urdu / Roman Urdu style
def test_spoken_urdu_and_roman_urdu_get_their_own_style_guidance(env):
    from app.agent import Agent
    from app.hub import Hub

    agent = Agent(None, env.client.app.state.db, Hub())
    urdu = agent._system(1, "hi", False, voice=True, lang="ur")
    roman = agent._system(1, "hi", False, voice=True, lang="roman-urdu")
    english = agent._system(1, "hi", False, voice=True, lang="es")
    typed = agent._system(1, "hi", False, voice=False, lang="ur")
    assert "URDU, spoken" in urdu and "۔" in urdu and "ROMAN URDU" not in urdu
    assert "ROMAN URDU, spoken" in roman and "URDU, spoken: write" not in roman
    assert "URDU, spoken" not in english and "ROMAN URDU" not in english
    assert "URDU, spoken" not in typed                                  # typed chats are not read aloud: no voice style


# ---------------------------------------------------------------- files the page loads are really served (auth-ui.* were missing from the list before v21)
def test_talk_and_auth_ui_files_are_served(env):
    c = env.client
    for name, kind in (("talk.js", "javascript"), ("auth-ui.js", "javascript"), ("auth-ui.css", "css"), ("voice.js", "javascript")):
        r = c.get("/" + name)
        assert r.status_code == 200 and kind in r.headers["content-type"], name
    assert b"createLive" in c.get("/talk.js").content
