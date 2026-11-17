"""Tool catalogue: single source of truth for the AI.

- where="server": runs on the server (memory, time).
- where="device": executed by the user's desktop app over the websocket.
- risky=True: the user must approve in the UI before it runs.
"""
from dataclasses import dataclass, field
from typing import Dict, List

S = {"type": "string"}
N = {"type": "number"}


@dataclass
class Tool:
    name: str
    description: str
    where: str
    properties: Dict = field(default_factory=dict)
    required: List[str] = field(default_factory=list)
    risky: bool = False

    def schema(self):
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": {"type": "object", "properties": self.properties, "required": self.required},
        }


TOOLS: List[Tool] = [
    # ---- server tools ----
    Tool("remember", "Save a fact about the user to long-term memory.", "server", {"fact": S}, ["fact"]),
    Tool("recall", "Search long-term memory for facts relevant to a query.", "server", {"query": S}, ["query"]),
    Tool("forget", "Delete memories that contain the given text.", "server", {"contains": S}, ["contains"], risky=True),
    Tool("current_time", "Get the current date and time, optionally in a given IANA timezone such as Asia/Karachi or America/New_York.", "server", {"timezone": S}),
    Tool("calculate", "Evaluate a math expression exactly (+ - * / ** % parentheses, sqrt, sin, cos, tan, log, ln, abs, round, pi, e). Use it for any arithmetic instead of guessing.", "server", {"expression": S}, ["expression"]),
    Tool("get_weather", "Get the current weather and a 3-day forecast for a city anywhere in the world.", "server", {"city": S}, ["city"]),
    Tool("fetch_url", "Open a public web page and read its text. Use it to read an article or link the user gives you, or to follow up a search result.", "server", {"url": S}, ["url"]),
    Tool("wikipedia", "Look up a person, place, concept or event on Wikipedia and get the summary. Good for quick, reliable facts.", "server", {"topic": S, "lang": {"type": "string", "description": "2-letter language code, default en"}}, ["topic"]),
    Tool("convert_currency", "Convert money between currencies at the live exchange rate (USD, PKR, EUR, GBP, AED...).", "server", {"amount": N, "from_currency": S, "to_currency": S}, ["amount", "from_currency", "to_currency"]),
    Tool("add_task", "Add an item to the user's to-do list.", "server", {"text": S, "due": {"type": "string", "description": "optional due date or time in plain words"}}, ["text"]),
    Tool("list_tasks", "Show the user's to-do list (open tasks first).", "server"),
    Tool("complete_task", "Mark the to-do item that contains the given text as done.", "server", {"contains": S}, ["contains"]),
    Tool("set_reminder", "Set a reminder that will pop up and be spoken at the right time, even later in the day. Give EITHER in_minutes OR at (the user's local time as 'YYYY-MM-DD HH:MM', or just 'HH:MM' for the next time that clock time occurs).", "server", {"text": S, "in_minutes": N, "at": S}, ["text"]),
    Tool("list_reminders", "Show the user's upcoming reminders.", "server"),
    Tool("cancel_reminder", "Cancel upcoming reminders whose text contains the given words.", "server", {"contains": S}, ["contains"]),
    Tool("save_note", "Save a longer note, list, idea or snippet for the user (use remember for short personal facts instead).", "server", {"title": S, "content": S}, ["title", "content"]),
    Tool("search_notes", "Find the user's saved notes. Leave query empty to list the latest.", "server", {"query": S}),
    Tool("daily_briefing", "Gather what the user needs for their day: date and time, open tasks, upcoming reminders and, if a city is given, the weather. Call this for 'good morning', 'brief me', 'what is my day like'.", "server", {"city": S}),
    # ---- desktop tools ----
    Tool("open_app", "Open a desktop application by name (chrome, notepad, calc, spotify...).", "device", {"name": S}, ["name"]),
    Tool("open_url", "Open a website in the user's default browser.", "device", {"url": S}, ["url"]),
    Tool("browser_search", "Open a web search results page in the user's own browser window.", "device", {"query": S}, ["query"]),
    Tool("system_health", "Report CPU, memory and disk status of the user's PC.", "device"),
    Tool("list_files", "List files in Documents, Desktop or Downloads (or a subfolder).", "device", {"folder": S}, ["folder"]),
    Tool("read_file", "Read a text file from Documents, Desktop or Downloads.", "device", {"path": S}, ["path"]),
    Tool("write_file", "Create or overwrite a text file in an allowed folder.", "device", {"path": S, "content": S}, ["path", "content"], risky=True),
    Tool("move_file", "Move or rename a file inside allowed folders.", "device", {"src": S, "dst": S}, ["src", "dst"], risky=True),
    Tool("organize_folder", "Sort files in a folder into Images/Documents/Videos/Audio/Archives/Other.", "device", {"folder": S}, ["folder"], risky=True),
    Tool("delete_file", "Delete a single file in an allowed folder.", "device", {"path": S}, ["path"], risky=True),
    Tool("open_file", "Open a file from Documents, Desktop or Downloads in its default program.", "device", {"path": S}, ["path"]),
    Tool("find_files", "Search Documents, Desktop and Downloads for files whose name contains the text.", "device", {"query": S}, ["query"]),
    Tool("clipboard_read", "Read the text currently on the user's clipboard.", "device"),
    Tool("clipboard_write", "Put text on the user's clipboard.", "device", {"text": S}, ["text"], risky=True),
    Tool("set_volume", "Set the PC speaker volume (0-100), or mute / unmute / up / down.", "device", {"level": {"type": "string", "description": "a number 0-100, or mute, unmute, up, down"}}, ["level"]),
    Tool("media_control", "Control media playback: play_pause, next, previous, stop.", "device", {"action": S}, ["action"]),
    Tool("notify", "Show a desktop notification on the user's PC.", "device", {"title": S, "message": S}, ["message"]),
    Tool("running_apps", "List the user's open application windows.", "device"),
    Tool("close_app", "Close an application by process name (e.g. notepad, chrome).", "device", {"name": S}, ["name"], risky=True),
    Tool("lock_screen", "Lock the user's PC screen.", "device", {}, [], risky=True),
    Tool("take_screenshot", "Capture the screen and save it to the Pictures folder.", "device"),
    Tool("type_text", "Type text into whatever window is focused.", "device", {"text": S}, ["text"], risky=True),
    Tool("press_keys", "Press a shortcut such as ctrl+c, alt+tab, ctrl+shift+t.", "device", {"keys": S}, ["keys"], risky=True),
    Tool("run_shell", "Run a shell command. Last resort.", "device", {"command": S}, ["command"], risky=True),
]

BY_NAME = {t.name: t for t in TOOLS}


def schemas(device_connected: bool, web_search: bool = False, max_uses: int = 4):
    out = [t.schema() for t in TOOLS if device_connected or t.where == "server"]
    if web_search:
        # Anthropic runs this one itself; the server never sees a tool_use for it.
        out.append({"type": "web_search_20250305", "name": "web_search", "max_uses": max_uses})
    return out
