"""v11 extras: expenses, habits with streaks, prayer times, cross-search and database backups.

Everything here is plain functions on top of db.py / utilities.py, so the REST API and the AI tools share one implementation.
"""
import glob
import os
import time
import urllib.parse
from datetime import date, datetime, timedelta

from . import utilities

# ------------------------------------------------------------------ backups


def make_backup(db, folder: str, keep: int = 7) -> str:
    """Write aegis-YYYYmmdd-HHMMSS.db into `folder` and delete the oldest copies beyond `keep`. Returns the new path."""
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, time.strftime("aegis-%Y%m%d-%H%M%S.db"))
    db.backup_to(path)
    old = sorted(glob.glob(os.path.join(folder, "aegis-*.db")))
    for f in old[: max(0, len(old) - max(1, keep))]:
        try:
            os.remove(f)
        except OSError:
            pass
    return path


# ------------------------------------------------------------------ expenses

PERIODS = {"today": 1, "week": 7, "month": 30, "year": 365}


def period_bounds(period: str, tz: str = "", now: datetime = None):
    """(start_ts, end_ts, label) for 'today', 'yesterday', 'week' (last 7 days), 'month' (this calendar month), 'year' or 'last_month'."""
    zone = utilities.get_zone(tz)
    now = now.astimezone(zone) if now else datetime.now(zone)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    period = (period or "month").strip().lower().replace(" ", "_")
    if period == "today":
        return day0.timestamp(), (day0 + timedelta(days=1)).timestamp(), "today"
    if period == "yesterday":
        return (day0 - timedelta(days=1)).timestamp(), day0.timestamp(), "yesterday"
    if period == "week":
        return (day0 - timedelta(days=6)).timestamp(), (day0 + timedelta(days=1)).timestamp(), "the last 7 days"
    if period == "year":
        start = day0.replace(month=1, day=1)
        return start.timestamp(), (day0 + timedelta(days=1)).timestamp(), f"{now.year}"
    first = day0.replace(day=1)
    if period == "last_month":
        prev = (first - timedelta(days=1)).replace(day=1)
        return prev.timestamp(), first.timestamp(), prev.strftime("%B %Y")
    return first.timestamp(), (day0 + timedelta(days=1)).timestamp(), first.strftime("%B %Y") if period != "month" else "this month"


def expense_totals(rows):
    """{'by_currency': {'PKR': {'total': 1200.0, 'by_category': {'food': 800.0}}}, 'count': n}"""
    out = {}
    for r in rows:
        cur = out.setdefault(r["currency"], {"total": 0.0, "by_category": {}})
        cur["total"] = round(cur["total"] + r["amount"], 2)
        cur["by_category"][r["category"]] = round(cur["by_category"].get(r["category"], 0.0) + r["amount"], 2)
    return {"by_currency": out, "count": len(rows)}


def money(x: float) -> str:
    return f"{x:,.0f}" if abs(x - round(x)) < 0.005 else f"{x:,.2f}"


def describe_expenses(rows, label: str) -> str:
    if not rows:
        return f"No expenses recorded for {label}."
    t = expense_totals(rows)
    lines = []
    for cur, d in sorted(t["by_currency"].items()):
        top = sorted(d["by_category"].items(), key=lambda kv: -kv[1])[:6]
        lines.append(f"{cur} {money(d['total'])} in total across {sum(1 for r in rows if r['currency'] == cur)} entries. By category: " + ", ".join(f"{k} {money(v)}" for k, v in top) + ".")
    return f"Spending for {label}:\n" + "\n".join(lines)


# ------------------------------------------------------------------ habits


def streak(days, today: date) -> int:
    """Consecutive days ending today (or yesterday, if today is not ticked yet). `days` = ISO date strings."""
    have = set(days)
    cur = today if today.isoformat() in have else today - timedelta(days=1)
    n = 0
    while cur.isoformat() in have:
        n += 1
        cur -= timedelta(days=1)
    return n


def best_streak(days) -> int:
    ds = sorted({date.fromisoformat(d) for d in days})
    best = run = 0
    prev = None
    for d in ds:
        run = run + 1 if prev and (d - prev).days == 1 else 1
        best = max(best, run)
        prev = d
    return best


def habit_report(db, uid: int, tz: str = "", now: datetime = None):
    zone = utilities.get_zone(tz)
    today = (now.astimezone(zone) if now else datetime.now(zone)).date()
    out = []
    for h in db.habits(uid):
        days = db.habit_days(uid, h["id"])
        last7 = sum(1 for d in days if (today - date.fromisoformat(d)).days < 7)
        out.append({"id": h["id"], "name": h["name"], "done_today": today.isoformat() in days, "streak": streak(days, today),
                    "best": best_streak(days), "last7": last7, "total": len(days)})
    return out


def today_in(tz: str = "", now: datetime = None) -> date:
    zone = utilities.get_zone(tz)
    return (now.astimezone(zone) if now else datetime.now(zone)).date()


# ------------------------------------------------------------------ prayer times (Aladhan, no key)

# method 1 = University of Islamic Sciences, Karachi (the usual choice in Pakistan, India and Bangladesh)
PRAYER_METHODS = {"karachi": 1, "isna": 2, "mwl": 3, "makkah": 4, "egypt": 5, "tehran": 7, "gulf": 8, "kuwait": 9, "qatar": 10, "singapore": 11, "turkey": 13, "dubai": 16}


def prayer_times(city: str, method: str = "karachi", date_str: str = "") -> str:
    city = str(city).strip()[:80]
    if not city:
        return "Error: give a city."
    try:
        g = utilities._get("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + urllib.parse.quote(city))
        if not g.get("results"):
            return f"Error: could not find a place called {city}."
        r = g["results"][0]
        m = PRAYER_METHODS.get(str(method or "karachi").strip().lower(), 1)
        when = ""
        if date_str:
            try:
                when = "/" + datetime.strptime(str(date_str).strip(), "%Y-%m-%d").strftime("%d-%m-%Y")
            except ValueError:
                return "Error: date must look like 2026-11-23."
        d = utilities._get(f"https://api.aladhan.com/v1/timings{when}?latitude={r['latitude']}&longitude={r['longitude']}&method={m}")
        t = d["data"]["timings"]
        hijri = d["data"].get("date", {}).get("hijri", {})
    except Exception:
        return "Error: the prayer-time service is not reachable right now."
    names = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"]
    body = ", ".join(f"{n} {str(t.get(n, '?'))[:5]}" for n in names)
    h = f" Islamic date: {hijri.get('day')} {hijri.get('month', {}).get('en')} {hijri.get('year')}." if hijri.get("day") else ""
    return f"Prayer times in {r['name']} ({r.get('timezone', 'local time')}): {body}.{h}"


def next_prayer(timings: dict, now_hhmm: str):
    """('Asr', '15:42') = the first prayer after now_hhmm, or None when the day's prayers are over."""
    for n in ("Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"):
        t = str(timings.get(n, ""))[:5]
        if t and t > now_hhmm:
            return n, t
    return None
