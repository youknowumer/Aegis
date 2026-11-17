"""Small safe helpers for server tools: math evaluator and weather lookup (Open-Meteo, no API key)."""
import ast
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
