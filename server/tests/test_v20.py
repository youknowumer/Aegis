"""v20: Piper local voices, the Piper -> MMS -> Edge chain, and observability (metrics, dashboard, JSON logs)."""
import json
import logging
import os
import sys
import time
import wave
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from test_server import auth, env, register  # noqa: E402,F401  (env is a fixture)

from app import mms, observability, piper_engine as pe, settings, tts  # noqa: E402
from app.observability import JsonFormatter, Registry, obs  # noqa: E402


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    obs.reset()
    monkeypatch.setenv("AEGIS_PIPER_DIR", str(tmp_path / "piper"))
    pe._scan.update(at=0.0, dir="", found={})
    pe._index.update(at=0.0, data=None)
    pe.unload_all()
    yield
    pe.unload_all()


# ------------------------------------------------------------ observability
def test_counter_gauge_histogram_prometheus_text():
    r = Registry()
    r.inc("hits_total", 2, engine="piper", lang="en")
    r.inc("hits_total", engine="piper", lang="en")
    r.set_gauge("loaded", 3, engine="piper")
    for s in (0.01, 0.2, 0.2, 3.0):
        r.observe("lat_seconds", s, engine="piper")
    text = r.render_prometheus()
    assert 'aegis_hits_total{engine="piper",lang="en"} 3' in text
    assert 'aegis_loaded{engine="piper"} 3' in text
    assert 'aegis_lat_seconds_bucket{engine="piper",le="0.025"} 1' in text
    assert 'aegis_lat_seconds_bucket{engine="piper",le="+Inf"} 4' in text
    assert 'aegis_lat_seconds_count{engine="piper"} 4' in text
    assert "# TYPE aegis_lat_seconds histogram" in text


def test_quantiles_are_sane_and_never_invented():
    r = Registry()
    for _ in range(98):
        r.observe("l", 0.04)
    r.observe("l", 5.0)
    r.observe("l", 500.0)        # slower than the last bucket: capped, not made up
    row = r.histogram_summary("l")[0]
    assert row["count"] == 100 and 25 <= row["p50_ms"] <= 50
    assert row["p99_ms"] <= 30000 and row["p95_ms"] < 100


def test_labels_are_sanitised_and_bounded():
    r = Registry()
    r.inc("x", user='a"b\nc{d}' + "z" * 100)
    line = [ln for ln in r.render_prometheus().splitlines() if ln.startswith("aegis_x{")][0]
    assert "\n" not in line and line.count('"') == 2 and len(line) < 100


def test_voice_events_ring_buffer_and_fallback_health(monkeypatch):
    monkeypatch.setenv("AEGIS_OBS_FALLBACK_WARN", "0.5")
    for _ in range(4):
        obs.record_voice("piper", "en", "ok", 0.2, chars=10, size=500)
    assert observability.voice_health()["status"] == "ok"
    for _ in range(8):
        obs.record_voice("edge", "ur", "ok", 0.4, chars=10, size=500, fell_back_from="mms", why="no local voice")
    h = observability.voice_health()
    assert h["status"] == "degraded" and "fallback" in h["problems"][0]
    ev = obs.recent_events(3, "voice")
    assert ev[0]["engine"] == "edge" and ev[0]["fell_back_from"] == "mms" and ev[0]["why"] == "no local voice"
    dash = observability.voice_dashboard()
    assert dash["total_requests"] == 12 and {e["engine"] for e in dash["by_engine"]} == {"piper", "edge"}


def test_json_logging_formatter():
    rec = logging.LogRecord("aegis.x", logging.WARNING, __file__, 1, "hello %s", ("world",), None)
    out = json.loads(JsonFormatter().format(rec))
    assert out["msg"] == "hello world" and out["level"] == "WARNING" and out["logger"] == "aegis.x"


# ------------------------------------------------------------ Piper: choosing and downloading voices (no network: file:// host)
INDEX = {
    "en_US-lessac-medium": {"language": {"family": "en"}, "quality": "medium", "files": {"en/en_US/lessac/medium/en_US-lessac-medium.onnx": {"size_bytes": 10}, "en/en_US/lessac/medium/en_US-lessac-medium.onnx.json": {"size_bytes": 2}, "en/en_US/lessac/medium/MODEL_CARD": {}}},
    "en_US-lessac-high": {"language": {"family": "en"}, "quality": "high", "files": {}},
    "en_GB-alan-low": {"language": {"family": "en"}, "quality": "low", "files": {}},
    "de_DE-thorsten-medium": {"language": {"family": "de"}, "quality": "medium", "files": {}},
    "de_DE-zzz-x_low": {"language": {"family": "de"}, "quality": "x_low", "files": {}},
    "ar_JO-kareem-low": {"language": {"family": "ar"}, "quality": "low", "files": {}},
}


def test_resolve_prefers_known_voice_then_nearest_quality(monkeypatch):
    assert pe.resolve("en", INDEX) == "en_US-lessac-medium"
    monkeypatch.setenv("AEGIS_PIPER_QUALITY", "high")
    assert pe.resolve("en", INDEX) == "en_US-lessac-high"
    assert pe.resolve("de", INDEX) == "de_DE-thorsten-medium"          # no high voice exists: nearest tier
    assert pe.resolve("ar", INDEX) == "ar_JO-kareem-low"               # not in PREFERRED at this tier: best of the language
    assert pe.resolve("ur", INDEX) is None                             # Piper has none: MMS / Edge speak it
    monkeypatch.setenv("AEGIS_PIPER_VOICES", "en=en_GB-alan-low")
    assert pe.resolve("en", INDEX) == "en_GB-alan-low"


def test_download_from_host_is_atomic_and_idempotent(tmp_path, monkeypatch):
    host = tmp_path / "host"
    (host / "en/en_US/lessac/medium").mkdir(parents=True)
    (host / "en/en_US/lessac/medium/en_US-lessac-medium.onnx").write_bytes(b"x" * 1000)
    (host / "en/en_US/lessac/medium/en_US-lessac-medium.onnx.json").write_text("{}")
    (host / "voices.json").write_text(json.dumps(INDEX))
    monkeypatch.setenv("AEGIS_PIPER_BASE", host.as_uri())
    idx = pe.load_index(force=True)
    root = tmp_path / "piper"
    assert pe.download("en_US-lessac-medium", idx, root) == "done"
    assert pe.download("en_US-lessac-medium", idx, root) == "skipped"
    assert not list(root.glob("*.part")) and not (root / "MODEL_CARD").exists()
    assert "en_US-lessac-medium" in pe.installed(force=True) and pe.voice_for("en-GB") == "en_US-lessac-medium"
    assert "not in the Piper voice list" in pe.download("xx_XX-none-low", idx, root)
    # a failed download leaves nothing half-written
    bad = {"en_US-bad-medium": {"files": {"missing/en_US-bad-medium.onnx": {}, "missing/en_US-bad-medium.onnx.json": {}}}}
    assert pe.download("en_US-bad-medium", bad, root) not in ("done", "skipped") and not list(root.glob("en_US-bad*"))


def test_auto_download_queue_records_metrics(tmp_path, monkeypatch):
    host = tmp_path / "host"
    (host / "de").mkdir(parents=True)
    (host / "de/de_DE-thorsten-medium.onnx").write_bytes(b"x" * 500)
    (host / "de/de_DE-thorsten-medium.onnx.json").write_text("{}")
    idx = {"de_DE-thorsten-medium": {"language": {"family": "de"}, "files": {"de/de_DE-thorsten-medium.onnx": {}, "de/de_DE-thorsten-medium.onnx.json": {}}}}
    (host / "voices.json").write_text(json.dumps(idx))
    monkeypatch.setenv("AEGIS_PIPER_BASE", host.as_uri())
    monkeypatch.setenv("AEGIS_PIPER", "1")
    monkeypatch.setenv("AEGIS_PIPER_AUTO", "1")
    monkeypatch.setattr(pe, "deps_ok", lambda: True)
    assert pe.code_for("de") is None                 # first sentence: fallback speaks, download starts
    pe.wait_downloads(10)
    assert pe.code_for("de") == "de_DE-thorsten-medium"
    assert any(r["result"] == "ok" for r in obs.counter_rows("voice_model_downloads_total"))


def test_auto_setting_list_limits_languages(monkeypatch):
    monkeypatch.setenv("AEGIS_PIPER_AUTO", "en,es")
    assert pe.auto_allows("en") and not pe.auto_allows("de")
    monkeypatch.setenv("AEGIS_PIPER_AUTO", "0")
    assert not pe.auto_allows("en")


# ------------------------------------------------------------ the chain: Piper -> MMS -> Edge, every step measured
def _chain(monkeypatch, piper_ok=True, piper_err=None, mms_ok=True, edge=True):
    monkeypatch.setattr(pe, "ready", lambda: piper_ok)
    monkeypatch.setattr(pe, "code_for", lambda lang: "en_US-x-medium" if lang == "en" else None)

    def p_syn(text, key, rate_pct=0, volume_pct=0):
        if piper_err:
            raise pe.PiperError(piper_err)
        return b"RIFF....WAVEpiper"

    monkeypatch.setattr(pe, "synthesize", p_syn)
    monkeypatch.setattr(mms, "ready", lambda: mms_ok)
    monkeypatch.setattr(mms, "code_for", lambda lang, roman=False: "urd" if lang == "ur" else None)
    monkeypatch.setattr(mms, "synthesize", lambda *a, **k: b"RIFF....WAVEmms")
    monkeypatch.setattr(tts, "edge_enabled", lambda: edge)
    monkeypatch.setattr(tts, "_edge_audio", lambda *a, **k: b"ID3edge")
    monkeypatch.setattr(tts, "edge_voice", lambda *a, **k: "v")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("AEGIS_TTS_PROVIDER", raising=False)


def _last():
    return obs.recent_events(1, "voice")[0]


def test_piper_speaks_first_and_is_measured(monkeypatch):
    _chain(monkeypatch)
    assert tts.provider() == "piper" and tts.daily_chars() == 200000
    assert tts.synthesize("Hello there", "warm", "en").endswith(b"piper")
    e = _last()
    assert e["engine"] == "piper" and e["lang"] == "en" and e["outcome"] == "ok" and e["fell_back_from"] is None
    assert 'aegis_voice_requests_total{engine="piper",lang="en",outcome="ok"} 1' in obs.render_prometheus()


def test_language_piper_lacks_goes_to_mms_without_counting_a_fallback_failure(monkeypatch):
    _chain(monkeypatch)
    assert tts.synthesize("آپ کیسے ہیں", "calm", "ur").endswith(b"mms")
    assert _last()["engine"] == "mms"


def test_piper_error_falls_through_to_mms_then_edge_and_says_why(monkeypatch):
    _chain(monkeypatch, piper_err="The Piper voice is busy right now.")
    monkeypatch.setattr(pe, "code_for", lambda lang: "k")
    monkeypatch.setattr(mms, "code_for", lambda lang, roman=False: None)       # MMS has nothing for this language either
    assert tts.synthesize("Hello", "calm", "en") == b"ID3edge"
    e = _last()
    assert e["engine"] == "edge" and e["fell_back_from"] == "piper" and "busy" in e["why"]
    assert 'aegis_voice_fallbacks_total{from_engine="piper",lang="en",to_engine="edge"} 1' in obs.render_prometheus()


def test_everything_fails_is_an_error_event(monkeypatch):
    _chain(monkeypatch, edge=False)
    with pytest.raises(tts.TTSError):
        tts.synthesize("Bonjour", "calm", "fr")
    assert _last()["outcome"] == "error"


def test_piper_provider_can_be_forced_and_paid_key_still_wins(monkeypatch):
    _chain(monkeypatch)
    monkeypatch.setenv("AEGIS_TTS_PROVIDER", "piper")
    assert tts.provider() == "piper"
    monkeypatch.delenv("AEGIS_TTS_PROVIDER")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert tts.provider() == "openai"


def test_local_languages_unites_both_engines(monkeypatch):
    _chain(monkeypatch)
    monkeypatch.setattr(pe, "languages", lambda: ["en", "de"])
    monkeypatch.setattr(mms, "languages", lambda: ["ur", "de"])
    assert tts.local_languages() == ["de", "en", "ur"]


# ------------------------------------------------------------ the real Piper engine (needs piper-tts and one voice file)
VOICE = os.environ.get("AEGIS_TEST_PIPER_VOICE", "")


@pytest.mark.skipif(not (VOICE and Path(VOICE).is_file() and pe.deps_ok()), reason="set AEGIS_TEST_PIPER_VOICE=/path/voice.onnx and pip install -r requirements-piper.txt")
def test_real_piper_voice_speaks_with_speed_volume_and_cache(tmp_path, monkeypatch):
    root = tmp_path / "piper"
    root.mkdir()
    (root / "en_US-test-medium.onnx").write_bytes(Path(VOICE).read_bytes())
    (root / "en_US-test-medium.onnx.json").write_text(Path(VOICE + ".json").read_text())
    monkeypatch.setenv("AEGIS_PIPER_DIR", str(root))
    monkeypatch.setenv("AEGIS_PIPER", "1")
    monkeypatch.setenv("AEGIS_PIPER_AUTO", "0")
    pe._scan.update(at=0.0, dir="", found={})
    assert pe.ready() and pe.languages() == ["en"] and pe.code_for("en-US") == "en_US-test-medium"

    def info(wav):
        import io
        with wave.open(io.BytesIO(wav)) as w:
            return w.getnframes() / w.getframerate(), w.getnchannels(), w.getsampwidth()

    normal = pe.synthesize("Hello, this is Aegis speaking.", "en_US-test-medium")
    fast = pe.synthesize("Hello, this is Aegis speaking.", "en_US-test-medium", rate_pct=30)
    assert info(normal)[1:] == (1, 2) and info(fast)[0] < info(normal)[0] * 0.9
    assert pe.loaded() == ["en_US-test-medium"] and obs.histogram_summary("voice_model_load_seconds")
    assert obs.histogram_summary("voice_queue_wait_seconds")[0]["count"] == 2
    with pytest.raises(pe.PiperError):
        pe.synthesize("...", "en_US-test-medium")                       # nothing speakable
    # and through the full tts path
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    assert tts.provider() == "piper"
    audio = tts.synthesize("How are you today?", "empathy", "en")
    assert audio[:4] == b"RIFF" and tts.content_type(audio) == "audio/wav" and _last()["engine"] == "piper"


def test_busy_voice_times_out_into_the_fallback(monkeypatch):
    monkeypatch.setenv("AEGIS_PIPER_CONCURRENCY", "1")
    monkeypatch.setenv("AEGIS_PIPER_QUEUE_SECONDS", "1")
    sem = pe._slot()
    sem.acquire()
    try:
        t0 = time.time()
        with pytest.raises(pe.PiperError):
            pe.synthesize("hello", "k")
        assert time.time() - t0 < 4
    finally:
        sem.release()
    assert obs.counter_rows("voice_queue_timeouts_total")[0]["value"] == 1


# ------------------------------------------------------------ HTTP: admin dashboard, metrics, request ids
def test_admin_voice_endpoints_hidden_until_token_then_work(env, monkeypatch):
    c = env.client
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "")
    for path in ("/api/admin/voice", "/admin/voice", "/admin/voice.js"):
        assert c.get(path, headers={"X-Admin-Token": "x"}).status_code == 404
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "t" * 40)
    H = {"X-Admin-Token": "t" * 40}
    assert c.get("/api/admin/voice", headers={"X-Admin-Token": "wrong"}).status_code == 401
    obs.record_voice("piper", "en", "ok", 0.3, chars=5, size=100)
    d = c.get("/api/admin/voice", headers=H).json()
    assert d["health"]["status"] == "ok" and d["total_requests"] == 1 and "piper" in d and "mms" in d and d["process"]["threads"] >= 1
    page = c.get("/admin/voice")
    assert page.status_code == 200 and "<script src=\"/admin/voice.js\">" in page.text and "<script>" not in page.text   # the CSP forbids inline scripts
    assert c.get("/admin/voice.js").headers["content-type"].startswith("text/javascript")
    assert c.get("/api/admin/stats", headers=H).json()["voice"]["status"] == "ok"


def test_metrics_include_labelled_http_latency_and_voice_series(env, monkeypatch):
    c = env.client
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "t" * 40)
    c.get("/healthz")
    obs.record_voice("mms", "ur", "ok", 1.2, chars=20, size=900)
    text = c.get("/metrics", headers={"X-Admin-Token": "t" * 40}).text
    assert 'aegis_http_request_seconds_count{method="GET",route="/healthz",status="2xx"}' in text
    assert 'aegis_voice_requests_total{engine="mms",lang="ur",outcome="ok"} 1' in text
    assert "aegis_process_resident_memory_mb" in text and "aegis_http_requests_total" in text


def test_tts_endpoint_records_request_id_and_status_lists_engines(env, monkeypatch):
    c = env.client
    token = register(c)
    _chain(monkeypatch)
    r = c.post("/api/tts", json={"text": "Hello there", "lang": "en"}, headers={**auth(token), "X-Request-ID": "rid-123"})
    assert r.status_code == 200 and r.content.endswith(b"piper")
    assert _last()["rid"] == "rid-123"
    monkeypatch.setattr(pe, "languages", lambda: ["en"])
    st = c.get("/api/tts/status", headers=auth(token)).json()
    assert st["provider"] == "piper" and st["engines"]["piper"] == ["en"] and "en" in st["languages"]


def test_piper_stays_off_on_a_tiny_server_and_says_why(monkeypatch):
    monkeypatch.setenv("AEGIS_PIPER", "1")
    monkeypatch.setenv("AEGIS_PIPER_AUTO", "1")
    monkeypatch.setattr(pe, "deps_ok", lambda: True)
    monkeypatch.setattr(mms, "_ram_mb", lambda: 256)
    assert not pe.ready() and "256 MB" in pe.reason()
    monkeypatch.setenv("AEGIS_PIPER_FORCE", "1")
    assert pe.ready() and pe.reason() == ""
    monkeypatch.delenv("AEGIS_PIPER_FORCE")
    monkeypatch.setattr(mms, "_ram_mb", lambda: 2048)
    assert pe.ready()
