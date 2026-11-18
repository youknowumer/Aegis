"""AI providers: one registry, two wire formats.

The agent loop speaks the Anthropic Messages shape (content blocks, tool_use / tool_result). Claude is used
natively. Every other provider (OpenAI, Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI, Ollama, LM Studio, ...)
exposes an "OpenAI-compatible" chat API, so a small adapter translates to that format and back. The agent never
knows the difference.

API keys come from the user's browser (per session, kept in memory only, never stored or logged) or from
server environment variables (see `env_key`).
"""
import asyncio
import json
import os
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import List, Optional
from urllib.parse import urlparse

from . import utilities

TIMEOUT = 90.0


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    kind: str  # "anthropic" | "openai"
    base_url: str
    env_key: str
    models: List[str] = field(default_factory=list)  # suggestions only; any model id can be typed in
    key_hint: str = ""
    key_url: str = ""
    needs_key: bool = True
    custom_url: bool = False  # user supplies the base URL


PROVIDERS = [
    Provider("anthropic", "Claude (Anthropic)", "anthropic", "https://api.anthropic.com", "ANTHROPIC_API_KEY",
             ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-2"], "sk-ant-...", "https://console.anthropic.com/settings/keys"),
    Provider("openai", "OpenAI (ChatGPT)", "openai", "https://api.openai.com/v1", "OPENAI_API_KEY",
             ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"], "sk-...", "https://platform.openai.com/api-keys"),
    Provider("gemini", "Google Gemini", "openai", "https://generativelanguage.googleapis.com/v1beta/openai", "GEMINI_API_KEY",
             ["gemini-2.5-pro", "gemini-2.5-flash"], "AIza...", "https://aistudio.google.com/apikey"),
    Provider("groq", "Groq (fast, free tier)", "openai", "https://api.groq.com/openai/v1", "GROQ_API_KEY",
             ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"], "gsk_...", "https://console.groq.com/keys"),
    Provider("openrouter", "OpenRouter (many models)", "openai", "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY",
             ["anthropic/claude-sonnet-4.5", "openai/gpt-4o-mini", "google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct"], "sk-or-...", "https://openrouter.ai/keys"),
    Provider("mistral", "Mistral", "openai", "https://api.mistral.ai/v1", "MISTRAL_API_KEY",
             ["mistral-large-latest", "mistral-small-latest"], "", "https://console.mistral.ai/api-keys"),
    Provider("deepseek", "DeepSeek", "openai", "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY",
             ["deepseek-chat", "deepseek-reasoner"], "sk-...", "https://platform.deepseek.com/api_keys"),
    Provider("xai", "xAI (Grok)", "openai", "https://api.x.ai/v1", "XAI_API_KEY",
             ["grok-3", "grok-3-mini"], "xai-...", "https://console.x.ai"),
    Provider("custom", "Custom / Local (OpenAI-compatible)", "openai", "", "CUSTOM_AI_API_KEY",
             [], "optional for local servers", "", needs_key=False, custom_url=True),
]
BY_ID = {p.id: p for p in PROVIDERS}


def allow_private_urls() -> bool:
    """Ollama / LM Studio live on localhost. Only allow that when the server owner explicitly opts in."""
    return os.environ.get("AEGIS_ALLOW_LOCAL_PROVIDERS", "0") == "1"


def public_catalog() -> list:
    """What the website may know: names, models and whether the SERVER already holds a key. Never key values."""
    return [
        {"id": p.id, "label": p.label, "kind": p.kind, "models": p.models, "key_hint": p.key_hint, "key_url": p.key_url,
         "needs_key": p.needs_key, "custom_url": p.custom_url, "server_key": bool(os.environ.get(p.env_key))}
        for p in PROVIDERS
    ]


class ConfigError(ValueError):
    """The user's AI settings are unusable. The message is safe to show to them."""


@dataclass
class AIConfig:
    provider: Provider
    api_key: str
    model: str
    base_url: str
    max_tokens: int
    temperature: Optional[float]


def parse_config(raw: dict, default_model: str, default_max_tokens: int) -> AIConfig:
    """Validate what the browser sent. Synchronous and cheap; the base-URL DNS check is in `validate_base_url`."""
    if not isinstance(raw, dict):
        raise ConfigError("Invalid AI settings.")
    p = BY_ID.get(str(raw.get("provider", "")).strip())
    if not p:
        raise ConfigError("Unknown AI provider.")
    key = str(raw.get("api_key", "")).strip()
    if len(key) > 400 or any(c.isspace() for c in key):
        raise ConfigError("That API key doesn't look right (spaces or too long). Paste only the key.")
    if not key:
        key = os.environ.get(p.env_key, "")
    if not key and p.needs_key:
        raise ConfigError(f"No API key for {p.label}. Paste your key, or ask the server owner to set {p.env_key}.")
    model = str(raw.get("model", "")).strip()[:120] or (default_model if p.id == "anthropic" else (p.models[0] if p.models else ""))
    if not model:
        raise ConfigError("Enter a model name.")
    if any(c.isspace() for c in model):
        raise ConfigError("A model name has no spaces.")
    base = p.base_url
    if p.custom_url:
        base = str(raw.get("base_url", "")).strip().rstrip("/")
        u = urlparse(base)
        if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
            raise ConfigError("Enter the full base URL, for example https://my-server.example.com/v1")
    try:
        mt = int(raw.get("max_tokens") or default_max_tokens)
    except (TypeError, ValueError):
        mt = default_max_tokens
    mt = max(64, min(mt, 16000))
    temp = raw.get("temperature")
    try:
        temp = None if temp in (None, "") else max(0.0, min(float(temp), 1.0 if p.kind == "anthropic" else 2.0))
    except (TypeError, ValueError):
        temp = None
    return AIConfig(p, key, model, base, mt, temp)


async def validate_base_url(cfg: AIConfig):
    """SSRF guard for user-supplied URLs: refuse private / loopback / metadata addresses unless the owner opted in."""
    if not cfg.provider.custom_url or allow_private_urls():
        return
    try:
        await asyncio.to_thread(utilities.check_public_url, cfg.base_url)
    except ValueError as e:
        raise ConfigError(
            f"That base URL was refused ({e}). A cloud server cannot reach localhost. "
            "Use a public https address, or run Aegis on your own PC with AEGIS_ALLOW_LOCAL_PROVIDERS=1."
        )


def build_client(cfg: AIConfig):
    if cfg.provider.kind == "anthropic":
        import anthropic

        return anthropic.AsyncAnthropic(api_key=cfg.api_key)
    return OpenAICompatClient(cfg.base_url, cfg.api_key, cfg.temperature)


# ---------------------------------------------------------------------------------------------
# OpenAI-compatible adapter (looks like the Anthropic client to the agent loop)
# ---------------------------------------------------------------------------------------------
def _get(o, k, d=None):
    return o.get(k, d) if isinstance(o, dict) else getattr(o, k, d)


def _tool_schema(t: dict):
    if "input_schema" not in t:  # Anthropic server tools such as web_search have no OpenAI equivalent
        return None
    return {"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t["input_schema"]}}


def to_openai_messages(system: str, messages: list) -> list:
    out = [{"role": "system", "content": system}]
    for m in messages:
        role, content = m["role"], m["content"]
        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue
        if role == "assistant":
            text = "".join(_get(b, "text", "") or "" for b in content if _get(b, "type") == "text")
            calls = [
                {"id": _get(b, "id"), "type": "function", "function": {"name": _get(b, "name"), "arguments": json.dumps(_get(b, "input", {}) or {})}}
                for b in content if _get(b, "type") == "tool_use"
            ]
            msg = {"role": "assistant", "content": text or None}
            if calls:
                msg["tool_calls"] = calls
            out.append(msg)
        else:
            texts = []
            for b in content:
                if _get(b, "type") == "tool_result":
                    c = _get(b, "content", "")
                    out.append({"role": "tool", "tool_call_id": _get(b, "tool_use_id"), "content": c if isinstance(c, str) else json.dumps(c)})
                elif _get(b, "type") == "text":
                    texts.append(_get(b, "text", ""))
            if texts:
                out.append({"role": "user", "content": "\n".join(texts)})
    return out


def _final(text: str, calls: dict, finish: str):
    blocks = []
    if text:
        blocks.append(SimpleNamespace(type="text", text=text))
    for i in sorted(calls):
        c = calls[i]
        try:
            args = json.loads(c["args"] or "{}")
            if not isinstance(args, dict):
                args = {}
        except ValueError:
            args = {}
        blocks.append(SimpleNamespace(type="tool_use", id=c["id"] or f"call_{i}", name=c["name"], input=args))
    has_tools = any(b.type == "tool_use" for b in blocks)
    return SimpleNamespace(content=blocks, stop_reason="tool_use" if has_tools else ("max_tokens" if finish == "length" else "end_turn"))


class ProviderError(RuntimeError):
    pass


def _raise_for(status: int, body: str):
    hint = {401: "the API key was rejected", 403: "the API key has no access to that model", 404: "model or URL not found",
            429: "rate limit or no credit on that account"}.get(status, f"provider returned HTTP {status}")
    detail = ""
    try:
        j = json.loads(body)
        e = j.get("error", j) if isinstance(j, dict) else {}
        detail = (e.get("message") if isinstance(e, dict) else str(e)) or ""
    except ValueError:
        pass
    raise ProviderError(f"{hint}. {detail[:200]}".strip())


class _Stream:
    def __init__(self, owner, kw):
        self.owner, self.kw, self.final = owner, kw, None
        self._resp = None
        self._cm = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def __aiter__(self):
        return self._events()

    async def _events(self):
        import httpx

        body = self.owner._body(self.kw, stream=True)
        text, calls, finish = [], {}, ""
        async with httpx.AsyncClient(timeout=TIMEOUT) as http:
            async with http.stream("POST", self.owner.url, json=body, headers=self.owner.headers) as r:
                if r.status_code >= 400:
                    _raise_for(r.status_code, (await r.aread()).decode("utf-8", "replace"))
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        ch = json.loads(data)["choices"][0]
                    except (ValueError, KeyError, IndexError):
                        continue
                    d = ch.get("delta") or {}
                    if d.get("content"):
                        text.append(d["content"])
                        yield SimpleNamespace(type="text", text=d["content"])
                    for tc in d.get("tool_calls") or []:
                        c = calls.setdefault(tc.get("index", 0), {"id": "", "name": "", "args": ""})
                        c["id"] = tc.get("id") or c["id"]
                        fn = tc.get("function") or {}
                        c["name"] = fn.get("name") or c["name"]
                        c["args"] += fn.get("arguments") or ""
                    finish = ch.get("finish_reason") or finish
        self.final = _final("".join(text), calls, finish)

    async def get_final_message(self):
        return self.final


class _Messages:
    def __init__(self, owner):
        self.owner = owner

    def stream(self, **kw):
        return _Stream(self.owner, kw)

    async def create(self, **kw):
        import httpx

        async with httpx.AsyncClient(timeout=TIMEOUT) as http:
            r = await http.post(self.owner.url, json=self.owner._body(kw, stream=False), headers=self.owner.headers)
        if r.status_code >= 400:
            _raise_for(r.status_code, r.text)
        ch = r.json()["choices"][0]
        msg = ch.get("message") or {}
        calls = {i: {"id": tc.get("id"), "name": tc["function"]["name"], "args": tc["function"].get("arguments", "")} for i, tc in enumerate(msg.get("tool_calls") or [])}
        return _final(msg.get("content") or "", calls, ch.get("finish_reason") or "")


class OpenAICompatClient:
    def __init__(self, base_url: str, api_key: str, temperature: Optional[float] = None):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.headers = {"Content-Type": "application/json"}
        if api_key:
            self.headers["Authorization"] = "Bearer " + api_key
        self.temperature = temperature
        self.messages = _Messages(self)

    def _body(self, kw: dict, stream: bool) -> dict:
        tools = [s for s in (_tool_schema(t) for t in kw.get("tools", [])) if s]
        body = {"model": kw["model"], "messages": to_openai_messages(kw.get("system", ""), kw["messages"]), "max_tokens": kw.get("max_tokens", 2048), "stream": stream}
        if tools:
            body["tools"] = tools
        if self.temperature is not None:
            body["temperature"] = self.temperature
        return body


async def ping(cfg: AIConfig) -> str:
    """One tiny real request so the user learns right now whether key + model + URL work. Returns the model's short reply."""
    client = build_client(cfg)
    kw = dict(model=cfg.model, max_tokens=24, system="Reply with the single word OK.", tools=[], messages=[{"role": "user", "content": "ping"}])
    if cfg.temperature is not None and cfg.provider.kind == "anthropic":
        kw["temperature"] = cfg.temperature
    resp = await asyncio.wait_for(client.messages.create(**kw), 45)
    return "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text").strip()[:80]
