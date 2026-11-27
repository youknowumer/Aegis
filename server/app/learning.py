"""v19 "learning": Aegis adapts to how THIS user likes to be helped, and prepares their chats as training data.

What it does (all plain Python, no extra AI call, nothing leaves the server):
- detect_lessons: standing rules and corrections said in passing ("from now on keep answers short", "stop calling me sir",
  "urdu mein jawab do", "no, I meant ...") become *lessons* that are shown to the AI on every turn.
- style_profile: habits learned from the numbers (how long they write, what they thumbs-up or down, what they use most).
- redact / training_jsonl / modelfile: turn the (redacted) conversation log into a fine-tuning dataset or an Ollama Modelfile.

Honest limit: this does not change model weights while you chat. It changes behaviour at once (lessons + memory + style in the
prompt) and gives you clean data to fine-tune a model of your own later.
"""
import json
import re
import time
from typing import Dict, List, Optional

from . import settings

MAX_ACTIVE = 60          # lessons kept per user
MAX_SHOWN = 12           # lessons shown to the AI per turn
SLOTS = ("length", "language", "tone", "address", "format")

# ------------------------------------------------------------------ detection
_LANGS = {
    "urdu": "Urdu (Urdu script)", "roman urdu": "Roman Urdu", "english": "English", "hindi": "Hindi", "arabic": "Arabic",
    "spanish": "Spanish", "french": "French", "german": "German", "punjabi": "Punjabi", "persian": "Persian", "turkish": "Turkish",
}
_BEHAVE = ("call", "say", "saying", "use", "using", "explain", "explaining", "apologize", "apologise", "apologizing", "apologising", "repeat", "repeating",
           "ask", "asking", "speak", "speaking", "be", "give", "add", "write", "reply", "answer", "respond", "interrupt", "summarize", "summarise",
           "mention", "bring", "talk", "sound", "over", "read", "start", "end", "sugarcoat", "lecture", "joke", "joking", "greet", "greeting", "emoji")
_TASKY = re.compile(r"\b(forget|remind|worry|miss|let me|go |buy|call (?:him|her|them|mom|dad|ali)|leave)\b", re.I)


def _clean(t: str, n: int = 140) -> str:
    return re.sub(r"\s+", " ", str(t or "")).strip(" .,!?:;")[:n]


def _lang_name(w: str) -> str:
    w = w.lower().strip()
    return _LANGS.get(w, "")


def detect_lessons(text: str, prev_user: str = "") -> List[dict]:
    """Standing instructions in one message -> [{text, kind, slot}]. Conservative: questions and one-off tasks are ignored."""
    raw = " ".join(str(text or "").split())
    if not raw or len(raw) > 300 or raw.endswith("?"):
        return []
    low = raw.lower()
    out: List[dict] = []

    def add(t, kind="rule", slot=""):
        t = _clean(t)
        if t and not any(o["text"].lower() == t.lower() for o in out):
            out.append({"text": t, "kind": kind, "slot": slot})

    # length
    if re.search(r"\b(?:keep|make)\b.{0,25}\b(?:short|shorter|brief|concise|crisp)\b|\b(?:short|brief|concise)\s+(?:answers?|replies|responses)\b|\btoo (?:long|wordy|chatty)\b|\bless (?:talking|words)\b|jawab\s+(?:chhota|chota|mukhtasar|short)", low):
        add("Keep replies short and to the point", "style", "length")
    elif re.search(r"\b(?:more|longer)\s+(?:detail|detailed|in.?depth|thorough)\b|\bexplain (?:more|in detail)\b|\btoo (?:short|brief|vague)\b|\b(?:detailed|longer)\s+(?:answers?|replies|responses)\b|tafseel se", low):
        add("Give fuller, more detailed answers", "style", "length")
    # tone
    m = re.search(r"\b(?:be|sound|talk)\s+(?:a bit |a little |much |way )?(?:more\s+)?(casual|formal|direct|gentle|funny|serious|professional|friendly|blunt|warm|playful)\b", low)
    if m:
        add(f"Be more {m.group(1)} in tone", "style", "tone")
    if re.search(r"\btoo (?:formal|robotic|stiff)\b|\bless (?:formal|robotic)\b", low):
        add("Be less formal and more natural", "style", "tone")
    if re.search(r"\b(?:stop|don'?t|do not|no need to)\s+(?:be\s+)?(?:apologi[sz]ing|saying sorry|sorry)\b", low):
        add("Do not apologise repeatedly", "rule", "tone")
    # language
    m = re.search(r"\b(?:reply|answer|respond|talk|speak|write)\b.{0,20}\bin\s+(roman urdu|urdu|english|hindi|arabic|spanish|french|german|punjabi|persian|turkish)\b", low)
    m2 = re.search(r"\b(roman urdu|urdu|english|hindi|arabic|spanish|french|german|punjabi|persian|turkish)\s+(?:mein|me|main)\s+(?:jawab|baat|reply|bolo|likho)", low)
    mm = m or m2
    if mm and not re.search(r"\btranslate\b|\bhow (?:do|would) you say\b", low):
        add(f"Reply in {_lang_name(mm.group(1))}", "style", "language")
    # how to address them
    m = re.search(r"\b(?:don'?t|do not|stop|never)\s+call(?:ing)?\s+me\s+([\w' -]{2,20})", low)
    if m:
        add(f"Do not call them \"{_clean(m.group(1), 20)}\"", "rule", "address")
    # format
    if re.search(r"\b(?:no|stop (?:using)?|don'?t use|without)\s+(?:bullet|bullets|bullet points|lists|markdown|emojis?)\b", low):
        add("Avoid bullet lists, markdown and emoji; write plain sentences", "style", "format")
    if re.search(r"\b(?:use|give me|prefer)\s+(?:bullet points|bullets|lists)\b", low):
        add("Prefer bullet points for lists and comparisons", "style", "format")
    # explicit standing orders
    m = re.match(r"^(?:ok(?:ay)?[, ]+|please[, ]+)?(?:from now on|going forward|in future|in the future|henceforth|hamesha|aage se|aaj se|ab se|always|never)\b[, ]*(.{4,140})$", raw, re.I)
    if m and not _TASKY.search(raw) and not out:
        lead = re.match(r"^(?:ok(?:ay)?[, ]+|please[, ]+)?(always|never)\b", raw, re.I)
        add((lead.group(1).capitalize() + " " if lead else "") + m.group(1))
    # "don't / stop <assistant behaviour>" at the start of a message
    m = re.match(r"^(?:please\s+)?(?:don'?t|do not|dont|stop|quit)\s+(?:be\s+|so\s+)?(\w+)\b(.{0,80})$", raw, re.I)
    if m and m.group(1).lower() in _BEHAVE and not _TASKY.search(raw) and not out:
        add(("Do not " if re.match(r"^(?:please\s+)?(?:don|do not|dont)", raw, re.I) else "Stop ") + m.group(1).lower() + m.group(2))
    # corrections of the last answer (kept only with the question they belong to)
    if not out and prev_user and re.match(r"^(?:no[, ]+(?:i meant|i said|that'?s not|that is not|not that)|that'?s (?:wrong|not right|incorrect)|galat|nahi[, ]+mera matlab)", low):
        add("When they asked '" + _clean(prev_user, 50) + "' they corrected you: '" + _clean(raw, 60) + "'", "correction", "")
    return out[:3]


def _tok(t: str) -> set:
    return set(re.findall(r"\w+", str(t).lower()))


def learn(db, uid: int, text: str, prev_user: str = "", source: str = "auto") -> List[dict]:
    """Detect and store lessons. Returns the ones saved."""
    if not enabled(db, uid):
        return []
    saved = []
    for l in detect_lessons(text, prev_user):
        db.add_lesson(uid, l["text"], l["kind"], l["slot"], source)
        saved.append(l)
    return saved


# ------------------------------------------------------------------ switches
def enabled(db, uid: int) -> bool:
    if not settings.LEARNING:
        return False
    return db.get_pref(uid, "learn", "1") != "0"


# ------------------------------------------------------------------ the prompt block
def lessons_block(rows: List[dict], limit: int = MAX_SHOWN) -> str:
    rows = [r for r in rows if r.get("active", 1)]
    if not rows:
        return ""
    now = time.time()
    rows.sort(key=lambda r: (-(r["weight"] + (2 if r["kind"] in ("rule", "style") else 0)), -max(r["created"], r.get("last_used", 0))))
    live = [r for r in rows if r["kind"] != "correction" or now - r["created"] < 30 * 86400][:limit]
    if not live:
        return ""
    return ("\nHow THIS user wants you to behave (they told you, or you learned it from their feedback: follow it unless they change it, and never mention this list):\n"
            + "\n".join("- " + r["text"] for r in live) + "\n")


def _median(xs: List[int]) -> float:
    xs = sorted(xs)
    return float(xs[len(xs) // 2]) if xs else 0.0


def style_profile(rows: List[dict], tools_used: Optional[Dict[str, int]] = None) -> str:
    """Habits read from numbers: message length, thumbs, favourite tools. Needs at least 8 conversations."""
    rows = [r for r in rows if r.get("source", "ai") == "ai" and r.get("reply")]
    if len(rows) < 8:
        return ""
    bits = []
    med = _median([len(r["user_text"].split()) for r in rows[:60]])
    if med and med <= 5:
        bits.append("they write very short messages, so keep replies brief")
    elif med >= 30:
        bits.append("they write long, detailed messages, so a fuller answer is welcome")
    up = [len(r["reply"].split()) for r in rows if r["rating"] > 0]
    down = [len(r["reply"].split()) for r in rows if r["rating"] < 0]
    if len(up) >= 2 and len(down) >= 2:
        a, b = sum(up) / len(up), sum(down) / len(down)
        if b > a * 1.4:
            bits.append("replies they liked were shorter than the ones they disliked: be briefer")
        elif a > b * 1.4:
            bits.append("replies they liked were fuller than the ones they disliked: give a bit more")
    voice = sum(1 for r in rows[:60] if r["voice"])
    if voice >= 0.7 * min(60, len(rows)):
        bits.append("they mostly talk by voice: speak naturally, no formatting")
    if tools_used:
        top = [k for k, v in sorted(tools_used.items(), key=lambda kv: -kv[1]) if v >= 4][:3]
        if top:
            bits.append("tools they use most: " + ", ".join(top))
    return ("\nHabits learned from their history (private, shape your style, never recite): " + "; ".join(bits) + ".\n") if bits else ""


# ------------------------------------------------------------------ redaction and export
_SECRET = [
    (re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b"), "[email]"),
    (re.compile(r"\b(?:sk|gsk|xai|pk|rk|ghp|AIza)[-_A-Za-z0-9]{16,}\b"), "[key]"),
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[number]"),
    (re.compile(r"(?<!\w)\+?\d[\d ()-]{8,}\d\b"), "[phone]"),
    (re.compile(r"(?i)\b(password|passcode|pin|otp|cvv|token|secret)\b\s*(?:is|=|:)?\s*\S+"), r"\1 [hidden]"),
]


def redact(text: str) -> str:
    t = str(text or "")
    for rx, sub in _SECRET:
        t = rx.sub(sub, t)
    return t


PERSONA = ("You are Aegis, a warm, sharp personal voice assistant. Answer directly in plain spoken sentences, "
           "in the language and script the user writes in.")


def system_for_training(lessons: List[dict]) -> str:
    rules = [r["text"] for r in lessons if r.get("active", 1) and r["kind"] != "correction"][:MAX_SHOWN]
    return PERSONA + ((" The user's standing preferences: " + "; ".join(rules) + ".") if rules else "")


def training_rows(rows: List[dict], include_unrated: bool = True) -> List[dict]:
    """Clean, deduplicated (user, reply) pairs: thumbs-down and fast-path or empty replies are left out."""
    seen, out = set(), []
    for r in sorted(rows, key=lambda r: r["ts"]):
        if r["rating"] < 0 or r.get("source", "ai") != "ai" or not r["reply"] or (r["rating"] == 0 and not include_unrated):
            continue
        u, a = redact(r["user_text"]).strip(), redact(re.sub(r"\[(?:calm|warm|joy|excited|curious|empathy|concern|urgent|confident)\]\s*", "", r["reply"])).strip()
        if len(u) < 2 or len(a) < 2 or (u, a) in seen:
            continue
        seen.add((u, a))
        out.append({"user": u, "assistant": a, "rating": r["rating"]})
    return out


def training_jsonl(rows: List[dict], lessons: List[dict], fmt: str = "openai", include_unrated: bool = True) -> str:
    """fmt: openai (chat messages; works for OpenAI, Together, Fireworks, Mistral, Unsloth chat templates), alpaca (instruction/output),
    kto (prompt/completion/label from thumbs up and down: needs ratings)."""
    fmt = fmt if fmt in ("openai", "alpaca", "kto") else "openai"
    sysmsg = system_for_training(lessons)
    lines = []
    if fmt == "kto":
        for r in sorted(rows, key=lambda r: r["ts"]):
            if r["rating"] == 0 or r.get("source", "ai") != "ai" or not r["reply"]:
                continue
            lines.append({"prompt": [{"role": "system", "content": sysmsg}, {"role": "user", "content": redact(r["user_text"])}],
                          "completion": [{"role": "assistant", "content": redact(r["reply"])}], "label": r["rating"] > 0})
    else:
        for p in training_rows(rows, include_unrated):
            if fmt == "alpaca":
                lines.append({"instruction": p["user"], "input": "", "output": p["assistant"], "system": sysmsg})
            else:
                lines.append({"messages": [{"role": "system", "content": sysmsg}, {"role": "user", "content": p["user"]}, {"role": "assistant", "content": p["assistant"]}]})
    return "\n".join(json.dumps(l, ensure_ascii=False) for l in lines) + ("\n" if lines else "")


def modelfile(lessons: List[dict], base: str = "llama3.1") -> str:
    """An Ollama Modelfile: a personal model made instantly by baking their persona and rules into the system prompt."""
    sysmsg = system_for_training(lessons).replace('"""', "'''")
    return f'FROM {base}\nPARAMETER temperature 0.7\nSYSTEM """{sysmsg}"""\n'
