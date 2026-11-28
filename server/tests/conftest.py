import pytest


@pytest.fixture(autouse=True)
def _local_voices_off_by_default(monkeypatch):
    """No test may depend on the machine it runs on: PyTorch installed, models on disk, or a background download.
    test_mms.py, test_mms_engine.py and test_v20.py switch the local voices on themselves, inside their own fixtures."""
    monkeypatch.setenv("AEGIS_MMS", "0")
    monkeypatch.setenv("AEGIS_MMS_AUTO", "0")
    monkeypatch.setenv("AEGIS_PIPER", "0")
    monkeypatch.setenv("AEGIS_PIPER_AUTO", "0")
