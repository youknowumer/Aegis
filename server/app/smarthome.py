"""Smart-home control through Home Assistant's REST API (optional).

Set on the server:
  AEGIS_HA_URL    e.g. http://homeassistant.local:8123   (your Home Assistant address)
  AEGIS_HA_TOKEN  a long-lived access token (Home Assistant > your profile > Security)

Lights, switches, fans, climate, media players, scenes and scripts run straight away. Anything that
can open a door or raise an alarm (locks, covers / garage doors, alarm panels, sirens, valves) ALWAYS needs
the user's approval, and an entity whose type is not known yet counts as sensitive (fail safe).
"""
import json
import os
import re
import time
import urllib.error
import urllib.request
from typing import Dict, List, Optional

SAFE_DOMAINS = {"light", "switch", "fan", "climate", "media_player", "scene", "script", "input_boolean", "humidifier", "vacuum"}
SENSITIVE_ACTIONS = {"lock", "unlock", "open", "close", "arm", "disarm"}
ACTIONS = ("turn_on", "turn_off", "toggle", "set_brightness", "set_temperature", "set_volume", "activate", "run") + tuple(sorted(SENSITIVE_ACTIONS))
_ENTITY_RE = re.compile(r"[a-z_]+\.[a-z0-9_]+")

_CACHE: Dict[str, object] = {"at": 0.0, "states": []}  # last device list, so approval rules can tell a lamp from a door lock


class HomeError(Exception):
    pass


def base_url() -> str:
    return os.environ.get("AEGIS_HA_URL", "").strip().rstrip("/")


def configured() -> bool:
    u = base_url()
    return bool(u.startswith(("http://", "https://")) and os.environ.get("AEGIS_HA_TOKEN", "").strip())


def _call(method: str, path: str, body: Optional[dict] = None):
    if not configured():
        raise HomeError("Home Assistant is not set up on this server.")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        base_url() + path, data=data, method=method,
        headers={"Authorization": "Bearer " + os.environ["AEGIS_HA_TOKEN"].strip(), "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:  # noqa: S310 (address set by the server owner)
            raw = r.read(2_000_000)
            return json.loads(raw.decode() or "null")
    except urllib.error.HTTPError as e:
        raise HomeError({401: "Home Assistant refused the token.", 404: "Home Assistant does not know that device or service."}.get(e.code, f"Home Assistant answered {e.code}."))
    except Exception:
        raise HomeError("Could not reach Home Assistant.")


def states(refresh: bool = False) -> List[dict]:
    if refresh or time.time() - float(_CACHE["at"]) > 60 or not _CACHE["states"]:
        data = _call("GET", "/api/states")
        _CACHE["states"] = [s for s in (data or []) if isinstance(s, dict) and "entity_id" in s]
        _CACHE["at"] = time.time()
    return _CACHE["states"]  # type: ignore[return-value]


def _name(s: dict) -> str:
    return str((s.get("attributes") or {}).get("friendly_name") or s["entity_id"])


def _domain(entity_id: str) -> str:
    return entity_id.split(".", 1)[0]


def list_devices(query: str = "", domain: str = "", limit: int = 25) -> str:
    try:
        items = states(refresh=True)
    except HomeError as e:
        return f"Error: {e}"
    q, dom = str(query or "").strip().lower(), str(domain or "").strip().lower()
    hits = [s for s in items if (not dom or _domain(s["entity_id"]) == dom) and (not q or q in _name(s).lower() or q in s["entity_id"].lower())]
    if not hits:
        return "No matching devices."
    hits = [s for s in hits if _domain(s["entity_id"]) in SAFE_DOMAINS | {"lock", "cover", "alarm_control_panel", "sensor", "binary_sensor"}][: max(1, min(int(limit or 25), 60))] or hits[:limit]
    return "\n".join(f"- {s['entity_id']} ({_name(s)}): {s.get('state')}" for s in hits)


def resolve(entity: str) -> dict:
    """Entity id or a friendly name -> the state dict. Raises HomeError when nothing or too many things match."""
    e = str(entity or "").strip().lower()
    if not e:
        raise HomeError("Say which device.")
    items = states()
    for s in items:
        if s["entity_id"].lower() == e:
            return s
    exact = [s for s in items if _name(s).lower() == e]
    hits = exact or [s for s in items if e in _name(s).lower()]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        raise HomeError(f"No device called '{entity}'. Use home_list to see the names.")
    raise HomeError("More than one device matches: " + ", ".join(f"{s['entity_id']} ({_name(s)})" for s in hits[:6]) + ". Say which one.")


def needs_approval(args: dict) -> bool:
    """True when this home_control call must be approved by the user (see the module docstring)."""
    action = str(args.get("action", "")).strip().lower()
    if action in SENSITIVE_ACTIONS:
        return True
    entity = str(args.get("entity", "")).strip().lower()
    if _ENTITY_RE.fullmatch(entity):
        return _domain(entity) not in SAFE_DOMAINS
    for s in _CACHE["states"]:  # type: ignore[union-attr]
        if _name(s).lower() == entity:
            return _domain(s["entity_id"]) not in SAFE_DOMAINS
    return True  # unknown device: ask first


def _service_for(domain: str, action: str, value):
    """(service domain, service name, extra data) for one action, or raises HomeError."""
    a = action
    if a in ("turn_on", "turn_off", "toggle"):
        return domain, a, {}
    if a == "set_brightness" and domain == "light":
        try:
            pct = max(0, min(100, int(float(value))))
        except (TypeError, ValueError):
            raise HomeError("Give the brightness as a number from 0 to 100.")
        return "light", "turn_on", {"brightness_pct": pct}
    if a == "set_temperature" and domain == "climate":
        try:
            t = float(value)
        except (TypeError, ValueError):
            raise HomeError("Give the temperature as a number.")
        if not 5 <= t <= 35:
            raise HomeError("That temperature looks wrong (use 5 to 35 degrees Celsius).")
        return "climate", "set_temperature", {"temperature": t}
    if a == "set_volume" and domain == "media_player":
        try:
            v = max(0, min(100, float(value))) / 100
        except (TypeError, ValueError):
            raise HomeError("Give the volume as a number from 0 to 100.")
        return "media_player", "volume_set", {"volume_level": v}
    if a == "activate" and domain == "scene":
        return "scene", "turn_on", {}
    if a == "run" and domain == "script":
        return "script", "turn_on", {}
    if domain == "lock" and a in ("lock", "unlock"):
        return "lock", a, {}
    if domain == "cover" and a in ("open", "close"):
        return "cover", "open_cover" if a == "open" else "close_cover", {}
    if domain == "alarm_control_panel" and a in ("arm", "disarm"):
        return "alarm_control_panel", "alarm_arm_away" if a == "arm" else "alarm_disarm", {}
    raise HomeError(f"'{a}' does not work on a {domain}.")


def control(entity: str, action: str, value=None, confirmed: bool = False) -> str:
    """Run one action. `confirmed` is True only when the user approved this exact call in the app."""
    action = str(action or "").strip().lower()
    if action not in ACTIONS:
        return "Error: action must be one of " + ", ".join(ACTIONS) + "."
    try:
        s = resolve(entity)
        domain = _domain(s["entity_id"])
        if (domain not in SAFE_DOMAINS or action in SENSITIVE_ACTIONS) and not confirmed:
            return "Error: this device needs the user's approval. Tell them what you are about to do and call again."
        svc_domain, svc, extra = _service_for(domain, action, value)
        _call("POST", f"/api/services/{svc_domain}/{svc}", {"entity_id": s["entity_id"], **extra})
    except HomeError as e:
        return f"Error: {e}"
    return f"Done: {action.replace('_', ' ')} {_name(s)}."
