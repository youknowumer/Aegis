"""Emotional intelligence for Aegis: read how the user feels, remember it over time, and shape the reply.

Everything here is plain Python (no extra AI call): a multilingual word list (English, Roman Urdu, Urdu, Hindi, Arabic)
gives a quick read of each message. The AI can add its own reading with the `note_mood` tool for anything the list misses.
Only the mood name, its strength and the time are stored automatically, never the user's words.
"""
import re
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from . import utilities

# mood -> (valence, the feeling Aegis shows back; one of the voice tags the app understands)
MOODS: Dict[str, tuple] = {
    "happy": ("positive", "joy"),
    "excited": ("positive", "excited"),
    "proud": ("positive", "joy"),
    "grateful": ("positive", "warm"),
    "stressed": ("negative", "calm"),
    "anxious": ("negative", "concern"),
    "sad": ("negative", "empathy"),
    "lonely": ("negative", "empathy"),
    "angry": ("negative", "calm"),
    "tired": ("negative", "warm"),
    "distressed": ("negative", "concern"),
    "neutral": ("neutral", "calm"),
}

# Single words (matched as whole words) and phrases (matched inside the text).
_WORDS = {
    "happy": "happy glad delighted cheerful great awesome wonderful khush khushi mast zabardast shandar maza mazay "
             "خوش خوشی مزہ زبردست شاندار سعید खुश बढ़िया मज़ा فرحان سعيد مبسوط",
    "excited": "excited thrilled pumped cantwait can't-wait eager josh pursoz پرجوش उत्साहित متحمس",
    "proud": "proud accomplished achieved nailed promoted fakhar fakhr فخر गर्व فخور",
    "grateful": "thanks thankyou grateful thankful appreciate shukriya shukria mehrbani jazakallah شکریہ مہربانی धन्यवाद शुक्रिया شكرا جزاك",
    "stressed": "stressed stress overwhelmed deadline swamped tension pareshan pareshaani preshan تناؤ پریشان پریشانی दबाव परेशान ضغط",
    "anxious": "anxious anxiety nervous worried worry scared afraid panic dar darr ghabrahat ghabra ڈر گھبراہٹ فکر डर घबराहट चिंता قلق خايف خائف",
    "sad": "sad unhappy depressed crying cried heartbroken hurt gloomy udaas udas dukhi dukh gham ro rona rohi اداس غم دکھ رونا दुखी उदास दर्द حزين حزينة زعلان",
    "lonely": "lonely alone isolated akela akeli tanha tanhai اکیلا اکیلی تنہا تنہائی अकेला अकेली وحيد",
    "angry": "angry furious mad annoyed irritated frustrated hate gussa ghussa naraz nafrat غصہ ناراض نفرت गुस्सा नाराज़ غاضب",
    "tired": "tired exhausted sleepy drained burnt burned-out burnout thak thaka thaki thakan neend تھکا تھکی تھکاوٹ نیند थका थकान تعبان مرهق",
}
_PHRASES = {
    "happy": ["so good", "feeling good", "best day", "bohat acha", "bahut accha", "bohat khush", "mood acha", "acha lag raha"],
    "excited": ["can't wait", "cant wait", "so excited"],
    "proud": ["i did it", "i got the job", "i passed", "got promoted", "kar dikhaya"],
    "grateful": ["thank you", "thanks a lot", "bohat shukriya", "bahut shukriya"],
    "stressed": ["too much work", "too much to do", "bohat kaam", "kaam ka pressure", "can't cope", "cannot cope", "sar dard", "dimaag kharab"],
    "anxious": ["freaking out", "what if", "mujhe dar lag", "ڈر لگ رہا", "dar lag raha", "dar lag rahi"],
    "sad": ["feel down", "feeling low", "not okay", "not ok", "dil toot", "dil bhara", "mann udaas", "mood kharab", "mood off", "dil dukh", "جی اداس", "دل ٹوٹ"],
    "lonely": ["no one cares", "nobody cares", "no friends", "koi nahi hai", "koi nahin hai", "kisi ko parwah nahi"],
    "angry": ["fed up", "sick of", "had enough", "bohat gussa", "bahut gussa", "pagal kar diya"],
    "tired": ["worn out", "no energy", "need sleep", "bohat thak", "bahut thak", "thak gaya", "thak gayi", "thak gaya hoon"],
}
# Danger signs. These beat everything else: the reply must be about the person, not the task.
_DISTRESS = [
    "kill myself", "end my life", "want to die", "wanna die", "suicide", "suicidal", "hurt myself", "harm myself", "self harm",
    "no reason to live", "better off without me", "khud kushi", "khudkushi", "khudkushi", "jaan de", "marna chahta", "marna chahti",
    "mar jana chahta", "mar jana chahti", "zindagi khatam", "خودکشی", "مرنا چاہتا", "مرنا چاہتی", "जान दे", "आत्महत्या", "मरना चाहता", "انتحار", "اقتل نفسي",
]
_INTENSIFIERS = set(
    "very really so extremely totally completely super too bohat bahut boht behad bilkul itna itni zyada "
    "بہت بے حد انتہائی بالکل بहुत बेहद حقا جدا".split()
)
_NEGATIONS = set("not never no isnt isn't dont don't cant can't nahi nahin nai na نہیں نا نہ नहीं ना مش لا".split())

_WORD_INDEX: Dict[str, str] = {}
for _m, _ws in _WORDS.items():
    for _w in _ws.split():
        _WORD_INDEX.setdefault(_w.lower(), _m)


@dataclass
class Reading:
    mood: str = "neutral"
    intensity: int = 0  # 0 none, 1 mild, 2 clear, 3 strong
    distress: bool = False

    @property
    def valence(self) -> str:
        return MOODS[self.mood][0]

    @property
    def feeling(self) -> str:
        return MOODS[self.mood][1]


def detect(text: str) -> Reading:
    """Read the feeling in one message. Cheap and good enough to steer the tone; never used to judge or diagnose."""
    low = " " + " ".join(str(text or "").lower().split()) + " "
    if any(p in low for p in _DISTRESS):
        return Reading("distressed", 3, True)

    tokens = re.findall(r"[\w']+", low)
    score: Counter = Counter()
    for i, tok in enumerate(tokens):
        mood = _WORD_INDEX.get(tok)
        if not mood:
            continue
        window = tokens[max(0, i - 3):i]
        if any(w in _NEGATIONS for w in window):
            if MOODS[mood][0] == "positive":
                score["sad"] += 1  # "not happy"
            continue  # "not sad" is simply not counted
        weight = 1 + (1 if any(w in _INTENSIFIERS for w in window) else 0)
        score[mood] += weight
    for mood, phrases in _PHRASES.items():
        for p in phrases:
            if p in low:
                score[mood] += 2
    if not score:
        return Reading()
    mood, top = score.most_common(1)[0]
    strong = top >= 3 or "!!" in low or any(len(w) > 3 and w.isupper() for w in re.findall(r"[A-Z]{4,}", str(text or "")))
    intensity = 3 if (top >= 4 or (strong and top >= 2)) else 2 if (top >= 2 or strong) else 1
    return Reading(mood, intensity)


# ---------------------------------------------------------------- what the AI is told

_STYLE = {
    "happy": "They sound happy. Share it with them in one genuine sentence before anything else.",
    "excited": "They are excited. Match their energy and celebrate with them.",
    "proud": "They are proud of something. Congratulate them warmly and ask about it if it fits.",
    "grateful": "They are thankful. Accept it graciously and simply; do not over-explain.",
    "stressed": "They sound stressed. Stay calm and steady, offer to take one thing off their plate, keep the answer short and clear.",
    "anxious": "They sound anxious. Be reassuring and grounded, do not add alarm, break things into small steps.",
    "sad": "They sound sad. Slow down, be gentle, acknowledge the feeling first and do not rush to fix or cheer them up.",
    "lonely": "They sound lonely. Be present and kind, show you are listening, and keep the conversation going with a soft question.",
    "angry": "They sound angry. Stay calm, never argue back, acknowledge the frustration and then help.",
    "tired": "They sound tired. Keep it short and easy, be gentle, and suggest rest if it is natural.",
    "distressed": (
        "IMPORTANT: they may be in real danger or talking about hurting themselves. Drop any task. Respond with warmth and calm, say you are "
        "glad they told you, ask gently if they are safe right now, encourage them to reach someone they trust or local emergency services "
        "or a crisis line, and stay with them. Do not lecture, do not diagnose, do not use tools."
    ),
}


def style_for(reading: Reading) -> str:
    if reading.mood == "neutral" or not reading.intensity:
        return ""
    strength = {1: "a little", 2: "clearly", 3: "strongly"}[reading.intensity]
    return f"How they seem right now: {reading.mood} ({strength}). {_STYLE[reading.mood]}"


def _day(ts: float, tz: str):
    return datetime.fromtimestamp(ts, utilities.get_zone(tz)).date()


def summarize(rows: List[dict], tz: str = "", days: int = 7, now: Optional[float] = None) -> str:
    """'Past 7 days: mostly stressed (3), tired (2). Yesterday: sad.' Empty when there is nothing to say."""
    now = now or time.time()
    cutoff = now - days * 86400
    rows = [r for r in rows if r["created"] >= cutoff and r["mood"] != "neutral"]
    if not rows:
        return ""
    counts = Counter(r["mood"] for r in rows)
    top = ", ".join(f"{m} ({n})" for m, n in counts.most_common(3))
    out = f"Past {days} days: mostly {top}."
    today = _day(now, tz)
    by_day: Dict[object, Counter] = {}
    for r in rows:
        by_day.setdefault(_day(r["created"], tz), Counter())[r["mood"]] += 1
    y = today - timedelta(days=1)
    if y in by_day:
        out += f" Yesterday: {by_day[y].most_common(1)[0][0]}."
    if today in by_day:
        out += f" Today so far: {by_day[today].most_common(1)[0][0]}."
    return out


def checkin_hint(rows: List[dict], tz: str = "", now: Optional[float] = None) -> str:
    """If the last strong negative mood was from an earlier day (within 3 days) suggest ONE gentle, natural check-in."""
    now = now or time.time()
    today = _day(now, tz)
    for r in rows:  # newest first
        if r["mood"] == "neutral":
            continue
        d = _day(r["created"], tz)
        if d == today:
            return ""  # they already talked today: no "how are you feeling" ambush
        if MOODS.get(r["mood"], ("",))[0] == "negative" and r["intensity"] >= 2 and (today - d).days <= 3:
            when = "yesterday" if (today - d).days == 1 else f"{(today - d).days} days ago"
            return (
                f"Check-in: {when} they seemed {r['mood']}. If it fits the start of this conversation, ask once, gently and in your "
                "own words, how they are feeling now. Do not mention that you tracked it, and drop it if they want to talk about something else."
            )
        return ""
    return ""
