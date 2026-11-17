(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ config
  // config.js sets API_BASE. Empty = same origin (local dev, desktop app, server-hosted UI).
  const CFG = window.AEGIS_CONFIG || {};
  const API = String(CFG.API_BASE || "").replace(/\/+$/, "");
  const API_MISSING = /YOUR-AEGIS-SERVER/i.test(API);
  // Local login mode: no server needed. Accounts live in THIS browser on THIS computer only
  // (localStorage, passwords PBKDF2-hashed). Used automatically while config.js has no real server yet,
  // or force it with LOCAL_LOGIN: true. Chat/AI still needs the real server.
  const LOCAL = API_MISSING || CFG.LOCAL_LOGIN === true;
  const LOCAL_USERS_KEY = "aegis_local_users";
  const WS_URL =
    (API ? API.replace(/^http/i, "ws") : (location.protocol === "https:" ? "wss://" : "ws://") + location.host) + "/ws";
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
    if (!wsOpen) st = "offline";
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

  // Free hosts put idle servers to sleep. Poke it as soon as the page opens so login is fast.
  async function warmServer() {
    const pill = $("server-state");
    if (LOCAL) {
      setPill(pill, "Local login (this computer)", "warn");
      const w = $("config-warning");
      w.classList.remove("hidden");
      w.textContent = "Local mode: your account is saved only in this browser on this computer. Chat/AI needs the Aegis server (set API_BASE in config.js).";
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
        if (r.ok) { clearTimeout(wake); setPill(pill, "Server online", "on"); return; }
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

  function addMsg(role, text) {
    markChat();
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.dir = "auto"; // right-to-left for Urdu
    rich(el, text);
    $("messages").appendChild(el);
    if (thinkingEl) $("messages").appendChild(thinkingEl);
    scrollDown();
    return el;
  }

  function clearChat() {
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
    $("send-btn").disabled = b;
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

  function doneTool(m) {
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
    if (LOCAL) { setLink("offline"); return; }
    const sock = new WebSocket(WS_URL);
    ws = sock;
    setLink(retry ? "reconnecting" : "connecting");
    sock.onopen = () => {
      retry = 0;
      sock.send(JSON.stringify({ type: "auth", token, role: "chat" }));
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
        $("user-email").textContent = m.email;
        setUsage(m.used, m.limit, m.plan);
        setDevice(m.device);
        $("messages").querySelectorAll(".msg,.tool").forEach((n) => n.remove());
        (m.history || []).forEach((h) => addMsg(h.role === "user" ? "user" : "ai", h.text));
        loadMemory();
        refreshState();
        syncVoice();
        break;
      case "status": setDevice(m.device); break;
      case "tool": addTool(m); break;
      case "tool_done": doneTool(m); break;
      case "confirm": confirmQueue.push(m); showConfirm(); break;
      case "reply":
        setBusy(false, true); // speak() re-syncs the microphone once it knows whether Aegis will talk
        addMsg("ai", m.text);
        setUsage(m.used, m.limit);
        loadMemory();
        speak(m.text);
        break;
      case "error": setBusy(false); addMsg("err", m.text); break;
      case "cleared": clearChat(); break;
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
    $("confirm-args").textContent = JSON.stringify(m.args, null, 2);
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
  function submitText(text) {
    text = String(text || "").trim();
    if (!text || busy) return;
    if (!ws || ws.readyState !== 1 || !wsOpen) return addMsg("err", LOCAL ? "Local login mode: the AI server isn't connected yet. Set API_BASE in config.js to your deployed server." : "Not connected. Reconnecting...");
    stopSpeaking();
    stopRec();
    setInterim("");
    manual = false;
    followUp = false;
    addMsg("user", text);
    send({ type: "chat", text });
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
  document.querySelectorAll(".chip[data-q]").forEach((c) =>
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

  // keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      if (authed) { e.preventDefault(); $("input").focus(); }
    } else if (e.key === "Escape" && authed && !$("confirm").open) {
      stopSpeaking(); convo = false; manual = false; followUp = false; syncToggles(); syncVoice();
    }
  });

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
        wake = false; convo = false; manual = false; followUp = false;
        safeSet("aegis_wake", "0");
        syncToggles();
        toast("Microphone access is blocked. Allow it in your browser's address bar to use voice.", 7000);
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
    if (!SR || !authed || !wsOpen || busy || speaking || $("confirm").open) return stopRec();
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
  function pickVoice(lang) {
    const all = speechSynthesis.getVoices();
    const base = lang.split("-")[0];
    const match = all.filter((v) => v.lang === lang || v.lang.startsWith(base));
    return match.find((v) => /natural|online|google/i.test(v.name)) || match[0] || null;
  }
  function stopSpeaking() {
    speakGen++;
    if (hasTTS) speechSynthesis.cancel();
    if (speaking) { speaking = false; refreshState(); }
  }
  function speak(text) {
    const want = hasTTS && ($("speak").checked || convo);
    const parts = want ? chunkSpeech(plainSpeech(text)) : [];
    if (!parts.length) return syncVoice();
    speechSynthesis.cancel();
    const gen = ++speakGen;
    let left = parts.length;
    speaking = true;
    refreshState();
    syncVoice(); // makes sure the mic is off while Aegis talks
    const lang = $("lang").value;
    const voice = pickVoice(lang);
    parts.forEach((p) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 1.02;
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
  $("lang").addEventListener("change", () => { safeSet("aegis_lang", $("lang").value); stopRec(); syncVoice(); });
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
  }

  tick();
  setInterval(tick, 20000);
  mountOrbs();
  if (window.__AEGIS_TEST__) window.__aegis = { extractWake, rich, labelFor };
  start();
})();
