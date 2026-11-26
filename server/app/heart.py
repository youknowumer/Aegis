"""v13 "heart": memory that behaves like a person's, and a bond that grows.

- extract_memories: pick up names, people, dates, plans and losses from what the user says, without waiting for the AI.
- select_memories / format_memories: what to bring to mind right now (relevance, importance, how strongly it was felt,
  how recent, how often it mattered), shown to the AI with "how long ago" and "how they felt".
- consolidate: merge near-duplicates and let unimportant, unused memories fade so memory scales to thousands of chats.
- bond: how well Aegis knows the user (levels 1-5) and how warm / personal it may be.
- trend / absence / callback / special_days: the emotional arc, "I missed you", following up on what they told us,
  and birthdays or anniversaries.
Plain Python: no extra AI call, nothing leaves the server.
"""
import re
import time
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from . import emotion, utilities

# ------------------------------------------------------------------ auto-memory
_MONTHS = {m: i for i, names in enumerate(
    ["jan january", "feb february", "mar march", "apr april", "may", "jun june", "jul july", "aug august", "sep sept september",
     "oct october", "nov november", "dec december"], 1) for m in names.split()}

_REL = ("sister|brother|mother|mom|mum|dad|father|wife|husband|son|daughter|friend|best friend|boss|cousin|uncle|aunt|grandmother|grandfather|"
        "girlfriend|boyfriend|fiance|fiancee|colleague|teacher|manager|partner|neighbour|neighbor")
_REL_UR = "behen|bhai|ammi|ami|abbu|abu|mama|mamu|khala|chacha|chachi|bivi|biwi|shohar|beti|beta|dost|dada|dadi|nana|nani|phupho|bhabhi|saas|susar"
_NAME = r"([A-Z][\w'’-]{1,24}(?: [A-Z][\w'’-]{1,24})?)"
_NAME_ANY = r"([\w'’-]{2,24})"
_DATE = r"((?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Za-z]{3,9})|(?:[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?))"
_EVENT_WORDS = "exam|interview|presentation|surgery|operation|wedding|appointment|deadline|trip|flight|match|test|viva|result|meeting|shaadi|imtihan|nikah"
_WHEN = r"(today|tomorrow|tonight|day after tomorrow|next \w+|on \w+(?: \d{1,2})?|this \w+|kal|aaj|parson|agle \w+)"


def parse_month_day(text: str) -> str:
    """'5 December', 'Dec 5th' -> '12-05' (a yearly date). '' when there is none."""
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\b", text or "")
    if m and m.group(2).lower() in _MONTHS:
        day, mon = int(m.group(1)), _MONTHS[m.group(2).lower()]
    else:
        m = re.search(r"\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b", text or "")
        if not (m and m.group(1).lower() in _MONTHS):
            return ""
        mon, day = _MONTHS[m.group(1).lower()], int(m.group(2))
    return f"{mon:02d}-{day:02d}" if 1 <= day <= 31 else ""


def _clean(t: str, n: int = 80) -> str:
    return re.sub(r"\s+", " ", t).strip(" .,!?:;'\"")[:n]


def extract_memories(text: str, now: Optional[datetime] = None) -> List[dict]:
    """Things worth keeping from one message: [{text, kind, important, when_md}]. Questions are ignored."""
    raw = " ".join(str(text or "").split())
    if not raw or len(raw) > 400 or raw.rstrip().endswith("?"):
        return []
    now = now or datetime.now()
    stamp = now.strftime("%Y-%m-%d")
    out: List[dict] = []

    def add(t, kind="fact", important=False, when_md=""):
        if not any(o["text"].lower() == t.lower() for o in out):
            out.append({"text": t, "kind": kind, "important": important, "when_md": when_md})

    # their own name
    m = re.search(r"\b(?:my name is|call me|i am called|i'm called)\s+" + _NAME_ANY, raw, re.I) or re.search(r"\bmera naam\s+" + _NAME_ANY + r"\s+hai", raw, re.I)
    if m and m.group(1).lower() not in ("a", "an", "the", "not", "so"):
        add(f"Their name is {m.group(1).capitalize()}", "person", True)

    # their birthday
    m = re.search(r"\bmy (?:birthday|bday|birth day)\s+(?:is|falls)\s+(?:on\s+)?" + _DATE, raw, re.I)
    if m and parse_month_day(m.group(1)):
        add(f"Their birthday is on {_clean(m.group(1))}", "event", True, parse_month_day(m.group(1)))

    # other people's birthdays / anniversaries
    for m in re.finditer(r"\b" + _NAME + r"['’]s\s+(birthday|bday|anniversary)\s+(?:is|falls)\s+(?:on\s+)?" + _DATE, raw):
        md = parse_month_day(m.group(3))
        if md:
            add(f"{m.group(1)}'s {m.group(2).replace('bday', 'birthday')} is on {_clean(m.group(3))}", "event", True, md)
    m = re.search(r"\bour anniversary\s+(?:is|falls)\s+(?:on\s+)?" + _DATE, raw, re.I)
    if m and parse_month_day(m.group(1)):
        add(f"Their anniversary is on {_clean(m.group(1))}", "event", True, parse_month_day(m.group(1)))

    # people in their life
    for m in re.finditer(r"\bmy (" + _REL + r")(?:['’]s name)?\s+(?:is|name is|are)\s+" + _NAME_ANY, raw, re.I):
        if m.group(2).lower() not in ("a", "an", "the", "not", "so", "very", "really", "my", "in", "at", "going", "coming", "sick", "ill", "here", "home", "okay", "fine"):
            add(f"Their {m.group(1).lower()} is {m.group(2).capitalize()}", "person", True)
    for m in re.finditer(r"\b(?:meri|mere|mera)\s+(" + _REL_UR + r")\s+ka naam\s+" + _NAME_ANY + r"\s+hai", raw, re.I):
        add(f"Their {m.group(1).lower()} is {m.group(2).capitalize()}", "person", True)
    # someone unwell / in trouble: a feeling to ask about later
    m = re.search(r"\bmy (" + _REL + r")\s+(?:is|has been|was)\s+(sick|ill|in hospital|in the hospital|unwell|in surgery)", raw, re.I)
    if m:
        add(f"Their {m.group(1).lower()} is {m.group(2).lower()} (said on {stamp})", "emotion", True)
    m = re.search(r"\bmy (" + _REL + r")\s+(?:has\s+)?(passed away|died|is no more)", raw, re.I)
    if m:
        add(f"Their {m.group(1).lower()} passed away (they shared this on {stamp}); be gentle if it comes up", "emotion", True)
    m = re.search(r"\b(?:mere|meri|mera)\s+(" + _REL_UR + r")\s+(?:ka\s+)?(?:inteqal|wafat|death)\s+(?:ho\s+gai|ho\s+gaya|hogaya|hogai)", raw, re.I)
    if m:
        add(f"Their {m.group(1).lower()} passed away (they shared this on {stamp}); be gentle if it comes up", "emotion", True)

    # where they live / work / study
    m = re.search(r"\bi (?:live|stay) in\s+([^.,!;]{2,40})", raw, re.I) or re.search(r"\bmain\s+([A-Za-z ]{2,30})\s+mein\s+(?:rehta|rehti)\s+hoon", raw, re.I)
    if m:
        add(f"They live in {_clean(m.group(1))}", "fact")
    m = re.search(r"\bi(?:'m| am) from\s+([^.,!;]{2,40})", raw, re.I)
    if m:
        add(f"They are from {_clean(m.group(1))}", "fact")
    m = re.search(r"\bi work (?:at|for|as|in|with)\s+([^.,!;]{2,50})", raw, re.I)
    if m:
        add(f"They work {_clean(m.group(0)[len('i work '):])}", "fact")
    m = re.search(r"\bi (?:study|am studying|'m studying) (?:at|in)?\s*([^.,!;]{2,50})", raw, re.I)
    if m:
        add(f"They study {_clean(m.group(1))}", "fact")

    # likes and dislikes
    m = re.search(r"\bi (love|really like|like|hate|prefer|enjoy|can't stand|cant stand)\s+([^.,!;?]{2,45})", raw, re.I)
    if m and not re.match(r"(to |it\b|that\b|this\b|you\b|when\b|how\b|what\b)", m.group(2), re.I):
        add(f"They {m.group(1).lower()} {_clean(m.group(2))}", "preference")
    m = re.search(r"\bmujhe\s+([^.,!;?]{2,40}?)\s+(?:bohat |bahut )?(pasand|acha lagta|achi lagti|bura lagta)\b", raw, re.I)
    if m:
        add(f"They {'like' if m.group(2).lower() != 'bura lagta' else 'dislike'} {_clean(m.group(1))}", "preference")

    # goals
    m = re.search(r"\b(?:i want to|i'm planning to|i am planning to|i plan to|my goal is to|i'm trying to|i am trying to|i'm going to|i'd like to)\s+([^.,!;?]{4,70})", raw, re.I)
    if m:
        add(f"They want to {_clean(m.group(1))}", "goal")
    m = re.search(r"\b(?:mera maqsad|mera goal|meri khwahish)\s+([^.,!;?]{4,70})", raw, re.I)
    if m:
        add(f"Their goal: {_clean(m.group(1))}", "goal")

    # upcoming events
    m = re.search(r"\bi (?:have|got|'ve got|am having|'m having)\s+(?:an?\s+|my\s+)?(" + _EVENT_WORDS + r")\s+" + _WHEN, raw, re.I)
    if m:
        add(f"They have {'an' if m.group(1)[0].lower() in 'aeiou' else 'a'} {m.group(1).lower()} {_clean(m.group(2))} (said on {stamp})", "event", True)
    m = re.search(r"\b(?:mera|meri|mere)\s+(" + _EVENT_WORDS + r")\s+(" + r"kal|aaj|parson|[\w ]{3,20}" + r")\s+(?:hai|hain|he)\b", raw, re.I)
    if m:
        add(f"They have an {m.group(1).lower()} {_clean(m.group(2))} (said on {stamp})", "event", True)

    # pets
    m = re.search(r"\bmy (dog|cat|puppy|kitten|parrot|rabbit|horse|fish|bird)(?:['’]s name)?\s+(?:is named|is called|name is|named|called|is)\s+" + _NAME_ANY, raw, re.I)
    if m and m.group(2).lower() not in ("a", "an", "the", "so", "very", "sick", "ill", "here", "not", "named", "called"):
        add(f"Their {m.group(1).lower()} is called {m.group(2).capitalize()}", "person", True)
    m = re.search(r"\bi have (?:a|an|two|three)\s+(dog|cat|puppy|kitten|parrot|rabbit|horse)s?\s+(?:named|called)\s+" + _NAME_ANY, raw, re.I)
    if m:
        add(f"They have a {m.group(1).lower()} called {m.group(2).capitalize()}", "person", True)
    # health: allergies, conditions, fears (always kept, they matter)
    m = re.search(r"\bi(?:'m| am) allergic to\s+([^.,!;?]{2,40})", raw, re.I) or re.search(r"\bmujhe\s+([^.,!;?]{2,30}?)\s+se\s+allergy\s+hai", raw, re.I)
    if m:
        add(f"They are allergic to {_clean(m.group(1))}", "fact", True)
    m = re.search(r"\bi (?:have|suffer from|was diagnosed with)\s+(diabetes|asthma|migraines?|anxiety|depression|adhd|epilepsy|high blood pressure|hypertension|insomnia|arthritis)\b", raw, re.I)
    if m:
        add(f"They have {m.group(1).lower()} (be considerate about it)", "fact", True)
    m = re.search(r"\bi(?:'m| am) (?:scared|afraid|terrified) of\s+([^.,!;?]{2,40})", raw, re.I) or re.search(r"\bmujhe\s+([^.,!;?]{2,30}?)\s+se\s+(?:dar|darr)\s+lagta\b", raw, re.I)
    if m:
        add(f"They are afraid of {_clean(m.group(1))}", "emotion", True)
    # favourites
    m = re.search(r"\bmy fav(?:ou?rite)?\s+([a-z ]{2,20}?)\s+(?:is|are)\s+([^.,!;?]{2,40})", raw, re.I)
    if m:
        add(f"Their favourite {_clean(m.group(1))} is {_clean(m.group(2))}", "preference")
    # who they are: job title, age, family changes
    m = re.search(r"\bi(?:'m| am) an?\s+((?:[a-z]+ ){0,2}(?:engineer|developer|designer|doctor|nurse|teacher|student|lawyer|accountant|manager|writer|artist|freelancer|entrepreneur|founder|driver|chef|pilot|researcher|analyst))\b", raw, re.I)
    if m:
        add(f"They are {'an' if m.group(1)[0].lower() in 'aeiou' else 'a'} {_clean(m.group(1)).lower()}", "fact")
    m = re.search(r"\bi(?:'m| am)\s+(\d{2})\s+years?\s+old\b", raw, re.I) or re.search(r"\bmeri umar\s+(\d{2})\s+(?:saal\s+)?hai\b", raw, re.I)
    if m and 5 <= int(m.group(1)) <= 110:
        add(f"They are {m.group(1)} years old (said on {stamp})", "fact")
    m = re.search(r"\bi (?:just |recently )?(got married|got engaged|had a baby|became a (?:dad|father|mom|mother)|graduated|got (?:the|a) job|got hired|moved to [^.,!;?]{2,30}|lost my job|got fired|got divorced)", raw, re.I)
    if m:
        add(f"They {_clean(m.group(1))} (told us on {stamp})", "emotion", True)
    return out[:8]


# ------------------------------------------------------------------ one fact per slot: new replaces old
_SINGULAR_REL = "mother|mom|mum|dad|father|wife|husband|boss|girlfriend|boyfriend|fiance|fiancee|partner"
_SLOTS = [
    (r"^their name is ", "name"),
    (r"^they live in ", "home"),
    (r"^they are from ", "origin"),
    (r"^they work ", "work"),
    (r"^they study ", "study"),
    (r"^their birthday is ", "birthday"),
    (r"^their anniversary is ", "anniversary"),
    (r"^they are \d+ years old", "age"),
    (r"^their (" + _SINGULAR_REL + r") is ", None),     # slot = the relation
    (r"^their favourite ([a-z ]+) is ", None),          # slot = what it is a favourite of
]


def slot_of(text: str) -> str:
    """'They live in Lahore' -> 'home'. Facts with a slot can only hold one value: the newest wins ('I moved' replaces the old city)."""
    t = str(text or "").strip().lower()
    for pat, name in _SLOTS:
        m = re.match(pat, t)
        if m:
            if name:
                return name
            rel = m.group(1).strip().replace(" ", "_")
            return {"mom": "mother", "mum": "mother", "dad": "father"}.get(rel, rel)
    return ""


def supersede(db, uid: int, text: str) -> int:
    """After saving `text`, delete older memories that held a different value for the same slot. Returns how many were replaced."""
    slot = slot_of(text)
    if not slot:
        return 0
    n = 0
    rows = [dict(r) for r in db.facts(uid)]  # newest first
    newest = next((r for r in rows if r["text"].strip().lower() == text.strip().lower()), None)
    if not newest:
        return 0
    for r in rows:
        if r["id"] != newest["id"] and slot_of(r["text"]) == slot and r["text"].strip().lower() != text.strip().lower() and r["created"] <= newest["created"]:
            db.delete_fact(uid, r["id"])
            n += 1
    return n


# ------------------------------------------------------------------ recall: what to bring to mind
def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


_SYN = [
    {"mom", "mother", "mum", "ammi", "ami", "maa", "mama"}, {"dad", "father", "abbu", "abu", "papa", "baba"},
    {"wife", "bivi", "biwi", "spouse", "partner"}, {"husband", "shohar", "spouse", "partner"},
    {"sister", "behen", "behan", "sis"}, {"brother", "bhai", "bro"},
    {"birthday", "bday", "janamdin", "born"}, {"job", "work", "office", "company", "career", "employer"},
    {"study", "studying", "university", "college", "school", "degree", "student"}, {"live", "home", "city", "stay", "rehta", "address"},
    {"dog", "puppy", "pet"}, {"cat", "kitten", "pet"}, {"afraid", "scared", "fear", "phobia", "darr"},
    {"allergic", "allergy", "allergies"}, {"exam", "test", "imtihan", "viva", "paper"}, {"sick", "ill", "unwell", "hospital", "bimar"},
    {"goal", "plan", "dream", "want", "maqsad"}, {"like", "love", "enjoy", "favourite", "favorite", "pasand"},
    # v17: more Roman Urdu / Hindi / everyday groups, so "paisa" finds "salary" and "dawai" finds "medicine"
    {"money", "paisa", "paise", "salary", "income", "tankhwah", "pay", "savings", "budget"}, {"car", "gaari", "gadi", "bike", "vehicle", "motorcycle"},
    {"food", "khana", "dinner", "lunch", "breakfast", "meal", "cook", "cooking"}, {"friend", "dost", "yaar", "buddy", "mate"},
    {"wedding", "shaadi", "shadi", "marriage", "nikah", "engaged", "engagement"}, {"doctor", "hospital", "clinic", "medicine", "dawai", "dawa", "treatment", "dentist"},
    {"trip", "safar", "travel", "flight", "journey", "holiday", "vacation", "visa"}, {"sleep", "neend", "insomnia", "bed", "nap"},
    {"child", "kid", "baby", "bacha", "bachay", "bachcha", "son", "daughter", "beta", "beti"}, {"house", "ghar", "home", "apartment", "flat", "rent", "kiraya"},
    {"gym", "exercise", "workout", "fitness", "walk", "running", "jogging"}, {"prayer", "namaz", "salah", "dua", "mosque", "masjid"},
]
_SYN_INDEX: Dict[str, set] = {}
for _grp in _SYN:
    for _w in _grp:
        _SYN_INDEX.setdefault(_w, set()).update(_grp)


def _tokens(text: str) -> set:
    return {_stem(w) for w in re.findall(r"\w+", str(text).lower()) if len(w) > 1}


def _tokens_expanded(text: str) -> set:
    """Query words plus their everyday synonyms ('mom' also looks for 'mother'). Used for the question, never for the stored memory."""
    out = set(_tokens(text))
    for w in re.findall(r"\w+", str(text).lower()):
        out |= {_stem(x) for x in _SYN_INDEX.get(w, ())}
    return out


def _trigrams(w: str) -> set:
    w = f"  {w} "
    return {w[i:i + 3] for i in range(len(w) - 2)}


def _fuzzy_overlap(q: set, t: set) -> float:
    """Spelling-tolerant word overlap (behen / behan, birthday / bday are close enough to count a little)."""
    score = 0.0
    for a in q:
        if a in t:
            score += 1
            continue
        if len(a) < 4:
            continue
        ga = _trigrams(a)
        best = max((len(ga & _trigrams(b)) / len(ga | _trigrams(b)) for b in t if len(b) >= 4), default=0)
        if best >= 0.55:
            score += 0.6
    return score


def _idf(rows) -> Dict[str, float]:
    """How rare each word is across everything remembered: a shared rare word ('Ayesha') says more than a shared common one ('they')."""
    import math

    df: Dict[str, int] = {}
    for r in rows:
        for w in _tokens(r["text"]):
            df[w] = df.get(w, 0) + 1
    n = max(1, len(rows))
    return {w: math.log(1 + n / (1 + c)) for w, c in df.items()}


def memory_score(r, q: set, now: float, query_text: str = "", idf: Optional[Dict[str, float]] = None) -> float:
    t = _tokens(r["text"])
    rel = min(_fuzzy_overlap(q, t), 3.0) if q else 0.0
    if q and idf and rel:
        rel += min(1.0, 0.25 * sum(idf.get(w, 1.0) for w in q if w in t))  # rare shared words count more
    age = max(0.0, now - (r["created"] or now)) / 86400
    half_life = 10 * (1 + r["weight"] * 2)  # days; an important memory fades 5x slower than a casual one
    recency = 0.5 ** (age / half_life)
    used = min(int(r["uses"] or 0), 10) * 0.15
    felt = {0: 0.0, 1: 0.0, 2: 0.3, 3: 0.8, 4: 1.6, 5: 2.2}.get(int(r["mood_level"] or 0), 0.0)  # strongly felt moments stay vivid
    kind = 0.8 if r["kind"] in ("person", "emotion", "goal") else 0.3 if r["kind"] == "event" else 0.0
    pinned = 3.0 if (r["pinned"] if "pinned" in r.keys() else 0) else 0.0
    return rel * 3.0 + r["weight"] * 0.9 + recency * 1.4 + used + felt + kind + pinned


def select_memories(rows, query: str = "", limit: int = 14, now: Optional[float] = None) -> list:
    """The memories that should be on Aegis's mind for this message, most relevant first."""
    now = now or time.time()
    q = _tokens_expanded(query)
    idf = _idf(rows) if q else None
    ranked = sorted(rows, key=lambda r: -memory_score(r, q, now, idf=idf))
    hits = [r for r in ranked if q and _fuzzy_overlap(q, _tokens(r["text"])) >= 1][:7]
    chosen = list(hits)
    for r in ranked:
        if len(chosen) >= limit:
            break
        if r not in chosen:
            chosen.append(r)
    return chosen


def ago(ts: float, now: Optional[float] = None) -> str:
    d = (now or time.time()) - ts
    if d < 3600:
        return "just now"
    if d < 86400:
        return "earlier today"
    days = int(d // 86400)
    if days == 1:
        return "yesterday"
    if days < 14:
        return f"{days} days ago"
    if days < 60:
        return f"{days // 7} weeks ago"
    if days < 700:
        return f"{days // 30} months ago"
    return f"{days // 365} years ago"


def format_memories(rows, now: Optional[float] = None) -> str:
    now = now or time.time()
    lines = []
    for r in rows:
        bits = [ago(r["created"], now)]
        if r["mood"] and r["mood_level"] >= 2:
            bits.append(f"they felt {r['mood']}" + (" very strongly" if r["mood_level"] >= 4 else ""))
        tag = f" [{r['kind']}]" if r["kind"] != "fact" else ""
        if r["weight"] >= 3:
            bits.append("important to them")
        if int(r["uses"] or 0) >= 5:
            bits.append("comes up often")
        lines.append(f"- {r['text']}{tag} ({', '.join(bits)})")
    return "\n".join(lines)


# ------------------------------------------------------------------ housekeeping
MEMORY_CAP = 400


def consolidate(db, uid: int, cap: int = MEMORY_CAP, now: Optional[float] = None) -> dict:
    """Merge look-alike memories (60% same words) and let the least important, unused, old ones fade when over `cap`."""
    now = now or time.time()
    rows = [dict(r) for r in db.facts(uid)]
    merged = 0
    gone = set()
    words = {r["id"]: set(re.findall(r"\w+", r["text"].lower())) for r in rows}
    for i, a in enumerate(rows):  # newest first
        if a["id"] in gone:
            continue
        for b in rows[i + 1:]:
            if b["id"] in gone or a["kind"] != b["kind"]:
                continue
            wa, wb = words[a["id"]], words[b["id"]]
            # people and dated events differ by one name ("Their sister is Ayesha" / "...Sana"): only merge when nearly identical
            need = 0.8 if a["kind"] in ("person", "event") else 0.6
            if wa and wb and len(wa & wb) / len(wa | wb) >= need:
                db.update_fact_text(uid, a["id"], a["text"], min(5, max(a["weight"], b["weight"])))
                db.delete_fact(uid, b["id"])
                gone.add(b["id"])
                merged += 1
    seen_slots = set()
    for r in rows:  # newest first: the first one seen for a slot is the current truth
        if r["id"] in gone:
            continue
        slot = slot_of(r["text"])
        if not slot:
            continue
        if slot in seen_slots:
            db.delete_fact(uid, r["id"])
            gone.add(r["id"])
            merged += 1
        else:
            seen_slots.add(slot)
    rows = [r for r in rows if r["id"] not in gone]
    faded = 0
    if len(rows) > cap:
        # forgettable = low weight, never felt strongly, rarely used, older than a month; weakest first
        weak = sorted((r for r in rows if r["weight"] <= 1 and r["mood_level"] < 3 and r["uses"] < 3 and now - r["created"] > 30 * 86400 and not r.get("pinned")),
                      key=lambda r: memory_score(r, set(), now))
        for r in weak[: len(rows) - cap]:
            db.delete_fact(uid, r["id"])
            faded += 1
    return {"merged": merged, "faded": faded}


# ------------------------------------------------------------------ the bond
LEVELS = [
    (1, "just met", 0),
    (2, "getting to know each other", 25),
    (3, "friends", 90),
    (4, "close friends", 280),
    (5, "trusted confidant", 750),
]

_TONE = {
    1: "You have only just met. Be warm, polite and curious; do not presume closeness or use pet names.",
    2: "You are getting to know each other. Be friendly and natural, show interest in their life, and use what you remember lightly.",
    3: "You are friends. Be relaxed and personal, tease gently when the mood allows, bring up things they told you, and show you care how their days go.",
    4: "You are close friends. Speak like someone who really knows them: warmth, inside references, honest gentle opinions, and notice small changes in their mood without being asked.",
    5: "You are their trusted confidant, one of the people who knows them best. Be deeply caring and honest, remember the story of their life, say what you notice, celebrate and worry for them for real, and never be shallow.",
}


def bond_points(row: dict, facts: int) -> int:
    return int(row["turns"] + row["days"] * 8 + row["shared"] * 5 + facts * 2)


def bond_level(row: dict, facts: int = 0) -> dict:
    pts = bond_points(row, facts)
    level = 1
    for lv, _, need in LEVELS:
        if pts >= need:
            level = lv
    name = dict((lv, n) for lv, n, _ in LEVELS)[level]
    nxt = next((need for lv, _, need in LEVELS if lv == level + 1), None)
    floor = next(need for lv, _, need in LEVELS if lv == level)
    pct = 100 if nxt is None else int(100 * (pts - floor) / max(1, nxt - floor))
    return {"level": level, "name": name, "points": pts, "next_at": nxt, "progress": pct, "tone": _TONE[level]}


def absence_hint(row: dict, now: Optional[float] = None) -> str:
    """After a few days apart, a real friend says she missed them. `prev_last` = when they last talked before today."""
    now = now or time.time()
    prev = row.get("prev_last") or 0
    if not prev:
        return ""
    days = int((now - prev) // 86400)
    if days >= 14:
        return (f"They are back after {days} days away. Welcome them back with real warmth and say you missed them, ask gently how they have been "
                "and what has happened since, once, in your own words. Do not scold them for being away.")
    if days >= 3:
        return (f"They are back after {days} days. Let them know in one warm sentence that you missed them and are glad they are back, "
                "then answer what they asked.")
    return ""


# ------------------------------------------------------------------ emotional arc
def _valence_score(r) -> float:
    v = emotion.MOODS.get(r["mood"], ("neutral",))[0]
    return {"positive": 1.0, "negative": -1.0}.get(v, 0.0) * r["intensity"]


def trend(rows: List[dict], tz: str = "", now: Optional[float] = None) -> dict:
    """rows = recent moods, newest first. -> {direction: lifting|sinking|steady|unknown, rough_patch: bool, bright_streak: bool}"""
    now = now or time.time()
    zone = utilities.get_zone(tz)
    today = datetime.fromtimestamp(now, zone).date()
    by_day: Dict[date, List[float]] = {}
    for r in rows:
        if r["mood"] == "neutral":
            continue
        d = datetime.fromtimestamp(r["created"], zone).date()
        if (today - d).days <= 10:
            by_day.setdefault(d, []).append(_valence_score(r))
    if len(by_day) < 2:
        return {"direction": "unknown", "rough_patch": False, "bright_streak": False}
    avg = {d: sum(v) / len(v) for d, v in by_day.items()}
    recent = [v for d, v in avg.items() if (today - d).days <= 2]
    before = [v for d, v in avg.items() if 2 < (today - d).days <= 9]
    direction = "steady"
    if recent and before:
        diff = sum(recent) / len(recent) - sum(before) / len(before)
        direction = "lifting" if diff >= 1 else "sinking" if diff <= -1 else "steady"
    last4 = [avg.get(today - timedelta(days=i)) for i in range(4)]
    seen = [v for v in last4 if v is not None]
    rough = sum(1 for v in seen if v <= -1.5) >= 3
    bright = len(seen) >= 3 and all(v >= 1 for v in seen)
    return {"direction": direction, "rough_patch": rough, "bright_streak": bright}


def trend_hint(t: dict) -> str:
    if t["rough_patch"]:
        return ("They have had a heavy few days in a row. Be extra gentle and unhurried; let them know, once and without drama, that you have noticed "
                "and you are here. If it fits, softly suggest talking to someone they trust or getting rest. Never diagnose.")
    if t["bright_streak"]:
        return "They have been in good spirits for days. Enjoy it with them and name it once if it fits (\"you have been sounding happy lately\")."
    if t["direction"] == "lifting":
        return "Their mood has been lifting compared with last week. If it fits, say you are glad things seem a little brighter."
    if t["direction"] == "sinking":
        return "Their mood has been lower than last week. Be a little more attentive and warm than usual."
    return ""


# ------------------------------------------------------------------ following up on their life
def callback(db, uid: int, now: Optional[float] = None) -> Optional[dict]:
    """A recent thing they told us that deserves a follow-up (event, feeling or goal, 1-6 days old)."""
    now = now or time.time()
    best = None
    for r in db.facts(uid):
        age = (now - r["created"]) / 86400
        if r["kind"] not in ("event", "emotion", "goal") or not (0.5 <= age <= 6) or "birthday" in r["text"].lower():
            continue
        score = r["weight"] + r["mood_level"] * 0.5 - age * 0.3 + (1 if r["kind"] == "emotion" else 0)
        if best is None or score > best[0]:
            best = (score, r)
    if not best:
        return None
    r = best[1]
    return {"id": r["id"], "text": re.sub(r"\s*\((?:said|they shared this) on [^)]*\)", "", r["text"]), "kind": r["kind"], "days_ago": int((now - r["created"]) // 86400)}


def special_days(db, uid: int, tz: str = "", now: Optional[datetime] = None) -> List[dict]:
    """Birthdays and anniversaries today or tomorrow -> [{key, when, text}]."""
    zone = utilities.get_zone(tz)
    now = now.astimezone(zone) if now else datetime.now(zone)
    today, tomorrow = now.date(), now.date() + timedelta(days=1)
    out = []
    for r in db.facts(uid):
        md = r["when_md"]
        if not md:
            continue
        for d, when in ((today, "today"), (tomorrow, "tomorrow")):
            if md == f"{d.month:02d}-{d.day:02d}":
                out.append({"key": f"special:{r['id']}:{when}:{d.isoformat()}", "when": when, "text": r["text"]})
    return out


# ------------------------------------------------------------------ v17: understanding the person over time
_PARTS = (("night", 0, 5), ("morning", 5, 12), ("afternoon", 12, 17), ("evening", 17, 22), ("night", 22, 24))
_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _part_of_day(hour: int) -> str:
    for name, a, b in _PARTS:
        if a <= hour < b:
            return name
    return "night"


def patterns(rows: List[dict], tz: str = "") -> List[str]:
    """Rhythms in how they feel, from the mood history (newest first). Needs real evidence: 5+ low moments, and a weekday or time of
    day that holds a clear share of them. -> ['They often feel stressed on Sundays', 'They tend to feel low at night']"""
    zone = utilities.get_zone(tz)
    low = [r for r in rows if r["mood"] != "neutral" and emotion.MOODS.get(r["mood"], ("",))[0] == "negative" and r["intensity"] >= 2]
    out: List[str] = []
    if len(low) < 5:
        return out
    by_day: Dict[int, List[str]] = {}
    by_part: Dict[str, List[str]] = {}
    for r in low:
        d = datetime.fromtimestamp(r["created"], zone)
        by_day.setdefault(d.weekday(), []).append(r["mood"])
        by_part.setdefault(_part_of_day(d.hour), []).append(r["mood"])

    def top(moods):
        return max(set(moods), key=moods.count)

    wd, moods = max(by_day.items(), key=lambda kv: len(kv[1]))
    if len(moods) >= 3 and len(moods) / len(low) >= 0.4:
        out.append(f"They often feel {top(moods)} on {_DAYS[wd]}s")
    part, moods = max(by_part.items(), key=lambda kv: len(kv[1]))
    if len(moods) >= 4 and len(moods) / len(low) >= 0.5:
        out.append(f"They tend to feel {top(moods)} in the {part}" if part != "night" else f"They tend to feel {top(moods)} late at night")
    return out


def feelings_about(rows, text: str, limit: int = 2) -> str:
    """If the message touches something they once felt strongly about, say so ('the exam made them anxious'), so Aegis can be ready for it."""
    q = _tokens_expanded(text)
    if not q:
        return ""
    hits = []
    for r in rows:
        if not r["mood"] or r["mood_level"] < 3 or r["kind"] == "episode":
            continue
        if _fuzzy_overlap(q, _tokens(r["text"])) >= 1:
            hits.append(r)
    hits.sort(key=lambda r: (-r["mood_level"], -r["created"]))
    if not hits:
        return ""
    lines = [f"- {re.sub(r' *[(]said on [^)]*[)]', '', r['text'])}: they felt {r['mood']}{' very strongly' if r['mood_level'] >= 4 else ''} when they told you" for r in hits[:limit]]
    return ("This message touches something that stirred strong feeling before (private, never mention that you noticed):\n" + "\n".join(lines) +
            "\nBe ready for that feeling to come back; ask how it is going before diving into the task if it fits.")


_REL_FACT = re.compile(r"^Their ([\w' -]{2,30}?) (?:is|was) ([A-Z][\w'’-]{1,24})(?:[ ,.;:(].*)?$")


def people(rows, now: Optional[float] = None) -> List[dict]:
    """The people in their life, built from memory: name, relation, how often they come up, how they feel about them."""
    now = now or time.time()
    out: Dict[str, dict] = {}
    for r in rows:
        if r["kind"] not in ("person", "fact"):
            continue
        m = _REL_FACT.match(r["text"].strip())
        if not m:
            continue
        rel, name = m.group(1).strip().lower(), m.group(2)
        if rel in ("name", "birthday", "anniversary"):
            continue
        out.setdefault(name.lower(), {"name": name, "relation": rel, "mentions": 0, "last": 0.0, "moods": [], "notes": []})
    if not out:
        return []
    for r in rows:
        low = r["text"].lower()
        for key, p in out.items():
            if re.search(r"\b" + re.escape(key) + r"\b", low):
                p["mentions"] += 1
                p["last"] = max(p["last"], r["created"])
                if r["mood"] and r["mood_level"] >= 2:
                    p["moods"].append(r["mood"])
                if r["kind"] != "person" and len(p["notes"]) < 5:
                    p["notes"].append(r["text"])
    res = []
    for p in out.values():
        feel = max(set(p["moods"]), key=p["moods"].count) if p["moods"] else ""
        res.append({"name": p["name"], "relation": p["relation"], "mentions": p["mentions"], "last_mentioned": ago(p["last"], now) if p["last"] else "",
                    "feeling": feel, "notes": p["notes"]})
    res.sort(key=lambda p: -p["mentions"])
    return res


def reflect(db, uid: int, tz: str = "", now: Optional[float] = None) -> int:
    """Once a day: turn the mood history into a few lasting 'insight' memories (rhythms the user never stated). Replaces the old ones."""
    now = now or time.time()
    found = patterns(db.moods(uid, since=now - 60 * 86400, limit=600), tz)
    db.delete_facts_by_prefix(uid, "Pattern:")
    for p in found:
        db.add_fact(uid, "Pattern: " + p, "insight", False, source="auto")
    return len(found)
