"""Small safe helpers for server tools: math evaluator and weather lookup (Open-Meteo, no API key)."""
import ast
import re
import json
import math
import operator as op
import urllib.parse
import urllib.request

_BIN = {ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul, ast.Div: op.truediv, ast.Pow: op.pow, ast.Mod: op.mod, ast.FloorDiv: op.floordiv}
_UN = {ast.UAdd: op.pos, ast.USub: op.neg}
_FN = {
    "sqrt": math.sqrt, "sin": math.sin, "cos": math.cos, "tan": math.tan, "log": math.log10, "ln": math.log,
    "abs": abs, "round": round, "floor": math.floor, "ceil": math.ceil, "exp": math.exp,
}
_CONST = {"pi": math.pi, "e": math.e}


def safe_calc(expression: str) -> str:
    """Evaluate arithmetic without eval(): only numbers, + - * / ** % // , parentheses and a few functions."""
    expr = str(expression).strip().replace("^", "**").replace("\u00d7", "*").replace("\u00f7", "/").replace(",", "")
    if not expr or len(expr) > 200:
        return "Error: give a short math expression."

    def ev(n, depth=0):
        if depth > 30:
            raise ValueError("too deep")
        if isinstance(n, ast.Expression):
            return ev(n.body, depth + 1)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return n.value
        if isinstance(n, ast.Name) and n.id in _CONST:
            return _CONST[n.id]
        if isinstance(n, ast.BinOp) and type(n.op) in _BIN:
            a, b = ev(n.left, depth + 1), ev(n.right, depth + 1)
            if isinstance(n.op, ast.Pow) and (abs(b) > 1000 or abs(a) > 1e6):
                raise ValueError("power too large")
            return _BIN[type(n.op)](a, b)
        if isinstance(n, ast.UnaryOp) and type(n.op) in _UN:
            return _UN[type(n.op)](ev(n.operand, depth + 1))
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in _FN and not n.keywords:
            return _FN[n.func.id](*[ev(a, depth + 1) for a in n.args])
        raise ValueError("unsupported")

    try:
        val = ev(ast.parse(expr, mode="eval"))
    except ZeroDivisionError:
        return "Error: division by zero."
    except Exception:
        return "Error: could not evaluate that expression."
    if isinstance(val, float):
        val = round(val, 10)
        if val == int(val) and abs(val) < 1e15:
            val = int(val)
    return str(val)


_WMO = [(0, "clear"), (1, "mostly clear"), (2, "partly cloudy"), (3, "overcast"), (45, "fog"), (51, "drizzle"), (61, "rain"),
        (65, "heavy rain"), (71, "snow"), (80, "showers"), (95, "thunderstorm")]


def _wmo(code: int) -> str:
    name = "clear"
    for c, n in _WMO:
        if code >= c:
            name = n
    return name


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Aegis/1.0"})
    with urllib.request.urlopen(req, timeout=8) as r:  # noqa: S310 (fixed https hosts)
        return json.loads(r.read().decode())


def weather_for(city: str) -> str:
    city = str(city).strip()[:80]
    if not city:
        return "Error: give a city name."
    try:
        g = _get("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + urllib.parse.quote(city))
        if not g.get("results"):
            return f"Error: could not find a place called {city}."
        r = g["results"][0]
        d = _get(
            "https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&timezone=auto&forecast_days=4"
            "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature"
            "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" % (r["latitude"], r["longitude"])
        )
    except Exception:
        return "Error: the weather service is not reachable right now."
    c, dy = d["current"], d["daily"]
    lines = [
        f"{r['name']}, {r.get('country', '')}: {round(c['temperature_2m'])}C (feels {round(c['apparent_temperature'])}C), "
        f"{_wmo(c['weather_code'])}, humidity {c['relative_humidity_2m']}%, wind {round(c['wind_speed_10m'])} km/h."
    ]
    for i in range(1, 4):
        lines.append(
            f"{dy['time'][i]}: {_wmo(dy['weather_code'][i])}, {round(dy['temperature_2m_min'][i])}-{round(dy['temperature_2m_max'][i])}C, "
            f"rain chance {dy['precipitation_probability_max'][i]}%."
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------------
# Web helpers: read a page, Wikipedia, currency. All free, no API keys.
# ---------------------------------------------------------------------------------------------
import ipaddress  # noqa: E402
import socket  # noqa: E402
import urllib.error  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from html.parser import HTMLParser  # noqa: E402

MAX_PAGE_BYTES = 600_000


def _ip_is_public(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (a.is_private or a.is_loopback or a.is_link_local or a.is_reserved or a.is_multicast or a.is_unspecified)


def check_public_url(url: str) -> str:
    """Return the URL if it is plain http(s) to a public host, else raise ValueError (blocks SSRF to localhost / LAN / cloud metadata)."""
    p = urllib.parse.urlparse(str(url).strip())
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("only http(s) links are allowed")
    if p.username or p.password:
        raise ValueError("links with embedded logins are not allowed")
    try:
        infos = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except OSError:
        raise ValueError("could not find that website")
    if not infos or not all(_ip_is_public(i[4][0]) for i in infos):
        raise ValueError("that address is not a public website")
    return p.geturl()


class _Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe", "aside"}
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "blockquote", "pre"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.title, self._skip, self._in_title = [], "", 0, False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data.strip()
        elif not self._skip and data.strip():
            self.out.append(data)


def html_to_text(html: str):
    ex = _TextExtractor()
    try:
        ex.feed(html)
    except Exception:
        pass
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(ex.out))
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return ex.title.strip(), text


def fetch_page(url: str, max_chars: int = 5000) -> str:
    """Download a public web page and return its readable text."""
    try:
        url = check_public_url(url)
        opener = urllib.request.build_opener(_Redirect)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Aegis/2.0)", "Accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.5"})
        with opener.open(req, timeout=10) as r:
            ctype = (r.headers.get("Content-Type") or "").lower()
            if not any(k in ctype for k in ("text/", "json", "xml")):
                return f"Error: that link is not a readable page ({ctype or 'unknown type'})."
            raw = r.read(MAX_PAGE_BYTES)
            charset = r.headers.get_content_charset() or "utf-8"
    except ValueError as e:
        return f"Error: {e}."
    except urllib.error.HTTPError as e:
        return f"Error: the site answered with HTTP {e.code}."
    except Exception:
        return "Error: could not open that page."
    body = raw.decode(charset, errors="replace")
    if "html" in ctype:
        title, text = html_to_text(body)
    else:
        title, text = "", body.strip()
    if not text:
        return "Error: the page has no readable text."
    head = f"Title: {title}\n" if title else ""
    more = "\n[...truncated]" if len(text) > max_chars else ""
    return f"{head}{text[:max_chars]}{more}"


def wikipedia_summary(query: str, lang: str = "en") -> str:
    query = str(query).strip()[:120]
    lang = lang if re.fullmatch(r"[a-z]{2,3}", str(lang)) else "en"
    if not query:
        return "Error: give a topic."
    try:
        s = _get(f"https://{lang}.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=" + urllib.parse.quote(query))
        if not s[1]:
            return f"Nothing found on Wikipedia for {query}."
        title = s[1][0]
        d = _get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_")))
    except Exception:
        return "Error: Wikipedia is not reachable right now."
    extract = (d.get("extract") or "").strip()
    if not extract:
        return f"Nothing useful found on Wikipedia for {query}."
    link = (d.get("content_urls", {}).get("desktop", {}) or {}).get("page", "")
    return f"{d.get('title', title)}: {extract[:1800]}" + (f"\nSource: {link}" if link else "")


def convert_currency(amount, src: str, dst: str) -> str:
    src, dst = str(src).strip().upper(), str(dst).strip().upper()
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return "Error: amount must be a number."
    if not (re.fullmatch(r"[A-Z]{3}", src) and re.fullmatch(r"[A-Z]{3}", dst)):
        return "Error: use 3-letter currency codes such as USD, PKR, EUR."
    try:
        d = _get("https://open.er-api.com/v6/latest/" + src)
        rate = d["rates"][dst]
    except Exception:
        return "Error: could not get the exchange rate right now (check the currency codes)."
    return f"{amount:,.2f} {src} = {amount * rate:,.2f} {dst} (1 {src} = {rate:,.4f} {dst}, live rate)"


# ---------------------------------------------------------------------------------------------
# Time helpers (reminders, current time in any zone)
# ---------------------------------------------------------------------------------------------
def get_zone(name: str):
    from zoneinfo import ZoneInfo

    try:
        return ZoneInfo(str(name).strip()) if name else timezone.utc
    except Exception:
        return timezone.utc


def now_in(tz_name: str = "") -> datetime:
    return datetime.now(get_zone(tz_name))


def resolve_due(args: dict, tz_name: str = "", now: datetime = None):
    """Work out when a reminder fires. Accepts in_minutes, or at = 'YYYY-MM-DD HH:MM' (or 'HH:MM' for today/tomorrow)
    in the user's own timezone. Returns (epoch_seconds, human_text) or raises ValueError."""
    zone = get_zone(tz_name)
    now = (now or datetime.now(timezone.utc)).astimezone(zone)
    mins = args.get("in_minutes")
    if mins not in (None, ""):
        try:
            mins = float(mins)
        except (TypeError, ValueError):
            raise ValueError("in_minutes must be a number")
        if not (0 < mins <= 60 * 24 * 365):
            raise ValueError("choose a time between now and one year from now")
        due = now + timedelta(minutes=mins)
    else:
        at = str(args.get("at", "")).strip()
        if not at:
            raise ValueError("give in_minutes or at")
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})", at)
        if m:
            y, mo, d, h, mi = map(int, m.groups())
            try:
                due = datetime(y, mo, d, h, mi, tzinfo=zone)
            except ValueError:
                raise ValueError("that date does not exist")
        else:
            m = re.fullmatch(r"(\d{1,2}):(\d{2})", at)
            if not m:
                raise ValueError("use at = 'YYYY-MM-DD HH:MM'")
            h, mi = int(m.group(1)), int(m.group(2))
            if h > 23 or mi > 59:
                raise ValueError("that time does not exist")
            due = now.replace(hour=h, minute=mi, second=0, microsecond=0)
            if due <= now:
                due += timedelta(days=1)
        if due <= now:
            raise ValueError("that time is already in the past")
        if due - now > timedelta(days=366):
            raise ValueError("choose a time within the next year")
    return due.timestamp(), due.strftime("%A %d %B, %H:%M")


# ---------------------------------------------------------------------------------------------
# Repeating reminders
# ---------------------------------------------------------------------------------------------
REPEATS = ("daily", "weekdays", "weekly", "monthly")


def next_occurrence(due_ts: float, repeat: str, tz_name: str = ""):
    """Next fire time (epoch seconds) after a repeating reminder that was due at due_ts.
    Keeps the same wall-clock time in the user's zone (so 9:00 stays 9:00 across daylight saving).
    Always lands in the future, even if the server was asleep for days. Returns None for unknown repeat values."""
    if repeat not in REPEATS:
        return None
    zone = get_zone(tz_name)
    cur = datetime.fromtimestamp(due_ts, zone)
    now = datetime.now(zone)
    for _ in range(800):  # bounded: never loops forever
        if repeat in ("daily", "weekdays"):
            cur = cur + timedelta(days=1)
            if repeat == "weekdays":
                while cur.weekday() >= 5:
                    cur = cur + timedelta(days=1)
        elif repeat == "weekly":
            cur = cur + timedelta(days=7)
        else:  # monthly: same day number, clamped to the month length
            y, m = (cur.year + 1, 1) if cur.month == 12 else (cur.year, cur.month + 1)
            day = cur.day
            while True:
                try:
                    cur = cur.replace(year=y, month=m, day=day)
                    break
                except ValueError:
                    day -= 1
        if cur > now:
            return cur.timestamp()
    return None
