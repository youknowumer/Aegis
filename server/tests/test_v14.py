"""v14: the voice brain on the server: how they sounded, deep thinking, spoken-language hint and the conversation recap memory."""
import asyncio
import time
from types import SimpleNamespace

from test_server import FakeClient, auth, connect, drain_until, env, register, resp, text, tool  # noqa: F401

from app.agent import Agent, Session
from app.db import DB
from app.hub import Hub


def mk(tmp_path, script=()):
    db = DB(str(tmp_path / "v14.db"))
    uid = db.create_user("x@example.com", "h", "s")
    fake = FakeClient(script)
    agent = Agent(fake, db, Hub())
    sess = Session(uid, None, [])
    return db, uid, fake, agent, sess


def system_for(agent, uid, **kw):
    return agent._system(uid, "hello", False, "Asia/Karachi", False, kw.pop("voice", True), "", None, None, **kw)


def test_voice_sound_shapes_the_prompt_only_for_spoken_turns(tmp_path):
    db, uid, fake, agent, sess = mk(tmp_path)
    tired = system_for(agent, uid, vibe={"pace": "slow", "energy": "low"})
    assert "tired, down or distracted" in tired and "never mention it" in tired
    unsure = system_for(agent, uid, vibe={"hesitant": True})
    assert "hesitated" in unsure
    fast = system_for(agent, uid, vibe={"pace": "fast", "energy": "normal"})
    assert "quick, upbeat" in fast
    typed = system_for(agent, uid, voice=False, vibe={"pace": "slow", "energy": "low"})
    assert "SOUNDED" not in typed                       # typed messages have no voice to read
    assert "SOUNDED" not in system_for(agent, uid, vibe={})


def test_deep_thinking_and_spoken_language_hints(tmp_path):
    db, uid, fake, agent, sess = mk(tmp_path)
    assert "THINK DEEPLY" in system_for(agent, uid, deep=True)
    assert "THINK DEEPLY" not in system_for(agent, uid)
    assert "Roman Urdu" in system_for(agent, uid, lang="roman-urdu")
    assert "Spanish" in system_for(agent, uid, lang="es")


def test_websocket_sanitises_vibe_and_deep(env):
    c = env.client
    token = register(c)
    env.fake.script = [resp(text("[calm] Okay."))]
    ws, s = connect(c, token)
    try:
        drain_until(s, "hello")
        s.send_json({"type": "chat", "text": "hi there", "voice": True, "lang": "ur", "deep": True,
                     "vibe": {"pace": "slow", "energy": "<script>", "hesitant": True, "evil": "x"}})
        drain_until(s, "reply")
    finally:
        ws.__exit__(None, None, None)
    system = env.fake.calls[0]["system"]
    assert "THINK DEEPLY" in system and "Urdu" in system and "hesitated" in system and "evil" not in system and "<script>" not in system


def test_recap_is_saved_as_an_episode_memory(tmp_path):
    db, uid, fake, agent, sess = mk(tmp_path, [resp(text("They planned next week's Odoo demo and felt a little nervous."))])
    for i, line in enumerate(["I have an Odoo demo next week", "can you help me prepare slides", "I am a bit nervous about it"]):
        sess.history.append({"role": "user", "content": line})
        sess.history.append({"role": "assistant", "content": [text("[warm] Sure.")]})
    out = asyncio.run(agent.recap(sess))
    assert "Odoo demo" in out
    kinds = {r["kind"]: r["text"] for r in db.facts(uid)}
    assert kinds["episode"].startswith("Last talk:") and "Odoo demo" in kinds["episode"]
    assert asyncio.run(agent.recap(sess)) == ""          # not again within ten minutes
    assert len(fake.calls) == 1


def test_short_chats_are_not_recapped(tmp_path):
    db, uid, fake, agent, sess = mk(tmp_path, [resp(text("never used"))])
    sess.history.append({"role": "user", "content": "hello"})
    assert asyncio.run(agent.recap(sess)) == ""
    assert fake.calls == []


def test_wrap_message_over_the_websocket(env):
    c = env.client
    token = register(c)
    env.fake.script = [resp(text("[calm] One.")), resp(text("[calm] Two.")), resp(text("[calm] Three.")), resp(text("They chatted about three small things."))]
    ws, s = connect(c, token)
    try:
        drain_until(s, "hello")
        for i in range(3):
            s.send_json({"type": "chat", "text": f"message number {i}", "voice": True})
            drain_until(s, "reply")
        s.send_json({"type": "wrap"})
        for _ in range(50):
            if len(env.fake.calls) >= 4:
                break
            time.sleep(0.05)
    finally:
        ws.__exit__(None, None, None)
    assert len(env.fake.calls) == 4 and "recaps this conversation" in env.fake.calls[3]["system"]
