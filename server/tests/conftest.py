import pytest


@pytest.fixture(autouse=True)
def _local_voices_off_by_default(monkeypatch):
    """No test may depend on the machine it runs on: PyTorch installed, models on disk, or a background download.
    test_mms.py and test_mms_engine.py switch the local voices on themselves, inside their own fixtures."""
    monkeypatch.setenv("AEGIS_MMS", "0")
    monkeypatch.setenv("AEGIS_MMS_AUTO", "0")
