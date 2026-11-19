(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ config
  // config.js sets API_BASE. Empty = same origin (local dev, desktop app, server-hosted UI).
  const CFG = window.AEGIS_CONFIG || {};
  const API_KEY_OVERRIDE = "aegis_api_base"; // set from the "Connect AI" dialog, wins over config.js
  let apiOverride = "";
  try { apiOverride = localStorage.getItem(API_KEY_OVERRIDE) || ""; } catch {}
  // Local login mode: no server needed. Accounts live in THIS browser on THIS computer only
  // (localStorage, passwords PBKDF2-hashed). Used while no real server is known, or force it with LOCAL_LOGIN: true.
  // Chat/AI still needs the real server. If this page is itself served BY the Aegis server (Render / Docker / localhost)
  // detectServer() notices that and links up automatically, so config.js needs no edit in that case.
  let sameOrigin = false;
  let API = "", API_MISSING = false, LOCAL = false, WS_URL = "";
  function applyApi() {
    API = sameOrigin ? "" : String(apiOverride || CFG.API_BASE || "").replace(/\/+$/, "");
    API_MISSING = !sameOrigin && /YOUR-AEGIS-SERVER/i.test(API);
    LOCAL = !apiOverride && !sameOrigin && (API_MISSING || CFG.LOCAL_LOGIN === true);
    WS_URL = (API && !API_MISSING ? API.replace(/^http/i, "ws") : (location.protocol === "https:" ? "wss://" : "ws://") + location.host) + "/ws";
  }
  applyApi();
  const LOCAL_USERS_KEY = "aegis_local_users";
  window.AEGIS_RUNTIME = { get api() { return API; }, get local() { return LOCAL; } }; // hud.js reads this
  const TOKEN_KEY = "aegis_token";
  const desktop = window.aegisDesktop || null; // injected by the Electron preload script
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ state
  let token = safeGet(TOKEN_KEY);
  let ws = null;
  let wsOpen = false;
  let retry = 0;
  let pingTimer = null;
  let authed = false;
  let busy = false;
  let speaking = false;
  let authMode = "login";
  let thinkingEl = null;
  let confirmTimer = null;
  const confirmQueue = [];
  const acts = new Map(); // tool call id -> { chip, li }
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
  const directHist = []; // chat turns for direct (serverless) mode
  let streamEl = null, streamText = "", streamRaf = 0; // the Aegis message that is currently being typed out

  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
  function safeSessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }

  // ------------------------------------------------------------------ small UI helpers
  let toastTimer = null;
  function toast(text, ms = 4200) {
    const t = $("toast");
    t.textContent = text;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }

  function setPill(el, text, kind) {
    el.textContent = text;
    el.className = "pill " + kind;
  }

  const orbs = {};
  function mountOrbs() {
    if (!window.AegisOrb) return;
    if ($("orb")) orbs.main = AegisOrb.mount($("orb"));
    if ($("auth-orb")) orbs.auth = AegisOrb.mount($("auth-orb"));
  }

  const STATE_TEXT = { offline: "Offline", idle: "Standing by", listening: "Listening", thinking: "Working", speaking: "Speaking" };
  let listeningNow = false;
  function refreshState() {
    let st = "idle";
    if (!wsOpen && !(LOCAL && authed)) st = "offline";
    else if (listeningNow) st = "listening";
    else if (busy) st = "thinking";
    else if (speaking) st = "speaking";
    const stage = $("stage");
    if (stage.dataset.state !== st) {
      stage.dataset.state = st;
      $("orb-label").textContent = STATE_TEXT[st];
      if (orbs.main) orbs.main.setState(st);
    }
  }

  // ------------------------------------------------------------------ API
  class NetError extends Error {
    constructor() {
      super("Can't reach the Aegis server. If it runs on free hosting it may be waking up. Wait about 30 seconds and try again.");
    }
  }

  const b2h = (buf) => Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
  const h2b = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));
  async function localHash(pw, saltHex) {
    if (!(window.crypto && crypto.subtle)) throw new Error("This browser blocks secure login here. Open the site over https:// or localhost.");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return b2h(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: h2b(saltHex), iterations: 150000, hash: "SHA-256" }, key, 256));
  }
  function localUsers() { try { return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || "{}"); } catch { return {}; } }
  async function localApi(path, opts) {
    const body = opts.body ? JSON.parse(opts.body) : {};
    const email = String(body.email || "").trim().toLowerCase();
    if (path === "/api/register" || path === "/api/login") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address");
      const users = localUsers();
      if (path === "/api/register") {
        if (String(body.password).length < 8) throw new Error("Password must be 8 to 200 characters");
        if (users[email]) throw new Error("An account with this email already exists");
        const salt = b2h(crypto.getRandomValues(new Uint8Array(16)));
        users[email] = { salt, hash: await localHash(body.password, salt) };
        localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
      } else {
        const u = users[email];
        if (!u || (await localHash(body.password, u.salt)) !== u.hash) throw new Error("Invalid email or password");
      }
      return { token: "local:" + email };
    }
    if (path === "/api/me") {
      const email = String(token || "").replace(/^local:/, "");
      if (!localUsers()[email]) { logout(); throw new Error("Please sign in again."); }
      return { email, plan: "local", used: 0, limit: 0, device: false, app_name: "Aegis", web_search: false };
    }
    if (path === "/api/memory") return [];
    return {};
  }

  async function api(path, opts = {}) {
    if (LOCAL) return localApi(path, opts);
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 60000);
    let res;
    try {
      res = await fetch(API + path, { ...opts, headers, signal: ctl.signal });
    } catch {
      throw new NetError();
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 401 && token) logout();
      const detail = data && typeof data.detail === "string" ? data.detail : null;
      throw new Error(detail || (res.status === 422 ? "Please check your email and password." : "Request failed (" + res.status + ")."));
    }
    return data;
  }

  async function detectServer() {
    if (apiOverride || !API_MISSING || CFG.LOCAL_LOGIN === true || location.protocol === "file:") return;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch("/healthz", { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      const j = r.ok ? await r.json() : null;
      if (j && j.ok === true) { sameOrigin = true; applyApi(); }
    } catch {}
  }

  // ---- AI link chip (top bar): says in one glance whether the AI is reachable and what is missing
  let aiState = "local";
  function setAi(kind, text, tip) {
    aiState = kind;
    const b = $("connect-btn");
    b.dataset.k = kind;
    b.textContent = text;
    b.title = tip || "";
    const bn = $("ai-banner");
    const txt = { local: ["Instant voice commands are live. Link your Aegis server to unlock AI chat.", "Connect AI"],
      nokey: ["No AI key yet. Add your own key (Claude, OpenAI, Gemini...) or set ANTHROPIC_API_KEY on the server.", "Add AI key"],
      down: ["Can't reach the server. Free hosts sleep: wait about 30 seconds, then retry.", "Retry"] }[kind];
    bn.classList.toggle("hidden", !txt);
    if (txt) { $("ai-banner-text").textContent = txt[0]; $("ai-banner-btn").textContent = txt[1]; }
  }
  function refreshConnectBtn() {
    if (LOCAL && aiCfg && directReady()) setAi("ok", "AI: " + aiShort(aiCfg) + " (direct)", "Chatting straight from your browser with your own key. Click the gear > AI provider to change.");
    else if (LOCAL) setAi("local", "AI: not connected", "Instant commands work. Add your AI key in Settings > AI provider, or link a server.");
    else setAi("checking", "AI: checking...", "");
  }
  async function checkAI() {
    if (LOCAL) return refreshConnectBtn();
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(API + "/healthz", { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json();
      if (!j.ok) throw 0;
      if (j.ai === false && !aiCfg) { setAi("nokey", "AI key missing", "No AI key yet. Click to add your own, or set ANTHROPIC_API_KEY on the server."); return "nokey"; }
      setAi("ok", aiLabel ? "AI: " + aiLabel : "AI online", "Connected to " + (API || location.origin));
      return "ok";
    } catch {
      setAi("down", "Server offline", "Can't reach " + (API || location.origin) + ". Free hosts sleep; wait 30 s and retry.");
      return "down";
    }
  }

  // Free hosts put idle servers to sleep. Poke it as soon as the page opens so login is fast.
  async function warmServer() {
    const pill = $("server-state");
    if (LOCAL) {
      setPill(pill, "Local login (this computer)", "warn");
      const w = $("config-warning");
      w.classList.remove("hidden");
      w.textContent = "Local mode: your account stays in this browser. Instant voice commands work; for AI chat press \"AI: not connected\" (top right) and link your Aegis server.";
      return;
    }
    setPill(pill, "Connecting...", "off");
    const wake = setTimeout(() => setPill(pill, "Waking the server...", "warn"), 3500);
    for (let i = 0; i < 6; i++) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 20000);
        const r = await fetch(API + "/healthz", { cache: "no-store", signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) {
          clearTimeout(wake);
          let ai = true; try { ai = (await r.json()).ai !== false; } catch {}
          setPill(pill, ai ? "Server online" : "Server online, AI key missing", ai ? "on" : "warn");
          return;
        }
      } catch {}
      await sleep(2500);
    }
    clearTimeout(wake);
    setPill(pill, "Server unreachable", "bad");
  }

  // ------------------------------------------------------------------ auth UI
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      authMode = t.dataset.mode;
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      $("auth-submit").textContent = authMode === "login" ? "Sign in" : "Create account";
      $("password").autocomplete = authMode === "login" ? "current-password" : "new-password";
      $("auth-error").textContent = "";
    })
  );
  if (new URLSearchParams(location.search).get("mode") === "register") {
    document.querySelector('.tab[data-mode="register"]').click();
  }
  $("pw-toggle").addEventListener("click", () => {
    const show = $("password").type === "password";
    $("password").type = show ? "text" : "password";
    $("pw-toggle").textContent = show ? "Hide" : "Show";
    $("pw-toggle").setAttribute("aria-label", show ? "Hide password" : "Show password");
  });

  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("auth-submit");
    btn.disabled = true;
    $("auth-error").textContent = "";
    try {
      const data = await api(authMode === "login" ? "/api/login" : "/api/register", {
        method: "POST",
        body: JSON.stringify({ email: $("email").value, password: $("password").value }),
      });
      token = data.token;
      safeSet(TOKEN_KEY, token);
      $("password").value = "";
      start();
    } catch (err) {
      $("auth-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  function logout() {
    token = null;
    authed = false;
    safeSet(TOKEN_KEY, null);
    if (desktop) desktop.setToken(null);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    clearInterval(pingTimer);
    wsOpen = false;
    stopSpeaking();
    convo = false;
    manual = false;
    followUp = false;
    syncToggles();
    stopRec();
    setBusy(false);
    clearChat();
    $("activity").textContent = "";
    acts.clear();
    $("activity-count").textContent = "0";
    $("activity-empty").classList.remove("hidden");
    show("auth");
    refreshState();
    warmServer();
  }
  $("logout-btn").addEventListener("click", logout);

  function show(which) {
    $("auth").classList.toggle("hidden", which !== "auth");
    $("app").classList.toggle("hidden", which !== "app");
    closeDrawers();
  }

  // ------------------------------------------------------------------ rendering (never uses innerHTML)
  const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|https?:\/\/[^\s<>"')\]]+)/g;
  function inline(parent, text) {
    text.split(INLINE).forEach((part) => {
      if (!part) return;
      if (/^\*\*[^*\n]+\*\*$/.test(part)) {
        const b = document.createElement("strong"); b.textContent = part.slice(2, -2); parent.appendChild(b);
      } else if (/^`[^`\n]+`$/.test(part)) {
        const c = document.createElement("code"); c.textContent = part.slice(1, -1); parent.appendChild(c);
      } else if (/^https?:\/\//.test(part)) {
        const m = part.match(/^(.*?)([.,;:!?]*)$/);
        const a = document.createElement("a");
        a.href = m[1]; a.textContent = m[1]; a.target = "_blank"; a.rel = "noopener noreferrer";
        parent.appendChild(a);
        if (m[2]) parent.appendChild(document.createTextNode(m[2]));
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  // Mini markdown: paragraphs, bullet / numbered lists, fenced code, **bold**, `code`, links.
  function rich(el, text) {
    el.textContent = "";
    let list = null, code = null, para = null;
    for (const line of String(text).replace(/\r/g, "").split("\n")) {
      if (code) {
        if (/^\s*```/.test(line)) code = null;
        else code.textContent += (code.textContent ? "\n" : "") + line;
        continue;
      }
      if (/^\s*```/.test(line)) {
        list = null; para = null;
        const pre = document.createElement("pre");
        code = document.createElement("code");
        pre.appendChild(code); el.appendChild(pre);
        continue;
      }
      const li = line.match(/^\s*(?:[-*\u2022]|\d+[.)])\s+(.*)$/);
      if (li) {
        if (!list) {
          list = document.createElement(/^\s*\d/.test(line) ? "ol" : "ul");
          el.appendChild(list); para = null;
        }
        const item = document.createElement("li");
        inline(item, li[1]); list.appendChild(item);
        continue;
      }
      list = null;
      if (!line.trim()) { para = null; continue; }
      if (!para) { para = document.createElement("p"); el.appendChild(para); }
      else para.appendChild(document.createElement("br"));
      inline(para, line);
    }
  }

  function markChat() { $("stage").dataset.chat = "1"; $("welcome").classList.add("hidden"); }

  let lastAi = "";
  function decorate(el, text) {
    const bar = document.createElement("div");
    bar.className = "msg-actions";
    const copy = document.createElement("button");
    copy.type = "button"; copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; } catch { copy.textContent = "Can't copy"; }
      setTimeout(() => (copy.textContent = "Copy"), 1500);
    });
    const say = document.createElement("button");
    say.type = "button"; say.textContent = "Read aloud";
    say.addEventListener("click", () => speak(text, true));
    bar.append(copy, say);
    el.appendChild(bar);
  }
  function addMsg(role, text) {
    if (role === "ai") lastAi = text;
    markChat();
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.dir = "auto"; // right-to-left for Urdu
    rich(el, text);
    if (role === "ai") decorate(el, text);
    $("messages").appendChild(el);
    if (thinkingEl) $("messages").appendChild(thinkingEl);
    scrollDown();
    return el;
  }

  // While text is still arriving, hide half-typed markdown (an unclosed ** or code fence) so it never flashes raw.
  function partialSafe(t) {
    if ((t.match(/```/g) || []).length % 2) t += "\n```";
    const outside = t.split(/```/).filter((_, i) => i % 2 === 0).join("");
    if ((outside.match(/\*\*/g) || []).length % 2) { const i = t.lastIndexOf("**"); t = t.slice(0, i) + t.slice(i + 2); }
    return t;
  }
  // ---- streaming: the answer types out word by word
  function onDelta(text) {
    if (!streamEl) {
      markChat();
      streamEl = document.createElement("div");
      streamEl.className = "msg ai streaming";
      streamEl.dir = "auto";
      streamText = "";
      $("messages").appendChild(streamEl);
    }
    if (thinkingEl) thinkingEl.style.display = "none";
    streamText += text;
    if (!streamRaf) streamRaf = requestAnimationFrame(() => { streamRaf = 0; if (streamEl) { rich(streamEl, partialSafe(streamText)); scrollDown(); } });
  }
  // text = the final text to show (or undefined to keep what streamed in)
  function endStream(text) {
    if (streamRaf) { cancelAnimationFrame(streamRaf); streamRaf = 0; }
    if (thinkingEl) thinkingEl.style.display = "";
    const el = streamEl;
    streamEl = null;
    if (!el) return null;
    const final = text !== undefined ? text : streamText;
    if (!final.trim()) { el.remove(); return null; }
    el.classList.remove("streaming");
    rich(el, final);
    decorate(el, final);
    lastAi = final;
    if (thinkingEl) $("messages").appendChild(thinkingEl);
    scrollDown();
    return el;
  }

  function clearChat() {
    directHist.length = 0;
    streamEl = null;
    $("messages").querySelectorAll(".msg,.tool,.thinking").forEach((n) => n.remove());
    thinkingEl = null;
    $("welcome").classList.remove("hidden");
    $("stage").dataset.chat = "0";
  }

  function scrollDown() { const m = $("messages"); m.scrollTop = m.scrollHeight; }

  function setThinking(on) {
    if (on && !thinkingEl) {
      thinkingEl = document.createElement("div");
      thinkingEl.className = "thinking";
      for (let i = 0; i < 3; i++) thinkingEl.appendChild(document.createElement("i"));
      $("messages").appendChild(thinkingEl);
      scrollDown();
    } else if (!on && thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  function setBusy(b, skipVoiceSync) {
    busy = b;
    $("send-btn").classList.toggle("hidden", b);
    $("stop-btn").classList.toggle("hidden", !b);
    setThinking(b);
    refreshState();
    if (!skipVoiceSync) syncVoice();
  }

  // ------------------------------------------------------------------ tool activity
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return String(u || "a page"); } };
  const LABELS = {
    remember: () => "Saving to memory",
    recall: (a) => "Searching memory" + (a.query ? ": " + a.query : ""),
    forget: () => "Forgetting memories",
    current_time: () => "Checking the time",
    fetch_url: (a) => "Reading " + host(a.url),
    wikipedia: (a) => "Wikipedia: " + (a.topic || ""),
    convert_currency: (a) => "Converting " + (a.from_currency || "") + " to " + (a.to_currency || ""),
    add_task: (a) => "Adding task: " + (a.text || ""),
    list_tasks: () => "Reading your tasks",
    complete_task: () => "Completing a task",
    set_reminder: (a) => "Setting reminder: " + (a.text || ""),
    list_reminders: () => "Checking reminders",
    cancel_reminder: () => "Cancelling a reminder",
    save_note: (a) => "Saving note: " + (a.title || ""),
    search_notes: () => "Searching notes",
    daily_briefing: () => "Preparing your briefing",
    calculate: (a) => "Calculating " + (a.expression || ""),
    get_weather: (a) => "Weather in " + (a.city || ""),
    open_file: (a) => "Opening " + (a.path || "a file"),
    find_files: (a) => "Finding files: " + (a.query || ""),
    clipboard_read: () => "Reading the clipboard",
    clipboard_write: () => "Copying to the clipboard",
    set_volume: (a) => "Volume: " + (a.level || ""),
    media_control: (a) => "Media: " + (a.action || ""),
    notify: () => "Showing a notification",
    running_apps: () => "Listing open apps",
    close_app: (a) => "Closing " + (a.name || "an app"),
    lock_screen: () => "Locking the screen",
    open_app: (a) => "Opening " + (a.name || "an app"),
    open_url: (a) => "Opening " + host(a.url),
    browser_search: (a) => "Searching: " + (a.query || ""),
    system_health: () => "Checking system health",
    list_files: (a) => "Listing " + (a.folder || "files"),
    read_file: (a) => "Reading " + (a.path || "a file"),
    write_file: (a) => "Writing " + (a.path || "a file"),
    move_file: () => "Moving a file",
    organize_folder: (a) => "Organizing " + (a.folder || "a folder"),
    delete_file: (a) => "Deleting " + (a.path || "a file"),
    take_screenshot: () => "Taking a screenshot",
    type_text: () => "Typing text",
    press_keys: (a) => "Pressing " + (a.keys || "keys"),
    run_shell: () => "Running a command",
    compose_email: (a) => "Drafting email to " + (a.to || "someone"),
    open_folder: (a) => "Opening folder " + (a.path || ""),
    make_folder: (a) => "Creating folder " + (a.path || ""),
    copy_file: () => "Copying a file",
    append_file: (a) => "Adding to " + (a.path || "a file"),
    file_info: (a) => "Checking " + (a.path || "a file"),
    search_in_files: (a) => "Searching inside files: " + (a.query || ""),
    read_document: (a) => "Reading " + (a.path || "a document"),
    download_file: (a) => "Downloading " + host(a.url),
    send_email: (a) => "Sending email to " + (a.to || "someone"),
    check_inbox: () => "Checking your inbox",
    save_contact: (a) => "Saving contact " + (a.name || ""),
    find_contact: (a) => "Looking up contact " + (a.query || ""),
    save_routine: (a) => "Saving routine " + (a.name || ""),
    run_routine: (a) => "Running routine " + (a.name || ""),
    list_routines: () => "Listing routines",
    delete_routine: (a) => "Deleting routine " + (a.name || ""),
  };
  const labelFor = (name, args) => (LABELS[name] ? LABELS[name](args || {}) : name);

  function addTool(m) {
    markChat();
    const text = labelFor(m.name, m.args);

    const chip = document.createElement("div");
    chip.className = "tool running";
    chip.textContent = text;
    $("messages").appendChild(chip);
    if (thinkingEl) $("messages").appendChild(thinkingEl);

    const li = document.createElement("li");
    li.className = "running";
    const dot = document.createElement("span"); dot.className = "dot";
    const txt = document.createElement("span"); txt.className = "txt"; txt.dir = "auto"; txt.textContent = text;
    li.append(dot, txt);
    if (m.risky) {
      const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "asks first";
      li.appendChild(tag);
    }
    const ul = $("activity");
    ul.prepend(li);
    while (ul.children.length > 40) ul.lastChild.remove();
    $("activity-empty").classList.add("hidden");
    $("activity-count").textContent = ul.children.length;

    if (m.id) acts.set(m.id, { chip, li });
    scrollDown();
  }

  const TASK_TOOLS = new Set(["add_task", "complete_task"]);
  const REMIND_TOOLS = new Set(["set_reminder", "cancel_reminder"]);
  function doneTool(m) {
    if (TASK_TOOLS.has(m.name)) loadTasks();
    if (REMIND_TOOLS.has(m.name)) loadReminders();
    const a = acts.get(m.id);
    if (!a) return;
    const cls = m.ok ? "ok" : "fail";
    a.chip.className = "tool " + cls;
    a.li.className = cls;
    acts.delete(m.id);
  }

  // ------------------------------------------------------------------ status panels
  function setDevice(on) {
    setPill($("device-pill"), on ? "Connected" : "Not connected", on ? "on" : "off");
    $("device-hint").textContent = on
      ? "Aegis can open apps, manage files and more on your PC."
      : desktop
        ? "Connecting to your account..."
        : "Install the desktop app to let Aegis control your PC.";
  }

  function setUsage(used, limit, plan) {
    $("usage-text").textContent = used + " / " + limit;
    $("usage-bar").style.width = Math.min(100, (used / Math.max(limit, 1)) * 100) + "%";
    if (plan) $("plan-name").textContent = plan;
  }

  function setLink(kind) {
    const map = { online: ["Online", "on"], connecting: ["Connecting...", "warn"], reconnecting: ["Reconnecting...", "warn"], offline: ["Offline", "off"] };
    setPill($("link-pill"), map[kind][0], map[kind][1]);
  }

  async function loadMemory() {
    try {
      const facts = await api("/api/memory");
      const ul = $("memory-list");
      ul.textContent = "";
      facts.forEach((f) => {
        const li = document.createElement("li");
        const s = document.createElement("span"); s.dir = "auto"; s.textContent = f.text;
        const b = document.createElement("button");
        b.type = "button"; b.textContent = "\u00d7"; b.title = "Forget this"; b.setAttribute("aria-label", "Forget this");
        b.addEventListener("click", async () => { try { await api("/api/memory/" + f.id, { method: "DELETE" }); loadMemory(); } catch {} });
        li.append(s, b);
        ul.appendChild(li);
      });
      $("memory-count").textContent = facts.length;
      $("memory-empty").classList.toggle("hidden", facts.length > 0);
    } catch {}
  }

  // ---- tasks and reminders
  function emptyToggle(listId, emptyId, countId, n) {
    $(emptyId).classList.toggle("hidden", n > 0);
    $(countId).textContent = n;
  }
  async function loadTasks() {
    if (LOCAL || !token) return;
    try {
      const rows = await api("/api/tasks");
      if (!Array.isArray(rows)) return;
      const ul = $("task-list");
      ul.textContent = "";
      rows.forEach((t) => {
        const li = document.createElement("li");
        if (t.done) li.className = "done";
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "check"; cb.checked = !!t.done; cb.setAttribute("aria-label", "Done: " + t.text);
        cb.addEventListener("change", async () => { try { await api("/api/tasks/" + t.id, { method: "POST", body: JSON.stringify({ done: cb.checked }) }); } catch {} loadTasks(); });
        const s = document.createElement("span"); s.dir = "auto"; s.textContent = t.text;
        li.append(cb, s);
        if (t.due) { const w = document.createElement("span"); w.className = "when"; w.textContent = t.due; li.appendChild(w); }
        const x = document.createElement("button");
        x.type = "button"; x.className = "x"; x.textContent = "\u00d7"; x.setAttribute("aria-label", "Delete task");
        x.addEventListener("click", async () => { try { await api("/api/tasks/" + t.id, { method: "DELETE" }); } catch {} loadTasks(); });
        li.appendChild(x);
        ul.appendChild(li);
      });
      emptyToggle("task-list", "task-empty", "task-count", rows.filter((t) => !t.done).length);
    } catch {}
  }
  $("task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("task-input").value.trim();
    if (!v) return;
    if (LOCAL) return toast("Tasks need the AI server.");
    $("task-input").value = "";
    try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ text: v }) }); } catch (err) { toast(err.message); }
    loadTasks();
  });

  function whenLabel(ts) {
    const d = new Date(ts * 1000), now = new Date();
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return hm;
    return d.toLocaleDateString([], { weekday: "short" }) + " " + hm;
  }
  async function loadReminders() {
    if (LOCAL || !token) return;
    try {
      const rows = await api("/api/reminders");
      if (!Array.isArray(rows)) return;
      const ul = $("remind-list");
      ul.textContent = "";
      rows.forEach((r) => {
        const li = document.createElement("li");
        const w = document.createElement("span"); w.className = "when"; w.textContent = whenLabel(r.due);
        const s = document.createElement("span"); s.dir = "auto"; s.textContent = r.text;
        const x = document.createElement("button");
        x.type = "button"; x.className = "x"; x.textContent = "\u00d7"; x.setAttribute("aria-label", "Cancel reminder");
        x.addEventListener("click", async () => { try { await api("/api/reminders/" + r.id, { method: "DELETE" }); } catch {} loadReminders(); });
        li.append(w, s, x);
        ul.appendChild(li);
      });
      emptyToggle("remind-list", "remind-empty", "remind-count", rows.length);
    } catch {}
  }
  function onReminder(m) {
    const text = "Reminder: " + m.text;
    alertUser(text);
    loadReminders();
  }

  async function checkDownload() {
    if (desktop) return; // already inside the desktop app
    try {
      const r = await fetch("downloads/Aegis-Setup.exe", { method: "HEAD" });
      if (r.ok) $("download-link").classList.remove("hidden");
    } catch {}
  }

  // ------------------------------------------------------------------ websocket
  function connect() {
    if (!token || ws) return;
    if (LOCAL) { setPill($("link-pill"), "Local mode", "warn"); return; }
    const sock = new WebSocket(WS_URL);
    ws = sock;
    setLink(retry ? "reconnecting" : "connecting");
    sock.onopen = () => {
      retry = 0;
      sock.send(JSON.stringify({ type: "auth", token, role: "chat", tz: TZ }));
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ type: "ping" }), 25000); // keeps proxies from closing an idle socket
    };
    sock.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
    sock.onclose = (ev) => {
      if (ws === sock) ws = null;
      clearInterval(pingTimer);
      wsOpen = false;
      setBusy(false);
      refreshState();
      if (ev.code === 4401) return logout();
      if (ev.code === 4403) { setLink("offline"); return toast("This website is not allowed to use that server. Check AEGIS_ALLOWED_ORIGINS on the server.", 9000); }
      if (!token) return;
      setLink("reconnecting");
      setTimeout(connect, Math.min(15000, 800 * 2 ** retry++));
    };
    sock.onerror = () => {};
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function onMessage(m) {
    switch (m.type) {
      case "hello":
        wsOpen = true;
        setLink("online");
        pushAiCfg();
        checkAI();
        $("user-email").textContent = m.email;
        setUsage(m.used, m.limit, m.plan);
        setDevice(m.device);
        $("messages").querySelectorAll(".msg,.tool").forEach((n) => n.remove());
        (m.history || []).forEach((h) => addMsg(h.role === "user" ? "user" : "ai", h.text));
        streamEl = null;
        loadMemory(); loadTasks(); loadReminders();
        refreshState();
        syncVoice();
        break;
      case "status": setDevice(m.device); break;
      case "delta": onDelta(m.text || ""); break;
      case "delta_end": endStream(); break;
      case "stopped": endStream(); setBusy(false); toast("Stopped."); break;
      case "reminder": onReminder(m); break;
      case "tool": addTool(m); break;
      case "tool_done": doneTool(m); break;
      case "confirm": confirmQueue.push(m); showConfirm(); break;
      case "reply":
        setBusy(false, true); // speak() re-syncs the microphone once it knows whether Aegis will talk
        if (!endStream(m.text)) addMsg("ai", m.text);
        setUsage(m.used, m.limit);
        loadMemory(); loadTasks(); loadReminders();
        speak(m.text);
        break;
      case "error": endStream(); setBusy(false); addMsg("err", m.text); break;
      case "cleared": clearChat(); break;
      case "ai_set": onAiSet(m); break;
    }
  }

  // ------------------------------------------------------------------ approval dialog
  const RISK = {
    write_file: ["Create or overwrite a file", "Writes to a file inside Documents, Desktop or Downloads."],
    move_file: ["Move or rename a file", "Moves a file inside Documents, Desktop or Downloads."],
    organize_folder: ["Organize a folder", "Sorts the files in that folder into sub-folders."],
    delete_file: ["Delete a file", "This permanently deletes the file."],
    type_text: ["Type on your keyboard", "Aegis will type into whichever window is focused right now."],
    press_keys: ["Press keyboard keys", "Aegis will press these keys in the focused window."],
    run_shell: ["Run a command on your PC", "Only allow this if you understand the command below."],
    forget: ["Forget memories", "Removes the saved memories that match."],
    send_email: ["Send this email", "Aegis will send this email from your mail account. Check the recipient, subject and text below."],
    make_folder: ["Create a folder", "Creates a new folder inside Documents, Desktop or Downloads."],
    copy_file: ["Copy a file", "Copies a file inside your allowed folders. Existing files are never overwritten."],
    append_file: ["Add text to a file", "Adds the text below to the end of that file."],
    download_file: ["Download a file", "Downloads this file into your Downloads folder. Programs and scripts are always refused."],
    delete_routine: ["Delete a routine", "Removes this saved routine."],
  };
  const CONFIRM_SECONDS = 60;

  function showConfirm() {
    const dlg = $("confirm");
    if (dlg.open || !confirmQueue.length) return;
    const m = confirmQueue[0];
    const [title, why] = RISK[m.tool] || ["Allow this action?", "Aegis wants to run this tool."];
    $("confirm-title").textContent = title;
    $("confirm-why").textContent = why;
    $("confirm-tool").textContent = m.tool;
    const a = m.args || {};
    $("confirm-args").textContent = m.tool === "send_email"
      ? "To: " + (a.to || "") + (a.cc ? "\nCc: " + a.cc : "") + "\nSubject: " + (a.subject || "") + "\n\n" + (a.body || "") // read it like an email, not like JSON
      : JSON.stringify(m.args, null, 2);
    const bar = $("confirm-timer");
    bar.style.transition = "none";
    bar.style.transform = "scaleX(1)";
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    void bar.offsetWidth; // restart the countdown animation
    bar.style.transition = "transform " + CONFIRM_SECONDS + "s linear";
    bar.style.transform = "scaleX(0)";
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => answerConfirm(false), CONFIRM_SECONDS * 1000); // the server also gives up after 60s
    stopSpeaking();
    syncVoice();
  }
  function answerConfirm(ok) {
    clearTimeout(confirmTimer);
    const m = confirmQueue.shift();
    if (m) send({ type: "confirm_response", id: m.id, ok });
    const dlg = $("confirm");
    if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open");
    showConfirm();
    syncVoice();
  }
  $("allow-btn").addEventListener("click", () => answerConfirm(true));
  $("deny-btn").addEventListener("click", () => answerConfirm(false));
  $("confirm").addEventListener("cancel", (e) => { e.preventDefault(); answerConfirm(false); }); // Esc = deny

  // ------------------------------------------------------------------ composer
  // ---- instant commands (commands.js): answered locally, no server, no quota
  const THEME_RGB = {
    cyan: [47, 227, 255], blue: [90, 150, 255], green: [52, 230, 140], red: [255, 84, 96],
    amber: [255, 176, 46], purple: [170, 130, 255], pink: [255, 105, 200],
  };
  function applyTheme(name) {
    const rgb = THEME_RGB[name] || THEME_RGB.cyan;
    const r = document.documentElement.style;
    r.setProperty("--ac", rgb.join(", "));
    r.setProperty("--accent", "rgb(" + rgb.join(",") + ")");
    r.setProperty("--amber", name === "amber" ? "#ff5a36" : "#ffb02e");
    if (window.AegisOrb) AegisOrb.setTheme(rgb);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = "#03070d";
    safeSet("aegis_theme", name);
  }
  function setFocus(on) {
    const v = on === undefined ? !document.body.classList.contains("focus") : !!on;
    document.body.classList.toggle("focus", v);
    return v;
  }
  function alertUser(text) {
    toast(text, 9000);
    addMsg("ai", text);
    speak(text, true);
    beep(); setTimeout(beep, 260); setTimeout(beep, 520);
    try { if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("Aegis", { body: text }); } catch {}
    try { if (document.hidden) { const old = document.title; document.title = "\u23f0 " + text; setTimeout(() => (document.title = old), 15000); } } catch {}
  }
  const cmdCtx = {
    get online() { return wsOpen; },
    get hud() { return window.AegisHUD || null; },
    say(text, o) {
      o = o || {};
      if (o.silent) { toast(text); return; }
      addMsg("ai", text);
      speak(o.speak || text);
    },
    alert: alertUser,
    open(url) {
      let w = null;
      try { w = window.open(url, "_blank"); } catch {}
      if (w) { try { w.opener = null; } catch {} return; }
      // Voice commands have no click behind them, so browsers often block the new tab: give a one-tap link instead.
      addMsg("ai", "Your browser blocked the new tab. Tap to open: " + url);
      toast("Allow pop-ups for this site and voice can open pages by itself.", 7000);
    },
    setLang(code) { $("lang").value = code; $("lang").dispatchEvent(new Event("change")); },
    setVoiceMode(on) { $("voice-mode").checked = on; $("voice-mode").dispatchEvent(new Event("change")); },
    setSpeak(on) { $("speak").checked = on; safeSet("aegis_speak", on ? "1" : "0"); if (!on) stopSpeaking(); },
    stopSpeaking,
    clearChat() { if (ws && wsOpen) send({ type: "reset" }); clearChat(); },
    lastReply() { return lastAi; },
    repeatLast() { speak(lastAi, true); },
    setTheme: applyTheme,
    toggleFocus: setFocus,
  };
  const SILENT_CMDS = { stop: 1, mute: 1, unmute: 0 };

  function runCommand(cmd, text) {
    stopRec();
    setInterim("");
    manual = false;
    followUp = false;
    if (!SILENT_CMDS[cmd.name]) { stopSpeaking(); addMsg("user", text); }
    cmd.run(cmdCtx).catch(() => addMsg("err", "That command failed. Try again.")).finally(() => setTimeout(syncVoice, 300)); // keeps Voice mode alive after silent commands
  }

  function submitText(text) {
    text = String(text || "").trim();
    if (!text) return;
    const cmd = window.AegisCommands && AegisCommands.match(text, { online: wsOpen });
    if (cmd) return runCommand(cmd, text);
    if (busy) return;
    if (LOCAL && directReady()) return directChat(text);
    if (!ws || ws.readyState !== 1 || !wsOpen) { if (LOCAL) { addMsg("err", "That one needs the AI server, which isn't linked yet. Tap \"AI: not connected\" at the top to link it. Meanwhile I can still do instant things: say \"help\"."); $("connect-btn").classList.add("nudge"); setTimeout(() => $("connect-btn").classList.remove("nudge"), 2400); } else addMsg("err", aiState === "nokey" ? "No AI key yet. Open Settings > AI provider and add your key." : "Not connected to the server yet. Reconnecting..."); return; }
    stopSpeaking();
    stopRec();
    setInterim("");
    manual = false;
    followUp = false;
    addMsg("user", text);
    send({ type: "chat", text, tz: TZ });
    setBusy(true);
  }
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("input").value;
    $("input").value = "";
    autosize();
    submitText(t);
  });
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("composer").requestSubmit(); }
  });
  function autosize() { const t = $("input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }
  $("input").addEventListener("input", autosize);
  document.querySelectorAll(".chip[data-q], .qcard[data-q]").forEach((c) =>
    c.addEventListener("click", () => { closeDrawers(); submitText(c.dataset.q); })
  );
  $("clear-btn").addEventListener("click", () => { if (confirm("Clear this conversation?")) send({ type: "reset" }); });

  // drawers (mobile / tablet)
  function closeDrawers() {
    $("left").classList.remove("open");
    $("right").classList.remove("open");
    $("scrim").classList.add("hidden");
  }
  function openDrawer(side) {
    closeDrawers();
    $(side).classList.add("open");
    $("scrim").classList.remove("hidden");
  }
  $("menu-btn").addEventListener("click", () => openDrawer("left"));
  $("activity-btn").addEventListener("click", () => openDrawer("right"));
  $("scrim").addEventListener("click", closeDrawers);

  $("stop-btn").addEventListener("click", () => { send({ type: "stop" }); if (directCtl) directCtl.abort(); stopSpeaking(); });

  // keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      if (authed) { e.preventDefault(); openPalette(); }
    } else if (e.key === "/" && !typing && authed) {
      e.preventDefault(); $("input").focus();
    } else if (e.key === "Escape" && authed && !document.querySelector("dialog[open]")) {
      if (busy) { send({ type: "stop" }); if (directCtl) directCtl.abort(); }
      stopSpeaking(); convo = false; manual = false; followUp = false; syncToggles(); syncVoice();
    }
  });

  // ------------------------------------------------------------------ command palette
  const ACTIONS = [
    { g: "Aegis", ic: "\u25d0", t: "Toggle focus mode", run: () => setFocus() },
    { g: "Aegis", ic: "\u25cf", t: "Turn voice mode on", run: () => cmdCtx.setVoiceMode(true) },
    { g: "Aegis", ic: "\u25cb", t: "Turn voice mode off", run: () => cmdCtx.setVoiceMode(false) },
    { g: "Aegis", ic: "\u2699", t: "Open settings", run: () => openSettings() },
    { g: "Aegis", ic: "\u21bb", t: "Clear this conversation", run: () => { if (confirm("Clear this conversation?")) send({ type: "reset" }); } },
    { g: "Aegis", ic: "\u21aa", t: "Sign out", run: () => logout() },
  ];
  const ASKS = [
    ["Good morning, brief me on my day", "Brief me on my day", "\u2600"],
    ["Remind me in 20 minutes to stretch", "Set a reminder", "\u23f0"],
    ["Add a task to call the bank tomorrow", "Add a task", "\u2611"],
    ["What's the latest news today?", "Latest news", "\u25a4"],
    ["Convert 100 USD to PKR", "Convert currency", "$"],
    ["Who is Ada Lovelace?", "Look something up", "?"],
    ["What do you remember about me?", "What do you remember?", "\u2606"],
    ["open YouTube", "Open YouTube", "\u2197"],
    ["google latest AI news", "Search Google", "\u2197"],
    ["weather in Lahore", "Weather", "\u2601"],
    ["set a timer for 5 minutes", "Timer: 5 minutes", "\u23f1"],
    ["calculate 15% of 2400", "Calculate", "="],
    ["convert 10 km to miles", "Convert units", "\u21c4"],
    ["take a note call the bank tomorrow", "Take a note", "\u270e"],
    ["show my notes", "Show my notes", "\u270e"],
    ["switch to Urdu", "Switch to Urdu", "\u0627"],
    ["Check my system health", "PC: system health", "\u25a3"],
    ["Take a screenshot", "PC: take a screenshot", "\u25a3"],
    ["List the files in my Downloads folder", "PC: list Downloads", "\u25a3"],
    ["Organize my Downloads folder", "PC: organize Downloads", "\u25a3"],
    ["help", "Everything I can do", "\u2139"],
  ].map(([q, t, ic]) => ({ g: "Ask Aegis", ic, t, sub: q, run: () => submitText(q) }));
  Object.keys(THEME_RGB).forEach((n) => ACTIONS.push({ g: "Theme", ic: "\u25cf", t: "Accent colour: " + n, run: () => applyTheme(n) }));

  let palItems = [], palSel = 0;
  function renderPalette() {
    const q = $("pal-input").value.trim().toLowerCase();
    const all = ACTIONS.concat(ASKS);
    palItems = q ? all.filter((i) => (i.t + " " + (i.sub || "")).toLowerCase().includes(q)) : all.filter((i) => i.g !== "Theme");
    if (q) palItems.unshift({ g: "Ask Aegis", ic: "\u279c", t: "Ask: " + $("pal-input").value.trim(), run: () => submitText($("pal-input").value.trim()) });
    if (palSel >= palItems.length) palSel = Math.max(0, palItems.length - 1);
    const ul = $("pal-list");
    ul.textContent = "";
    let group = "";
    palItems.forEach((it, i) => {
      if (it.g !== group) { group = it.g; const h = document.createElement("li"); h.className = "pal-group"; h.setAttribute("role", "presentation"); h.textContent = group; ul.appendChild(h); }
      const li = document.createElement("li");
      li.className = "pal-item"; li.setAttribute("role", "option"); li.setAttribute("aria-selected", i === palSel ? "true" : "false");
      const ic = document.createElement("span"); ic.className = "ic"; ic.textContent = it.ic;
      const t = document.createElement("span"); t.textContent = it.t;
      li.append(ic, t);
      if (it.sub && it.sub !== it.t) { const s = document.createElement("small"); s.textContent = it.sub.length > 34 ? it.sub.slice(0, 33) + "\u2026" : it.sub; li.appendChild(s); }
      li.addEventListener("click", () => runPalette(i));
      li.addEventListener("mousemove", () => { if (palSel !== i) { palSel = i; markPal(); } });
      ul.appendChild(li);
    });
    if (!palItems.length) { const e = document.createElement("li"); e.className = "pal-group"; e.textContent = "No match. Press Enter to ask Aegis."; ul.appendChild(e); }
  }
  function markPal() {
    document.querySelectorAll("#pal-list .pal-item").forEach((li, i) => {
      const on = i === palSel; li.setAttribute("aria-selected", on ? "true" : "false");
      if (on) li.scrollIntoView({ block: "nearest" });
    });
  }
  function runPalette(i) {
    const it = palItems[i];
    const typed = $("pal-input").value.trim();
    $("palette").close();
    if (it) it.run(); else if (typed) submitText(typed);
  }
  function openPalette() {
    const d = $("palette");
    if (d.open || !authed) return;
    $("pal-input").value = ""; palSel = 0; renderPalette();
    d.showModal();
    $("pal-input").focus();
  }
  $("pal-input").addEventListener("input", () => { palSel = 0; renderPalette(); });
  $("pal-input").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); markPal(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(0, palSel - 1); markPal(); }
    else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); runPalette(palSel); }
  });
  $("palette").addEventListener("click", (e) => { if (e.target === $("palette")) $("palette").close(); });
  $("palette-btn").addEventListener("click", openPalette);

  // ------------------------------------------------------------------ settings + focus
  function buildSwatches() {
    const box = $("swatches");
    box.textContent = "";
    const cur = safeGet("aegis_theme") || "cyan";
    Object.keys(THEME_RGB).forEach((n) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "swatch"; b.title = n; b.setAttribute("role", "radio"); b.setAttribute("aria-label", n);
      b.setAttribute("aria-checked", n === cur ? "true" : "false");
      b.style.background = "rgb(" + THEME_RGB[n].join(",") + ")";
      b.addEventListener("click", () => { applyTheme(n); buildSwatches(); });
      box.appendChild(b);
    });
  }
  function refreshNotifBtn() {
    const nb = $("notif-btn");
    if (!("Notification" in window)) { nb.disabled = true; nb.textContent = "Not supported in this browser"; }
    else if (Notification.permission === "granted") { nb.disabled = true; nb.textContent = "Notifications are on"; }
    else if (Notification.permission === "denied") { nb.disabled = true; nb.textContent = "Blocked: allow them in the address bar"; }
    else { nb.disabled = false; nb.textContent = "Allow notifications"; }
  }
  function openSettings() {
    renderAiStatus();
    buildSwatches();
    refreshNotifBtn();
    if (!$("settings").open) $("settings").showModal();
  }
  $("settings-btn").addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", () => $("settings").close());
  $("settings").addEventListener("click", (e) => { if (e.target === $("settings")) $("settings").close(); });
  $("notif-btn").addEventListener("click", async () => {
    try { const r = await Notification.requestPermission(); toast(r === "granted" ? "Notifications are on." : "Notifications stay off."); } catch {}
    refreshNotifBtn();
  });
  $("focus-btn").addEventListener("click", () => setFocus());

  // ------------------------------------------------------------------ voice
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasTTS = "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  let rec = null, recKind = null, recGotFinal = false, recErr = "";
  let manual = false;      // push-to-talk
  let followUp = false;    // heard "Hey Aegis" with no command yet: listen once for it
  let convo = false;       // Voice mode: keep a back-and-forth conversation going
  let wake = safeGet("aegis_wake") === "1";
  let noSpeechStreak = 0;
  let gestured = false;    // browsers only allow the mic after the person has interacted with the page
  let speakGen = 0;
  let lastSpoken = "";

  // "Hey Aegis, open Chrome" -> "open Chrome". Returns null when there is no wake phrase.
  const WAKE_RE = /\b(?:(?:hey|hi|hello|ok|okay)\s+(?:aegis|aegus|ejis|edgis|eejis|ages|edges|jarvis)|aegis|jarvis)\b[\s,.:;!?-]*/i;
  function extractWake(text) {
    const m = String(text || "").match(WAKE_RE);
    return m ? String(text).slice(m.index + m[0].length).trim() : null;
  }

  function setInterim(t) { $("interim").textContent = t || ""; }

  function beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = new AC(), o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; g.gain.value = 0.05;
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.12);
      o.onended = () => ac.close();
    } catch {}
  }

  function setListening(on) {
    listeningNow = on;
    const live = on && recKind === "once";
    $("interim").dataset.live = live ? "1" : "0";
    if (live && !$("interim").textContent) setInterim("Listening...");
    $("mic-btn").classList.toggle("live", on && recKind === "once");
    refreshState();
  }

  function startRec(kind) {
    if (!SR || rec) return;
    const r = new SR();
    rec = r; recKind = kind; recGotFinal = false; recErr = "";
    if (kind === "once") followUp = false;
    r.lang = $("lang").value;
    r.interimResults = true;
    r.continuous = kind === "wake";
    r.maxAlternatives = 1;

    r.onstart = () => { if (rec === r) setListening(kind === "once"); };
    r.onresult = (e) => {
      if (rec !== r) return;
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      if (kind === "wake") {
        const rest = extractWake(final);
        if (rest === null) return;
        recGotFinal = true;
        stopRec();
        beep();
        if (rest.length > 2) submitText(rest);
        else { followUp = true; setTimeout(syncVoice, 250); }
        return;
      }
      setInterim(interim || final);
      if (final) { recGotFinal = true; noSpeechStreak = 0; stopRec(); submitText(final); }
    };
    r.onerror = (e) => {
      if (rec !== r) return;
      recErr = e.error || "";
      if (recErr === "not-allowed" || recErr === "service-not-allowed") {
        const hint = !window.isSecureContext ? " This page is not secure: voice needs https:// or http://localhost." :
          location.protocol === "file:" ? " Voice does not work on a file: page. Open http://localhost:8000 instead." : "";
        voiceFail("Microphone access is blocked. Allow it in your browser's address bar." + hint);
      } else if (recErr === "audio-capture") {
        voiceFail("No microphone found. Plug one in, or choose it in your browser's site settings.");
      } else if (recErr === "network") {
        voiceFail("The browser's speech service can't be reached. Chrome sends your voice to Google to transcribe it, so voice needs internet.");
      } else if (recErr === "language-not-supported") {
        $("lang").value = "en-US"; safeSet("aegis_lang", "en-US");
        voiceFail("This browser can't recognise that language, so I switched to English. Turn voice back on to retry.");
      }
    };
    r.onend = () => {
      if (rec !== r) return;
      rec = null; recKind = null;
      setListening(false);
      setInterim("");
      const wasManual = manual;
      manual = false;
      if (kind === "once" && !recGotFinal && convo && !wasManual && (recErr === "no-speech" || recErr === "")) {
        if (++noSpeechStreak >= 3) { convo = false; syncToggles(); toast("Voice mode paused: I didn't hear anything."); }
      }
      setTimeout(syncVoice, 350);
    };
    try { r.start(); } catch { rec = null; recKind = null; }
  }

  // Turn every listening mode off and tell the person why (so it never silently loops).
  function voiceFail(msg) {
    wake = false; convo = false; manual = false; followUp = false;
    safeSet("aegis_wake", "0");
    stopRec();
    syncToggles();
    toast(msg, 9000);
    addMsg("err", msg);
  }

  function stopRec() {
    if (!rec) return;
    const r = rec;
    rec = null; recKind = null;
    r.onresult = r.onend = r.onerror = r.onstart = null;
    try { r.abort(); } catch {}
    setListening(false);
    setInterim("");
  }

  // One place decides what the microphone should be doing right now.
  function syncVoice() {
    if (!SR || !authed || busy || speaking || $("confirm").open) return stopRec(); // instant commands need no server, so voice works before the AI link is up
    const want = manual || followUp || convo ? "once" : wake && gestured ? "wake" : null;
    if (!want) return stopRec();
    if (rec && recKind === want) return;
    if (rec) { stopRec(); return void setTimeout(syncVoice, 300); }
    startRec(want);
  }

  // ---- speaking
  function plainSpeech(text) {
    return String(text)
      .replace(/```[\s\S]*?```/g, " code block. ")
      .replace(/https?:\/\/\S+/g, " link ")
      .replace(/[*`#_>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function chunkSpeech(text) {
    // Chrome silently stops long utterances, so speak in short pieces.
    const out = [];
    let cur = "";
    for (const s of text.match(/[^.!?\u06d4\u0964\n]+[.!?\u06d4\u0964]?/g) || []) {
      if ((cur + s).length > 180 && cur) { out.push(cur.trim()); cur = ""; }
      cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // Speak in the language the TEXT is written in, so an English answer isn't read with an Urdu voice and vice versa.
  function langFor(text) {
    if (/[\u0600-\u06ff]/.test(text)) return "ur-PK";
    if (/[\u0900-\u097f]/.test(text)) return "hi-IN";
    const sel = $("lang").value;
    return sel.startsWith("en") ? sel : "en-US";
  }
  const VOICE_RANK = /neural|natural|online|premium|enhanced|google|samantha|daniel|aria|jenny|guy|libby|ryan/i;
  function voicesFor(lang) {
    if (!hasTTS) return [];
    const base = lang.split("-")[0];
    return speechSynthesis.getVoices().filter((v) => v.lang === lang || v.lang.startsWith(base)).sort((x, y) => VOICE_RANK.test(y.name) - VOICE_RANK.test(x.name));
  }
  function pickVoice(lang) {
    const list = voicesFor(lang);
    const saved = safeGet("aegis_voice");
    return list.find((v) => v.name === saved) || list[0] || null;
  }
  function fillVoices() {
    const sel = $("voice-pick");
    if (!hasTTS || !sel) return;
    const list = voicesFor($("lang").value);
    const saved = safeGet("aegis_voice");
    sel.textContent = "";
    if (!list.length) { sel.append(new Option("System default", "")); return; }
    list.forEach((v) => sel.append(new Option(v.name.replace(/^(Microsoft|Google)\s+/, "").slice(0, 28), v.name)));
    sel.value = list.some((v) => v.name === saved) ? saved : list[0].name;
  }
  function stopSpeaking() {
    speakGen++;
    if (hasTTS) speechSynthesis.cancel();
    if (speaking) { speaking = false; refreshState(); }
  }
  function speak(text, force) {
    const want = hasTTS && (force || $("speak").checked || convo);
    const parts = want ? chunkSpeech(plainSpeech(text)) : [];
    if (!parts.length) return syncVoice();
    speechSynthesis.cancel();
    const gen = ++speakGen;
    let left = parts.length;
    speaking = true;
    refreshState();
    syncVoice(); // makes sure the mic is off while Aegis talks
    const lang = langFor(text);
    const voice = pickVoice(lang);
    const rate = parseFloat($("rate").value) || 1.02;
    parts.forEach((p) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = rate;
      const fin = () => {
        if (gen !== speakGen) return;
        if (--left === 0) { speaking = false; refreshState(); syncVoice(); }
      };
      u.onend = fin; u.onerror = fin;
      speechSynthesis.speak(u);
    });
  }

  // ---- toggles
  function syncToggles() {
    $("voice-mode").checked = convo;
    $("wake").checked = wake;
  }
  if (!SR) {
    ["mic-btn", "voice-mode", "wake"].forEach((id) => { $(id).disabled = true; });
    $("mic-btn").title = "Voice input needs Chrome, Edge or Safari";
    $("voice-mode").title = $("wake").title = "Voice input needs Chrome, Edge or Safari";
    wake = false;
  }
  if (!hasTTS) { $("speak").disabled = true; }
  $("lang").value = safeGet("aegis_lang") || "en-US";
  $("lang").addEventListener("change", () => { safeSet("aegis_lang", $("lang").value); fillVoices(); stopRec(); syncVoice(); });
  $("rate").value = safeGet("aegis_rate") || "1.02";
  $("rate").addEventListener("input", () => safeSet("aegis_rate", $("rate").value));
  $("voice-pick").addEventListener("change", () => {
    safeSet("aegis_voice", $("voice-pick").value);
    if (hasTTS) { stopSpeaking(); lastSpoken = ""; speak("Hello, this is how I sound.", true); }
  });
  if (hasTTS) { fillVoices(); speechSynthesis.addEventListener("voiceschanged", fillVoices); }
  $("speak").checked = safeGet("aegis_speak") === "1";
  $("speak").addEventListener("change", () => { safeSet("aegis_speak", $("speak").checked ? "1" : "0"); if (!$("speak").checked) stopSpeaking(); });

  $("voice-mode").addEventListener("change", () => {
    gestured = true;
    convo = $("voice-mode").checked;
    noSpeechStreak = 0;
    if (convo) { $("speak").checked = true; safeSet("aegis_speak", "1"); }
    syncVoice();
  });
  $("wake").addEventListener("change", () => {
    gestured = true;
    wake = $("wake").checked;
    safeSet("aegis_wake", wake ? "1" : "0");
    if (wake) toast('Listening for "Hey Aegis". Keep this tab open.');
    syncVoice();
  });
  $("mic-btn").addEventListener("click", () => {
    gestured = true;
    if (!SR || busy) return;
    if (rec && recKind === "once") { manual = false; convo = false; syncToggles(); stopRec(); return; }
    stopSpeaking();
    manual = true;
    syncVoice();
  });
  ["pointerdown", "keydown"].forEach((ev) =>
    document.addEventListener(ev, () => { if (!gestured) { gestured = true; syncVoice(); } }, { passive: true })
  );

  // ------------------------------------------------------------------ clock + greeting
  function tick() {
    const d = new Date();
    $("clock").textContent = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) + "  " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function greet() {
    const h = new Date().getHours();
    $("greeting").textContent = (h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening") + ". How can I help?";
  }

  // ------------------------------------------------------------------ boot
  async function bootSequence() {
    if (reduceMotion || safeSessionGet("aegis_booted")) return;
    const box = $("boot"), pre = $("boot-text");
    const lines = ["AEGIS CORE ........ online", "MEMORY ............ linked", "VOICE ............. ready",
      desktop ? "PC LINK ........... establishing" : "PC LINK ........... standby", "", "Welcome back."];
    let skip = false;
    box.addEventListener("click", () => { skip = true; }, { once: true });
    pre.textContent = "";
    box.classList.remove("hidden", "leaving");
    for (const l of lines) {
      if (skip) break;
      pre.textContent += l + "\n";
      await sleep(l ? 190 : 80);
    }
    if (!skip) await sleep(350);
    box.classList.add("leaving");
    await sleep(skip ? 0 : 380);
    box.classList.add("hidden");
    try { sessionStorage.setItem("aegis_booted", "1"); } catch {}
  }

  // ------------------------------------------------------------------ start
  async function start() {
    syncToggles();
    await detectServer();
    refreshConnectBtn();
    window.dispatchEvent(new Event("aegis:server"));
    if (!token) { show("auth"); warmServer(); return; }
    try {
      await api("/api/me");
    } catch (err) {
      if (err instanceof NetError) {
        // server asleep or unreachable: keep the saved login, let the person retry
        show("auth");
        $("auth-error").textContent = err.message;
        warmServer();
        return;
      }
      show("auth");
      if (token) warmServer(); // a rejected token already triggered logout(), which warms the server itself
      return;
    }
    authed = true;
    greet();
    show("app");
    bootSequence();
    if (desktop) desktop.setToken(token); // lets the desktop app open its PC-control connection
    checkDownload();
    refreshState();
    connect();
    checkAI();
  }


  // ------------------------------------------------------------------ AI provider (Claude, OpenAI, Gemini, ...)

  // The browser keeps the user's provider choice + key and hands them to the server over the websocket for this session.
  // The server holds them in memory only. Without a saved choice the server's own default key is used.
  const AI_CFG_KEY = "aegis_ai_cfg", AI_SECRET_KEY = "aegis_ai_key";
  const FALLBACK_PROVIDERS = [
    { id: "anthropic", label: "Claude (Anthropic)", models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"], key_hint: "sk-ant-...", key_url: "https://console.anthropic.com/settings/keys", needs_key: true },
    { id: "openai", label: "OpenAI (ChatGPT)", models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"], key_hint: "sk-...", key_url: "https://platform.openai.com/api-keys", needs_key: true },
    { id: "gemini", label: "Google Gemini", models: ["gemini-2.5-pro", "gemini-2.5-flash"], key_hint: "AIza...", key_url: "https://aistudio.google.com/apikey", needs_key: true },
    { id: "groq", label: "Groq (fast, free tier)", models: ["llama-3.3-70b-versatile"], key_hint: "gsk_...", key_url: "https://console.groq.com/keys", needs_key: true },
    { id: "openrouter", label: "OpenRouter (many models)", models: ["openai/gpt-4o-mini"], key_hint: "sk-or-...", key_url: "https://openrouter.ai/keys", needs_key: true },
    { id: "mistral", label: "Mistral", models: ["mistral-large-latest"], key_hint: "", key_url: "https://console.mistral.ai/api-keys", needs_key: true },
    { id: "deepseek", label: "DeepSeek", models: ["deepseek-chat"], key_hint: "sk-...", key_url: "https://platform.deepseek.com/api_keys", needs_key: true },
    { id: "xai", label: "Grok (xAI)", models: ["grok-4", "grok-3", "grok-3-mini"], key_hint: "xai-...", key_url: "https://console.x.ai", needs_key: true },
    { id: "custom", label: "Custom / Local (OpenAI-compatible)", models: [], key_hint: "optional for local servers", key_url: "", needs_key: false, custom_url: true },
  ];
  let providers = FALLBACK_PROVIDERS, aiCfg = null, aiLabel = "", providersLoaded = false;
  function loadAiCfg() {
    let c = null;
    try { c = JSON.parse(safeGet(AI_CFG_KEY) || "null"); } catch {}
    if (!c || typeof c.provider !== "string") return null;
    let k = safeGet(AI_SECRET_KEY);
    if (k == null) { try { k = sessionStorage.getItem(AI_SECRET_KEY); } catch {} }
    c.api_key = k || "";
    return c;
  }
  aiCfg = loadAiCfg();
  const provById = (id) => providers.find((p) => p.id === id) || providers[0];
  function aiShort(c) { const p = provById(c.provider); return (p.label.split(" (")[0]) + (c.model ? " · " + c.model : ""); }
  function renderAiStatus() {
    $("ai-status").textContent = aiCfg ? "Using: " + aiShort(aiCfg) + (aiCfg.api_key ? "" : " (server's key)") : "Using the server's default AI (Claude).";
  }
  function aiMsg(text, kind) { const m = $("ai-msg"); m.textContent = text || ""; m.className = kind === "ok" ? "ok-msg" : kind === "warn" ? "warn-msg" : "error"; }
  function pushAiCfg() {
    if (!wsOpen) return;
    if (!aiCfg) { aiLabel = ""; return; } // server default; nothing to send on a fresh connection
    send({ type: "set_ai", config: aiCfgPayload(aiCfg) });
  }
  function aiCfgPayload(c) { return { provider: c.provider, api_key: c.api_key || "", model: c.model || "", base_url: c.base_url || "", max_tokens: c.max_tokens || 0, temperature: c.temperature === "" || c.temperature == null ? null : Number(c.temperature) }; }
  function onAiSet(m) {
    if (m.ok) { aiLabel = m.provider === "server" ? "" : (m.label || "").split(" (")[0] + (m.model ? " · " + m.model : ""); if (aiState !== "local") checkAI(); }
    else { aiLabel = ""; toast("AI settings: " + (m.error || "couldn't apply them."), 7000); if ($("aicfg").open) aiMsg(m.error || "Couldn't apply those settings."); }
    if (m.ok && $("aicfg").open) aiMsg("Saved. Now chatting with " + (m.label || "the server default") + ".", "ok");
  }
  async function loadProviders() {
    if (providersLoaded || LOCAL) return;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(API + "/api/providers", { signal: ctl.signal }); clearTimeout(t);
      const j = await r.json();
      if (Array.isArray(j.providers) && j.providers.length) { providers = j.providers; providersLoaded = true; }
    } catch {}
  }
  function fillProviderUi(keepModel) {
    const p = provById($("ai-provider").value);
    $("ai-key").placeholder = p.server_key ? "optional: the server already has a key" : (p.needs_key ? (p.key_hint || "paste your API key") : "optional for local servers");
    const kl = $("ai-keylink");
    kl.classList.toggle("hidden", !p.key_url); if (p.key_url) kl.href = p.key_url;
    $("ai-models").textContent = "";
    (p.models || []).forEach((m) => { const o = document.createElement("option"); o.value = m; $("ai-models").appendChild(o); });
    if (!keepModel) $("ai-model").value = (p.models && p.models[0]) || "";
    $("ai-model").placeholder = p.custom_url ? "e.g. llama3.1 or gpt-4o-mini" : "model name";
    $("ai-base-row").classList.toggle("hidden", !p.custom_url);
  }
  async function openAiCfg() {
    await loadProviders();
    const sel = $("ai-provider"); sel.textContent = "";
    providers.forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.label + (p.server_key ? " ✓ server key" : ""); sel.appendChild(o); });
    const c = aiCfg || { provider: "anthropic", model: "" };
    sel.value = provById(c.provider).id;
    fillProviderUi(false);
    if (c.model) $("ai-model").value = c.model;
    $("ai-key").value = c.api_key || ""; $("ai-key").type = "password"; $("ai-keyshow").textContent = "Show";
    $("ai-base").value = c.base_url || ""; $("ai-maxtok").value = c.max_tokens || ""; $("ai-temp").value = c.temperature == null ? "" : c.temperature;
    $("ai-remember").checked = safeGet(AI_SECRET_KEY) != null || !aiCfg;
    aiMsg(LOCAL ? "No server linked: chat will go straight from your browser to the provider (plain chat, no PC tools)." : "", LOCAL ? "warn" : "");
    if (!$("aicfg").open) $("aicfg").showModal();
  }
  function readAiForm() {
    const num = (id) => { const v = $(id).value.trim(); return v === "" ? "" : Number(v); };
    return { provider: $("ai-provider").value, api_key: $("ai-key").value.trim(), model: $("ai-model").value.trim(), base_url: $("ai-base").value.trim().replace(/\/+$/, ""), max_tokens: num("ai-maxtok") || 0, temperature: num("ai-temp") };
  }
  function checkAiForm(c) {
    const p = provById(c.provider);
    if (/\s/.test(c.api_key)) return "The key has spaces in it. Paste only the key.";
    if (p.needs_key && !c.api_key && !p.server_key) return "Paste your " + p.label.split(" (")[0] + " API key (or choose another provider).";
    if (!c.model) return "Enter a model name.";
    if (p.custom_url && !/^https?:\/\/[^\s/]+/i.test(c.base_url)) return "Enter the full base URL, starting with https://";
    return "";
  }
  $("aicfg-open").addEventListener("click", () => { $("settings").close(); openAiCfg(); });
  $("ai-close").addEventListener("click", () => $("aicfg").close());
  $("ai-provider").addEventListener("change", () => { fillProviderUi(false); aiMsg(""); });
  $("ai-keyshow").addEventListener("click", () => { const k = $("ai-key"); const show = k.type === "password"; k.type = show ? "text" : "password"; $("ai-keyshow").textContent = show ? "Hide" : "Show"; });
  $("ai-test").addEventListener("click", async () => {
    const c = readAiForm(), bad = checkAiForm(c);
    if (bad) return aiMsg(bad);
    aiMsg("Testing with a tiny real request...", "warn");
    if (LOCAL) { try { const r = await directTest(c); aiMsg("Works! " + provById(c.provider).label.split(" (")[0] + " \u00b7 " + c.model + " answered" + (r ? ": \u201c" + r + "\u201d" : "."), "ok"); } catch (e) { aiMsg(e.message); } return; }
    try {
      const r = await api("/api/ai/test", { method: "POST", body: JSON.stringify(aiCfgPayload(c)), timeout: 70000 });
      aiMsg(r.ok ? "Works! " + r.provider + " · " + r.model + " answered" + (r.reply ? ": “" + r.reply + "”" : ".") : r.error, r.ok ? "ok" : "");
    } catch (e) { aiMsg(e instanceof NetError ? "Can't reach the Aegis server. Check it is online (top bar)." : e.message); }
  });
  $("ai-save").addEventListener("click", () => {
    const c = readAiForm(), bad = checkAiForm(c);
    if (bad) return aiMsg(bad);
    const remember = $("ai-remember").checked;
    aiCfg = c;
    safeSet(AI_CFG_KEY, JSON.stringify({ provider: c.provider, model: c.model, base_url: c.base_url, max_tokens: c.max_tokens, temperature: c.temperature }));
    safeSet(AI_SECRET_KEY, remember && c.api_key ? c.api_key : null);
    try { remember ? sessionStorage.removeItem(AI_SECRET_KEY) : (c.api_key ? sessionStorage.setItem(AI_SECRET_KEY, c.api_key) : sessionStorage.removeItem(AI_SECRET_KEY)); } catch {}
    renderAiStatus();
    if (wsOpen) { aiMsg("Applying...", "warn"); pushAiCfg(); }
    else { aiMsg(LOCAL ? "Saved. Chat now works straight from this browser with your key." : "Saved. It will be applied when the connection is up.", "ok"); if (LOCAL) refreshConnectBtn(); }
  });
  $("ai-clear").addEventListener("click", () => {
    aiCfg = null; aiLabel = "";
    safeSet(AI_CFG_KEY, null); safeSet(AI_SECRET_KEY, null);
    try { sessionStorage.removeItem(AI_SECRET_KEY); } catch {}
    renderAiStatus();
    if (LOCAL) refreshConnectBtn();
    if (wsOpen) send({ type: "clear_ai" });
    aiMsg("Back to the server's default AI.", "ok");
  });
  renderAiStatus();


  // ------------------------------------------------------------------ direct mode (GitHub Pages / no server)
  // When no Aegis server is linked, chat can still work: the browser talks to the AI provider directly with the key
  // saved in AI provider settings. Plain chat only (no memory/PC tools: those need the server).
  const DIRECT_BASE = { openai: "https://api.openai.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta/openai", groq: "https://api.groq.com/openai/v1", openrouter: "https://openrouter.ai/api/v1", mistral: "https://api.mistral.ai/v1", deepseek: "https://api.deepseek.com/v1", xai: "https://api.x.ai/v1" };
  let directCtl = null;
  const directReady = () => LOCAL && aiCfg && (aiCfg.api_key || (aiCfg.provider === "custom"));
  function directSystem() {
    return "You are Aegis, a calm, sharp, warm personal AI assistant (JARVIS-like). Answer any question directly. Match the user's language and script exactly (English, Urdu, Hindi, or Roman Urdu). Keep replies short and plain (1-3 sentences) unless asked to explain in depth; no markdown tables. It is now " + new Date().toLocaleString() + " (" + (TZ || "local time") + "). You have no tools in this mode, so say so if asked to control a PC, set reminders or browse live.";
  }
  async function* sse(res) {
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line.startsWith("data:")) yield line.slice(5).trim(); }
    }
  }
  async function directStream(c, messages, onText, signal, maxTokens) {
    const anth = c.provider === "anthropic";
    const base = c.provider === "custom" ? (c.base_url || "").replace(/\/+$/, "") : DIRECT_BASE[c.provider];
    const url = anth ? "https://api.anthropic.com/v1/messages" : base + "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (anth) { headers["x-api-key"] = c.api_key; headers["anthropic-version"] = "2023-06-01"; headers["anthropic-dangerous-direct-browser-access"] = "true"; }
    else if (c.api_key) headers.Authorization = "Bearer " + c.api_key;
    const mt = maxTokens || c.max_tokens || 1024;
    const temp = c.temperature === "" || c.temperature == null ? undefined : Number(c.temperature);
    const body = anth ? { model: c.model, max_tokens: mt, system: directSystem(), messages, stream: true, temperature: temp }
      : { model: c.model, max_tokens: mt, messages: [{ role: "system", content: directSystem() }, ...messages], stream: true, temperature: temp };
    let res;
    try { res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal }); }
    catch (e) { if (e.name === "AbortError") throw e; throw new Error("The browser couldn't reach " + (anth ? "Anthropic" : new URL(url).hostname) + ". Check your internet. Some providers block direct browser calls: if so, use a server (see SETUP.md)."); }
    if (!res.ok) {
      let msg = ""; try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || j.message || ""; } catch {}
      const hint = { 401: "The API key was rejected.", 403: "That key has no access to this model.", 404: "Model or URL not found.", 429: "Rate limit reached or no credit on that account." }[res.status] || "The provider returned HTTP " + res.status + ".";
      throw new Error(hint + (msg ? " (" + String(msg).slice(0, 160) + ")" : ""));
    }
    let full = "";
    for await (const d of sse(res)) {
      if (d === "[DONE]") break;
      let j; try { j = JSON.parse(d); } catch { continue; }
      const t = anth ? (j.type === "content_block_delta" && j.delta && j.delta.text) : (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content);
      if (t) { full += t; onText(t); }
    }
    return full;
  }
  async function directChat(text) {
    directHist.push({ role: "user", content: text });
    while (directHist.length > 20) directHist.shift();
    stopSpeaking(); stopRec(); setInterim(""); manual = false; followUp = false;
    addMsg("user", text);
    setBusy(true);
    directCtl = new AbortController();
    try {
      const reply = await directStream(aiCfg, directHist.slice(), onDelta, directCtl.signal);
      setBusy(false, true);
      if (!endStream(reply)) addMsg("ai", reply || "Done.");
      directHist.push({ role: "assistant", content: reply || "Done." });
      speak(reply);
    } catch (e) {
      endStream(); setBusy(false); directHist.pop();
      if (e.name === "AbortError") toast("Stopped."); else addMsg("err", e.message);
    } finally { directCtl = null; }
  }
  async function directTest(c) {
    const out = await directStream(c, [{ role: "user", content: "Reply with the single word OK." }], () => {}, undefined, 16);
    return out.trim().slice(0, 60);
  }

  // ---- Connect AI dialog (no code editing needed)
  async function probe(u) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(u + "/healthz", { cache: "no-store", signal: ctl.signal });
      const j = r.ok ? await r.json() : null;
      if (!j || !j.ok) throw 0;
      return j;
    } finally { clearTimeout(t); }
  }
  function connectMsg(text, kind) { const m = $("connect-msg"); m.textContent = text; m.className = kind === "ok" ? "ok-msg" : kind === "warn" ? "warn-msg" : "error"; }
  function openConnect(prefill) {
    $("connect-origin").textContent = location.origin.startsWith("http") ? location.origin : "(your website address)";
    $("connect-url").value = prefill || apiOverride || (sameOrigin ? location.origin : (API_MISSING ? "" : API));
    connectMsg("");
    if (!$("connect").open) $("connect").showModal();
  }
  const cleanUrl = () => $("connect-url").value.trim().replace(/\/+$/, "");
  const validUrl = (u) => /^https?:\/\/[^\s/]+/i.test(u);
  async function testConnect() {
    const u = cleanUrl();
    if (!validUrl(u)) { connectMsg("Enter the full address, starting with https://"); return null; }
    connectMsg("Checking...", "warn");
    try {
      const j = await probe(u);
      if (j.ai === false) connectMsg("Server reachable, but it has no AI key yet. Add ANTHROPIC_API_KEY on the server, then test again.", "warn");
      else connectMsg("Server reachable and the AI key is set. You're good to connect.", "ok");
      return j;
    } catch {
      connectMsg("Can't reach that server. If it is on free hosting wait 30 seconds and try again. If it keeps failing, check that AEGIS_ALLOWED_ORIGINS on the server contains " + location.origin + ".");
      return null;
    }
  }
  $("connect-btn").addEventListener("click", () => openConnect());
  $("ai-banner-btn").addEventListener("click", () => { if (aiState === "down") { setAi("checking", "AI: checking...", ""); checkAI(); } else if (aiState === "nokey") openAiCfg(); else openConnect(); });
  $("voice-help").addEventListener("click", () => { gestured = true; submitText("help"); });
  $("connect-close").addEventListener("click", () => $("connect").close());
  $("connect-reset").addEventListener("click", () => { safeSet(API_KEY_OVERRIDE, null); location.reload(); });
  $("connect-test").addEventListener("click", testConnect);
  $("connect-save").addEventListener("click", async () => {
    if (!(await testConnect())) return;
    safeSet(API_KEY_OVERRIDE, cleanUrl());
    safeSet(TOKEN_KEY, null);
    location.reload();
  });
  // A link like app.html?server=https://my-aegis.onrender.com opens this dialog pre-filled. It is never applied silently:
  // a stranger's link must not be able to redirect where your password is sent.
  const qServer = new URLSearchParams(location.search).get("server");
  if (qServer && validUrl(qServer)) setTimeout(() => openConnect(qServer.replace(/\/+$/, "")), 700);

  applyTheme(safeGet("aegis_theme") || "cyan");
  tick();
  setInterval(tick, 20000);
  mountOrbs();
  if (window.__AEGIS_TEST__) window.__aegis = { extractWake, rich, labelFor };
  start();
})();
