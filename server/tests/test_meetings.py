"""Groq transcription + meeting notes. Groq itself is faked with httpx.MockTransport: no network, no key."""
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

os.environ["AEGIS_JWT_SECRET"] = "test-secret-test-secret-test-secret-0123456789"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import meeting, utilities  # noqa: E402
from app.main import create_app  # noqa: E402

NOTES = {
    "title": "Sprint planning",
    "summary": "The team planned the sprint.",
    "important_points": [{"point": "Launch moved to Friday", "importance": "medium"}, {"point": "Budget approved", "importance": "high"}],
    "decisions": ["Ship on Friday"],
    "action_items": [{"task": "Send the invoice", "owner": "Ali", "due": "Thursday", "priority": "high"}, "Book the demo room"],
    "enhancements": [{"idea": "Automate the release checklist", "why": "Saves an hour", "impact": "high", "source": "suggested"}],
    "risks": ["Vendor may be late"],
    "open_questions": ["Who owns QA?"],
    "next_steps": ["Review on Monday"],
    "participants": ["Ali", "Sara"],
    "topics": ["Sprint", "Release"],
}


class FakeGroq:
    """Stands in for api.groq.com. Records what it was asked."""

    def __init__(self):
        self.requests = []
        self.stt_status = 200
        self.chat_reply = json.dumps(NOTES)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.endswith("/audio/transcriptions"):
            if self.stt_status != 200:
                return httpx.Response(self.stt_status, json={"error": {"message": "nope"}}, headers={"retry-after": "7"})
            return httpx.Response(200, json={
                "text": "ignored", "language": "urdu", "duration": 12.5,
                "segments": [
                    {"start": 0, "end": 4, "text": " Hello team, let's begin.", "no_speech_prob": 0.01, "avg_logprob": -0.2},
                    {"start": 4, "end": 6, "text": " Thank you for watching!", "no_speech_prob": 0.9, "avg_logprob": -1.4},
                    {"start": 6, "end": 12, "text": " Budget approve ho gaya.", "no_speech_prob": 0.02, "avg_logprob": -0.3},
                ],
            })
        if request.url.path.endswith("/chat/completions"):
            return httpx.Response(200, json={"choices": [{"message": {"content": self.chat_reply}}]})
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "whisper-large-v3"}, {"id": "llama-3.3-70b-versatile"}]})
        return httpx.Response(404, json={})


@pytest.fixture
def groq(monkeypatch):
    fake = FakeGroq()
    real = httpx.AsyncClient

    def patched(*a, **kw):
        kw["transport"] = httpx.MockTransport(fake.handler)
        return real(*a, **kw)

    monkeypatch.setattr(httpx, "AsyncClient", patched)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    return fake


@pytest.fixture
def env(tmp_path, groq):
    app = create_app(client=SimpleNamespace(messages=None), db_path=str(tmp_path / "t.db"))
    with TestClient(app) as client:
        token = client.post("/api/register", json={"email": "a@example.com", "password": "password123"}).json()["token"]
        yield SimpleNamespace(client=client, h={"Authorization": "Bearer " + token}, groq=groq, app=app)


# ---------------------------------------------------------------- transcription
def test_transcribe_filters_whisper_hallucinations(env):
    r = env.client.post("/api/transcribe?lang=ur", content=b"fake-audio", headers={**env.h, "X-Groq-Key": "gsk_test", "Content-Type": "audio/webm"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert [s["text"] for s in j["segments"]] == ["Hello team, let's begin.", "Budget approve ho gaya."]
    assert "Thank you for watching" not in j["text"]
    assert j["duration"] == 12.5
    sent = env.groq.requests[0]
    assert sent.headers["authorization"] == "Bearer gsk_test"
    body = sent.content
    assert b"whisper-large-v3" in body and b'name="language"' in body  # Urdu uses the accurate model, language hint forwarded
    assert b"whisper-large-v3-turbo" not in body


def test_transcribe_english_uses_fast_model_and_prompt(env):
    env.client.post("/api/transcribe?lang=en&prompt=Aegis%20roadmap", content=b"x", headers={**env.h, "X-Groq-Key": "gsk_test", "Content-Type": "audio/webm"})
    body = env.groq.requests[0].content
    assert b"whisper-large-v3-turbo" in body and b"Aegis roadmap" in body


def test_transcribe_needs_a_key(env):
    r = env.client.post("/api/transcribe", content=b"x", headers={**env.h, "Content-Type": "audio/webm"})
    assert r.status_code == 400 and "Groq key" in r.json()["detail"]


def test_transcribe_uses_server_key_when_set(env, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_server")
    r = env.client.post("/api/transcribe", content=b"x", headers={**env.h, "Content-Type": "audio/webm"})
    assert r.status_code == 200
    assert env.groq.requests[0].headers["authorization"] == "Bearer gsk_server"


def test_transcribe_requires_login(env):
    assert env.client.post("/api/transcribe", content=b"x").status_code == 401


def test_transcribe_rejects_huge_audio_and_empty(env, monkeypatch):
    monkeypatch.setattr(meeting, "MAX_AUDIO_BYTES", 1000)
    h = {**env.h, "X-Groq-Key": "gsk_test", "Content-Type": "audio/webm"}
    assert env.client.post("/api/transcribe", content=b"x" * 5000, headers=h).status_code == 413
    assert env.client.post("/api/transcribe", content=b"", headers=h).status_code == 400
    assert not env.groq.requests


def test_groq_errors_are_friendly_and_never_leak_the_key(env):
    env.groq.stt_status = 401
    r = env.client.post("/api/transcribe", content=b"x", headers={**env.h, "X-Groq-Key": "gsk_secret", "Content-Type": "audio/webm"})
    assert r.status_code == 401 and "rejected" in r.json()["detail"] and "gsk_secret" not in r.text
    env.groq.stt_status = 429
    r = env.client.post("/api/transcribe", content=b"x", headers={**env.h, "X-Groq-Key": "gsk_secret", "Content-Type": "audio/webm"})
    assert r.status_code == 429 and "7 seconds" in r.json()["detail"]


def test_bad_key_characters_refused(env):
    r = env.client.post("/api/transcribe", content=b"x", headers={**env.h, "X-Groq-Key": "gsk_a b", "Content-Type": "audio/webm"})
    assert r.status_code == 400


def test_key_test_endpoint(env):
    r = env.client.post("/api/groq/test", headers={**env.h, "X-Groq-Key": "gsk_test"}).json()
    assert r["ok"] and "whisper-large-v3" in r["whisper"]
    assert env.client.post("/api/groq/test", headers=env.h).json()["ok"] is False  # no key anywhere


def test_server_key_has_a_daily_cap(env, monkeypatch):
    from app import settings
    monkeypatch.setenv("GROQ_API_KEY", "gsk_server")
    monkeypatch.setattr(settings, "SERVER_STT_PER_DAY", 2)
    h = {**env.h, "Content-Type": "audio/webm"}
    assert env.client.post("/api/transcribe", content=b"x", headers=h).status_code == 200
    assert env.client.post("/api/transcribe", content=b"x", headers=h).status_code == 200
    assert env.client.post("/api/transcribe", content=b"x", headers=h).status_code == 429
    # a user's own key is never capped by us
    assert env.client.post("/api/transcribe", content=b"x", headers={**h, "X-Groq-Key": "gsk_mine"}).status_code == 200


# ---------------------------------------------------------------- notes
TRANSCRIPT = "[00:00] Hello team, let's begin the sprint planning.\n[00:30] Budget approve ho gaya. Ali will send the invoice by Thursday."


def test_create_meeting_notes_saved_and_normalised(env):
    r = env.client.post("/api/meetings", json={"transcript": TRANSCRIPT, "duration": 600, "output_lang": "roman"}, headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.status_code == 200, r.text
    j = r.json()
    n = j["notes"]
    assert n["important_points"][0] == {"point": "Budget approved", "importance": "high"}  # sorted by importance
    assert n["action_items"][1] == {"task": "Book the demo room", "owner": "", "due": "", "priority": "medium"}  # plain strings tolerated
    assert n["enhancements"][0]["source"] == "suggested"
    assert "## Action items" in j["markdown"] and "- [ ] Send the invoice" in j["markdown"]
    sys_prompt = json.loads(env.groq.requests[-1].content)["messages"][0]["content"]
    assert "Roman Urdu" in sys_prompt  # the chosen output language reached the model
    # history
    lst = env.client.get("/api/meetings", headers=env.h).json()
    assert len(lst) == 1 and lst[0]["title"] == "Sprint planning"
    full = env.client.get(f"/api/meetings/{j['id']}", headers=env.h).json()
    assert full["transcript"] == TRANSCRIPT and full["notes"]["decisions"] == ["Ship on Friday"]


def test_meeting_action_items_become_tasks(env):
    mid = env.client.post("/api/meetings", json={"transcript": TRANSCRIPT}, headers={**env.h, "X-Groq-Key": "gsk_test"}).json()["id"]
    assert env.client.post(f"/api/meetings/{mid}/tasks", headers=env.h).json() == {"added": 2}
    texts = [t["text"] for t in env.client.get("/api/tasks", headers=env.h).json()]
    assert "Send the invoice (Ali)" in texts and "Book the demo room" in texts


def test_meetings_are_private_per_user(env):
    mid = env.client.post("/api/meetings", json={"transcript": TRANSCRIPT}, headers={**env.h, "X-Groq-Key": "gsk_test"}).json()["id"]
    other = env.client.post("/api/register", json={"email": "b@example.com", "password": "password123"}).json()["token"]
    h2 = {"Authorization": "Bearer " + other}
    assert env.client.get("/api/meetings", headers=h2).json() == []
    assert env.client.get(f"/api/meetings/{mid}", headers=h2).status_code == 404
    assert env.client.delete(f"/api/meetings/{mid}", headers=h2).status_code == 404
    assert env.client.delete(f"/api/meetings/{mid}", headers=env.h).status_code == 200


def test_quick_notes_are_not_saved(env):
    r = env.client.post("/api/meetings", json={"transcript": TRANSCRIPT, "quick": True}, headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.status_code == 200 and "id" not in r.json()
    assert json.loads(env.groq.requests[-1].content)["model"] == meeting.FAST_CHAT_MODEL
    assert env.client.get("/api/meetings", headers=env.h).json() == []


def test_too_short_transcript_is_refused(env):
    r = env.client.post("/api/meetings", json={"transcript": "hi"}, headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.status_code == 400


def test_model_json_in_code_fence_and_junk_is_handled(env):
    env.groq.chat_reply = "Here you go:\n```json\n" + json.dumps({"summary": "ok", "decisions": "just one", "action_items": None}) + "\n```"
    n = env.client.post("/api/meetings", json={"transcript": TRANSCRIPT}, headers={**env.h, "X-Groq-Key": "gsk_test"}).json()["notes"]
    assert n["summary"] == "ok" and n["decisions"] == ["just one"] and n["action_items"] == []
    env.groq.chat_reply = "I cannot do that"
    assert env.client.post("/api/meetings", json={"transcript": TRANSCRIPT}, headers={**env.h, "X-Groq-Key": "gsk_test"}).status_code == 502


def test_long_meeting_is_split_and_merged(env, monkeypatch):
    monkeypatch.setattr(meeting, "CHUNK_CHARS", 300)
    long = "\n".join(f"[{i:02d}:00] Sentence number {i} about the project and budget." for i in range(40))
    assert len(meeting.split_transcript(long, 300)) > 3
    r = env.client.post("/api/meetings", json={"transcript": long}, headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.status_code == 200
    chat_calls = [q for q in env.groq.requests if q.url.path.endswith("/chat/completions")]
    assert len(chat_calls) > 3  # one per part + one merge
    assert "partial" in json.loads(chat_calls[-1].content)["messages"][0]["content"].lower()


# ---------------------------------------------------------------- agent integration
def test_agent_meeting_tools(env):
    from app.agent import Agent
    from app.hub import Hub

    env.client.post("/api/meetings", json={"transcript": TRANSCRIPT, "title": "Sprint planning"}, headers={**env.h, "X-Groq-Key": "gsk_test"})
    agent = Agent(None, env.app.state.db, Hub())
    run = lambda name, **a: asyncio.run(agent._run_server_tool(1, name, a))
    assert "Sprint planning" in run("list_meetings")
    out = run("get_meeting", query="sprint")
    assert "Budget approved" in out and "Send the invoice" in out and out.startswith("[Untrusted")
    assert "Added 2" in run("meeting_actions_to_tasks")
    assert "Deleted task" in run("delete_task", contains="invoice")
    assert "No matches" in run("get_meeting", query="zzz") or "No saved meeting" in run("get_meeting", query="zzz")


def test_groq_is_the_default_ai_when_server_has_only_a_groq_key(tmp_path, groq, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_server")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    app = create_app(client=None, db_path=str(tmp_path / "g.db"))
    with TestClient(app) as c:
        assert c.get("/healthz").json() == {"ok": True, "ai": True, "groq": True}
        assert c.get("/api/config").json()["groq"] is True


# ---------------------------------------------------------------- utilities
def test_parse_search_html():
    html = '''<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1">Example &amp; Co</a>
    <a class="result__snippet" href="x">A <b>great</b> site</a>
    <a rel="nofollow" class="result__a" href="https://other.org/b">Other</a>'''
    rows = utilities.parse_search_html(html)
    assert rows[0] == ("Example & Co", "https://example.com/a", "A great site")
    assert rows[1][1] == "https://other.org/b"


def test_news_headlines_parses_rss(monkeypatch):
    rss = "<rss><channel><item><title>Big news - Dawn</title><source>Dawn</source></item><item><title>Second</title><source>BBC</source></item></channel></rss>"
    monkeypatch.setattr(utilities, "_fetch_raw", lambda *a, **k: rss)
    out = utilities.news_headlines("cricket")
    assert "- Big news - Dawn" in out and "- Second (BBC)" in out


def test_web_search_tool_hidden_when_claude_has_native_search():
    from app import tools
    names = lambda web: {t["name"] for t in tools.schemas(False, web)}
    assert "search_web" in names(False) and "search_web" not in names(True)


def test_voice_turns_get_a_spoken_jarvis_style_prompt(env):
    from app.agent import Agent
    from app.hub import Hub

    agent = Agent(None, env.app.state.db, Hub())
    plain = agent._system(1, "hi", False)
    spoken = agent._system(1, "hi", False, voice=True, callme="boss")
    assert "VOICE CONVERSATION" not in plain
    assert "VOICE CONVERSATION" in spoken and "No markdown" in spoken and 'addressed as "boss"' in spoken


def test_chat_message_voice_flag_reaches_the_session(env):
    seen = {}
    from app import agent as agent_mod

    async def fake_run(self, sess, text, emit):
        seen.update(voice=sess.voice, callme=sess.callme)
        return "ok"

    orig = agent_mod.Agent.run
    agent_mod.Agent.run = fake_run
    try:
        token = env.h["Authorization"].split()[1]
        with env.client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "auth", "token": token})
            ws.send_json({"type": "chat", "text": "hello", "voice": True, "callme": "  sir  "})
            for _ in range(10):
                if ws.receive_json().get("type") == "reply":
                    break
    finally:
        agent_mod.Agent.run = orig
    assert seen == {"voice": True, "callme": "sir"}
