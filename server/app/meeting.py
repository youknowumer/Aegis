"""Groq speech-to-text (Whisper) and meeting intelligence.

Two jobs:
  1. `transcribe`  : audio bytes -> text + timed segments, through Groq's OpenAI-compatible Whisper endpoint.
  2. `analyze`     : a meeting transcript -> structured notes (summary, important points, decisions, action items with
                     owners, enhancement ideas, risks, open questions, next steps) through a Groq chat model.

The Groq key comes from the browser (header `X-Groq-Key`, used for this one request, never stored or logged) or from the
server's `GROQ_API_KEY` environment variable.
"""
import asyncio
import json
import os
import re
from typing import List, Optional

GROQ_BASE = os.environ.get("AEGIS_GROQ_BASE", "https://api.groq.com/openai/v1").rstrip("/")
# whisper-large-v3 is the most accurate (best for Urdu / Hindi / mixed speech); the turbo model is faster and cheaper.
STT_MODEL_FAST = os.environ.get("AEGIS_GROQ_STT_FAST", "whisper-large-v3-turbo")
STT_MODEL_BEST = os.environ.get("AEGIS_GROQ_STT_BEST", "whisper-large-v3")
CHAT_MODEL = os.environ.get("AEGIS_GROQ_CHAT_MODEL", "llama-3.3-70b-versatile")
FAST_CHAT_MODEL = os.environ.get("AEGIS_GROQ_FAST_MODEL", "llama-3.1-8b-instant")
MAX_AUDIO_BYTES = int(os.environ.get("AEGIS_MAX_AUDIO_MB", "24")) * 1024 * 1024  # Groq free tier accepts 25 MB per file
CHUNK_CHARS = int(os.environ.get("AEGIS_NOTES_CHUNK_CHARS", "12000"))  # keeps each request inside free-tier token limits
MAX_TRANSCRIPT_CHARS = 400_000
TIMEOUT = 120.0

LANG_CODES = {"en", "ur", "hi", "ar", "bn", "pa", "fa", "ps", "sd", "es", "fr", "de", "it", "pt", "tr", "ru", "zh", "ja", "ko", "id", "ms"}
OUTPUT_LANGS = {
    "en": "English",
    "roman": "Roman Urdu (Urdu written in the English alphabet, the way people text in Pakistan; keep technical terms in English)",
    "ur": "Urdu (in Urdu script)",
    "hi": "Hindi (in Devanagari)",
    "auto": "the same language the meeting was held in (if it is mixed Urdu and English, use English with Roman Urdu where natural)",
}


class GroqError(RuntimeError):
    """A failure that is safe to show to the user. Never contains the API key."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def clean_key(raw: str) -> str:
    key = str(raw or "").strip().strip("\"'")
    if key and (not key.isascii() or any(c.isspace() for c in key) or len(key) > 300):
        raise GroqError("That Groq key doesn't look right. Paste only the key (it starts with gsk_).", 400)
    return key


def resolve_key(header_key: str = "") -> str:
    key = clean_key(header_key) or os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        raise GroqError(
            "No Groq key yet. Paste one in Settings > Voice & meetings (free at console.groq.com/keys), "
            "or ask the server owner to set GROQ_API_KEY.",
            400,
        )
    return key


def server_has_key() -> bool:
    return bool(os.environ.get("GROQ_API_KEY", "").strip())


def _http_error(status: int, body: str, retry_after: str = "") -> GroqError:
    detail = ""
    try:
        j = json.loads(body)
        e = j.get("error", j) if isinstance(j, dict) else {}
        detail = (e.get("message") if isinstance(e, dict) else str(e)) or ""
    except ValueError:
        pass
    if status == 401:
        return GroqError("Groq rejected the API key. Check it at console.groq.com/keys.", 401)
    if status == 403:
        return GroqError("This Groq key (or this organisation) has no access to that model.", 403)
    if status == 413:
        return GroqError("That audio is too large for Groq (limit about 25 MB per file). Record in shorter parts.", 413)
    if status == 429:
        wait = f" Try again in about {retry_after} seconds." if retry_after.isdigit() else " Try again in a minute."
        return GroqError("Groq's rate limit was reached (free tier is limited per minute)." + wait, 429)
    if status == 400 and "tool_use_failed" in body:
        return GroqError("The model produced a malformed tool call. Please try again.", 502)
    return GroqError(f"Groq returned HTTP {status}. {detail[:200]}".strip(), 502)


# --------------------------------------------------------------------------------------------- speech to text
_HALLUCINATIONS = re.compile(
    r"^\W*(?:thank you(?: so much)?(?: for watching)?|thanks for watching|please subscribe|subtitles by .*|"
    r"amara\.org.*|you|bye|\.+|م.*ترجمہ.*|ترجمہ.*)\W*$",
    re.I,
)


def _usable(seg: dict) -> bool:
    """Whisper invents text ('Thank you for watching') on silence. Drop segments it itself flags as non-speech."""
    text = str(seg.get("text", "")).strip()
    if not text:
        return False
    if float(seg.get("no_speech_prob", 0) or 0) > 0.6 and float(seg.get("avg_logprob", 0) or 0) < -0.7:
        return False
    if _HALLUCINATIONS.match(text) and float(seg.get("no_speech_prob", 0) or 0) > 0.25:
        return False
    return True


async def transcribe(audio: bytes, filename: str, content_type: str, key: str, language: str = "", prompt: str = "", best: bool = False) -> dict:
    """Audio -> {"text", "language", "duration", "segments": [{"start", "end", "text"}]}."""
    import httpx

    if not audio:
        raise GroqError("That recording is empty.", 400)
    if len(audio) > MAX_AUDIO_BYTES:
        raise GroqError(f"That audio is {len(audio) // (1024 * 1024)} MB. The limit is {MAX_AUDIO_BYTES // (1024 * 1024)} MB per file. Record or upload it in shorter parts.", 413)
    lang = language.strip().lower()[:5].split("-")[0]
    data = {"model": STT_MODEL_BEST if (best or lang in ("ur", "hi", "pa", "sd", "ps")) else STT_MODEL_FAST, "response_format": "verbose_json", "temperature": "0"}
    if lang in LANG_CODES:
        data["language"] = lang
    if prompt.strip():
        data["prompt"] = prompt.strip()[-400:]
    safe_name = re.sub(r"[^\w.\-]", "_", filename or "audio.webm")[:80] or "audio.webm"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as http:
            r = await http.post(
                GROQ_BASE + "/audio/transcriptions",
                headers={"Authorization": "Bearer " + key},
                data=data,
                files={"file": (safe_name, audio, content_type or "application/octet-stream")},
            )
    except httpx.TimeoutException:
        raise GroqError("Groq took too long to transcribe that audio. Try a shorter recording.", 504)
    except httpx.HTTPError:
        raise GroqError("Couldn't reach Groq. Check the server's internet connection.", 502)
    if r.status_code >= 400:
        raise _http_error(r.status_code, r.text, r.headers.get("retry-after", ""))
    j = r.json()
    segs = [
        {"start": round(float(s.get("start", 0) or 0), 2), "end": round(float(s.get("end", 0) or 0), 2), "text": str(s.get("text", "")).strip()}
        for s in (j.get("segments") or [])
        if _usable(s)
    ]
    text = " ".join(s["text"] for s in segs).strip() if j.get("segments") else str(j.get("text", "")).strip()
    return {"text": text, "language": str(j.get("language", "")), "duration": float(j.get("duration", 0) or 0), "segments": segs}


async def check_key(key: str) -> dict:
    """Cheap authenticated call so the user learns right now whether the key works."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.get(GROQ_BASE + "/models", headers={"Authorization": "Bearer " + key})
    except httpx.HTTPError:
        raise GroqError("Couldn't reach Groq. Check the server's internet connection.", 502)
    if r.status_code >= 400:
        raise _http_error(r.status_code, r.text, r.headers.get("retry-after", ""))
    ids = sorted(m.get("id", "") for m in r.json().get("data", []))
    return {"models": len(ids), "whisper": [i for i in ids if "whisper" in i], "chat": [i for i in ids if "llama" in i or "gpt-oss" in i][:8]}


# --------------------------------------------------------------------------------------------- meeting notes
NOTES_SYSTEM = """You are an expert meeting analyst and chief of staff. You read a (possibly imperfect, speech-to-text) transcript and
produce precise, useful notes for busy people. The meeting may mix Urdu, Hindi and English; understand all of it.

Rules:
- Use ONLY what is in the transcript. Never invent names, numbers, dates, decisions or owners. If something is unclear write
  it as an open question instead of guessing. Fix obvious speech-recognition mistakes silently.
- Write the notes in {language}.
- Be concise: every item is one clear sentence. No filler, no repetition.
- "important_points": the facts, updates and statements that matter most, most important first. importance is high, medium or low.
- "decisions": things the group agreed or decided.
- "action_items": concrete tasks someone must do. owner = the person named for it, or "" if nobody was named. due = the
  deadline in the speaker's words ("Friday", "end of month"), or "".  priority is high, medium or low.
- "enhancements": improvement ideas for the product, process, plan or the meeting itself, either suggested in the meeting or
  clearly implied by problems discussed. For each give the idea, why it helps, and expected impact (high, medium, low).
  Mark ideas that were only suggested by you (not said in the meeting) with "source": "suggested", otherwise "source": "meeting".
- "risks": blockers, risks and concerns raised. "open_questions": unresolved questions. "next_steps": what happens next and when.
- "participants": names heard in the conversation (may be empty). "topics": 3 to 8 short topic labels.
- Empty lists are fine when the transcript has nothing for them.

Return ONLY one JSON object with exactly these keys:
{{"title": str, "summary": str, "important_points": [{{"point": str, "importance": str}}], "decisions": [str],
"action_items": [{{"task": str, "owner": str, "due": str, "priority": str}}],
"enhancements": [{{"idea": str, "why": str, "impact": str, "source": str}}],
"risks": [str], "open_questions": [str], "next_steps": [str], "participants": [str], "topics": [str]}}
The summary is 3 to 5 sentences."""

MERGE_SYSTEM = """You merge several partial meeting notes (JSON) from consecutive parts of ONE long meeting into a single final set of notes.
Remove duplicates, keep the most important items, keep every action item (merge near-identical ones), and write one coherent
summary of 4 to 6 sentences covering the whole meeting. Write in {language}. Return ONLY one JSON object with the same keys as the inputs."""

LIST_KEYS = ("decisions", "risks", "open_questions", "next_steps", "participants", "topics")


def _loads(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    try:
        j = json.loads(text)
    except ValueError:
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            raise GroqError("The AI answered in a format I couldn't read. Please try again.", 502)
        try:
            j = json.loads(m.group(0))
        except ValueError:
            raise GroqError("The AI answered in a format I couldn't read. Please try again.", 502)
    if not isinstance(j, dict):
        raise GroqError("The AI answered in a format I couldn't read. Please try again.", 502)
    return j


def _s(v, n=400) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _level(v, default="medium") -> str:
    v = str(v or "").strip().lower()
    return v if v in ("high", "medium", "low") else default


def normalize(j: dict, fallback_title: str = "") -> dict:
    """Whatever the model returned -> exactly the shape the UI expects, with sane limits."""
    out = {"title": _s(j.get("title"), 120) or fallback_title or "Meeting notes", "summary": _s(j.get("summary"), 1500)}
    pts = []
    for p in j.get("important_points") or []:
        if isinstance(p, dict):
            t = _s(p.get("point") or p.get("text"))
            if t:
                pts.append({"point": t, "importance": _level(p.get("importance"))})
        elif _s(p):
            pts.append({"point": _s(p), "importance": "medium"})
    order = {"high": 0, "medium": 1, "low": 2}
    out["important_points"] = sorted(pts, key=lambda x: order[x["importance"]])[:30]
    acts = []
    for a in j.get("action_items") or []:
        if isinstance(a, dict):
            t = _s(a.get("task") or a.get("action") or a.get("text"))
            if t:
                acts.append({"task": t, "owner": _s(a.get("owner"), 60), "due": _s(a.get("due"), 60), "priority": _level(a.get("priority"))})
        elif _s(a):
            acts.append({"task": _s(a), "owner": "", "due": "", "priority": "medium"})
    out["action_items"] = acts[:40]
    enh = []
    for e in j.get("enhancements") or []:
        if isinstance(e, dict):
            t = _s(e.get("idea") or e.get("text"))
            if t:
                enh.append({"idea": t, "why": _s(e.get("why") or e.get("reason")), "impact": _level(e.get("impact")), "source": "suggested" if str(e.get("source", "")).lower().startswith("sugg") else "meeting"})
        elif _s(e):
            enh.append({"idea": _s(e), "why": "", "impact": "medium", "source": "meeting"})
    out["enhancements"] = sorted(enh, key=lambda x: order[x["impact"]])[:20]
    for k in LIST_KEYS:
        v = j.get(k) or []
        out[k] = [_s(x, 300) for x in (v if isinstance(v, list) else [v]) if _s(x)][:25]
    return out


async def _chat_json(key: str, model: str, system: str, user: str, max_tokens: int = 2500) -> dict:
    import httpx

    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    last = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as http:
                r = await http.post(GROQ_BASE + "/chat/completions", json=body, headers={"Authorization": "Bearer " + key})
        except httpx.TimeoutException:
            raise GroqError("Groq took too long to write the notes. Try again.", 504)
        except httpx.HTTPError:
            raise GroqError("Couldn't reach Groq. Check the server's internet connection.", 502)
        if r.status_code == 429 and attempt < 2:  # free-tier limits are per minute: wait a little and retry
            wait = r.headers.get("retry-after", "")
            await asyncio.sleep(min(float(wait) if wait.replace(".", "", 1).isdigit() else 8, 20))
            last = _http_error(429, r.text, wait)
            continue
        if r.status_code == 400 and "json" in r.text.lower() and "response_format" in body:
            body.pop("response_format")  # a model that doesn't support JSON mode: ask in plain words (we parse leniently)
            continue
        if r.status_code >= 400:
            raise _http_error(r.status_code, r.text, r.headers.get("retry-after", ""))
        return _loads(r.json()["choices"][0]["message"]["content"])
    raise last or GroqError("Groq is busy. Try again in a minute.", 429)


def split_transcript(text: str, size: Optional[int] = None) -> List[str]:
    """Cut at line breaks so no sentence is split; each part stays under `size` characters."""
    size = size or CHUNK_CHARS
    parts, cur = [], ""
    for line in text.splitlines():
        while len(line) > size:  # a single enormous line
            if cur:
                parts.append(cur)
                cur = ""
            parts.append(line[:size])
            line = line[size:]
        if len(cur) + len(line) + 1 > size and cur:
            parts.append(cur)
            cur = ""
        cur += line + "\n"
    if cur.strip():
        parts.append(cur)
    return parts or [text]


async def analyze(transcript: str, key: str, title: str = "", output_lang: str = "en", quick: bool = False) -> dict:
    """Transcript -> structured notes. Long meetings are summarised in parts and merged."""
    transcript = (transcript or "").strip()
    if len(transcript) < 20:
        raise GroqError("There isn't enough speech in the transcript to write notes yet.", 400)
    lang = OUTPUT_LANGS.get(output_lang, OUTPUT_LANGS["en"])
    head = f"Meeting title (may be empty): {title}\n\n" if title else ""
    if quick:  # "key points so far": only the latest part, fast model
        tail = transcript[-CHUNK_CHARS:]
        j = await _chat_json(key, FAST_CHAT_MODEL, NOTES_SYSTEM.format(language=lang), head + "Transcript so far (latest part):\n" + tail)
        return normalize(j, title)
    transcript = transcript[:MAX_TRANSCRIPT_CHARS]
    parts = split_transcript(transcript)
    if len(parts) == 1:
        return normalize(await _chat_json(key, CHAT_MODEL, NOTES_SYSTEM.format(language=lang), head + "Transcript:\n" + parts[0]), title)
    partial = []
    for i, p in enumerate(parts, 1):  # sequential on purpose: stays friendly to per-minute token limits
        j = await _chat_json(key, CHAT_MODEL, NOTES_SYSTEM.format(language=lang), f"{head}Part {i} of {len(parts)} of the transcript:\n{p}", 2200)
        partial.append(normalize(j, title))
    merged_in = json.dumps(partial, ensure_ascii=False)[:30000]
    j = await _chat_json(key, CHAT_MODEL, MERGE_SYSTEM.format(language=lang), merged_in)
    return normalize(j, title)


def to_markdown(notes: dict, transcript: str = "", date: str = "") -> str:
    """Plain Markdown for download / email / the agent."""
    L = [f"# {notes.get('title') or 'Meeting notes'}"]
    if date:
        L.append(f"*{date}*")
    if notes.get("participants"):
        L.append("**Participants:** " + ", ".join(notes["participants"]))
    L += ["", "## Summary", notes.get("summary", "")]

    def sec(name, items, fmt):
        if items:
            L.extend(["", f"## {name}"] + [fmt(i) for i in items])

    sec("Important points", notes.get("important_points", []), lambda p: f"- **{p['importance'].upper()}**: {p['point']}")
    sec("Decisions", notes.get("decisions", []), lambda x: f"- {x}")
    sec("Action items", notes.get("action_items", []), lambda a: f"- [ ] {a['task']}" + (f" — **{a['owner']}**" if a["owner"] else "") + (f" (due {a['due']})" if a["due"] else ""))
    sec("Enhancements", notes.get("enhancements", []), lambda e: f"- **{e['impact'].upper()} impact**: {e['idea']}" + (f" — {e['why']}" if e["why"] else "") + (" *(suggested)*" if e["source"] == "suggested" else ""))
    sec("Risks and blockers", notes.get("risks", []), lambda x: f"- {x}")
    sec("Open questions", notes.get("open_questions", []), lambda x: f"- {x}")
    sec("Next steps", notes.get("next_steps", []), lambda x: f"- {x}")
    if transcript:
        L.extend(["", "## Transcript", transcript])
    return "\n".join(L).strip() + "\n"
