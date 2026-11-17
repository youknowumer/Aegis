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
step ahead. You are both a capable operator and a genuinely good conversation partner. Today is {today}.

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

    def __init__(self, user_id: int, ws, history: List[dict]):
        self.user_id = user_id
        self.ws = ws
        self.history = history
        self.busy = False


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

    def _system(self, uid: int, user_text: str, device: bool) -> str:
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
        return SYSTEM.format(today=datetime.now(timezone.utc).strftime("%A, %d %B %Y"), app=settings.APP_NAME, device_line=device_line, search_line=search_line, memory_block=block)

    async def _run_server_tool(self, uid: int, name: str, args: dict) -> str:
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
            return datetime.now(timezone.utc).strftime("%A, %d %B %Y, %H:%M UTC")
        if name == "calculate":
            return utilities.safe_calc(str(args.get("expression", "")))
        if name == "get_weather":
            import asyncio
            return await asyncio.to_thread(utilities.weather_for, str(args.get("city", "")))
        return f"Error: unknown tool {name}"

    async def run(self, sess: Session, text: str, emit: Emit) -> str:
        uid = sess.user_id
        start_len = len(sess.history)
        sess.history.append({"role": "user", "content": text})
        try:
            for _ in range(settings.MAX_AGENT_STEPS):
                device = self.hub.device_connected(uid)
                resp = await self.client.messages.create(
                    model=settings.MODEL,
                    max_tokens=settings.MAX_TOKENS,
                    system=self._system(uid, text, device),
                    tools=tools.schemas(device, settings.WEB_SEARCH, settings.WEB_SEARCH_MAX_USES),
                    messages=sess.history,
                )
                sess.history.append({"role": "assistant", "content": resp.content})

                uses = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
                if not uses and getattr(resp, "stop_reason", None) == "pause_turn":
                    continue  # the server-side web search needs another turn to finish
                if not uses:
                    out = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
                    trim_history(sess.history)
                    return out or "Done."

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
            out = await self._run_server_tool(uid, tu.name, args)
        else:
            out = await self.hub.call_device(uid, tu.name, args)
        out = str(out)
        if out.startswith("Error"):
            ok = False

        await emit({"type": "tool_done", "id": tu.id, "name": tu.name, "ok": ok})
        return {"type": "tool_result", "tool_use_id": tu.id, "content": out[:6000]}
