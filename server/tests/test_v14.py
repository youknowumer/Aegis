"""v14: mixed and heavier feelings, more things remembered, one value per slot, smarter recall."""
import time

from test_server import FakeClient, auth, connect, drain_until, env, register, resp, text, tool  # noqa: F401

from app import emotion, heart
from app.db import DB

DAY = 86400


def mk(tmp_path):
    db = DB(str(tmp_path / "h.db"))
    return db, db.create_user("x@example.com", "h", "s")


# ---------------------------------------------------------------- feelings
def test_new_moods_in_english_and_roman_urdu():
    cases = {
        "it is all my fault and i feel guilty about it": "guilty",
        "i feel so jealous of her, why can't i have that": "jealous",
        "what's the point, nothing matters": "hopeless",
        "wow i can't believe it, i am so shocked": "surprised",
        "i am not giving up, i am so determined and motivated": "determined",
        "i feel calm and at peace today": "calm",
        "meri ghalti thi, mujhe afsos hai": "guilty",
    }
    for msg, mood in cases.items():
        assert emotion.detect(msg).mood == mood, msg


def test_hopeless_is_always_heavy_and_gets_careful_guidance():
    r = emotion.detect("what's the point, i feel hopeless")
    assert r.mood == "hopeless" and r.intensity >= 4 and not r.distress
    out = emotion.style_for(r)
    assert "reach someone they trust" in out and "intense" in out


def test_mixed_feelings_are_both_acknowledged():
    r = emotion.detect("i got the job! i'm so happy but also really nervous and worried")
    assert r.secondary and r.secondary != r.mood
    assert {r.mood, r.secondary} & {"anxious", "proud", "happy"}
    assert "mixed feeling" in emotion.style_for(r)
    assert emotion.detect("i am so happy today").secondary == ""


def test_trailing_dots_make_a_sad_message_heavier():
    plain = emotion.detect("i feel sad")
    trailing = emotion.detect("i feel sad...")
    assert trailing.intensity == plain.intensity + 1


def test_casual_never_mind_is_not_read_as_sadness():
    assert emotion.detect("never mind, forget it, do the other one").mood == "neutral"


def test_every_mood_has_a_style_and_a_voice_feeling():
    for mood, (valence, feeling) in emotion.MOODS.items():
        assert valence in ("positive", "negative", "neutral") and feeling
        if mood != "neutral":
            assert mood in emotion._STYLE, mood


# ---------------------------------------------------------------- remembering more
def test_pets_health_fears_favourites_and_life_events_are_picked_up():
    def texts(msg):
        return [m["text"].lower() for m in heart.extract_memories(msg)]
    assert any("dog is called max" in t for t in texts("My dog is named Max"))
    assert any("allergic to peanuts" in t for t in texts("I'm allergic to peanuts"))
    assert any("has asthma" in t or "have asthma" in t for t in texts("I have asthma"))
    assert any("afraid of heights" in t for t in texts("I am scared of heights"))
    assert any("favourite colour is blue" in t for t in texts("my favourite colour is blue"))
    assert any("software engineer" in t for t in texts("I'm a software engineer"))
    assert any("25 years old" in t for t in texts("I am 25 years old"))
    assert any("got married" in t for t in texts("I just got married"))
    assert heart.extract_memories("Is my dog named Max?") == []


# ---------------------------------------------------------------- one value per slot
def test_slots_are_recognised():
    assert heart.slot_of("They live in Lahore") == "home"
    assert heart.slot_of("Their mom is Sana") == heart.slot_of("Their mother is Sana") == "mother"
    assert heart.slot_of("Their favourite colour is blue") == "colour"
    assert heart.slot_of("Their sister is Ayesha") == ""      # people can have several sisters
    assert heart.slot_of("They like pizza") == ""


def test_moving_house_replaces_the_old_city(tmp_path):
    db, uid = mk(tmp_path)
    db.add_fact(uid, "They live in Lahore", "fact", source="auto")
    time.sleep(0.01)
    db.add_fact(uid, "They live in Karachi", "fact", source="auto")
    assert heart.supersede(db, uid, "They live in Karachi") == 1
    texts = [r["text"] for r in db.facts(uid)]
    assert texts == ["They live in Karachi"]


def test_consolidate_keeps_only_the_newest_value_per_slot(tmp_path):
    db, uid = mk(tmp_path)
    db.add_fact(uid, "They work at Acme", "fact")
    db.add_fact(uid, "They work at Globex", "fact")
    db.add_fact(uid, "Their sister is Ayesha", "person")
    db.add_fact(uid, "Their sister is Sana", "person")
    heart.consolidate(db, uid)
    texts = sorted(r["text"] for r in db.facts(uid))
    assert "They work at Globex" in texts and "They work at Acme" not in texts
    assert "Their sister is Ayesha" in texts and "Their sister is Sana" in texts


# ---------------------------------------------------------------- recall
def test_everyday_synonyms_find_the_right_memory(tmp_path):
    db, uid = mk(tmp_path)
    db.add_fact(uid, "Their mother is Sana", "person", True)
    for i in range(20):
        db.add_fact(uid, f"They like topic number {i} very much indeed", "preference")
    top = heart.select_memories(db.facts(uid), "what is my mom's name", limit=3)
    assert any("mother is Sana" in r["text"] for r in top[:2])
    top = heart.select_memories(db.facts(uid), "when is my bday", limit=3)
    assert len(top) == 3


def test_important_and_often_used_memories_are_flagged_to_the_ai(tmp_path):
    db, uid = mk(tmp_path)
    fid = db.add_fact(uid, "Their wife is Hira", "person", True)
    db.execute("UPDATE facts SET weight = 3, uses = 6 WHERE id = ?", (fid,))
    out = heart.format_memories(db.facts(uid))
    assert "important to them" in out and "comes up often" in out
