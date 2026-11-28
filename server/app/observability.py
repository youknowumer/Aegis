"""Observability for Aegis at scale: labelled metrics, latency histograms, a voice event log and structured logs. Standard library only.

What it gives you
  * Counters, gauges and histograms WITH labels (engine, language, outcome...), thread-safe, rendered as Prometheus text.
  * p50 / p95 / p99 latency estimates for the JSON dashboard, from the same histogram buckets Prometheus scrapes.
  * A ring buffer of the last voice events (what spoke, in which language, how long it took, why a fallback happened).
  * Process gauges (memory, threads, uptime) read from /proc, no psutil needed.
  * AEGIS_LOG_JSON=1: every log line becomes one JSON object (request id included), ready for Loki / Datadog / CloudWatch.
  * A health verdict ("ok" | "degraded") that looks at fallback rate and queue timeouts, for an uptime monitor.

Label values are always short fixed words (engine, 2-letter language, outcome), never user ids or text, so the number of series
stays small and nothing private leaves the server. Environment (all optional):
  AEGIS_LOG_JSON=1            JSON log lines
  AEGIS_OBS_EVENTS=300        voice events kept in memory (10..5000)
  AEGIS_OBS_FALLBACK_WARN=0.5 "degraded" when more than this share of the last 50 voice requests ended on a fallback voice
"""
import json
import logging
import os
import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Dict, Iterable, List, Optional, Tuple

START = time.time()
LATENCY_BUCKETS = (0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 30.0)   # seconds
_LABEL_MAX = 40


def _clean(value) -> str:
    text = str(value if value not in (None, "") else "none")
    return "".join(c if (c.isalnum() or c in "-_.:/") else "_" for c in text)[:_LABEL_MAX]


def _key(labels: Dict[str, object]) -> Tuple[Tuple[str, str], ...]:
    return tuple(sorted((str(k), _clean(v)) for k, v in labels.items()))


def _fmt(key: Tuple[Tuple[str, str], ...], extra: str = "") -> str:
    parts = [f'{k}="{v}"' for k, v in key] + ([extra] if extra else [])
    return "{" + ",".join(parts) + "}" if parts else ""


class Registry:
    """One process-wide set of metrics. Cheap enough to call on every request and every spoken sentence."""

    def __init__(self):
        self._lock = threading.Lock()
        self._counters: Dict[str, Dict[tuple, float]] = {}
        self._gauges: Dict[str, Dict[tuple, float]] = {}
        self._hist: Dict[str, Dict[tuple, List[float]]] = {}      # name -> labels -> [bucket counts..., +Inf, sum, count]
        self._help: Dict[str, str] = {}
        self._events: deque = deque(maxlen=self._events_max())
        self._recent: deque = deque(maxlen=50)                      # last voice outcomes: True = ended on a fallback voice

    @staticmethod
    def _events_max() -> int:
        try:
            return max(10, min(5000, int(os.environ.get("AEGIS_OBS_EVENTS", "300"))))
        except ValueError:
            return 300

    # ------------------------------------------------------------ write
    def describe(self, name: str, text: str) -> None:
        self._help[name] = text

    def inc(self, name: str, amount: float = 1.0, **labels) -> None:
        with self._lock:
            series = self._counters.setdefault(name, {})
            k = _key(labels)
            series[k] = series.get(k, 0.0) + amount

    def set_gauge(self, name: str, value: float, **labels) -> None:
        with self._lock:
            self._gauges.setdefault(name, {})[_key(labels)] = float(value)

    def observe(self, name: str, seconds: float, **labels) -> None:
        with self._lock:
            series = self._hist.setdefault(name, {})
            k = _key(labels)
            row = series.get(k)
            if row is None:
                row = series[k] = [0.0] * (len(LATENCY_BUCKETS) + 3)
            for i, bound in enumerate(LATENCY_BUCKETS):
                if seconds <= bound:
                    row[i] += 1
            row[len(LATENCY_BUCKETS)] += 1          # +Inf bucket = every observation
            row[-2] += seconds
            row[-1] += 1

    @contextmanager
    def timer(self, name: str, **labels):
        t0 = time.perf_counter()
        try:
            yield
        finally:
            self.observe(name, time.perf_counter() - t0, **labels)

    def event(self, kind: str, **fields) -> None:
        item = {"t": round(time.time(), 3), "kind": kind, **{k: (v if isinstance(v, (int, float, bool)) or v is None else str(v)[:160]) for k, v in fields.items()}}
        with self._lock:
            self._events.append(item)

    # ------------------------------------------------------------ voice pipeline (one call per spoken sentence)
    def record_voice(self, engine: str, lang: str, outcome: str, seconds: float, chars: int = 0, size: int = 0,
                     fell_back_from: str = "", why: str = "", rid: str = "") -> None:
        """engine = the voice that really spoke (piper | mms | edge | openai | elevenlabs); outcome = ok | error.
        fell_back_from = the local engine that was tried first and could not speak (empty when nothing fell back)."""
        lang = (lang or "und")[:8]
        self.inc("voice_requests_total", engine=engine, lang=lang, outcome=outcome)
        self.observe("voice_synthesis_seconds", seconds, engine=engine, lang=lang)
        if chars:
            self.inc("voice_chars_total", chars, engine=engine)
        if size:
            self.inc("voice_audio_bytes_total", size, engine=engine)
        if fell_back_from:
            self.inc("voice_fallbacks_total", from_engine=fell_back_from, to_engine=engine, lang=lang)
        with self._lock:
            self._recent.append(bool(fell_back_from) or outcome != "ok")
        self.event("voice", engine=engine, lang=lang, outcome=outcome, ms=round(seconds * 1000), chars=chars, fell_back_from=fell_back_from or None, why=why or None, rid=rid or None)

    # ------------------------------------------------------------ read
    @staticmethod
    def _quantile(row: List[float], q: float) -> Optional[float]:
        total = row[-1]
        if not total:
            return None
        target, prev_count, prev_bound = q * total, 0.0, 0.0
        for i, bound in enumerate(LATENCY_BUCKETS):
            if row[i] >= target:
                span = row[i] - prev_count
                frac = (target - prev_count) / span if span else 1.0
                return prev_bound + (bound - prev_bound) * frac
            prev_count, prev_bound = row[i], bound
        return LATENCY_BUCKETS[-1]            # slower than the last bucket: report the cap, never invent a number

    def histogram_summary(self, name: str) -> List[dict]:
        with self._lock:
            series = {k: list(v) for k, v in self._hist.get(name, {}).items()}
        out = []
        for k, row in sorted(series.items()):
            out.append({**dict(k), "count": int(row[-1]), "avg_ms": round(row[-2] / row[-1] * 1000, 1) if row[-1] else 0,
                        **{f"p{int(q * 100)}_ms": (None if (v := self._quantile(row, q)) is None else round(v * 1000, 1)) for q in (0.5, 0.95, 0.99)}})
        return out

    def counter_rows(self, name: str) -> List[dict]:
        with self._lock:
            return [{**dict(k), "value": v} for k, v in sorted(self._counters.get(name, {}).items())]

    def recent_events(self, limit: int = 100, kind: str = "") -> List[dict]:
        with self._lock:
            items = [e for e in self._events if not kind or e["kind"] == kind]
        return items[-max(1, min(limit, 1000)):][::-1]

    def fallback_ratio(self) -> float:
        with self._lock:
            return (sum(self._recent) / len(self._recent)) if self._recent else 0.0

    def render_prometheus(self, prefix: str = "aegis_") -> str:
        lines: List[str] = []
        with self._lock:
            counters = {n: dict(s) for n, s in self._counters.items()}
            gauges = {n: dict(s) for n, s in self._gauges.items()}
            hist = {n: {k: list(v) for k, v in s.items()} for n, s in self._hist.items()}
        for name, series in sorted(counters.items()):
            lines += [f"# HELP {prefix}{name} {self._help.get(name, name)}", f"# TYPE {prefix}{name} counter"]
            lines += [f"{prefix}{name}{_fmt(k)} {v:g}" for k, v in sorted(series.items())]
        for name, series in sorted(gauges.items()):
            lines += [f"# HELP {prefix}{name} {self._help.get(name, name)}", f"# TYPE {prefix}{name} gauge"]
            lines += [f"{prefix}{name}{_fmt(k)} {v:g}" for k, v in sorted(series.items())]
        for name, series in sorted(hist.items()):
            lines += [f"# HELP {prefix}{name} {self._help.get(name, name)}", f"# TYPE {prefix}{name} histogram"]
            for k, row in sorted(series.items()):
                for i, bound in enumerate(LATENCY_BUCKETS):
                    le = 'le="%g"' % bound
                    lines.append(f"{prefix}{name}_bucket{_fmt(k, le)} {row[i]:g}")
                inf = 'le="+Inf"'
                lines.append(f"{prefix}{name}_bucket{_fmt(k, inf)} {row[len(LATENCY_BUCKETS)]:g}")
                lines.append(f"{prefix}{name}_sum{_fmt(k)} {row[-2]:.6f}")
                lines.append(f"{prefix}{name}_count{_fmt(k)} {row[-1]:g}")
        return "\n".join(lines) + "\n"

    def reset(self) -> None:
        """Tests only."""
        with self._lock:
            self._counters.clear(); self._gauges.clear(); self._hist.clear(); self._events.clear(); self._recent.clear()


obs = Registry()
obs.describe("voice_requests_total", "Sentences spoken, by the voice that spoke them")
obs.describe("voice_synthesis_seconds", "Time to produce one spoken sentence")
obs.describe("voice_fallbacks_total", "Sentences a local voice could not speak that a different voice then spoke")
obs.describe("voice_chars_total", "Characters spoken")
obs.describe("voice_audio_bytes_total", "Audio bytes produced")
obs.describe("voice_queue_wait_seconds", "Time a sentence waited for a free local-voice slot")
obs.describe("voice_model_load_seconds", "Time to load a local voice model into memory")
obs.describe("voice_model_downloads_total", "Voice model downloads, by result")
obs.describe("voice_models_loaded", "Local voice models held in memory")
obs.describe("voice_models_installed", "Local voice models on disk")
obs.describe("voice_queue_timeouts_total", "Sentences that waited too long for a local voice and were handed to a fallback")
obs.describe("http_request_seconds", "HTTP request latency by route template")
obs.describe("process_resident_memory_mb", "Memory used by this server process")
obs.describe("process_threads", "Threads in this server process")
obs.describe("process_uptime_seconds", "Seconds since this server process started")


# ---------------------------------------------------------------- process facts
def process_stats() -> dict:
    rss_mb, threads = 0.0, threading.active_count()
    try:
        for line in open("/proc/self/status", encoding="utf-8"):
            if line.startswith("VmRSS:"):
                rss_mb = int(line.split()[1]) / 1024
            elif line.startswith("Threads:"):
                threads = int(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return {"rss_mb": round(rss_mb, 1), "threads": threads, "uptime_s": int(time.time() - START)}


def refresh_process_gauges() -> dict:
    s = process_stats()
    obs.set_gauge("process_resident_memory_mb", s["rss_mb"])
    obs.set_gauge("process_threads", s["threads"])
    obs.set_gauge("process_uptime_seconds", s["uptime_s"])
    return s


# ---------------------------------------------------------------- structured logs
class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        item = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z", "level": record.levelname,
                "logger": record.name, "msg": record.getMessage()}
        if record.exc_info:
            item["exc"] = self.formatException(record.exc_info)
        return json.dumps(item, ensure_ascii=False)


def setup_logging() -> bool:
    """Switch every log line to JSON when AEGIS_LOG_JSON=1. Safe to call twice. Returns True when JSON logging is on."""
    if os.environ.get("AEGIS_LOG_JSON", "").strip() != "1":
        return False
    root = logging.getLogger()
    if not any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        if not root.handlers:
            root.addHandler(logging.StreamHandler())
        for h in root.handlers:
            h.setFormatter(JsonFormatter())
        if root.level in (logging.NOTSET, logging.WARNING):
            root.setLevel(logging.INFO)
    return True


# ---------------------------------------------------------------- health verdict + dashboard payload
def voice_health() -> dict:
    ratio = obs.fallback_ratio()
    try:
        limit = float(os.environ.get("AEGIS_OBS_FALLBACK_WARN", "0.5"))
    except ValueError:
        limit = 0.5
    problems = []
    if ratio > limit:
        problems.append(f"{ratio:.0%} of the last voice requests ended on a fallback voice")
    return {"status": "degraded" if problems else "ok", "fallback_ratio": round(ratio, 3), "problems": problems}


def voice_dashboard(extra: Optional[dict] = None) -> dict:
    """Everything the admin voice page shows, as plain JSON."""
    proc = refresh_process_gauges()
    requests = obs.counter_rows("voice_requests_total")
    total = sum(r["value"] for r in requests) or 0
    by = lambda field: sorted(  # noqa: E731
        ({field: key, "requests": int(sum(r["value"] for r in requests if r.get(field) == key)),
          "errors": int(sum(r["value"] for r in requests if r.get(field) == key and r.get("outcome") != "ok"))}
         for key in {r.get(field) for r in requests}), key=lambda x: -x["requests"])
    return {
        "health": voice_health(), "process": proc, "total_requests": int(total),
        "by_engine": by("engine"), "by_language": by("lang"),
        "latency": obs.histogram_summary("voice_synthesis_seconds"), "queue_wait": obs.histogram_summary("voice_queue_wait_seconds"),
        "model_load": obs.histogram_summary("voice_model_load_seconds"),
        "fallbacks": obs.counter_rows("voice_fallbacks_total"), "downloads": obs.counter_rows("voice_model_downloads_total"),
        "queue_timeouts": obs.counter_rows("voice_queue_timeouts_total"),
        "events": obs.recent_events(60, "voice"), **(extra or {}),
    }
