"""Otter-style meeting intelligence on top of the existing transcript + notes store.

  ask_one / ask_many   chat with one meeting, or with everything you have recorded ("what did we decide about pricing?")
  label_speakers       estimate who said each line (Whisper does not mark speakers, so this is inferred from the conversation)
  followup_email       a ready-to-send follow-up email from the notes
  insights             keywords, talk time per speaker, question count (no AI call, computed locally)
  search               full-text search across every meeting, with a snippet around the hit
  to_txt / to_srt / to_vtt   exports with speaker names and timestamps
  shared_html          the read-only page behind a share link
"""
import html
import json
import re
import time
from collections import Counter
from typing import Dict, List, Optional

from . import meeting
from .meeting import GroqError, _chat_json, _s

_TS = re.compile(r"^\[((?:\d+:)?\d{1,2}:\d{2})\]\s*(.*)$")
STOP = set("""a an the and or but if so to of in on at for with from by is are was were be been being it its this that these those i you he she we they me him her us them my your our their
am do does did done have has had not no yes ok okay just really very can could would should will shall may might also then than there here what which who whom when where why how about into over
out up down as too much many more some any all one like get got going go yeah um uh hmm right well still thing things lot kind sort""".split())
STOP |= set("hai hain ho ka ki ke ko se me mein ne par pe to bhi aur ya kya ye wo yeh woh hum aap tum main mai nahi nahin tha thi the raha rahi rahe kar karna karo kuch ab phir jo".split())


def _hms(sec: float) -> str:
    sec = max(0, int(sec))
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def parse_lines(transcript: str) -> List[dict]:
    """'[1:05] hello' lines -> [{"t": 65.0, "text": "hello"}]. Lines without a stamp (pasted text) get t=None."""
    out = []
    for raw in (transcript or "").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        m = _TS.match(raw)
        if m:
            parts = [int(x) for x in m.group(1).split(":")]
            t = float(parts[0] * 3600 + parts[1] * 60 + parts[2]) if len(parts) == 3 else float(parts[0] * 60 + parts[1])
            out.append({"t": t, "text": m.group(2).strip()})
        else:
            out.append({"t": None, "text": raw})
    return out


def default_extra() -> dict:
    return {"labels": [], "names": {}, "highlights": [], "comments": [], "tags": []}


def load_extra(raw: str) -> dict:
    ex = default_extra()
    try:
        j = json.loads(raw or "{}")
        if isinstance(j, dict):
            ex.update({k: j[k] for k in ex if k in j})
    except ValueError:
        pass
    return ex


def clean_extra(j: dict, n_lines: int) -> dict:
    """Whatever the browser sent -> a safe, bounded structure."""
    ex = default_extra()
    ex["labels"] = [max(0, min(int(x), 20)) for x in (j.get("labels") or [])[:n_lines] if str(x).lstrip("-").isdigit()]
    names = j.get("names") or {}
    if isinstance(names, dict):
        ex["names"] = {str(k)[:3]: _s(v, 40) for k, v in list(names.items())[:20] if str(k).isdigit()}
    ex["highlights"] = sorted({int(i) for i in (j.get("highlights") or [])[:500] if str(i).isdigit() and int(i) < n_lines})
    cm = []
    for c in (j.get("comments") or [])[:200]:
        if isinstance(c, dict) and str(c.get("line", "")).isdigit() and int(c["line"]) < n_lines and _s(c.get("text"), 500):
            cm.append({"line": int(c["line"]), "text": _s(c.get("text"), 500), "at": float(c.get("at") or 0)})
    ex["comments"] = cm
    ex["tags"] = [_s(t, 30) for t in (j.get("tags") or [])[:12] if _s(t, 30)]
    return ex


def speaker_name(ex: dict, n: int) -> str:
    return (ex.get("names") or {}).get(str(n)) or (f"Speaker {n}" if n else "")


# ------------------------------------------------------------------ LLM helpers
async def _chat_text(key: str, system: str, user: str, max_tokens: int = 1200, model: Optional[str] = None) -> str:
    import asyncio
    import httpx

    body = {"model": model or meeting.CHAT_MODEL, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}], "temperature": 0.3, "max_tokens": max_tokens}
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=meeting.TIMEOUT) as http:
                r = await http.post(meeting.GROQ_BASE + "/chat/completions", json=body, headers={"Authorization": "Bearer " + key})
        except httpx.TimeoutException:
            raise GroqError("Groq took too long to answer. Try again.", 504)
        except httpx.HTTPError:
            raise GroqError("Couldn't reach Groq. Check the server's internet connection.", 502)
        if r.status_code == 429 and attempt < 2:
            await asyncio.sleep(8)
            continue
        if r.status_code >= 400:
            raise meeting._http_error(r.status_code, r.text, r.headers.get("retry-after", ""))
        return (r.json()["choices"][0]["message"]["content"] or "").strip()
    raise GroqError("Groq is busy. Try again in a minute.", 429)


ASK_SYSTEM = """You answer questions about meeting recordings, like a sharp note-taker who was in the room.
Use ONLY the material provided. If the answer is not there, say so plainly; never invent names, numbers, dates or decisions.
Be concise: a short direct answer first, then bullets only if several items are needed.
Quote timestamps like [12:30] when you point to where something was said. When several meetings are given, name the meeting each fact came from.
Answer in the language of the question (Roman Urdu questions get Roman Urdu answers)."""


def _labelled_transcript(transcript: str, ex: dict, limit: int) -> str:
    lines = parse_lines(transcript)
    labels = ex.get("labels") or []
    out = []
    for i, ln in enumerate(lines):
        sp = speaker_name(ex, labels[i]) if i < len(labels) and labels[i] else ""
        ts = f"[{_hms(ln['t'])}] " if ln["t"] is not None else ""
        out.append(ts + (sp + ": " if sp else "") + ln["text"])
    text = "\n".join(out)
    return text[:limit]


async def ask_one(question: str, title: str, transcript: str, notes: dict, ex: dict, key: str, history: Optional[list] = None) -> str:
    ctx = f"Meeting: {title}\n\nSummary: {notes.get('summary', '')}\n\nTranscript:\n" + _labelled_transcript(transcript, ex, 22000)
    msgs = ""
    for h in (history or [])[-4:]:
        if isinstance(h, dict) and h.get("q") and h.get("a"):
            msgs += f"Earlier question: {_s(h['q'], 300)}\nEarlier answer: {_s(h['a'], 600)}\n"
    return await _chat_text(key, ASK_SYSTEM, ctx + ("\n\n" + msgs if msgs else "") + "\n\nQuestion: " + question[:800])


def _terms(q: str) -> List[str]:
    return [w for w in re.findall(r"[\w؀-ۿ]{3,}", q.lower()) if w not in STOP][:12]


def _window(text: str, terms: List[str], size: int = 2600) -> str:
    low = text.lower()
    best, at = -1, 0
    step = 600
    for i in range(0, max(1, len(text) - size // 2), step):
        seg = low[i:i + size]
        score = sum(seg.count(t) for t in terms)
        if score > best:
            best, at = score, i
    return text[at:at + size]


async def ask_many(question: str, rows: List[dict], key: str) -> dict:
    """rows: full meeting rows (title, transcript, notes json, id, created). Picks the best few, answers across them."""
    terms = _terms(question)
    scored = []
    for r in rows:
        hay = (r["title"] + " " + r["notes"] + " " + r["transcript"]).lower()
        s = sum(hay.count(t) for t in terms) if terms else 0
        scored.append((s, r))
    scored.sort(key=lambda x: (x[0], x[1]["created"]), reverse=True)
    pick = [r for s, r in scored[:4] if s > 0] or [r for _, r in scored[:2]]
    if not pick:
        return {"answer": "You have no saved meetings yet.", "sources": []}
    parts = []
    for r in pick:
        try:
            summ = json.loads(r["notes"]).get("summary", "")
        except ValueError:
            summ = ""
        parts.append(f"=== Meeting: {r['title']} (id {r['id']}) ===\nSummary: {summ}\nExcerpt:\n{_window(r['transcript'], terms)}")
    ans = await _chat_text(key, ASK_SYSTEM, "\n\n".join(parts)[:24000] + "\n\nQuestion: " + question[:800])
    return {"answer": ans, "sources": [{"id": r["id"], "title": r["title"]} for r in pick]}


# ------------------------------------------------------------------ speakers
SPEAKER_SYSTEM = """You are given numbered lines from ONE meeting recording. The audio had no speaker marks.
Assign every line to a speaker using the conversation itself: turn-taking, who asks and who answers, names people address each other by, self-introductions, topics each person owns.
Use consecutive speaker numbers starting at 1, consistently across the whole input. Consecutive lines often belong to the same person; do not change speaker on every line.
If a speaker's real first name is clearly stated or addressed, put it in "names", otherwise leave it empty.
Return JSON only: {"names": {"1": "Ali", "2": ""}, "labels": [1,1,2,...]} where labels has EXACTLY one number per input line, in order."""


async def label_speakers(transcript: str, key: str) -> dict:
    lines = parse_lines(transcript)
    if len(lines) < 2:
        raise GroqError("There isn't enough conversation to tell speakers apart.", 400)
    lines = lines[:1500]
    labels: List[int] = []
    names: Dict[str, str] = {}
    i = 0
    while i < len(lines):
        chunk, size = [], 0
        while i + len(chunk) < len(lines) and size < 8000 and len(chunk) < 140:
            size += len(lines[i + len(chunk)]["text"]) + 8
            chunk.append(lines[i + len(chunk)])
        ctx = ""
        if labels:
            tail = range(max(0, len(labels) - 6), len(labels))
            ctx = "Context so far (already labelled, keep the same speaker numbers): known speakers " + json.dumps(names, ensure_ascii=False) + "\n" + "\n".join(f"S{labels[k]}: {lines[k]['text'][:160]}" for k in tail) + "\n\nNow label these lines:\n"
        body = ctx + "\n".join(f"{n + 1}. {c['text'][:400]}" for n, c in enumerate(chunk))
        j = await _chat_json(key, meeting.CHAT_MODEL, SPEAKER_SYSTEM, body, 1800)
        got = [int(x) if str(x).isdigit() else 0 for x in (j.get("labels") or [])]
        prev = labels[-1] if labels else 1
        fixed = []
        for n in range(len(chunk)):
            v = got[n] if n < len(got) and 1 <= got[n] <= 12 else prev
            fixed.append(v)
            prev = v
        labels.extend(fixed)
        for k, v in (j.get("names") or {}).items():
            if str(k).isdigit() and _s(v, 40) and str(k) not in names:
                names[str(k)] = _s(v, 40)
        i += len(chunk)
    return {"labels": labels, "names": names}


# ------------------------------------------------------------------ follow-up email
EMAIL_SYSTEM = """Write a follow-up email for a meeting, from the notes provided. Tone: {tone}. Language: {language}.
Include: a one-line thanks, a short summary, the decisions, and the action items with owner and due date, then a polite close. No invented facts. Plain text, no markdown.
Return JSON only: {{"subject": "...", "body": "..."}}"""


async def followup_email(notes: dict, title: str, key: str, tone: str = "friendly and professional", language: str = "English") -> dict:
    j = await _chat_json(key, meeting.CHAT_MODEL, EMAIL_SYSTEM.format(tone=_s(tone, 60) or "professional", language=_s(language, 40) or "English"), f"Meeting: {title}\n" + json.dumps(notes, ensure_ascii=False)[:14000], 1400)
    return {"subject": _s(j.get("subject"), 200) or "Follow-up: " + title, "body": str(j.get("body") or "").strip()[:6000]}


# ------------------------------------------------------------------ insights (no AI)
def insights(transcript: str, ex: dict, duration: float = 0) -> dict:
    lines = parse_lines(transcript)
    labels = ex.get("labels") or []
    words = Counter()
    for ln in lines:
        for w in re.findall(r"[\w؀-ۿ']{3,}", ln["text"].lower()):
            if w not in STOP and not w.isdigit():
                words[w] += 1
    # bigrams read better than single words for topics
    bi = Counter()
    for ln in lines:
        toks = [w for w in re.findall(r"[\w؀-ۿ']{3,}", ln["text"].lower())]
        for a, b in zip(toks, toks[1:]):
            if a not in STOP and b not in STOP:
                bi[a + " " + b] += 1
    keywords = [w for w, c in bi.most_common(6) if c >= 2] + [w for w, c in words.most_common(14) if c >= 2]
    seen, kw = set(), []
    for w in keywords:
        if w not in seen and not any(w in x.split() for x in kw if " " in x):
            seen.add(w)
            kw.append(w)
    talk: Dict[int, float] = {}
    wc: Dict[int, int] = {}
    for i, ln in enumerate(lines):
        sp = labels[i] if i < len(labels) else 0
        nxt = lines[i + 1]["t"] if i + 1 < len(lines) else None
        n_words = len(ln["text"].split())
        wc[sp] = wc.get(sp, 0) + n_words
        if ln["t"] is not None and nxt is not None and nxt >= ln["t"]:
            dur = min(nxt - ln["t"], 45)
        else:
            dur = n_words / 2.5  # ~150 words a minute
        talk[sp] = talk.get(sp, 0) + dur
    total = sum(talk.values()) or 1
    speakers = [{"id": k, "name": speaker_name(ex, k) or "Unlabelled", "seconds": round(v), "share": round(100 * v / total), "words": wc.get(k, 0)} for k, v in sorted(talk.items(), key=lambda x: -x[1])]
    return {"keywords": kw[:14], "speakers": speakers, "lines": len(lines), "words": sum(wc.values()), "questions": sum(len(re.findall(r"[?؟]", ln["text"])) for ln in lines), "duration": duration}


# ------------------------------------------------------------------ search
def snippet(text: str, terms: List[str], width: int = 150) -> str:
    low = text.lower()
    pos = min((p for p in (low.find(t) for t in terms) if p >= 0), default=-1)
    if pos < 0:
        return _s(text[: width * 2], width * 2)
    a = max(0, pos - width // 2)
    return ("…" if a else "") + re.sub(r"\s+", " ", text[a:a + width * 2]).strip() + "…"


def search_terms(q: str) -> List[str]:
    return [w for w in re.findall(r"[\w؀-ۿ']+", q.lower()) if len(w) >= 2][:6]


# ------------------------------------------------------------------ exports
def _name_for(ex: dict, labels: list, i: int) -> str:
    return speaker_name(ex, labels[i]) if i < len(labels) and labels[i] else ""


def to_txt(title: str, transcript: str, ex: dict) -> str:
    lines, labels, out = parse_lines(transcript), ex.get("labels") or [], [title, "=" * min(len(title), 60), ""]
    hl = set(ex.get("highlights") or [])
    last = None
    for i, ln in enumerate(lines):
        sp = _name_for(ex, labels, i)
        ts = f"[{_hms(ln['t'])}] " if ln["t"] is not None else ""
        head = f"{sp}: " if sp and sp != last else ""
        out.append(("★ " if i in hl else "") + ts + head + ln["text"])
        last = sp or last
    return "\n".join(out) + "\n"


def _stamp(sec: float, comma: bool) -> str:
    ms = int(round((sec - int(sec)) * 1000))
    s = int(sec)
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}{',' if comma else '.'}{ms:03d}"


def _cues(transcript: str, ex: dict):
    lines, labels = parse_lines(transcript), ex.get("labels") or []
    t = 0.0
    cues = []
    for i, ln in enumerate(lines):
        start = ln["t"] if ln["t"] is not None else t
        nxt = next((x["t"] for x in lines[i + 1:] if x["t"] is not None), None)
        end = min(nxt, start + 12) if nxt is not None and nxt > start else start + max(2.0, len(ln["text"].split()) / 2.5)
        sp = _name_for(ex, labels, i)
        cues.append((start, end, (f"{sp}: " if sp else "") + ln["text"]))
        t = end
    return cues


def to_srt(transcript: str, ex: dict) -> str:
    return "\n".join(f"{n}\n{_stamp(a, True)} --> {_stamp(b, True)}\n{txt}\n" for n, (a, b, txt) in enumerate(_cues(transcript, ex), 1))


def to_vtt(transcript: str, ex: dict) -> str:
    return "WEBVTT\n\n" + "\n".join(f"{_stamp(a, False)} --> {_stamp(b, False)}\n{txt}\n" for a, b, txt in _cues(transcript, ex))


# ------------------------------------------------------------------ public share page
def shared_html(row: dict, notes: dict, ex: dict) -> str:
    e = html.escape

    def ul(items, fmt=lambda x: e(str(x))):
        return "<ul>" + "".join(f"<li>{fmt(i)}</li>" for i in items) + "</ul>" if items else ""

    parts = [f"<h1>{e(row['title'])}</h1>", f"<p class=meta>{e(time.strftime('%d %B %Y', time.localtime(row['created'])))}"
             + (f" · {max(1, round(row['duration'] / 60))} min" if row.get("duration") else "") + "</p>"]
    if notes.get("summary"):
        parts.append(f"<h2>Summary</h2><p>{e(notes['summary'])}</p>")
    for name, key, fmt in (
        ("Important points", "important_points", lambda p: f"<b>{e(p['importance'])}</b> {e(p['point'])}"),
        ("Decisions", "decisions", None),
        ("Action items", "action_items", lambda a: e(a["task"]) + (f" — <b>{e(a['owner'])}</b>" if a.get("owner") else "") + (f" <i>(due {e(a['due'])})</i>" if a.get("due") else "")),
        ("Next steps", "next_steps", None),
    ):
        items = notes.get(key) or []
        if items:
            parts.append(f"<h2>{name}</h2>" + (ul(items, fmt) if fmt else ul(items)))
    lines, labels = parse_lines(row["transcript"]), ex.get("labels") or []
    hl = set(ex.get("highlights") or [])
    tr = []
    for i, ln in enumerate(lines[:3000]):
        sp = _name_for(ex, labels, i)
        ts = f"<time>{_hms(ln['t'])}</time> " if ln["t"] is not None else ""
        tr.append(f"<p class='{'hl' if i in hl else ''}'>{ts}{('<b>' + e(sp) + '</b> ') if sp else ''}{e(ln['text'])}</p>")
    parts.append("<h2>Transcript</h2>" + "".join(tr))
    css = ("body{font:16px/1.6 system-ui,Segoe UI,sans-serif;max-width:760px;margin:0 auto;padding:32px 20px;background:#0b1a24;color:#e8f1f5}"
           "h1{font-size:30px;margin:0 0 4px}h2{margin:28px 0 8px;color:#2fe3ff;font-size:18px}.meta{color:#9db3c0}li{margin:4px 0}"
           "time{color:#9db3c0;font-size:13px;margin-right:6px}p.hl{background:rgba(255,178,28,.16);border-left:3px solid #ffb21c;padding-left:8px}"
           ".foot{margin-top:40px;color:#9db3c0;font-size:13px}@media(prefers-color-scheme:light){body{background:#fff;color:#0b1a24}h2{color:#0a7a78}}")
    return (f"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<meta name=robots content='noindex,nofollow'><title>{e(row['title'])}</title><style>{css}</style></head><body>" + "".join(parts) +
            "<p class=foot>Shared read-only from Aegis.</p></body></html>")
