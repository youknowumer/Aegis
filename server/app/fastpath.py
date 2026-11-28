"""v19 fast path: things you say that need no AI at all, answered in milliseconds and never counted against the daily quota.

Two families, in English, Roman Urdu and (for the browser) Urdu script:
  1. reminders   "remind me in 20 minutes to call Ali", "kal subah 9 baje yaad dilana ki ...", "snooze 10 minutes", "what are my reminders"
  2. browser     "next tab", "search for cats on youtube", "open the second result", "scroll down", "click sign in",
                 "pause the video", "find pricing on the page", "read this page" ... driving the user's REAL browser
                 (the Aegis Web Hands extension or the desktop app's Chrome) through the same chrome_* tools the AI uses.

Safety: only harmless chrome_* tools are used. A click that looks like buying / sending / deleting comes back as NEEDS_APPROVAL and the
message is then handed to the AI (try_fast returns None), which asks the user properly. Passwords are never typed or stored.
Anything not recognised returns None and goes to the AI as before.
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urlparse

from . import utilities

# ------------------------------------------------------------------ small helpers
_NUMW = {"zero": 0, "one": 1, "won": 1, "two": 2, "to": 2, "too": 2, "three": 3, "tree": 3, "four": 4, "for": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "ate": 8,
         "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
         "ek": 1, "aik": 1, "do": 2, "teen": 3, "char": 4, "panch": 5, "paanch": 5, "chhe": 6, "che": 6, "saat": 7, "aath": 8, "nau": 9, "das": 10,
         "pandrah": 15, "bees": 20, "tees": 30, "chalis": 40, "pachas": 50, "saath": 60,
         "ایک": 1, "دو": 2, "تین": 3, "چار": 4, "پانچ": 5, "چھ": 6, "سات": 7, "آٹھ": 8, "نو": 9, "دس": 10}
_ORD = {"first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3, "fourth": 4, "4th": 4, "fifth": 5, "5th": 5, "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
        "pehla": 1, "pehli": 1, "dusra": 2, "doosra": 2, "dusri": 2, "teesra": 3, "teesri": 3, "chautha": 4, "panchwa": 5, "top": 1, "last": -1}
_DIG = {"۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9", "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9"}


def norm(text: str) -> str:
    t = "".join(_DIG.get(c, c) for c in str(text or ""))
    t = t.lower().replace("“", "").replace("”", "").replace('"', "")
    t = re.sub(r"[?!؟.,;:]+(?=\s|$)", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"^(?:(?:hey|ok|okay) )?aegis[ ,]+", "", t)
    t = re.sub(r"^(?:please|plz|pls|can you|could you|will you|would you|kindly|zara|ab|now|then|and then)[ ,]+", "", t)
    t = re.sub(r"^(?:please|plz|pls|can you|could you)[ ,]+", "", t)
    t = re.sub(r"[ ,]+(?:please|plz|pls|thanks|thank you|shukriya|yaar|na|zara|for me|karo na)$", "", t)
    return t.strip()


def _num(s: str) -> Optional[float]:
    s = str(s or "").strip().lower()
    if re.fullmatch(r"\d+(?:\.\d+)?", s):
        return float(s)
    return float(_NUMW[s]) if s in _NUMW else None


def _idx(s: str) -> Optional[int]:
    s = str(s or "").strip().lower()
    if s in _ORD:
        return _ORD[s]
    n = _num(s)
    return int(n) if n is not None else None


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


# ================================================================== 1. reminders
_WD = {"monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2, "thursday": 3, "thu": 3, "thurs": 3, "friday": 4, "fri": 4, "saturday": 5, "sat": 5, "sunday": 6, "sun": 6,
       "somwar": 0, "peer": 0, "mangal": 1, "budh": 2, "jumerat": 3, "jumeraat": 3, "juma": 4, "hafta": 5, "itwar": 6, "itwaar": 6}
_UNIT_MIN = {"sec": 1 / 60, "second": 1 / 60, "min": 1, "minute": 1, "hour": 60, "hr": 60, "day": 1440, "week": 10080,
             "minat": 1, "ghanta": 60, "ghante": 60, "ghantay": 60, "ghanta": 60, "din": 1440, "hafte": 10080, "hafta": 10080}
_NUMRX = r"(a|an|half an?|\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ek|aik|do|teen|char|panch|paanch|chhe|saat|aath|nau|das|pandrah|bees|tees|chalis|pachas|aadha|aadhe|dedh|dhai)"
_UNITRX = r"(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|minat|ghanta|ghante|ghantay|din|hafta|hafte)"
_PARTS = {"morning": 9, "subah": 9, "subha": 9, "afternoon": 15, "dopahar": 14, "evening": 18, "shaam": 18, "night": 21, "raat": 21, "tonight": 20, "noon": 12, "midnight": 0}


def _rel_minutes(g_num: str, g_unit: str) -> Optional[float]:
    n = {"a": 1, "an": 1, "half a": 0.5, "half an": 0.5, "aadha": 0.5, "aadhe": 0.5, "dedh": 1.5, "dhai": 2.5}.get(g_num)
    if n is None:
        n = _num(g_num)
    u = re.sub(r"s$", "", g_unit)
    if n is None or u not in _UNIT_MIN:
        return None
    return n * _UNIT_MIN[u]


def parse_reminder(text: str, tz: str = "", now: Optional[datetime] = None) -> Optional[dict]:
    """'remind me in 20 minutes to call Ali' -> {due (epoch), when (spoken), text, repeat}. None if it is not a clear reminder."""
    t = norm(text)
    if not re.search(r"\bremind(?:er)?\b|yaad dil|yaad dila|yaad karana|yaad kara", t) or t.rstrip().endswith("?"):
        return None
    if re.match(r"^(?:what|which|show|list|read|cancel|delete|remove|clear|do i|are there|how many|snooze)\b", t):
        return None
    zone = utilities.get_zone(tz)
    now = (now or datetime.now(timezone.utc)).astimezone(zone)
    rest = " " + t + " "
    repeat = ""
    anchor_wd = None

    m = re.search(r"\b(?:every|each)\s+(day|weekday|weekdays|week|month|morning|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(daily|everyday|weekly|monthly)\b|\bhar\s+(roz|din|hafta|mahine|mahina)\b|\broz\b", rest)
    if m:
        w = (m.group(1) or m.group(2) or m.group(3) or "roz").lower()
        repeat = {"day": "daily", "everyday": "daily", "daily": "daily", "roz": "daily", "din": "daily", "morning": "daily", "evening": "daily", "night": "daily", "weekday": "weekdays", "weekdays": "weekdays",
                  "week": "weekly", "weekly": "weekly", "hafta": "weekly", "month": "monthly", "monthly": "monthly", "mahine": "monthly", "mahina": "monthly"}.get(w, "weekly")
        if w in _WD:
            anchor_wd = _WD[w]
        rest = rest.replace(m.group(0), " " + (w if w in _PARTS else "") + " ", 1)

    due: Optional[datetime] = None
    when_txt = ""
    # relative: "in 20 minutes", "after an hour", "20 minute baad", "half an hour"
    m = re.search(r"\b(?:in|after)\s+" + _NUMRX + r"\s*" + _UNITRX + r"\b", rest) or re.search(r"\b" + _NUMRX + r"\s*" + _UNITRX + r"\s+(?:baad|bad|mein|me|ke baad)\b", rest)
    if m and not repeat:
        mins = _rel_minutes(m.group(1), m.group(2))
        if mins is None or not 0 < mins <= 60 * 24 * 365:
            return None
        due = now + timedelta(minutes=mins)
        rest = rest.replace(m.group(0), " ", 1)
        when_txt = "in " + _spoken_span(mins)
    else:
        day_off = None
        dm = re.search(r"\b(day after tomorrow|tomorrow|tmrw|tonight|today|kal|aaj|parson|parso)\b", rest)
        if dm:
            w = dm.group(1)
            day_off = {"day after tomorrow": 2, "parson": 2, "parso": 2, "tomorrow": 1, "tmrw": 1, "kal": 1}.get(w, 0)
            rest = rest.replace(dm.group(0), " " + ("tonight" if w == "tonight" else "") + " ", 1)
        wm = re.search(r"\b(?:on |next |this |is )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thurs|fri|sat|sun)\b", rest)
        if wm and day_off is None and not repeat:
            anchor_wd = _WD[wm.group(1)]
            rest = rest.replace(wm.group(0), " ", 1)
        elif wm and repeat == "weekly":
            rest = rest.replace(wm.group(0), " ", 1)
        hour = minute = None
        meridian = ""
        cm = re.search(r"\b(?:at |by |around |about )?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)", rest)
        if cm:
            hour, minute, meridian = int(cm.group(1)), int(cm.group(2) or 0), cm.group(3)[0]
        else:
            cm = re.search(r"\b(?:at |by |around |about )(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:minutes?|mins?|hours?|days?|%|times))", rest) or re.search(r"\b(\d{1,2}):(\d{2})\b", rest) or \
                re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*baje\b", rest)
            if cm:
                hour, minute = int(cm.group(1)), int(cm.group(2) or 0)
        if cm:
            rest = rest.replace(cm.group(0), " ", 1)
        pm = re.search(r"\b(this )?(morning|subah|subha|afternoon|dopahar|evening|shaam|night|raat|tonight|noon|midnight)\b", rest)
        part = pm.group(2) if pm else ""
        if pm:
            rest = rest.replace(pm.group(0), " ", 1)
        if hour is None and not part and day_off is None and anchor_wd is None and not repeat:
            return None  # no time found at all
        if hour is None:
            hour, minute = (_PARTS.get(part, 9), 0)
        elif not meridian:
            if part in ("afternoon", "dopahar", "evening", "shaam", "night", "raat", "tonight") and hour < 12:
                hour += 12
            elif part in ("morning", "subah", "subha"):
                pass
            elif part == "":
                # nothing says am or pm: the next time that hour comes round (7+ means morning for a later day, 1-6 afternoon)
                if hour < 12 and (day_off or anchor_wd is not None):
                    hour = hour if hour >= 7 else hour + 12
                elif hour < 12:
                    cand = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    if cand <= now:
                        hour += 12 if hour + 12 < 24 and now.replace(hour=hour + 12, minute=minute, second=0, microsecond=0) > now else 0
        elif meridian == "p" and hour < 12:
            hour += 12
        elif meridian == "a" and hour == 12:
            hour = 0
        if part == "tonight" and day_off is None:
            day_off = 0
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return None
        base = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if anchor_wd is not None and day_off is None:
            delta = (anchor_wd - now.weekday()) % 7
            due = base + timedelta(days=delta)
            if due <= now:
                due += timedelta(days=7)
        else:
            due = base + timedelta(days=day_off or 0)
            if due <= now:
                if day_off:
                    return None
                due += timedelta(days=1)
        when_txt = _spoken_when(due, now)
    if repeat == "weekdays" and due.weekday() >= 5:
        due += timedelta(days=7 - due.weekday())
        when_txt = _spoken_when(due, now)
    if due - now > timedelta(days=366) or due <= now:
        return None

    # what to remind about
    body = rest
    body = re.sub(r"\b(?:set (?:a |an )?reminder|remind me|remind|reminder|mujhe|mujhay|mjhe)\b", " ", body)
    body = re.sub(r"\b(?:yaad dilana|yaad dilao|yaad dila dena|yaad dila do|yaad dilaana|yaad karana|yaad kara dena|yaad rakhna|remind karna|remind kar dena|batana|bata dena)\b", " ", body)
    body = re.sub(r"\b(?:every|each|daily|weekly|monthly)\b", " ", body)
    body = re.sub(r"^\s*(?:to|that|about|of|ki|ke liye|k liye|ke baare mein|ko|for)\s+", "", body.strip())
    body = re.sub(r"\s+(?:ki|ke liye|k liye)\s*$", "", body.strip())
    body = re.sub(r"\b(?:that|to|ki)\s*$", "", re.sub(r"\s+", " ", body).strip()).strip()
    body = re.sub(r"^(?:to|that|about|ki|ko)\s+", "", body)
    if len(body) < 2 or body in ("to", "that", "me"):
        return None
    orig = re.search(re.escape(body), " ".join(str(text).split()), re.I)  # keep the user's capitals (names)
    return {"due": due.timestamp(), "when": when_txt, "text": _cap(orig.group(0) if orig else body)[:200], "repeat": repeat}


def _spoken_span(mins: float) -> str:
    if mins < 1:
        return f"{int(round(mins * 60))} seconds"
    if mins < 60:
        n = int(round(mins))
        return f"{n} minute{'s' if n != 1 else ''}"
    if mins < 1440:
        h = mins / 60
        return (f"{int(h)} hour{'s' if int(h) != 1 else ''}" if abs(h - int(h)) < 0.01 else f"{round(h, 1)} hours")
    d = int(round(mins / 1440))
    return f"{d} day{'s' if d != 1 else ''}"


def _clock(d: datetime) -> str:
    h = d.hour % 12 or 12
    return f"{h}:{d.minute:02d} {'AM' if d.hour < 12 else 'PM'}" if d.minute else f"{h} {'AM' if d.hour < 12 else 'PM'}"


def _spoken_when(due: datetime, now: datetime) -> str:
    days = (due.date() - now.date()).days
    day = "today" if days == 0 else "tomorrow" if days == 1 else due.strftime("%A") if days < 7 else due.strftime("%A %d %B")
    return f"{day} at {_clock(due)}"


_LIST_RX = re.compile(r"^(?:what(?:'s| is| are)|show|list|read|tell me|do i have any|how many)(?: me)?(?: all)?(?: of)?(?: my)?(?: upcoming| pending)? reminders?(?: do i have| are there| set)?$|^(?:meri |mere )?reminders? (?:dikhao|batao|sunao|kya hain|kya hai)$")
_CANCEL_RX = re.compile(r"^(?:cancel|delete|remove|clear)(?: my| the)? reminders? (?:about |for |to |of )?(.{2,80})$|^(.{2,80}?) (?:wala )?reminder (?:cancel|delete|hata|hatao) ?(?:karo|do)?$")
_SNOOZE_RX = re.compile(r"^(?:snooze|remind me again|dobara yaad dil\w+|phir se yaad dil\w+|thori der baad yaad dil\w+)(?: (?:it|that))?(?: (?:for|in|after))?(?: " + _NUMRX + r"\s*" + _UNITRX + r")?(?: (?:baad|later|more))?$")


async def _reminders_and_memory(uid: int, raw: str, t: str, tz: str, db, now) -> Optional[dict]:
    zone = utilities.get_zone(tz)
    if raw.strip().endswith("?") and not _LIST_RX.match(t):
        return None
    m = _SNOOZE_RX.match(t)
    if m:
        mins = 10.0
        if m.group(1):
            mins = _rel_minutes(m.group(1), m.group(2)) or 10.0
        last = db.last_fired_reminder(uid, now=(now.timestamp() if now else None))
        if not last:
            return {"reply": "I don't see a reminder that just went off, so there is nothing to snooze.", "tools": ["snooze"]}
        due = (now or datetime.now(timezone.utc)).timestamp() + mins * 60
        db.add_reminder(uid, last, due, "", tz)
        return {"reply": f"Snoozed. I will remind you again in {_spoken_span(mins)}.", "tools": ["snooze"]}
    if _LIST_RX.match(t):
        rows = db.reminders(uid)
        if not rows:
            return {"reply": "You have no upcoming reminders.", "tools": ["list_reminders"]}
        n = now or datetime.now(timezone.utc)
        parts = [f"{r['text']}, {_spoken_when(datetime.fromtimestamp(r['due'], zone), n.astimezone(zone))}" for r in rows[:5]]
        return {"reply": f"You have {len(rows)} reminder{'s' if len(rows) != 1 else ''}. " + "; ".join(parts) + ("." if len(rows) <= 5 else "; and more."), "tools": ["list_reminders"]}
    m = _CANCEL_RX.match(t)
    if m:
        what = (m.group(1) or m.group(2) or "").strip()
        if what in ("all", "everything") or len(what) < 3:
            return None  # clearing everything is for the AI to confirm
        n = db.cancel_reminders_matching(uid, what)
        return {"reply": f"Cancelled {n} reminder{'s' if n != 1 else ''} about {what}." if n else f"I could not find an upcoming reminder about {what}.", "tools": ["cancel_reminder"]}
    p = parse_reminder(raw, tz, now)
    if p:
        db.add_reminder(uid, p["text"], p["due"], p["repeat"], tz)
        return {"reply": f"Done. I will remind you to {p['text'][0].lower() + p['text'][1:]} {p['when'] if not p['repeat'] else p['repeat'] + ', starting ' + p['when']}.", "tools": ["set_reminder"]}
    return None


# ================================================================== 3. browser
SITES = {
    "youtube": "https://www.youtube.com", "google": "https://www.google.com", "gmail": "https://mail.google.com", "mail": "https://mail.google.com", "whatsapp": "https://web.whatsapp.com",
    "github": "https://github.com", "maps": "https://maps.google.com", "google maps": "https://maps.google.com", "facebook": "https://www.facebook.com", "fb": "https://www.facebook.com",
    "instagram": "https://www.instagram.com", "twitter": "https://x.com", "x": "https://x.com", "linkedin": "https://www.linkedin.com", "netflix": "https://www.netflix.com",
    "spotify": "https://open.spotify.com", "drive": "https://drive.google.com", "google drive": "https://drive.google.com", "docs": "https://docs.google.com", "sheets": "https://sheets.google.com",
    "calendar": "https://calendar.google.com", "meet": "https://meet.google.com", "claude": "https://claude.ai", "chatgpt": "https://chatgpt.com", "news": "https://news.google.com",
    "wikipedia": "https://www.wikipedia.org", "reddit": "https://www.reddit.com", "telegram": "https://web.telegram.org", "translate": "https://translate.google.com",
    "amazon": "https://www.amazon.com", "daraz": "https://www.daraz.pk", "tiktok": "https://www.tiktok.com", "outlook": "https://outlook.office.com", "stackoverflow": "https://stackoverflow.com",
    "stack overflow": "https://stackoverflow.com", "yt": "https://www.youtube.com",
}
ENGINES = {
    "google": "https://www.google.com/search?q=", "youtube": "https://www.youtube.com/results?search_query=", "yt": "https://www.youtube.com/results?search_query=",
    "bing": "https://www.bing.com/search?q=", "duckduckgo": "https://duckduckgo.com/?q=", "ddg": "https://duckduckgo.com/?q=", "wikipedia": "https://en.wikipedia.org/w/index.php?search=",
    "wiki": "https://en.wikipedia.org/w/index.php?search=", "amazon": "https://www.amazon.com/s?k=", "maps": "https://www.google.com/maps/search/", "google maps": "https://www.google.com/maps/search/",
    "images": "https://www.google.com/search?tbm=isch&q=", "google images": "https://www.google.com/search?tbm=isch&q=", "news": "https://news.google.com/search?q=",
    "reddit": "https://www.reddit.com/search/?q=", "github": "https://github.com/search?q=", "stackoverflow": "https://stackoverflow.com/search?q=", "daraz": "https://www.daraz.pk/catalog/?q=",
}
_ENG_RX = "|".join(sorted((re.escape(k) for k in ENGINES), key=len, reverse=True))
_SITE_RX = "|".join(sorted((re.escape(k) for k in SITES), key=len, reverse=True))


def find_site(name: str) -> Optional[str]:
    n = re.sub(r"^(?:the|my|a)\s+", "", name.strip())
    n = re.sub(r"\s+(?:website|site|app|page|dot com)$", "", n)
    if n in SITES:
        return SITES[n]
    if re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:/\S*)?", n):
        return "https://" + n
    return None


def _search_url(engine: str, q: str) -> str:
    return ENGINES[engine] + quote_plus(q)


# A plan is a list of steps: ("call", tool, args) | ("tab_delta", ±1) | ("tabs",) | ("open_result", n) | ("read_results",) | ("read_page",) | ("numbers",)
# plus metadata: needs = the user must have a browser linked (else a helpful message), say = the reply for a plain success.
Plan = Dict


def _p(steps: list, say: str, strong: bool = True) -> Plan:
    return {"steps": steps, "say": say, "strong": strong}


def parse_browser(text: str) -> Optional[Plan]:
    """Voice/typed text -> a plan for the user's browser, or None."""
    t = norm(text)
    if not t or len(t) > 220 or re.search(r"\b(?:then|and then|phir|uske baad)\b", t):
        return None  # several steps in one sentence: the AI plans those
    n = lambda s: _idx(s)  # noqa: E731
    NUMW = r"(\d{1,3}|zero|one|won|two|to|too|three|tree|four|for|five|six|seven|eight|ate|nine|ten|eleven|twelve|ek|aik|do|teen|char|panch|chhe|saat|aath|nau|das)"
    ORDW = r"(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|top|last|1st|2nd|3rd|4th|5th|pehla|pehli|dusra|doosra|teesra|\d{1,2})"

    # ---- tabs
    if re.fullmatch(r"(?:go to |switch to |move to |show )?(?:the )?next tab|agla tab(?: kholo| par jao)?|next tab par jao", t):
        return _p([("tab_delta", 1)], "Next tab.")
    if re.fullmatch(r"(?:go to |switch to |move to |show )?(?:the )?(?:previous|prev|last|back) tab|pichla tab(?: kholo| par jao)?|pehla wala tab", t):
        return _p([("tab_delta", -1)], "Previous tab.")
    m = re.fullmatch(r"(?:go to|switch to|show|open|jump to|activate|select) tab (?:number |no |#)?" + NUMW + r"|tab (?:number |no )?" + NUMW + r" (?:par jao|kholo|dikhao)", t)
    if m:
        return _p([("call", "chrome_switch", {"tab": str(int(n(m.group(1) or m.group(2))))})], "Switched.")
    m = re.fullmatch(r"(?:go to|switch to|show|open|jump to) (?:the )?([\w .-]{2,30}?) tab|([\w .-]{2,30}?) (?:wale |wala )?tab (?:par jao|kholo|dikhao)", t)
    if m and not re.match(r"^(?:new|next|previous|prev|last|back|this|current|another|a|my|other)$", (m.group(1) or m.group(2)).strip()) and not re.search(r"\bnew\b|\bbrowser\b|\bchrome\b", m.group(0)):
        return _p([("call", "chrome_switch", {"tab": (m.group(1) or m.group(2)).strip()})], "Switched.")
    if re.fullmatch(r"(?:close|shut) (?:this |the |current )?tab|(?:yeh |ye )?tab band karo|tab band kar do", t):
        return _p([("call", "chrome_close", {})], "Closed the tab.")
    m = re.fullmatch(r"close tab (?:number |no |#)?" + NUMW, t)
    if m:
        return _p([("call", "chrome_close", {"tab": str(int(n(m.group(1))))})], "Closed.")
    if re.fullmatch(r"(?:open |make |create )?(?:a )?new tab|naya tab(?: kholo| khol do)?", t):
        return _p([("call", "chrome_open", {"url": "https://www.google.com"})], "New tab.")
    if re.fullmatch(r"(?:list|show|read|what(?:'s| are| is)) (?:my |the |all )?(?:open )?tabs(?: (?:do i have |are open))?|which tabs are open|tabs (?:dikhao|batao)", t):
        return _p([("tabs",)], "")

    # ---- search / play
    m = re.fullmatch(r"(?:play|chalao|laga do|lagao) (.{2,80}?) (?:on|in|par|pe) (?:youtube|yt)|(?:youtube|yt) (?:par|pe|per|mein) (.{2,80}?) (?:play |chalao|laga do|lagao)|(?:youtube|yt) play (.{2,80})", t)
    if m:
        q = next(g for g in m.groups() if g)
        return _p([("call", "chrome_youtube_play", {"query": q})], "")
    m = re.fullmatch(r"(?:search|look up|find|google)(?: for)? (.{2,100}?) (?:on|in|at|par|pe|per|mein) (" + _ENG_RX + r")(?: and (?:open|click|play) (?:the )?" + ORDW + r"(?: (?:result|one|link|video))?)?|(?:" + _ENG_RX + r") (?:search|par search karo)(?: for)? (.{2,100})", t)
    if m:
        eng = (m.group(2) or "").strip() or None
        q = (m.group(1) or m.group(4) or "").strip()
        if not eng:
            eng = re.match(r"(" + _ENG_RX + ")", t).group(1)
        steps = [("call", "chrome_open", {"url": _search_url(eng, q)})]
        if m.group(3):
            steps += [("wait", 1200), ("open_result", n(m.group(3)) or 1)]
        return _p(steps, f"Searching {eng} for {q}.")
    m = re.fullmatch(r"(?:search|look up|google|find|search for|google search)(?: for)? (.{2,100}?)(?: and (?:open|click|go to|play) (?:the )?" + ORDW + r"(?: (?:result|one|link|video|website|page))?)?|(.{2,100}?) (?:search karo|google karo|dhoondo|dhundo|search kar do)", t)
    if m and not re.match(r"^(?:on this page|in this page|this page|the page|on the page|for .* on the page)", m.group(1) or ""):
        q = (m.group(1) or m.group(3) or "").strip()
        if q and not re.search(r"\b(?:on|in) (?:this|the) page$|\bon page$", q) and not re.match(r"^(?:my|the)\s+(?:notes|tasks|memory|memories|files|reminders|meetings)\b", q):
            steps = [("call", "chrome_open", {"url": _search_url("google", q)})]
            if m.group(2):
                steps += [("wait", 1200), ("open_result", n(m.group(2)) or 1)]
            return _p(steps, f"Searching for {q}.", strong=False)
    m = re.fullmatch(r"(?:open|click|go to|play|select|kholo) (?:the )?" + ORDW + r" (?:search )?(?:result|link|video|one)(?: wala)?|(?:open|click) result (?:number |no |#)?" + NUMW + r"|(?:result|link) (?:number |no )?" + NUMW + r" (?:kholo|open karo)|" + ORDW + r" (?:result|link) (?:kholo|open karo|par click karo)", t)
    if m:
        g = next((x for x in m.groups() if x), "1")
        return _p([("open_result", n(g) or 1)], "")
    if re.fullmatch(r"(?:read|tell me|what are) (?:me )?(?:the )?(?:top |first )?(?:search )?results|results (?:padho|sunao|batao)", t):
        return _p([("read_results",)], "")

    # ---- open / go
    m = re.fullmatch(r"(?:open|launch|visit|start|kholo|khol do) (?:the )?(.{2,60}?) (?:in a new tab|in new tab|in the browser|in my browser|in chrome)|(?:open|visit) (?:a )?new tab (?:with|for|to) (.{2,60})", t)
    if m:
        site = find_site((m.group(1) or m.group(2)).strip())
        if site:
            return _p([("call", "chrome_open", {"url": site})], "Opening it in a new tab.")
    m = re.fullmatch(r"(?:go to|navigate to|take me to|jao|visit) (?:the )?(.{2,60})", t)
    if m:
        site = find_site(m.group(1).strip())
        if site:
            return _p([("call", "chrome_go", {"url": site})], "On my way.")
    m = re.fullmatch(r"(?:open|kholo) (.{2,40}?)(?: kholo| open karo)?|(.{2,40}?) (?:kholo|khol do|open karo)", t)
    if m:
        name = (m.group(1) or m.group(2)).strip()
        site = SITES.get(name) or (find_site(name) if "." in name else None)
        if site:
            return _p([("call", "chrome_open", {"url": site})], "Opening it.", strong=False)

    # ---- the page
    if re.fullmatch(r"(?:go )?back|go back|(?:previous|pichla) page|wapas jao|peeche jao", t):
        return _p([("call", "chrome_nav", {"action": "back"})], "Back.", strong=False)
    if re.fullmatch(r"(?:go )?forward|go forward|next page|aage jao", t):
        return _p([("call", "chrome_nav", {"action": "forward"})], "Forward.", strong=False)
    if re.fullmatch(r"(?:reload|refresh)(?: (?:the |this )?(?:page|tab))?|page (?:reload|refresh) karo|refresh karo", t):
        return _p([("call", "chrome_nav", {"action": "reload"})], "Reloading.", strong=False)
    m = re.fullmatch(r"(?:scroll |go |move |page )?(up|down)(?: (a lot|a little|a bit|more|fast|slowly|(?:by )?" + NUMW + r" (?:pages|screens)))?|(?:neeche|niche|upar|oopar) (?:scroll )?(?:karo|jao|le jao)|scroll (?:karo )?(neeche|niche|upar|oopar)|(?:page )(down|up)", t)
    if m:
        w = next((g for g in (m.group(1), m.group(4), m.group(5)) if g), t)
        up = bool(re.search(r"up|upar|oopar", w)) and "down" not in w
        amt = 3 if re.search(r"a lot|fast", t) else 0.4 if re.search(r"little|bit|slowly", t) else 1
        if m.group(3):
            amt = n(m.group(3)) or 1
        return _p([("call", "chrome_scroll", {"direction": "up" if up else "down", "amount": amt})], "", strong=False)
    m = re.fullmatch(r"(?:scroll |go |jump )?(?:to )?(?:the )?(top|bottom|end|beginning|start)(?: of (?:the )?page)?|(?:upar|oopar|neeche|niche) (?:tak )?(?:jao|scroll karo)", t)
    if m:
        top = bool(re.search(r"top|beginning|start|upar|oopar", m.group(1) or t))
        return _p([("call", "chrome_scroll", {"direction": "top" if top else "bottom"})], "Top." if top else "Bottom.", strong=False)
    m = re.fullmatch(r"(?:find|search|look for|search for|find me|dhoondo) (.{2,60}?) (?:on|in) (?:this |the )?(?:page|site|website|tab)|(?:find|search for) (?:on (?:this |the )?page|in (?:this |the )?page) (.{2,60})|(?:page (?:mein|me|par)) (.{2,60}?) (?:dhoondo|find karo)", t)
    if m:
        return _p([("call", "chrome_find", {"text": next(g for g in m.groups() if g).strip()})], "", strong=False)
    if re.fullmatch(r"(?:read|tell me what(?:'s| is) on) (?:me )?(?:this |the |current )?(?:page|tab|article|site|website)(?: aloud| out loud)?|page (?:padho|sunao)|(?:yeh |ye )?page padho", t):
        return _p([("read_page",)], "", strong=False)
    if re.fullmatch(r"(?:show|display|highlight|label|number)(?: me)?(?: the)? (?:numbers|links|buttons|clickable (?:things|items)|elements|options)(?: on (?:the |this )?(?:page|tab))?|numbers (?:dikhao|show karo)", t):
        return _p([("numbers",)], "")
    if re.fullmatch(r"(?:hide|remove|clear) (?:the )?numbers", t):
        return _p([("call", "chrome_elements", {"hide": True})], "Numbers hidden.", strong=False)
    m = re.fullmatch(r"(?:click|press|tap|hit|select|choose|open|activate)(?: on)?(?: the)? (?:number|no|item|link|button|element|#)? ?" + NUMW + r"|" + NUMW + r" (?:par|pe) click karo", t)
    if m:
        i = n(next(g for g in m.groups() if g))
        if i:
            return _p([("call", "chrome_click", {"index": i})], "Clicked.", strong=False)
    m = re.fullmatch(r"(?:click|press|tap|hit|select|choose)(?: on)?(?: the)? (.{2,50}?)(?: button| link| tab| option| icon)?|(.{2,50}?) (?:button |ko |par )?(?:click karo|dabao|press karo|tap karo)", t)
    if m:
        what = (m.group(1) or m.group(2)).strip()
        if not re.fullmatch(r"(?:it|that|this|here|enter|return|tab|escape|esc|space|backspace|number \w+|the page)", what) and not re.fullmatch(NUMW, what) and not re.search(r"\b(?:and|aur)\b", what):
            return _p([("call", "chrome_click", {"text": what})], "Clicked.", strong=False)
    m = re.fullmatch(r"(?:type|write|enter|dictate|likho|likh do) (.{1,150}?)(?: (?:in|into|in the|into the|on the) (?:the )?(.{2,30}?) (?:box|field|bar|input|area))?( and (?:press enter|submit|search|go))?", t)
    if m and not re.match(r"^(?:a (?:note|reminder|task|message|email)|my )", m.group(1)):
        args = {"text": m.group(1).strip()}
        if m.group(2):
            args["field"] = m.group(2).strip()
        if m.group(3):
            args["submit"] = True
        return _p([("call", "chrome_type", args)], "Typed.", strong=False)
    m = re.fullmatch(r"(?:press|hit) (enter|return|tab|escape|esc|space|backspace|page down|page up|home|end|down|up|left|right|control a|ctrl a|select all)|(?:submit|enter dabao)", t)
    if m:
        k = (m.group(1) or "enter").replace(" ", "")
        k = {"pagedown": "pagedown", "pageup": "pageup", "controla": "ctrl+a", "ctrla": "ctrl+a", "selectall": "ctrl+a", "return": "enter"}.get(k, k)
        return _p([("call", "chrome_key", {"keys": k})], "Done.", strong=False)
    if re.fullmatch(r"(?:take|grab|capture) (?:a )?(?:screenshot|screen shot|picture of (?:the |this )?(?:page|screen))|screenshot (?:lo|le lo|karo)", t):
        return _p([("call", "chrome_screenshot", {})], "", strong=False)

    # ---- video / audio in the page
    media = [
        (r"(?:pause|stop)(?: the| this)?(?: video| song| music| playback| it)?|(?:video |song )?(?:roko|ruko|pause karo)", ("pause", None), "Paused."),
        (r"(?:play|resume|continue|unpause)(?: the| this)?(?: video| song| music| playback)?|(?:video |song )?(?:chalao|shuru karo|play karo)", ("play", None), "Playing."),
        (r"mute(?: the| this)?(?: video| sound| tab)?|awaaz band karo", ("mute", None), "Muted."),
        (r"unmute(?: the| this)?(?: video| sound| tab)?|awaaz kholo", ("unmute", None), "Unmuted."),
        (r"(?:full ?screen)(?: the| this)?(?: video)?|(?:video )?full ?screen karo|exit full ?screen", ("fullscreen", None), "Done."),
        (r"(?:turn |make )?(?:the )?(?:video |sound |volume )?(?:volume )?up|louder|awaaz (?:barhao|tez karo)", ("volume", "up"), "Louder."),
        (r"(?:turn |make )?(?:the )?(?:video |sound |volume )?(?:volume )?down|quieter|softer|awaaz (?:kam karo|dheemi karo)", ("volume", "down"), "Quieter."),
        (r"(?:next|skip)(?: the)? (?:video|song|track)|agla (?:video|gana)", ("next", None), "Next."),
        (r"(?:turn )?(?:on |off )?(?:the )?(?:captions|subtitles)(?: on| off)?", ("captions", None), "Done."),
    ]
    for rxs, (act, val), say in media:
        if re.fullmatch(rxs, t) and not (act == "volume" and not re.search(r"volume|louder|quieter|softer|awaaz|video|sound", t)):
            return _p([("call", "chrome_media", {"action": act, **({"value": val} if val else {})})], say, strong=False)
    m = re.fullmatch(r"(?:skip|forward|go forward|fast forward|seek|jump) (?:ahead |forward )?(?:by )?(\d{1,4}|a minute|ten|thirty|five|fifteen|twenty|sixty) ?(?:seconds?|secs?|minutes?|mins?)?(?: ahead| forward)?", t)
    if m:
        s = 60 if m.group(1) == "a minute" else (n(m.group(1)) or 10)
        if re.search(r"minutes?|mins?", t) and m.group(1) != "a minute":
            s *= 60
        return _p([("call", "chrome_media", {"action": "seek", "value": str(int(s))})], "Skipping ahead.", strong=False)
    m = re.fullmatch(r"(?:rewind|go back|back|replay|skip back|seek back)(?: by)? (\d{1,4}|ten|thirty|five|fifteen|twenty|sixty) ?(?:seconds?|secs?)", t)
    if m:
        return _p([("call", "chrome_media", {"action": "seek", "value": str(-int(n(m.group(1)) or 10))})], "Rewinding.", strong=False)
    m = re.fullmatch(r"(?:set |change |play at )?(?:the )?(?:video |playback )?speed(?: to)? (\d(?:\.\d+)?)(?:x| times)?|(\d(?:\.\d+)?)x speed|normal speed", t)
    if m:
        v = m.group(1) or m.group(2) or "1"
        return _p([("call", "chrome_media", {"action": "speed", "value": v})], f"Speed {v}.", strong=False)
    return None


def needs_browser_message() -> str:
    return ("I can do that in your browser once it is linked: install the Aegis Web Hands extension, then in Settings choose Browser control and "
            "copy the connection code into it.")


_CAND = re.compile(r"^(\d+) \[link(?:,[^\]]*)?\] (.*?)(?: \(label:[^)]*\))?(?: → (\S+))?$")
_NOISE_HOSTS = ("accounts.google.", "support.google.", "policies.google.", "maps.google.", "webcache.", "translate.google.", "google.com/preferences", "google.com/advanced_search")


def result_candidates(listing: str) -> List[dict]:
    """Search-result style links from a chrome_elements listing: [{i, text, href}] in page order."""
    lines = listing.splitlines()
    head = lines[0] if lines else ""
    page_host = urlparse(head.split(" — ")[-1].strip()).netloc.lower() if " — " in head else ""
    out, seen = [], set()
    for ln in lines[1:]:
        m = _CAND.match(ln.strip())
        if not m:
            continue
        i, text, href = int(m.group(1)), m.group(2).strip(), (m.group(3) or "")
        if len(text) < 12 or not href.startswith("http") or any(h in href for h in _NOISE_HOSTS):
            continue
        host = urlparse(href).netloc.lower()
        same = host == page_host or host.endswith("." + page_host) or page_host.endswith("." + host)
        on_search = any(k in page_host for k in ("google.", "bing.", "duckduckgo.", "yahoo.", "youtube."))
        if same and not (on_search and ("/url?" in href or "/watch" in href or "/ck/a" in href or "duckduckgo.com/l/" in href)) and not ("youtube." in page_host and "/watch" in href):
            continue
        key = re.sub(r"[?#].*$", "", href)
        if key in seen:
            continue
        seen.add(key)
        out.append({"i": i, "text": re.sub(r"\s+", " ", text)[:90], "href": href})
    return out


Caller = Callable[[str, dict], Awaitable[str]]


async def run_browser_plan(plan: Plan, call: Caller) -> Optional[dict]:
    """Execute a plan. Returns {reply, tools} or None when it must be handed to the AI (an action that needs approval)."""
    import asyncio

    used: List[str] = []
    last = ""
    say = plan.get("say", "")

    def fail(msg: str) -> dict:
        msg = re.sub(r"^Error:\s*", "", msg).strip()
        return {"reply": "That did not work: " + msg[:200], "tools": used}

    for step in plan["steps"]:
        kind = step[0]
        if kind == "wait":
            await asyncio.sleep(step[1] / 1000)
            continue
        if kind == "call":
            used.append(step[1])
            args = step[2]
            last = str(await call(step[1], args))
            if last.startswith("NEEDS_APPROVAL"):
                return None
            if last.startswith("Error"):
                return fail(last)
        elif kind == "tab_delta":
            used += ["chrome_tabs", "chrome_switch"]
            listing = str(await call("chrome_tabs", {}))
            if listing.startswith("Error"):
                return fail(listing)
            rows = [re.match(r"^(\d+)(\*| ) ", ln) for ln in listing.splitlines()]
            rows = [r for r in rows if r]
            if len(rows) < 2:
                return {"reply": "There is only one tab open.", "tools": used}
            cur = next((int(r.group(1)) for r in rows if r.group(2) == "*"), 1)
            target = (cur - 1 + step[1]) % len(rows) + 1
            last = str(await call("chrome_switch", {"tab": str(target)}))
            if last.startswith("Error"):
                return fail(last)
            title = re.sub(r" — https?://\S*$", "", last.replace("Switched to: ", "")).strip()
            return {"reply": f"{'Next' if step[1] > 0 else 'Previous'} tab: {title[:60]}." if title else say, "tools": used}
        elif kind == "tabs":
            used.append("chrome_tabs")
            listing = str(await call("chrome_tabs", {}))
            if listing.startswith("Error"):
                return fail(listing)
            titles = []
            for ln in listing.splitlines():
                m = re.match(r"^\d+[* ] (.*?) — https?://", ln)
                if m:
                    titles.append(m.group(1).strip())
            if not titles:
                return {"reply": "No tabs are open.", "tools": used}
            return {"reply": f"You have {len(titles)} tab{'s' if len(titles) != 1 else ''} open: " + ", ".join(f"{i + 1} {t[:40]}" for i, t in enumerate(titles[:8])) + ("." if len(titles) <= 8 else ", and more."), "tools": used}
        elif kind in ("open_result", "read_results"):
            used.append("chrome_elements")
            listing = str(await call("chrome_elements", {}))
            if listing.startswith("Error"):
                return fail(listing)
            cands = result_candidates(listing)
            if not cands:
                return {"reply": "I can't see any results on this page. Say show numbers to see what is clickable.", "tools": used}
            if kind == "read_results":
                return {"reply": "The top results: " + "; ".join(f"{i + 1}, {c['text'][:70]}" for i, c in enumerate(cands[:5])) + ".", "tools": used}
            k = step[1]
            pick = cands[-1] if k == -1 else cands[k - 1] if 0 < k <= len(cands) else None
            if not pick:
                return {"reply": f"There is no result number {k}; I can see {len(cands)}.", "tools": used}
            used.append("chrome_click")
            last = str(await call("chrome_click", {"index": pick["i"]}))
            if last.startswith("NEEDS_APPROVAL"):
                return None
            if last.startswith("Error"):
                return fail(last)
            return {"reply": f"Opening {pick['text'][:70]}.", "tools": used}
        elif kind == "numbers":
            used.append("chrome_elements")
            listing = str(await call("chrome_elements", {"badges": True}))
            if listing.startswith("Error"):
                return fail(listing)
            items = [re.match(r"^(\d+) \[[^\]]*\] (.*?)(?: \(|$| → | =)", ln) for ln in listing.splitlines()[1:]]
            items = [(m.group(1), m.group(2).strip()) for m in items if m and m.group(2).strip()]
            total = len([ln for ln in listing.splitlines()[1:] if re.match(r"^\d+ \[", ln)])
            names = ", ".join(f"{i} {t[:28]}" for i, t in items[:6])
            return {"reply": f"I can see {total} things you can click. " + (names + ". " if names else "") + 'Say "click" and a number.', "tools": used}
        elif kind == "read_page":
            used.append("chrome_read")
            page = str(await call("chrome_read", {}))
            if page.startswith("Error"):
                return fail(page)
            parts = page.split("\n\n", 1)
            title = parts[0].splitlines()[0] if parts and parts[0] else ""
            body = re.sub(r"\s+", " ", parts[1] if len(parts) > 1 else "").strip()
            snippet = body[:450]
            if len(body) > 450:
                cut = max(snippet.rfind(". "), snippet.rfind("? "))
                snippet = snippet[: cut + 1] if cut > 150 else snippet + "..."
            return {"reply": (f"{title}. " if title else "") + (snippet or "The page has no readable text."), "tools": used}
    if not say:
        # tools whose own answer is the reply
        if used and used[-1] in ("chrome_youtube_play", "chrome_find", "chrome_screenshot"):
            return {"reply": re.sub(r"\s+", " ", last)[:300], "tools": used}
        return {"reply": "Done.", "tools": used}
    if used and used[-1] == "chrome_scroll" and "end" in last:
        return {"reply": "That is the end of the page.", "tools": used}
    return {"reply": say, "tools": used}


# ================================================================== entry point
async def try_fast(uid: int, text: str, tz: str, hub, db, now: Optional[datetime] = None) -> Optional[dict]:
    """Handle `text` without the AI when it is one of the instant commands above. {reply, tools} or None."""
    raw = " ".join(str(text or "").split())
    if not raw or len(raw) > 240:
        return None
    t = norm(raw)
    r = await _reminders_and_memory(uid, raw, t, tz, db, now)
    if r:
        return r
    plan = parse_browser(raw)
    if not plan:
        return None
    if not hub.can_chrome(uid):
        return {"reply": needs_browser_message(), "tools": []} if plan.get("strong") else None

    async def call(name: str, args: dict) -> str:
        return await hub.call_device(uid, name, args)

    return await run_browser_plan(plan, call)
