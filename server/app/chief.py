"""v12 "chief-of-staff" layer: proactive alerts, free-time finder, evening review, deep research, systems check.

Everything here is plain functions over the database / utilities so it is easy to test and the agent,
the websocket alert loop and the REST API can all share it.
"""
import re
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from . import extras, heart, mail, settings, smarthome, tts, utilities

ALERT_LEAD_MIN = 15          # "your meeting starts in 15 minutes"
HABIT_NUDGE_HOUR = 20        # open habits are mentioned once, after 8 pm local time
SPEND_MIN_DAYS = 5           # need this many days of history before calling today's spending "unusual"
SPEND_FACTOR = 2.5


def _fmt_minutes(mins: int) -> str:
    if mins <= 0:
        return "right now"
    return f"in {mins} minute{'s' if mins != 1 else ''}"


# ------------------------------------------------------------------ proactive alerts
def proactive_alerts(db, uid: int, tz: str = "", now: datetime = None) -> list:
    """Things worth telling the user without being asked. Returns [{key, level, text}].

    `key` is stable for the same situation (e.g. one event, one evening), so the caller can send each only once.
    """
    zone = utilities.get_zone(tz)
    now = now.astimezone(zone) if now else datetime.now(zone)
    out = []

    # 1) an event is about to start
    soon = db.events_between(uid, now.timestamp(), now.timestamp() + ALERT_LEAD_MIN * 60 + 1)
    for e in soon:
        if e["start"] < now.timestamp() - 60:
            continue  # already running: not "about to start"
        mins = max(0, int(round((e["start"] - now.timestamp()) / 60)))
        text = f"Heads up: {e['title']} starts {_fmt_minutes(mins)}" + (f" at {e['location']}" if e["location"] else "") + "."
        out.append({"key": f"event:{e['id']}", "level": "urgent", "text": text})

    # 2) habits still open in the evening
    if now.hour >= HABIT_NUDGE_HOUR:
        open_h = [h for h in extras.habit_report(db, uid, tz, now) if not h["done_today"]]
        if open_h:
            names = ", ".join(h["name"] for h in open_h[:3])
            risky = [h for h in open_h if h["streak"] >= 3]
            tail = f" Your {risky[0]['streak']}-day streak on {risky[0]['name']} is on the line." if risky else ""
            out.append({"key": f"habits:{now.date().isoformat()}", "level": "info", "text": f"Still open today: {names}.{tail}"})

    # 2b) birthdays and anniversaries they told us about
    for sd in heart.special_days(db, uid, tz, now):
        out.append({"key": sd["key"], "level": "info", "text": f"A date to remember: {sd['text']} ({sd['when']}). Want me to set a reminder or help you write something?"})

    # 3) unusually high spending today (same currency only, needs some history)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_rows = [r for r in db.expenses_between(uid, day0.timestamp(), day0.timestamp() + 86400) if r["currency"] == "PKR"]
    today_total = sum(r["amount"] for r in today_rows)
    if today_total > 0:
        past = [r for r in db.expenses_between(uid, day0.timestamp() - 30 * 86400, day0.timestamp()) if r["currency"] == "PKR"]
        days = {datetime.fromtimestamp(r["spent"], zone).date() for r in past}
        if len(days) >= SPEND_MIN_DAYS:
            avg = sum(r["amount"] for r in past) / len(days)
            if avg > 0 and today_total > avg * SPEND_FACTOR:
                out.append({"key": f"spend:{now.date().isoformat()}", "level": "info",
                            "text": f"You have spent {extras.money(today_total)} PKR today, well above your usual {extras.money(avg)} PKR a day."})
    return out


# ------------------------------------------------------------------ free time
def free_slots(db, uid: int, tz: str = "", date_str: str = "", minutes: int = 30, start_hour: int = 9, end_hour: int = 18, now: datetime = None) -> str:
    zone = utilities.get_zone(tz)
    now = now.astimezone(zone) if now else datetime.now(zone)
    try:
        minutes = max(5, min(int(float(minutes or 30)), 600))
        start_hour = max(0, min(int(float(start_hour if start_hour is not None else 9)), 23))
        end_hour = max(1, min(int(float(end_hour if end_hour is not None else 18)), 24))
    except (TypeError, ValueError):
        return "Error: minutes and hours must be numbers."
    if end_hour <= start_hour:
        return "Error: end_hour must be later than start_hour."
    if date_str:
        try:
            day = datetime.strptime(date_str.strip(), "%Y-%m-%d").replace(tzinfo=zone)
        except ValueError:
            return "Error: date must look like 2026-11-24."
    else:
        day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hi = day + timedelta(hours=end_hour)
    lo = day + timedelta(hours=start_hour)
    if lo.date() == now.date() and now > lo:
        lo = now + timedelta(minutes=(5 - now.minute % 5) % 5)  # today: only what is still ahead, rounded up to 5 min
        lo = lo.replace(second=0, microsecond=0)
    if hi <= lo:
        return f"The working window for {day.strftime('%A %d %B')} is already over."
    busy = sorted((max(e["start"], lo.timestamp()), min(e["end"] or e["start"] + 3600, hi.timestamp())) for e in db.events_between(uid, lo.timestamp(), hi.timestamp()))
    slots, cur = [], lo.timestamp()
    for s, e in busy:
        if s - cur >= minutes * 60:
            slots.append((cur, s))
        cur = max(cur, e)
    if hi.timestamp() - cur >= minutes * 60:
        slots.append((cur, hi.timestamp()))
    label = day.strftime("%A %d %B")
    if not slots:
        return f"No free gap of {minutes} minutes on {label} between {lo.strftime('%H:%M')} and {hi.strftime('%H:%M')}."
    lines = []
    for s, e in slots[:8]:
        a, b = datetime.fromtimestamp(s, zone), datetime.fromtimestamp(e, zone)
        lines.append(f"- {a.strftime('%H:%M')}-{b.strftime('%H:%M')} ({int((e - s) // 60)} min free)")
    return f"Free time of at least {minutes} minutes on {label}:\n" + "\n".join(lines)


# ------------------------------------------------------------------ evening review
def evening_review(db, uid: int, tz: str = "", now: datetime = None) -> str:
    zone = utilities.get_zone(tz)
    now = now.astimezone(zone) if now else datetime.now(zone)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    parts = [f"Now: {now.strftime('%A, %d %B %Y, %H:%M')}"]

    tasks = db.tasks(uid, include_done=True)
    done = [t for t in tasks if t["done"]]
    open_ = [t for t in tasks if not t["done"]]
    parts.append(f"Tasks: {len(done)} completed in total, {len(open_)} still open" + (":\n" + "\n".join(f"- {t['text']}" for t in open_[:8]) if open_ else "."))

    habits = extras.habit_report(db, uid, tz, now)
    if habits:
        ok = [h for h in habits if h["done_today"]]
        miss = [h for h in habits if not h["done_today"]]
        line = f"Habits: {len(ok)} of {len(habits)} done today."
        if ok:
            line += " Done: " + ", ".join(f"{h['name']} (streak {h['streak']})" for h in ok) + "."
        if miss:
            line += " Not yet: " + ", ".join(h["name"] for h in miss) + "."
        parts.append(line)

    rows = db.expenses_between(uid, day0.timestamp(), day0.timestamp() + 86400)
    parts.append(extras.describe_expenses(rows, "today") if rows else "Spending today: nothing logged.")

    ev = db.events_between(uid, day0.timestamp() + 86400, day0.timestamp() + 2 * 86400)
    parts.append("Tomorrow's calendar:\n" + ("\n".join(f"- {datetime.fromtimestamp(e['start'], zone).strftime('%H:%M')}: {e['title']}" + (f" @ {e['location']}" if e["location"] else "") for e in ev[:8]) if ev else "nothing scheduled yet"))

    rem = [r for r in db.reminders(uid) if r["due"] < day0.timestamp() + 2 * 86400][:6]
    if rem:
        parts.append("Reminders coming up:\n" + "\n".join(f"- {datetime.fromtimestamp(r['due'], zone).strftime('%a %H:%M')}: {r['text']}" for r in rem))

    moods = db.moods(uid, since=day0.timestamp())
    if moods:
        parts.append("Mood signals today: " + ", ".join(sorted({m["mood"] for m in moods})) + ".")
    return "\n\n".join(parts)


# ------------------------------------------------------------------ deep research
def _clip(text: str, n: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text[:n]


def deep_research(topic: str, depth: int = 3, search=None, fetch=None) -> str:
    """Search the web from a few angles, read the best pages and hand the AI the raw material to write a briefing.

    `search(query) -> [(title, url, snippet)]` and `fetch(url) -> text` can be swapped out in tests.
    """
    topic = " ".join(str(topic or "").split())[:200]
    if len(topic) < 3:
        return "Error: say what to research."
    try:
        depth = max(1, min(int(float(depth or 3)), 5))
    except (TypeError, ValueError):
        depth = 3
    search = search or _ddg_rows
    fetch = fetch or (lambda u: utilities.fetch_page(u, 3500))

    angles = [topic, f"{topic} latest news", f"{topic} explained overview", f"{topic} pros and cons", f"{topic} statistics facts"][: max(2, depth)]
    seen, hits = set(), []
    with ThreadPoolExecutor(max_workers=len(angles)) as pool:
        results = list(pool.map(lambda q: _safe(search, q), angles))
    for rows in results:
        for title, url, snippet in rows:
            host = urllib.parse.urlparse(url).netloc.lower().removeprefix("www.")
            if url in seen or host in {h for _, h, _, _ in hits}:
                continue  # one page per site keeps the sources varied
            seen.add(url)
            hits.append((title, host, url, snippet))
    if not hits:
        return f"Error: web search is not reachable right now, or found nothing for {topic}."

    chosen = hits[: depth + 1]
    with ThreadPoolExecutor(max_workers=len(chosen)) as pool:
        bodies = list(pool.map(lambda h: _safe(fetch, h[2], ""), chosen))
    blocks = []
    for i, ((title, host, url, snippet), body) in enumerate(zip(chosen, bodies), 1):
        body = "" if str(body).startswith("Error") else _clip(str(body), 1000)
        blocks.append(f"[{i}] {title} ({host})\n{url}\n" + (body or snippet or "(no text)"))
    extra = [f"- {t} ({h}): {url}" for t, h, url, _ in hits[len(chosen): len(chosen) + 4]]
    out = (f"Research material on: {topic}. Write a clear briefing from it: key findings first, note where sources disagree, "
           "name the sources, and say what is uncertain.\n\n" + "\n\n".join(blocks))
    if extra:
        out += "\n\nMore sources:\n" + "\n".join(extra)
    return out


def _ddg_rows(query: str):
    html = utilities._fetch_raw("https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query))
    return utilities.parse_search_html(html, 6)


def _safe(fn, arg, default=None):
    try:
        return fn(arg)
    except Exception:
        return [] if default is None else default


# ------------------------------------------------------------------ systems check
def systems_report(db, uid: int, device_connected: bool, now: datetime = None, tz: str = "") -> str:
    zone = utilities.get_zone(tz)
    now = now.astimezone(zone) if now else datetime.now(zone)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    ev_today = db.events_between(uid, now.timestamp(), day0.timestamp() + 86400)
    lines = [
        f"{settings.APP_NAME} systems check, {now.strftime('%H:%M')}:",
        f"- Desktop link: {'online (PC control available)' if device_connected else 'offline (open the Windows app for PC control)'}",
        f"- Voice: {'studio voice ready' if tts.available() else 'browser voice'}",
        f"- Email sending: {'ready' if mail.smtp_configured() else 'not configured (drafts only)'}; inbox reading: {'ready' if mail.imap_configured() else 'not configured'}",
        f"- Smart home: {'connected' if smarthome.configured() else 'not configured'}",
        f"- Memory: {len(db.facts(uid))} things remembered",
        f"- Open tasks: {len([t for t in db.tasks(uid, include_done=False)])}; reminders waiting: {len(db.reminders(uid))}; events left today: {len(ev_today)}",
    ]
    return "\n".join(lines)


# ------------------------------------------------------------------ greeting data for the app's welcome line
def brief(db, uid: int, tz: str = "", now: datetime = None) -> dict:
    """A few numbers for the welcome greeting: part of day, open tasks, events left today, the next event."""
    zone = utilities.get_zone(tz)
    now = now.astimezone(zone) if now else datetime.now(zone)
    day_end = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    left = [e for e in db.events_between(uid, now.timestamp(), day_end.timestamp()) if e["start"] >= now.timestamp() - 60]
    h = now.hour
    part = "morning" if 4 <= h < 12 else "afternoon" if 12 <= h < 17 else "evening" if 17 <= h < 22 else "night"
    nxt = left[0] if left else None
    return {
        "part": part,
        "tasks_open": len(db.tasks(uid, include_done=False)),
        "events_left": len(left),
        "next_event": ({"title": nxt["title"], "at": datetime.fromtimestamp(nxt["start"], zone).strftime("%H:%M")} if nxt else None),
        "habits_open": len([x for x in extras.habit_report(db, uid, tz, now) if not x["done_today"]]),
        "callback": heart.callback(db, uid, now.timestamp()),
        "away_days": _away_days(db.bond_row(uid), now.timestamp()),
    }


def _away_days(row: dict, now_ts: float) -> int:
    """Whole days since they last talked to Aegis (0 for a brand-new user)."""
    last = row.get("last") or 0
    return int((now_ts - last) // 86400) if last else 0
