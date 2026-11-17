"""Tool catalogue: single source of truth for the AI.

- where="server": runs on the server (memory, time).
- where="device": executed by the user's desktop app over the websocket.
- risky=True: the user must approve in the UI before it runs.
"""
from dataclasses import dataclass, field
from typing import Dict, List

S = {"type": "string"}


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
    Tool("current_time", "Get the current UTC date and time.", "server"),
    Tool("calculate", "Evaluate a math expression exactly (+ - * / ** % parentheses, sqrt, sin, cos, tan, log, ln, abs, round, pi, e). Use it for any arithmetic instead of guessing.", "server", {"expression": S}, ["expression"]),
    Tool("get_weather", "Get the current weather and a 3-day forecast for a city anywhere in the world.", "server", {"city": S}, ["city"]),
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
