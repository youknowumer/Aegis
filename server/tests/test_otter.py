"""Otter-style meeting extras: search, ask, speakers, highlights, share link, exports, follow-up email. Groq is faked."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_meetings import NOTES, env, groq  # noqa: E402,F401  (fixtures)

from app import otter  # noqa: E402

TRANSCRIPT = "[0:00] Hello team, let's begin with pricing.\n[0:05] Pricing goes up ten percent in March.\n[0:12] Who owns the invoice? Ali does.\n[1:03] Great, thanks everyone."


def _make(env, title="Pricing sync"):
    r = env.client.post("/api/meetings", json={"transcript": TRANSCRIPT, "title": title, "duration": 70}, headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_parse_and_exports():
    lines = otter.parse_lines(TRANSCRIPT)
    assert [l["t"] for l in lines] == [0.0, 5.0, 12.0, 63.0]
    ex = {"labels": [1, 1, 2, 1], "names": {"1": "Sara", "2": "Ali"}, "highlights": [1], "comments": [], "tags": []}
    txt = otter.to_txt("Pricing", TRANSCRIPT, ex)
    assert "Sara: Hello team" in txt and "★ [0:05]" in txt and "Ali: Who owns" in txt
    srt = otter.to_srt(TRANSCRIPT, ex)
    assert "00:00:00,000 --> 00:00:05,000" in srt and "Ali: Who owns the invoice?" in srt
    assert otter.to_vtt(TRANSCRIPT, ex).startswith("WEBVTT")


def test_insights_talk_time_and_keywords():
    ex = {"labels": [1, 1, 2, 1], "names": {"1": "Sara"}}
    i = otter.insights(TRANSCRIPT, ex, 70)
    assert i["questions"] == 1 and i["lines"] == 4
    assert {s["name"] for s in i["speakers"]} == {"Sara", "Speaker 2"}
    assert sum(s["share"] for s in i["speakers"]) in (99, 100, 101)
    assert "pricing" in i["keywords"]


def test_search_and_requires_login(env):
    _make(env)
    r = env.client.get("/api/meetings/search?q=invoice", headers=env.h)
    assert r.status_code == 200 and r.json()[0]["title"] and "invoice" in r.json()[0]["snippet"].lower()
    assert env.client.get("/api/meetings/search?q=zzzqqq", headers=env.h).json() == []
    assert env.client.get("/api/meetings/search?q=invoice").status_code == 401


def test_ask_one_and_all(env):
    mid = _make(env)
    env.groq.chat_reply = "Pricing goes up 10% in March [0:05]."
    r = env.client.post("/api/meetings/ask", json={"question": "When does pricing change?", "mid": mid}, headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.status_code == 200 and "March" in r.json()["answer"]
    sent = json.loads(env.groq.requests[-1].content)
    assert "Pricing goes up ten percent" in sent["messages"][1]["content"]  # the transcript really reached the model
    r = env.client.post("/api/meetings/ask", json={"question": "what about pricing"}, headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.status_code == 200 and r.json()["sources"][0]["id"] == mid
    assert env.client.post("/api/meetings/ask", json={"question": "x"}, headers={**env.h, "X-Groq-Key": "gsk_test"}).status_code == 400


def test_speakers_highlights_comments_roundtrip(env):
    mid = _make(env)
    env.groq.chat_reply = json.dumps({"names": {"1": "Sara", "2": "Ali"}, "labels": [1, 1, 2, 1]})
    r = env.client.post(f"/api/meetings/{mid}/speakers", headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.status_code == 200 and r.json()["labels"] == [1, 1, 2, 1] and r.json()["names"]["2"] == "Ali"
    r = env.client.put(f"/api/meetings/{mid}/extra", headers=env.h, json={"labels": [1, 1, 2, 1], "names": {"1": "Sara Khan", "2": "Ali"}, "highlights": [1, 99], "comments": [{"line": 2, "text": "Follow up"}, {"line": 50, "text": "bad"}], "tags": ["pricing"], "title": "Pricing v2"})
    j = r.json()
    assert j["highlights"] == [1] and len(j["comments"]) == 1 and j["names"]["1"] == "Sara Khan"  # out-of-range entries dropped
    got = env.client.get(f"/api/meetings/{mid}", headers=env.h).json()
    assert got["title"] == "Pricing v2" and got["extra"]["tags"] == ["pricing"]
    assert "Sara Khan: Hello team" in env.client.get(f"/api/meetings/{mid}/export?fmt=txt", headers=env.h).text


def test_labels_are_padded_when_model_returns_too_few(env):
    mid = _make(env)
    env.groq.chat_reply = json.dumps({"names": {}, "labels": [1, 2]})
    r = env.client.post(f"/api/meetings/{mid}/speakers", headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.json()["labels"] == [1, 2, 2, 2]


def test_share_link_is_public_readonly_and_revocable(env):
    mid = _make(env, "<b>Pricing</b>")
    tok = env.client.post(f"/api/meetings/{mid}/share", headers=env.h).json()["token"]
    assert len(tok) >= 16
    page = env.client.get("/shared/" + tok)  # no auth header on purpose
    assert page.status_code == 200 and "Budget approved" in page.text and "<b>Pricing</b>" not in page.text and "noindex" in page.text
    assert page.headers["cache-control"] == "no-store"
    assert env.client.get("/shared/not-a-real-token-123456").status_code == 404
    assert env.client.delete(f"/api/meetings/{mid}/share", headers=env.h).status_code == 200
    assert env.client.get("/shared/" + tok).status_code == 404


def test_other_users_cannot_touch_my_meeting(env):
    mid = _make(env)
    t2 = env.client.post("/api/register", json={"email": "b@example.com", "password": "password123"}).json()["token"]
    h2 = {"Authorization": "Bearer " + t2, "X-Groq-Key": "gsk_test"}
    for method, path in (("get", "extra"), ("post", "share"), ("get", "export?fmt=txt"), ("post", "followup"), ("post", "speakers")):
        kw = {"json": {}} if method == "post" else {}
        assert getattr(env.client, method)(f"/api/meetings/{mid}/{path}", headers=h2, **kw).status_code == 404, path
    assert env.client.get("/api/meetings/search?q=invoice", headers=h2).json() == []


def test_followup_email(env):
    mid = _make(env)
    env.groq.chat_reply = json.dumps({"subject": "Follow-up: Pricing", "body": "Hi all,\nThanks."})
    r = env.client.post(f"/api/meetings/{mid}/followup", json={"tone": "short"}, headers={**env.h, "X-Groq-Key": "gsk_test"})
    assert r.status_code == 200 and r.json()["subject"] == "Follow-up: Pricing"
