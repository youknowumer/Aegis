(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = "aegis_token";
  const desktop = window.aegisDesktop || null; // injected by the Electron preload script

  let token = safeGet(TOKEN_KEY);
  let ws = null;
  let retry = 0;
  let busy = false;
  let authMode = "login";
  let thinkingEl = null;
  const confirmQueue = [];

  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

  // ---------------------------------------------------------------- API
  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(path, { ...opts, headers });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 401 && token) logout();
      throw new Error((data && data.detail) || "Request failed");
    }
    return data;
  }

  // ---------------------------------------------------------------- auth UI
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      authMode = t.dataset.mode;
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      $("auth-submit").textContent = authMode === "login" ? "Sign in" : "Create account";
      $("password").autocomplete = authMode === "login" ? "current-password" : "new-password";
      $("auth-error").textContent = "";
    })
  );

  // Landing page "Get started" opens /app.html?mode=register
  if (new URLSearchParams(location.search).get("mode") === "register") {
    document.querySelector('.tab[data-mode="register"]').click();
  }

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
    safeSet(TOKEN_KEY, null);
    if (desktop) desktop.setToken(null);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    $("messages").querySelectorAll(".msg,.tool,.thinking").forEach((n) => n.remove());
    $("welcome").classList.remove("hidden");
    show("auth");
  }
  $("logout-btn").addEventListener("click", logout);

  function show(which) {
    $("auth").classList.toggle("hidden", which !== "auth");
    $("app").classList.toggle("hidden", which !== "app");
  }

  // ---------------------------------------------------------------- rendering
  function rich(el, text) {
    // Safe mini-formatter: **bold** and `code`; everything else is plain text (no innerHTML).
    el.textContent = "";
    text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        const b = document.createElement("strong"); b.textContent = part.slice(2, -2); el.appendChild(b);
      } else if (/^`[^`]+`$/.test(part)) {
        const c = document.createElement("code"); c.textContent = part.slice(1, -1); el.appendChild(c);
      } else if (part) {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  function addMsg(role, text) {
    $("welcome").classList.add("hidden");
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.dir = "auto"; // right-to-left for Urdu
    rich(el, text);
    $("messages").appendChild(el);
    scrollDown();
    return el;
  }

  function addTool(name, args) {
    $("welcome").classList.add("hidden");
    const el = document.createElement("div");
    el.className = "tool";
    const brief = Object.values(args || {}).map((v) => String(v).slice(0, 60)).join(", ");
    el.textContent = "⚙ " + name + (brief ? " · " + brief : "");
    $("messages").appendChild(el);
    scrollDown();
  }

  function setThinking(on) {
    if (on && !thinkingEl) {
      thinkingEl = document.createElement("div");
      thinkingEl.className = "thinking";
      thinkingEl.innerHTML = "<i></i><i></i><i></i>"; // static markup, no user data
      $("messages").appendChild(thinkingEl);
      scrollDown();
    } else if (!on && thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }
  function scrollDown() { const m = $("messages"); m.scrollTop = m.scrollHeight; }

  function setBusy(b) {
    busy = b;
    $("send-btn").disabled = b;
    setThinking(b);
  }

  // ---------------------------------------------------------------- status panels
  function setDevice(on) {
    const pill = $("device-pill");
    pill.textContent = on ? "Connected" : "Not connected";
    pill.className = "pill " + (on ? "on" : "off");
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

  async function loadMemory() {
    try {
      const facts = await api("/api/memory");
      const ul = $("memory-list");
      ul.textContent = "";
      facts.forEach((f) => {
        const li = document.createElement("li");
        const s = document.createElement("span"); s.dir = "auto"; s.textContent = f.text;
        const b = document.createElement("button"); b.textContent = "×"; b.title = "Forget this"; b.setAttribute("aria-label", "Forget this");
        b.addEventListener("click", async () => { try { await api("/api/memory/" + f.id, { method: "DELETE" }); loadMemory(); } catch {} });
        li.append(s, b);
        ul.appendChild(li);
      });
      $("memory-count").textContent = facts.length;
      $("memory-empty").classList.toggle("hidden", facts.length > 0);
    } catch {}
  }

  async function checkDownload() {
    if (desktop) return; // already in the desktop app
    try {
      const r = await fetch("/downloads/Aegis-Setup.exe", { method: "HEAD" });
      if (r.ok) $("download-link").classList.remove("hidden");
    } catch {}
  }

  // ---------------------------------------------------------------- websocket
  function connect() {
    if (!token) return;
    const proto = location.protocol === "https:" ? "wss://" : "ws://";
    ws = new WebSocket(proto + location.host + "/ws");
    ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ type: "auth", token, role: "chat" })); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
    ws.onclose = (ev) => {
      setBusy(false);
      if (ev.code === 4401) return logout();
      if (!token) return;
      setTimeout(connect, Math.min(15000, 800 * 2 ** retry++));
    };
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function onMessage(m) {
    switch (m.type) {
      case "hello":
        $("user-email").textContent = m.email;
        setUsage(m.used, m.limit, m.plan);
        setDevice(m.device);
        $("messages").querySelectorAll(".msg,.tool").forEach((n) => n.remove());
        (m.history || []).forEach((h) => addMsg(h.role === "user" ? "user" : "ai", h.text));
        loadMemory();
        break;
      case "status": setDevice(m.device); break;
      case "tool": addTool(m.name, m.args); break;
      case "confirm": confirmQueue.push(m); showConfirm(); break;
      case "reply":
        setBusy(false);
        addMsg("ai", m.text);
        setUsage(m.used, m.limit);
        loadMemory();
        speak(m.text);
        break;
      case "error": setBusy(false); addMsg("err", m.text); break;
      case "cleared":
        $("messages").querySelectorAll(".msg,.tool").forEach((n) => n.remove());
        $("welcome").classList.remove("hidden");
        break;
    }
  }

  // ---------------------------------------------------------------- confirm dialog
  function showConfirm() {
    const dlg = $("confirm");
    if (dlg.open || !confirmQueue.length) return;
    const m = confirmQueue[0];
    $("confirm-tool").textContent = m.tool;
    $("confirm-args").textContent = JSON.stringify(m.args, null, 2);
    dlg.showModal();
  }
  function answerConfirm(ok) {
    const m = confirmQueue.shift();
    if (m) send({ type: "confirm_response", id: m.id, ok });
    $("confirm").close();
    showConfirm();
  }
  $("allow-btn").addEventListener("click", () => answerConfirm(true));
  $("deny-btn").addEventListener("click", () => answerConfirm(false));
  $("confirm").addEventListener("cancel", (e) => { e.preventDefault(); answerConfirm(false); }); // Esc = deny

  // ---------------------------------------------------------------- composer
  function submitText(text) {
    text = text.trim();
    if (!text || busy) return;
    if (!ws || ws.readyState !== 1) return addMsg("err", "Not connected. Reconnecting...");
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
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => submitText(c.dataset.q)));
  $("clear-btn").addEventListener("click", () => { if (confirm("Clear this conversation?")) send({ type: "reset" }); });
  $("menu-btn").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("messages").addEventListener("click", () => $("sidebar").classList.remove("open"));

  // ---------------------------------------------------------------- voice (Web Speech API)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (!SR) { $("mic-btn").disabled = true; $("mic-btn").title = "Voice input is not supported in this browser"; }

  $("lang").value = safeGet("aegis_lang") || "en-US";
  $("lang").addEventListener("change", () => safeSet("aegis_lang", $("lang").value));
  $("speak").checked = safeGet("aegis_speak") === "1";
  $("speak").addEventListener("change", () => { safeSet("aegis_speak", $("speak").checked ? "1" : "0"); if (!$("speak").checked) speechSynthesis.cancel(); });

  $("mic-btn").addEventListener("click", () => {
    if (!SR) return;
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = $("lang").value;
    rec.interimResults = false;
    rec.onstart = () => $("mic-btn").classList.add("live");
    rec.onresult = (e) => submitText(e.results[0][0].transcript);
    rec.onerror = () => {};
    rec.onend = () => { rec = null; $("mic-btn").classList.remove("live"); };
    rec.start();
  });

  function speak(text) {
    if (!$("speak").checked || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*`]/g, ""));
    u.lang = $("lang").value;
    speechSynthesis.speak(u);
  }

  // ---------------------------------------------------------------- boot
  async function start() {
    try {
      const cfg = await (await fetch("/api/config")).json();
      document.title = cfg.app_name;
      document.querySelectorAll(".app-name").forEach((n) => (n.textContent = cfg.app_name));
    } catch {}
    if (!token) return show("auth");
    try {
      await api("/api/me");
    } catch {
      return show("auth");
    }
    show("app");
    if (desktop) desktop.setToken(token); // lets the desktop app open its PC-control connection
    checkDownload();
    if (!ws) connect();
  }
  start();
})();
