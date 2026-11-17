"""The AI brain: an async tool-use loop on the Claude API.

The model picks tools; server tools run here, desktop tools are sent to the user's
desktop app, and risky tools wait for the user's approval in the UI.
"""
import re
from datetime import datetime, timezone
from typing import Awaitable, Callable, List

from . import settings, tools, utilities
from .db import DB
from .hub import Hub

Emit = Callable[[dict], Awaitable[None]]

SYSTEM = """You are {app}, a personal AI assistant in the spirit of JARVIS: calm, sharp, warm, quietly witty and always one
step ahead. You are both a capable operator and a genuinely good conversation partner. It is now {today} (the user's local time).

Conversation (this is most of your job):
- Answer ANY question the user asks, directly and from your own knowledge: science, history, coding, maths, health,
  money, law, cooking, travel, languages, advice, brainstorming, explanations, translation, opinions, small talk and
  jokes. Never say "I can only help with PC tasks". Tools are for actions and live data, not a gate for talking.
- Talk like a person, not a manual. Give the answer first, then at most one short useful extra or a natural follow-up
  question. Be honest when you are unsure, and never invent facts, sources or numbers.
- Match the user's language AND script exactly: English, Urdu script, Hindi, or Roman Urdu/Hinglish (if they write
  "kya haal hai" answer in Roman Urdu). Mirror their formality and energy.
- Your replies are usually read aloud. Default to 1-3 short sentences with plain words, no markdown, no tables, no
  bullet lists, no emojis, and say numbers and units naturally. Go longer only when asked to explain in depth, and
  then use short paragraphs.

Doing things:
- Break multi-step requests into tool calls and keep going until the goal is done. Do not ask permission for
  harmless things (searching, reading, remembering, calculating, weather); just do them and report briefly.
- Use `calculate` for any arithmetic and `get_weather` for weather rather than guessing. Use `current_time` only if
  the date above is not enough.
- {device_line}
- {search_line}
- You are a full personal assistant: keep their to-do list (`add_task`, `list_tasks`, `complete_task`), set reminders that
  pop up and are spoken at the right time (`set_reminder`), save longer notes (`save_note`, `search_notes`), convert
  currencies live, look things up on Wikipedia, and read any web page the user links (`fetch_url`). For "good morning" or
  "what is my day like" call `daily_briefing` (pass their city if you know it from memory) and summarise it warmly.
- For reminders, work out the exact time from the local time above. "in 20 minutes" -> in_minutes 20; "tomorrow at 9" ->
  at "YYYY-MM-DD 09:00". Confirm back in plain words what time you set.
- Use `remember` when the user shares something worth keeping (names, dates, preferences, projects), and `recall`
  when they ask about their own life, preferences or earlier requests. Mention naturally that you will remember it.
- In the browser the app itself handles voice commands such as "open YouTube", "set a timer for 5 minutes",
  "switch to Urdu" or "change theme to red". If asked for those and they reach you, just do the best you can in words.
- Some tools need the user's approval. If the user declines, do not retry that action.
- Never delete, overwrite or send anything unless the user clearly asked for it.
{memory_block}"""


def _tokens(text: str) -> set:
    return set(re.findall(r"\w+", text.lower()))


class Session:
    """State for one open chat connection."""

    def __init__(self, user_id: int, ws, history: List[dict], tz: str = ""):
        self.user_id = user_id
        self.ws = ws
        self.history = history
        self.tz = tz
        self.busy = False
        self.task = None  # the running chat task, so the user can press Stop
        self.stopped = False


def trim_history(history: List[dict], keep: int = 40, limit: int = 60):
    """Drop old turns without splitting a tool_use / tool_result pair."""
    if len(history) <= limit:
        return
    start = len(history) - keep
    for i in range(start, len(history)):
        m = history[i]
        if m["role"] == "user" and isinstance(m["content"], str):
            del history[:i]
            return


class Agent:
    def __init__(self, client, db: DB, hub: Hub):
        self.client = client
        self.db = db
        self.hub = hub

    def _system(self, uid: int, user_text: str, device: bool, tz: str = "") -> str:
        rows = self.db.facts(uid)
        q = _tokens(user_text)
        relevant = sorted(rows, key=lambda r: -len(q & _tokens(r["text"])))
        relevant = [r for r in relevant if q & _tokens(r["text"])][:5]
        chosen, seen = [], set()
        for r in relevant + list(rows[:6]):
            if r["id"] not in seen:
                seen.add(r["id"])
                chosen.append(r["text"])
        block = ""
        if chosen:
            block = "\nWhat you already know about the user:\n" + "\n".join(f"- {t}" for t in chosen) + "\n"
        device_line = (
            "The user's desktop app is connected, so you can control their PC with tools."
            if device
            else "The user's desktop app is NOT connected. You cannot control their PC right now; "
            "if they ask for a PC action, tell them to open the Aegis desktop app. You can still chat, remember and recall."
        )
        search_line = (
            "You can search the web for current information (news, prices, weather, facts). Use it whenever the answer may have changed recently."
            if settings.WEB_SEARCH
            else "You have no live web access, so say so if asked for current news or prices."
        )
        return SYSTEM.format(today=utilities.now_in(tz).strftime("%A, %d %B %Y, %H:%M") + (f" ({tz})" if tz else " UTC"), app=settings.APP_NAME, device_line=device_line, search_line=search_line, memory_block=block)

    async def _run_server_tool(self, uid: int, name: str, args: dict, tz: str = "") -> str:
        import asyncio

        if name in ("fetch_url", "wikipedia", "convert_currency", "daily_briefing"):
            return await asyncio.to_thread(self._blocking_tool, uid, name, args, tz)
        if name == "remember":
            fact = str(args.get("fact", "")).strip()[:500]
            if not fact:
                return "Error: empty fact"
            self.db.add_fact(uid, fact)
            return "Saved to memory."
        if name == "recall":
            q = _tokens(str(args.get("query", "")))
            hits = [r["text"] for r in self.db.facts(uid) if q & _tokens(r["text"])][:8]
            return "\n".join(f"- {h}" for h in hits) or "Nothing relevant in memory."
        if name == "forget":
            text = str(args.get("contains", "")).strip()
            if len(text) < 3:
                return "Error: give at least 3 characters to match."
            return f"Forgot {self.db.delete_facts_containing(uid, text)} memory item(s)."
        if name == "current_time":
            zone = str(args.get("timezone", "")).strip()
            if zone and utilities.get_zone(zone) is timezone.utc and zone.upper() != "UTC":
                return f"Error: unknown timezone {zone}. Use a name like Asia/Karachi."
            return utilities.now_in(zone or tz).strftime("%A, %d %B %Y, %H:%M %Z").strip()
        if name == "add_task":
            text = str(args.get("text", "")).strip()
            if not text:
                return "Error: empty task."
            self.db.add_task(uid, text, args.get("due", ""))
            return f"Added to your to-do list: {text}"
        if name == "list_tasks":
            rows = self.db.tasks(uid)
            if not rows:
                return "The to-do list is empty."
            return "\n".join(f"- [{'x' if r['done'] else ' '}] {r['text']}" + (f" (due {r['due']})" if r["due"] else "") for r in rows[:40])
        if name == "complete_task":
            text = str(args.get("contains", "")).strip()
            if len(text) < 2:
                return "Error: say which task."
            hit = self.db.complete_task_matching(uid, text)
            return f"Marked done: {hit}" if hit else "No open task matches that."
        if name == "set_reminder":
            text = str(args.get("text", "")).strip()
            if not text:
                return "Error: what should the reminder say?"
            try:
                due_ts, human = utilities.resolve_due(args, tz)
            except ValueError as e:
                return f"Error: {e}."
            self.db.add_reminder(uid, text, due_ts)
            return f"Reminder set for {human}: {text}"
        if name == "list_reminders":
            rows = self.db.reminders(uid)
            zone = utilities.get_zone(tz)
            return "\n".join(f"- {datetime.fromtimestamp(r['due'], zone).strftime('%a %d %b %H:%M')}: {r['text']}" for r in rows) or "No upcoming reminders."
        if name == "cancel_reminder":
            text = str(args.get("contains", "")).strip()
            if len(text) < 2:
                return "Error: say which reminder."
            n = self.db.cancel_reminders_matching(uid, text)
            return f"Cancelled {n} reminder(s)." if n else "No upcoming reminder matches that."
        if name == "save_note":
            body = str(args.get("content", "")).strip()
            if not body:
                return "Error: the note is empty."
            self.db.add_note(uid, str(args.get("title", "")), body)
            return "Note saved."
        if name == "search_notes":
            rows = self.db.notes(uid, str(args.get("query", "")).strip())[:8]
            return "\n\n".join(f"# {r['title']}\n{r['body'][:600]}" for r in rows) or "No notes found."
        if name == "calculate":
            return utilities.safe_calc(str(args.get("expression", "")))
        if name == "get_weather":
            import asyncio
            return await asyncio.to_thread(utilities.weather_for, str(args.get("city", "")))
        return f"Error: unknown tool {name}"

    def _blocking_tool(self, uid: int, name: str, args: dict, tz: str) -> str:
        """Tools that do network work; run in a worker thread so the event loop stays responsive."""
        if name == "fetch_url":
            return utilities.fetch_page(str(args.get("url", "")))
        if name == "wikipedia":
            return utilities.wikipedia_summary(str(args.get("topic", "")), str(args.get("lang", "en") or "en"))
        if name == "convert_currency":
            return utilities.convert_currency(args.get("amount"), args.get("from_currency", ""), args.get("to_currency", ""))
        if name == "daily_briefing":
            now = utilities.now_in(tz)
            parts = [f"Now: {now.strftime('%A, %d %B %Y, %H:%M')}"]
            tasks = [t for t in self.db.tasks(uid, include_done=False)][:10]
            parts.append("Open tasks:\n" + ("\n".join(f"- {t['text']}" + (f" (due {t['due']})" if t["due"] else "") for t in tasks) if tasks else "none"))
            zone = utilities.get_zone(tz)
            rem = self.db.reminders(uid)[:8]
            parts.append("Upcoming reminders:\n" + ("\n".join(f"- {datetime.fromtimestamp(r['due'], zone).strftime('%a %H:%M')}: {r['text']}" for r in rem) if rem else "none"))
            city = str(args.get("city", "")).strip()
            if city:
                parts.append("Weather:\n" + utilities.weather_for(city))
            return "\n\n".join(parts)
        return f"Error: unknown tool {name}"

    async def _model_turn(self, system: str, tool_schemas: list, messages: list, emit: Emit):
        """One model call. With the real SDK the answer streams word by word to the UI."""
        kw = dict(model=settings.MODEL, max_tokens=settings.MAX_TOKENS, system=system, tools=tool_schemas, messages=messages)
        msgs = self.client.messages
        if hasattr(msgs, "stream"):
            async with msgs.stream(**kw) as stream:
                async for ev in stream:
                    if getattr(ev, "type", "") == "text" and getattr(ev, "text", ""):
                        await emit({"type": "delta", "text": ev.text})
                return await stream.get_final_message()
        return await msgs.create(**kw)

    async def run(self, sess: Session, text: str, emit: Emit) -> str:
        uid = sess.user_id
        start_len = len(sess.history)
        sess.history.append({"role": "user", "content": text})
        try:
            for _ in range(settings.MAX_AGENT_STEPS):
                device = self.hub.device_connected(uid)
                resp = await self._model_turn(
                    self._system(uid, text, device, sess.tz),
                    tools.schemas(device, settings.WEB_SEARCH, settings.WEB_SEARCH_MAX_USES),
                    sess.history,
                    emit,
                )
                sess.history.append({"role": "assistant", "content": resp.content})

                uses = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
                if not uses and getattr(resp, "stop_reason", None) == "pause_turn":
                    continue  # the server-side web search needs another turn to finish
                if not uses:
                    out = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
                    trim_history(sess.history)
                    return out or "Done."

                await emit({"type": "delta_end"})  # close any text bubble streamed before the tool calls
                results = []
                for tu in uses:
                    results.append(await self._execute(sess, tu, emit))
                sess.history.append({"role": "user", "content": results})
            trim_history(sess.history)
            return "I stopped after too many steps. Try splitting the request into smaller parts."
        except BaseException:
            del sess.history[start_len:]  # never leave a dangling tool_use behind
            raise

    async def _execute(self, sess: Session, tu, emit: Emit) -> dict:
        uid = sess.user_id
        tool = tools.BY_NAME.get(tu.name)
        args = tu.input if isinstance(tu.input, dict) else {}
        await emit({"type": "tool", "id": tu.id, "name": tu.name, "args": args, "risky": bool(tool and tool.risky)})

        ok = True
        if tool is None:
            out, ok = f"Error: unknown tool {tu.name}", False
        elif tool.risky and not await self.hub.ask_confirm(uid, sess.ws, tu.name, args):
            out, ok = "The user declined this action (or did not answer). Do not retry it.", False
        elif tool.where == "server":
            out = await self._run_server_tool(uid, tu.name, args, sess.tz)
        else:
            out = await self.hub.call_device(uid, tu.name, args)
        out = str(out)
        if out.startswith("Error"):
            ok = False

        await emit({"type": "tool_done", "id": tu.id, "name": tu.name, "ok": ok})
        return {"type": "tool_result", "tool_use_id": tu.id, "content": out[:6000]}
