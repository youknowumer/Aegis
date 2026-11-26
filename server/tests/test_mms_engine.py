"""The REAL local-voice engine (app/mms.py) on a tiny VITS model with random weights.

A random model makes noise, not speech, so these tests check the plumbing that decides whether Aegis speaks at all: loading through
transformers, tokenizing, speed and loudness, WAV output, the model cache, the concurrency gate, the uroman path and the fallback.
They are skipped when PyTorch / transformers are not installed (pip install -r requirements-mms.txt)."""
import io
import json
import shutil
import sys
import threading
import time
import wave
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

torch = pytest.importorskip("torch")
pytest.importorskip("transformers")

from transformers import VitsConfig, VitsModel  # noqa: E402

from app import mms, tts  # noqa: E402

LATIN = list("abcdefghijklmnopqrstuvwxyz '-,.?!")


def _write_model(folder: Path, uroman: bool = False) -> None:
    vocab = {"<pad>": 0, **{c: i for i, c in enumerate(LATIN, 1)}}
    cfg = VitsConfig(vocab_size=len(vocab), hidden_size=16, num_hidden_layers=1, num_attention_heads=2, ffn_dim=32, flow_size=16,
                     spectrogram_bins=17, upsample_initial_channel=16, prior_encoder_num_flows=1, prior_encoder_num_wavenet_layers=1,
                     posterior_encoder_num_wavenet_layers=1, duration_predictor_filter_channels=16, depth_separable_num_layers=1, sampling_rate=16000)
    torch.manual_seed(1)
    VitsModel(cfg).eval().save_pretrained(folder)
    (folder / "vocab.json").write_text(json.dumps(vocab))
    (folder / "tokenizer_config.json").write_text(json.dumps({
        "tokenizer_class": "VitsTokenizer", "add_blank": True, "is_uroman": uroman, "language": "x", "normalize": True,
        "phonemize": False, "pad_token": "<pad>", "unk_token": "<pad>", "model_max_length": 1000000}))


@pytest.fixture(scope="module")
def models(tmp_path_factory):
    root = tmp_path_factory.mktemp("mms_models")
    _write_model(root / "eng")
    shutil.copytree(root / "eng", root / "deu")
    _write_model(root / "kor", uroman=True)
    return root


@pytest.fixture(autouse=True)
def engine(models, monkeypatch):
    for k in ("AEGIS_MMS", "AEGIS_MMS_CACHE", "AEGIS_MMS_CONCURRENCY", "AEGIS_MMS_QUEUE_SECONDS", "AEGIS_TTS_PROVIDER", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "AEGIS_EDGE_TTS", "AEGIS_MMS_FORCE", "AEGIS_MMS_MIN_RAM_MB"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AEGIS_MMS_DIR", str(models))
    monkeypatch.setenv("AEGIS_MMS_AUTO", "0")
    monkeypatch.setattr(mms, "_ram_mb", lambda: 8192)
    mms.installed(force=True)
    mms.unload_all()
    yield
    mms.unload_all()


def _read(data: bytes):
    with wave.open(io.BytesIO(data)) as w:
        raw = w.readframes(w.getnframes())
        return w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth(), raw


def _peak(data: bytes) -> int:
    import numpy as np

    return int(np.abs(np.frombuffer(_read(data)[4], dtype="<i2")).max())


def test_real_packages_are_detected_and_the_models_are_found():
    assert mms.deps_ok() and mms.ready() and mms.languages() == ["de", "en", "ko"]


def test_speaks_a_valid_16_bit_mono_wav():
    frames, rate, channels, width, _ = _read(mms.synthesize("hello world, this is a test", "eng", "en"))
    assert frames > 1000 and rate == 16000 and channels == 1 and width == 2


def test_same_sentence_gives_the_same_voice_every_time():
    assert mms.synthesize("hello world", "eng", "en") == mms.synthesize("hello world", "eng", "en")


def test_emotion_speed_is_real_faster_is_shorter_slower_is_longer():
    base = _read(mms.synthesize("hello world this is a test", "eng", "en", rate_pct=0))[0]
    fast = _read(mms.synthesize("hello world this is a test", "eng", "en", rate_pct=+25))[0]
    slow = _read(mms.synthesize("hello world this is a test", "eng", "en", rate_pct=-20))[0]
    assert fast < base < slow


def test_volume_changes_loudness_and_never_clips_past_full_scale():
    loud = _peak(mms.synthesize("hello world", "eng", "en", volume_pct=+30))
    normal = _peak(mms.synthesize("hello world", "eng", "en", volume_pct=0))
    soft = _peak(mms.synthesize("hello world", "eng", "en", volume_pct=-50))
    assert soft < normal * 0.7 and loud <= 32767


def test_digits_are_spoken_as_words_instead_of_being_silently_dropped():
    pytest.importorskip("num2words")
    assert mms.synthesize("i have 3 apples", "eng", "en") == mms.synthesize("i have three apples", "eng", "en")
    assert mms.synthesize("i have 3 apples", "eng", "en") != mms.synthesize("i have apples", "eng", "en")


def test_text_with_nothing_speakable_is_refused_so_the_fallback_voice_can_take_it():
    for text in ("", "!!!", "   ", "你好"):                      # empty, punctuation only, a script this voice does not have
        with pytest.raises(mms.MMSError):
            mms.synthesize(text, "eng", "en")


def test_uroman_voices_romanize_other_scripts_first():
    pytest.importorskip("uroman")
    assert mms._romanize("안녕하세요").isascii()
    frames = _read(mms.synthesize("안녕하세요", "kor", "ko"))[0]
    assert frames > 1000


def test_least_recently_used_model_is_unloaded_when_the_cache_is_full(monkeypatch):
    monkeypatch.setenv("AEGIS_MMS_CACHE", "2")
    mms.synthesize("hello", "eng", "en")
    mms.synthesize("hallo", "deu", "de")
    mms.synthesize("hello again", "eng", "en")                  # eng is now the most recent
    mms.synthesize("annyeong", "kor", "ko")                     # needs a third slot: deu goes, not eng
    assert mms.loaded() == ["eng", "kor"]


def test_a_busy_engine_gives_up_quickly_instead_of_piling_up_requests(monkeypatch):
    monkeypatch.setenv("AEGIS_MMS_CONCURRENCY", "1")
    monkeypatch.setenv("AEGIS_MMS_QUEUE_SECONDS", "1")
    sem = mms._slot()
    assert sem.acquire(timeout=1)                               # somebody else is speaking
    try:
        t0 = time.time()
        with pytest.raises(mms.MMSError, match="busy"):
            mms.synthesize("hello", "eng", "en")
        assert 0.8 < time.time() - t0 < 5
    finally:
        sem.release()
    assert _read(mms.synthesize("hello", "eng", "en"))[0] > 1000    # and it recovers


def test_several_sentences_at_once_are_all_spoken_in_turn(monkeypatch):
    monkeypatch.setenv("AEGIS_MMS_CONCURRENCY", "1")
    results, errors = [], []

    def work(i):
        try:
            results.append(_read(mms.synthesize(f"hello number {'abc'[i]}", "eng", "en"))[0])
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=work, args=(i,)) for i in range(3)]
    [t.start() for t in threads]
    [t.join(60) for t in threads]
    assert not errors and len(results) == 3 and all(n > 1000 for n in results)


def test_a_broken_model_is_reported_and_not_cached(tmp_path, monkeypatch):
    bad = tmp_path / "fra"
    bad.mkdir()
    (bad / "config.json").write_text("{}")
    (bad / "model.safetensors").write_bytes(b"not a model")
    monkeypatch.setenv("AEGIS_MMS_DIR", str(tmp_path))
    mms.installed(force=True)
    with pytest.raises(mms.MMSError, match="could not be loaded"):
        mms.synthesize("bonjour", "fra", "fr")
    assert mms.loaded() == []


def test_through_tts_local_voice_speaks_its_language_and_the_rest_fall_back(monkeypatch):
    monkeypatch.setattr(tts, "_edge_installed", lambda: True)
    monkeypatch.setattr(tts, "_list_edge_voices", lambda: [])
    edge = []
    monkeypatch.setattr(tts, "_edge_audio", lambda text, voice, emotion, intensity=3: (edge.append((text, voice)) or b"ID3edge"))
    assert tts.provider() == "mms"
    wav = tts.synthesize("hello world", emotion="joy", lang="en")
    assert tts.content_type(wav) == "audio/wav" and _read(wav)[0] > 1000 and edge == []
    assert _read(tts.synthesize("hallo welt", lang="de"))[0] > 1000
    assert tts.synthesize("buongiorno a tutti", lang="it") == b"ID3edge" and len(edge) == 1      # Italian: no MMS model exists
    assert tts.synthesize("hola", lang="es") == b"ID3edge" and len(edge) == 2                    # Spanish: not downloaded here
