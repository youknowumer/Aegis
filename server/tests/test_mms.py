"""Local language voices (MMS): which voice speaks which language, when it falls back, and how the API answers.

The synthesis itself is replaced by a stub here, so these tests need neither PyTorch nor model files.
test_mms_engine.py runs the real PyTorch/transformers path on a tiny model when those packages are installed."""
import importlib.util
import io
import threading
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest

from test_server import *  # noqa: F401,F403
from test_server import auth, register

from app import mms, tts

# MMS-TTS codes copied from the official list (huggingface.co/facebook/mms-tts, 25 Nov 2026): a typo in CODES would silently disable a language.
OFFICIAL = set("eng urd-script_arabic urd-script_latin urd-script_devanagari hin ara fas ben pan tam tel guj mar spa fra deu por tur ind zlm nld pol rus ukr kor tha vie ell heb swe ron swh tgl".split())


def _wav(seconds=0.2, rate=16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x01\x00" * int(rate * seconds))
    return buf.getvalue()


WAV = _wav()


def add_model(root: Path, code: str, weights: str = "model.safetensors") -> Path:
    d = root / code
    d.mkdir(parents=True, exist_ok=True)
    (d / "config.json").write_text("{}")
    (d / weights).write_bytes(b"x")
    mms.installed(force=True)
    return d


@pytest.fixture
def local(monkeypatch, tmp_path):
    """Local voices on: PyTorch 'present', an empty models folder, a recording stub for MMS and for the Edge fallback."""
    for k in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY", "AEGIS_TTS_PROVIDER", "AEGIS_TTS_CHARS_PER_DAY", "AEGIS_EDGE_TTS", "AEGIS_MMS", "AEGIS_MMS_ROMAN",
              "AEGIS_MMS_FORCE", "AEGIS_MMS_MIN_RAM_MB", "AEGIS_MMS_MIN_FREE_MB"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AEGIS_MMS_DIR", str(tmp_path))
    monkeypatch.setenv("AEGIS_MMS_AUTO", "0")                     # most tests are about voices that are already on disk; "auto" has its own tests
    monkeypatch.setattr(mms, "_ram_mb", lambda: 8192)
    monkeypatch.setattr(mms, "deps_ok", lambda: True)
    mms._dl["failed"].clear()
    monkeypatch.setattr(tts, "_edge_installed", lambda: True)
    monkeypatch.setattr(tts, "_list_edge_voices", lambda: [])
    calls = {"mms": [], "edge": []}
    monkeypatch.setattr(mms, "synthesize", lambda text, code, lang="en", rate_pct=0, volume_pct=0: (calls["mms"].append((text, code, lang, rate_pct, volume_pct)) or WAV))
    monkeypatch.setattr(tts, "_edge_audio", lambda text, voice, emotion, intensity=3: (calls["edge"].append((text, voice)) or b"ID3edge"))
    mms.installed(force=True)
    return SimpleNamespace(root=tmp_path, calls=calls)


# ---------------------------------------------------------------- the language table
def test_every_code_is_in_the_official_mms_list():
    assert set(mms.CODES.values()) <= OFFICIAL and set(mms.ROMAN.values()) <= OFFICIAL


def test_only_languages_aegis_can_name_are_mapped_and_missing_ones_are_documented():
    assert set(mms.CODES) <= set(tts.LANG_NAMES)
    for lang in ("it", "zh", "ja", "cs"):          # MMS-TTS has no voice for these: they must stay on the fallback voice
        assert lang not in mms.CODES
    assert set(tts.LANG_NAMES) - set(mms.CODES) == {"it", "zh", "ja", "cs"}


# ---------------------------------------------------------------- what counts as installed
def test_only_complete_models_count_and_jarvis_folder_names_are_understood(local):
    add_model(local.root, "eng")
    (local.root / "hin").mkdir()                                  # empty folder
    (local.root / "ara").mkdir(); (local.root / "ara" / "config.json").write_text("{}")   # config but no weights
    add_model(local.root, "urdu")                                 # folder name used by the earlier MMS voice pack
    add_model(local.root, "fra", weights="pytorch_model.bin")     # older repos only have .bin
    assert set(mms.installed()) == {"eng", "urd-script_arabic", "fra"}
    assert mms.languages() == ["en", "fr", "ur"]


def test_code_for_is_exact_and_never_sends_latin_letters_to_the_urdu_script_model(local, monkeypatch):
    add_model(local.root, "urd-script_arabic")
    add_model(local.root, "eng")
    assert mms.code_for("en-US") == "eng" and mms.code_for("") == "eng"        # no tag means English
    assert mms.code_for("ur") == "urd-script_arabic"
    assert mms.code_for("ur", roman=True) is None                              # Roman Urdu needs the Latin-script model
    assert mms.code_for("it") is None and mms.code_for("hi") is None           # no model / not downloaded
    add_model(local.root, "urd-script_latin")
    assert mms.code_for("ur", roman=True) == "urd-script_latin" and mms.code_for("hi", roman=True) == "urd-script_latin"
    assert mms.code_for("ar", roman=True) is None
    monkeypatch.setenv("AEGIS_MMS_ROMAN", "0")                                 # owner prefers the Edge voice for Roman Urdu
    assert mms.code_for("ur", roman=True) is None and not mms.roman_ready()


# ---------------------------------------------------------------- which provider is active
def test_local_voices_are_automatic_once_models_exist_and_never_before(local):
    assert tts.provider() == "edge"                               # nothing downloaded yet: unchanged behaviour
    add_model(local.root, "eng")
    assert tts.provider() == "mms" and tts.available() and tts.daily_chars() == 200000


def test_paid_key_switch_off_and_missing_packages_all_keep_their_old_meaning(local, monkeypatch):
    add_model(local.root, "eng")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    assert tts.provider() == "openai" and tts.daily_chars() == 6000      # a paid key the owner set still wins
    monkeypatch.delenv("OPENAI_API_KEY")
    monkeypatch.setenv("AEGIS_MMS", "0")
    assert tts.provider() == "edge"
    monkeypatch.delenv("AEGIS_MMS")
    monkeypatch.setattr(mms, "deps_ok", lambda: False)            # models on disk but no PyTorch
    assert tts.provider() == "edge"


def test_explicit_mms_does_not_silently_become_another_service(local, monkeypatch):
    monkeypatch.setenv("AEGIS_TTS_PROVIDER", "mms")
    assert tts.provider() == ""                                   # asked for local voices, none installed
    add_model(local.root, "eng")
    assert tts.provider() == "mms"


# ---------------------------------------------------------------- one sentence, one language, one voice
def test_each_language_gets_its_own_model_and_emotion_changes_speed_and_loudness(local):
    for code in ("eng", "urd-script_arabic", "hin", "kor"):
        add_model(local.root, code)
    tts.synthesize("Good morning", lang="en")
    tts.synthesize("آپ کیسی ہیں؟", lang="ur")
    tts.synthesize("आप कैसे हैं", lang="hi")
    tts.synthesize("안녕하세요", lang="ko")
    assert [c[1] for c in local.calls["mms"]] == ["eng", "urd-script_arabic", "hin", "kor"]
    assert local.calls["edge"] == []
    tts.synthesize("I'm so sorry", emotion="empathy", lang="en")
    tts.synthesize("Great news!", emotion="excited", lang="en")
    slow, fast = local.calls["mms"][-2], local.calls["mms"][-1]
    assert slow[3] < 0 < fast[3] and slow[4] < fast[4]            # rate_pct and volume_pct


def test_stronger_feeling_moves_speed_further(local):
    add_model(local.root, "eng")
    tts.synthesize("Great news!", emotion="joy", lang="en", intensity=1)
    tts.synthesize("Great news!", emotion="joy", lang="en", intensity=5)
    assert local.calls["mms"][0][3] < local.calls["mms"][1][3]


def test_roman_urdu_uses_the_latin_urdu_model_when_it_is_installed(local):
    add_model(local.root, "urd-script_arabic")
    tts.synthesize("kya haal hai, sab theek?", lang="ur")
    assert local.calls["mms"] == [] and local.calls["edge"][0][1] == "en-IN-NeerjaNeural"   # no Latin model yet: the old Roman Urdu voice
    add_model(local.root, "urd-script_latin")
    tts.synthesize("kya haal hai, sab theek?", lang="ur")
    tts.synthesize("آپ کیسی ہیں؟", lang="ur")
    assert [c[1] for c in local.calls["mms"]] == ["urd-script_latin", "urd-script_arabic"]


def test_languages_mms_does_not_have_fall_back_to_the_edge_voice(local):
    add_model(local.root, "eng")
    for text, lang in (("Buongiorno", "it"), ("你好", "zh"), ("こんにちは", "ja"), ("Dobrý den", "cs"), ("Hola", "es")):
        tts.synthesize(text, lang=lang)
    assert local.calls["mms"] == [] and len(local.calls["edge"]) == 5


def test_a_failing_local_voice_falls_back_instead_of_going_silent(local, monkeypatch):
    add_model(local.root, "eng")

    def boom(*a, **k):
        raise mms.MMSError("The local voice is busy right now.")

    monkeypatch.setattr(mms, "synthesize", boom)
    assert tts.synthesize("Hello", lang="en") == b"ID3edge"
    monkeypatch.setenv("AEGIS_EDGE_TTS", "0")                     # no fallback available: a clear error, not silence
    with pytest.raises(tts.TTSError):
        tts.synthesize("Hello", lang="en")
    monkeypatch.setenv("AEGIS_TTS_PROVIDER", "mms")
    with pytest.raises(tts.TTSError):
        tts.synthesize("Buongiorno", lang="it")                   # no model and no fallback


def test_content_type_follows_the_audio_not_the_provider():
    assert tts.content_type(WAV) == "audio/wav"
    assert tts.content_type(b"ID3\x04") == "audio/mpeg" and tts.content_type(b"") == "audio/mpeg"


# ---------------------------------------------------------------- through the real HTTP API
def test_api_serves_wav_for_local_voices_and_lists_the_languages(env, local):
    add_model(local.root, "eng")
    add_model(local.root, "urd-script_arabic")
    add_model(local.root, "urd-script_latin")
    c = env.client
    token = register(c)
    st = c.get("/api/tts/status", headers=auth(token)).json()
    assert st["available"] and st["provider"] == "mms" and st["languages"] == ["en", "ur"] and st["roman_urdu"] is True
    assert "mms_models" not in str(st) and str(local.root) not in str(st)        # no server paths shown to users
    r = c.post("/api/tts", json={"text": "آپ کیسی ہیں؟", "emotion": "warm", "lang": "ur"}, headers=auth(token))
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav" and r.content == WAV
    assert local.calls["mms"][-1][1] == "urd-script_arabic"
    r = c.post("/api/tts", json={"text": "Buongiorno", "lang": "it"}, headers=auth(token))
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3edge"
    assert c.get("/api/config").json()["studio_voice"] is True


def test_api_status_stays_empty_of_languages_for_cloud_voices(env, local, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    add_model(local.root, "eng")
    c = env.client
    st = c.get("/api/tts/status", headers=auth(register(c))).json()
    assert st["provider"] == "openai" and st["languages"] == [] and st["roman_urdu"] is False


def test_failure_costs_nothing_with_local_voices(env, local, monkeypatch):
    add_model(local.root, "eng")
    monkeypatch.setenv("AEGIS_EDGE_TTS", "0")

    def boom(*a, **k):
        raise mms.MMSError("The local voice failed on this sentence.")

    monkeypatch.setattr(mms, "synthesize", boom)
    c = env.client
    token = register(c)
    before = c.get("/api/tts/status", headers=auth(token)).json()["chars_left"]
    assert c.post("/api/tts", json={"text": "Hello", "lang": "en"}, headers=auth(token)).status_code == 502
    assert c.get("/api/tts/status", headers=auth(token)).json()["chars_left"] == before


# ---------------------------------------------------------------- the downloader (no network: the Hub call is replaced)
def _downloader():
    path = Path(__file__).resolve().parent.parent / "scripts" / "mms_download.py"
    spec = importlib.util.spec_from_file_location("mms_download", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_downloader_plans_languages_skips_finished_ones_and_reports_missing_repos(tmp_path, monkeypatch, capsys):
    dl = _downloader()
    fetched = []

    def fake_fetch(repo, dest, patterns):
        fetched.append(repo)
        if repo.endswith("-pan"):
            raise RuntimeError("404 Client Error: Repository Not Found")
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "config.json").write_text("{}")
        (dest / "model.safetensors").write_bytes(b"x")

    monkeypatch.setattr(mms, "_fetch", fake_fetch)
    add_model(tmp_path, "eng")                                    # already there
    rc = dl.main(["--dir", str(tmp_path), "--langs", "en,ur,pa,roman"])
    out = capsys.readouterr().out
    assert rc == 1 and "not on the Hub as facebook/mms-tts-pan" in out
    assert fetched == ["facebook/mms-tts-urd-script_arabic", "facebook/mms-tts-pan", "facebook/mms-tts-urd-script_latin"]
    assert (tmp_path / "urd-script_latin" / "model.safetensors").is_file()
    assert dl.main(["--dir", str(tmp_path), "--langs", "en", "--list"]) == 0
    assert dl.main(["--dir", str(tmp_path), "--status"]) == 0


def test_downloader_default_plan_is_every_supported_language_plus_roman_urdu():
    dl = _downloader()
    args = type("A", (), {"codes": None, "langs": None, "all": False})()
    plan = dl.plan(args)
    assert len(plan) == len(set(plan)) == len(mms.CODES) + 1 and plan[-1] == "urd-script_latin"
    with pytest.raises(SystemExit):
        dl.plan(type("A", (), {"codes": None, "langs": "it", "all": False})())


# ---------------------------------------------------------------- small servers protect themselves
def test_a_server_with_too_little_memory_keeps_local_voices_off_and_says_why(local, monkeypatch):
    add_model(local.root, "eng")
    assert tts.provider() == "mms" and mms.reason() == ""
    monkeypatch.setattr(mms, "_ram_mb", lambda: 512)               # for example a 512 MB instance
    assert not mms.ready() and tts.provider() == "edge" and "512 MB" in mms.reason()
    tts.synthesize("Hello", lang="en")
    assert local.calls["mms"] == [] and len(local.calls["edge"]) == 1
    monkeypatch.setenv("AEGIS_MMS_FORCE", "1")                     # the owner knows better
    assert mms.ready() and tts.provider() == "mms"
    monkeypatch.delenv("AEGIS_MMS_FORCE")
    monkeypatch.setattr(mms, "_ram_mb", lambda: 0)                 # memory unknown (some desktops): trust the owner
    assert mms.ready()
    monkeypatch.setattr(mms, "_ram_mb", lambda: 1499)
    assert not mms.ready()
    monkeypatch.setenv("AEGIS_MMS_MIN_RAM_MB", "1000")
    assert mms.ready()


def test_memory_is_read_from_the_container_limit_not_the_host(monkeypatch, tmp_path):
    files = {"/sys/fs/cgroup/memory.max": "536870912", "/proc/meminfo": "MemTotal:       16000000 kB\n"}
    real = Path.read_text
    monkeypatch.setattr(Path, "read_text", lambda self, *a, **k: files[str(self)] if str(self) in files else (_ for _ in ()).throw(OSError()))
    mms._ram["mb"] = None
    assert mms._ram_mb() == 512                                    # a 512 MB container on a 16 GB host
    mms._ram["mb"] = None
    files["/sys/fs/cgroup/memory.max"] = "max"                     # cgroup v2 without a limit: the machine decides
    assert mms._ram_mb() == 15625
    mms._ram["mb"] = None
    monkeypatch.setattr(Path, "read_text", real)


def test_status_explains_why_local_voices_are_off_but_only_when_pytorch_is_installed(env, local, monkeypatch):
    c = env.client
    token = register(c)
    monkeypatch.setattr(mms, "_ram_mb", lambda: 512)
    st = c.get("/api/tts/status", headers=auth(token)).json()
    assert st["provider"] == "edge" and "512 MB" in st["local_reason"] and st["downloading"] == []
    monkeypatch.setattr(mms, "deps_ok", lambda: False)             # nobody tried to enable them: nothing to explain
    assert c.get("/api/tts/status", headers=auth(token)).json()["local_reason"] == ""


# ---------------------------------------------------------------- the voice installs itself
@pytest.fixture
def auto(local, monkeypatch):
    monkeypatch.setenv("AEGIS_MMS_AUTO", "1")
    fetched = []

    def fake_fetch(repo, dest, patterns):
        fetched.append(repo)
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "config.json").write_text("{}")
        (dest / "model.safetensors").write_bytes(b"x")

    monkeypatch.setattr(mms, "_fetch", fake_fetch)
    monkeypatch.setattr(mms, "_free_mb", lambda folder: 50000)
    yield SimpleNamespace(fetched=fetched, local=local)
    mms.wait_downloads(10)


def test_first_use_of_a_language_downloads_its_voice_in_the_background_then_speaks_with_it(auto):
    calls = auto.local.calls
    assert tts.provider() == "mms"                                 # nothing on disk yet, but the voices can fetch themselves
    tts.synthesize("Good morning", lang="en")
    assert calls["mms"] == [] and len(calls["edge"]) == 1          # this sentence: the fallback voice
    mms.wait_downloads(10)
    assert auto.fetched == ["facebook/mms-tts-eng"] and mms.languages() == ["en"]
    tts.synthesize("Good morning", lang="en")
    assert [c[1] for c in calls["mms"]] == ["eng"] and len(calls["edge"]) == 1


def test_a_language_is_requested_once_and_the_auto_list_limits_what_is_fetched(auto, monkeypatch):
    monkeypatch.setenv("AEGIS_MMS_AUTO", "ur,roman")
    for _ in range(4):
        tts.synthesize("Good morning", lang="en")                  # English is not on the list
    for _ in range(3):
        tts.synthesize("آپ کیسی ہیں؟", lang="ur")
    tts.synthesize("kya haal hai, sab theek?", lang="ur")
    mms.wait_downloads(10)
    assert sorted(auto.fetched) == ["facebook/mms-tts-urd-script_arabic", "facebook/mms-tts-urd-script_latin"]


def test_a_failed_download_is_not_retried_on_every_sentence(auto, monkeypatch):
    attempts = []

    def boom(repo, dest, patterns):
        attempts.append(repo)
        raise RuntimeError("404 Client Error: Repository Not Found")

    monkeypatch.setattr(mms, "_fetch", boom)
    for _ in range(3):
        tts.synthesize("Hello", lang="en")
        mms.wait_downloads(10)
    assert attempts == ["facebook/mms-tts-eng"] and len(auto.local.calls["edge"]) == 3 and mms.languages() == []


def test_no_automatic_download_on_a_full_disk_a_small_server_or_when_switched_off(auto, monkeypatch):
    monkeypatch.setattr(mms, "_free_mb", lambda folder: 200)
    tts.synthesize("Hello", lang="en")
    mms.wait_downloads(5)
    assert auto.fetched == [] and mms.downloading() == []
    monkeypatch.setattr(mms, "_free_mb", lambda folder: 50000)
    mms._dl["failed"].clear()
    monkeypatch.setattr(mms, "_ram_mb", lambda: 512)
    tts.synthesize("Hello", lang="en")
    mms.wait_downloads(5)
    assert auto.fetched == []
    monkeypatch.setattr(mms, "_ram_mb", lambda: 8192)
    monkeypatch.setenv("AEGIS_MMS_AUTO", "0")
    assert tts.provider() == "edge"                                # no models and no auto: unchanged old behaviour
    tts.synthesize("Hello", lang="en")
    mms.wait_downloads(5)
    assert auto.fetched == []


def test_status_lists_the_voices_that_are_still_downloading(env, auto, monkeypatch):
    gate = threading.Event()
    real = mms._fetch

    def slow(repo, dest, patterns):
        gate.wait(10)
        real(repo, dest, patterns)

    monkeypatch.setattr(mms, "_fetch", slow)
    c = env.client
    token = register(c)
    tts.synthesize("Good morning", lang="en")
    st = c.get("/api/tts/status", headers=auth(token)).json()
    assert st["provider"] == "mms" and st["downloading"] == ["eng"] and st["languages"] == []
    gate.set()
    mms.wait_downloads(10)
    assert c.get("/api/tts/status", headers=auth(token)).json()["languages"] == ["en"]
