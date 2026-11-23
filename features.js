// Aegis features: slash quick-prompts, prompt history, regenerate, conversation search, focus timer,
// scratchpad, file drop and an offline alert. Additive and guarded: nothing here touches app.js internals,
// it only drives the existing DOM (the message box, the form, the toast). CSP safe (no inline code, no innerHTML).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  const guard = (fn) => { try { fn(); } catch (e) { /* never break the app */ } };
  const toast = (m, ms = 2600) => { const t = $("toast"); if (!t) return; t.textContent = m; t.classList.remove("hidden"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), ms); };
  const input = () => $("input");
  const setInput = (v, focus = true) => {
    const t = input(); if (!t) return;
    t.value = v; t.dispatchEvent(new Event("input", { bubbles: true }));
    if (focus) { t.focus(); t.setSelectionRange(v.length, v.length); }
  };
  const busy = () => { const s = $("stop-btn"); return !!s && !s.classList.contains("hidden"); };

  // ------------------------------------------------------------ prompt history (Up / Down in the empty box)
  guard(() => {
    const KEY = "aegis_prompt_history", MAX = 60;
    let hist = [];
    try { hist = JSON.parse(store.get(KEY) || "[]") || []; } catch { hist = []; }
    let idx = -1, draft = "";
    const form = $("composer"), t = input();
    if (!form || !t) return;
    form.addEventListener("submit", () => {
      const v = t.value.trim();
      if (v && !v.startsWith("/") && hist[hist.length - 1] !== v) { hist.push(v); hist = hist.slice(-MAX); store.set(KEY, JSON.stringify(hist)); }
      idx = -1;
    }, true);
    t.addEventListener("keydown", (e) => {
      if (document.getElementById("slash-menu") && !$("slash-menu").classList.contains("hidden")) return;
      if (e.key === "ArrowUp" && (t.value === "" || idx >= 0) && !e.shiftKey && !e.altKey) {
        if (!hist.length) return;
        e.preventDefault();
        if (idx < 0) { draft = t.value; idx = hist.length; }
        idx = Math.max(0, idx - 1); setInput(hist[idx]);
      } else if (e.key === "ArrowDown" && idx >= 0) {
        e.preventDefault();
        idx += 1;
        if (idx >= hist.length) { idx = -1; setInput(draft); } else setInput(hist[idx]);
      }
    });
  });

  // ------------------------------------------------------------ focus timer
  let focusApi = null;
  guard(() => {
    const ring = $("fx-ring"), time = $("fx-time"), mode = $("fx-mode"), start = $("fx-start"), reset = $("fx-reset"), done = $("focus-done");
    if (!ring || !time || !start) return;
    const KEY = "aegis_focus", DAY = "aegis_focus_day";
    let total = 25 * 60, left = total, end = 0, label = "Focus", timer = 0;
    const pad = (n) => String(n).padStart(2, "0");
    const today = () => new Date().toDateString();
    const doneCount = () => { try { const d = JSON.parse(store.get(DAY) || "{}"); return d.day === today() ? d.n : 0; } catch { return 0; } };
    const bump = () => { store.set(DAY, JSON.stringify({ day: today(), n: doneCount() + 1 })); done.textContent = doneCount(); };
    const paint = () => {
      time.textContent = pad(Math.floor(left / 60)) + ":" + pad(left % 60);
      ring.style.setProperty("--p", String(Math.round(((total - left) / total) * 100)));
      ring.classList.toggle("run", !!timer);
      mode.textContent = label;
      start.textContent = timer ? "Pause" : (left < total && left > 0 ? "Resume" : "Start");
      document.title = timer ? time.textContent + " | Aegis" : document.title.replace(/^\d\d:\d\d \| /, "");
    };
    const save = () => store.set(KEY, JSON.stringify({ total, left, label, end: timer ? end : 0 }));
    const beep = () => {
      try {
        const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
        const c = new A(); [0, 0.25, 0.5].forEach((d) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(c.destination); o.start(c.currentTime + d); o.stop(c.currentTime + d + 0.15); });
        setTimeout(() => c.close(), 1200);
      } catch {}
    };
    const finish = () => {
      clearInterval(timer); timer = 0; left = 0;
      if (label !== "Break" && label !== "Long break") bump();
      const msg = label + " finished. " + (/break/i.test(label) ? "Back to work." : "Take a break.");
      toast(msg, 8000); beep();
      try { if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("Aegis", { body: msg }); } catch {}
      paint(); save();
    };
    const tick = () => { left = Math.max(0, Math.round((end - Date.now()) / 1000)); if (left <= 0) finish(); else { paint(); } };
    const run = () => { if (timer) return; if (left <= 0) left = total; end = Date.now() + left * 1000; timer = setInterval(tick, 500); paint(); save(); };
    const pause = () => { if (!timer) return; clearInterval(timer); timer = 0; paint(); save(); };
    const set = (min, name) => { pause(); total = min * 60; left = total; label = name; paint(); save();
      document.querySelectorAll(".fx-presets button").forEach((b) => b.classList.toggle("active", Number(b.dataset.min) === min && b.dataset.mode === name)); };
    start.addEventListener("click", () => (timer ? pause() : run()));
    reset.addEventListener("click", () => { pause(); left = total; paint(); save(); });
    document.querySelectorAll(".fx-presets button").forEach((b) => b.addEventListener("click", () => set(Number(b.dataset.min), b.dataset.mode)));
    try {
      const s = JSON.parse(store.get(KEY) || "null");
      if (s && s.total) {
        total = s.total; left = s.left; label = s.label || "Focus";
        document.querySelectorAll(".fx-presets button").forEach((b) => b.classList.toggle("active", Number(b.dataset.min) * 60 === total && b.dataset.mode === label));
        if (s.end && s.end > Date.now()) { end = s.end; left = Math.round((end - Date.now()) / 1000); timer = setInterval(tick, 500); }
        else if (s.end) left = 0;
      }
    } catch {}
    done.textContent = doneCount(); paint();
    focusApi = { start: (m, n) => { if (m) set(m, n || "Focus"); run(); toast("Focus timer started."); } };
  });

  // ------------------------------------------------------------ scratchpad
  guard(() => {
    const pad = $("pad"), cnt = $("pad-count");
    if (!pad) return;
    pad.value = store.get("aegis_scratch") || "";
    const upd = () => { cnt.textContent = pad.value.length ? pad.value.length + " chars" : "0"; };
    let tm = 0;
    pad.addEventListener("input", () => { upd(); clearTimeout(tm); tm = setTimeout(() => store.set("aegis_scratch", pad.value), 300); });
    $("pad-clear").addEventListener("click", () => { if (!pad.value || confirm("Clear the scratchpad?")) { pad.value = ""; store.set("aegis_scratch", ""); upd(); } });
    $("pad-send").addEventListener("click", () => { if (!pad.value.trim()) return toast("The scratchpad is empty."); setInput(pad.value.trim()); toast("Added to the message box."); });
    upd();
  });

  // ------------------------------------------------------------ conversation search
  let findApi = null;
  guard(() => {
    const bar = $("find-bar"), q = $("find-input"), cnt = $("find-count"), box = $("messages");
    if (!bar || !q || !box) return;
    let hits = [], cur = -1;
    const all = () => [...box.querySelectorAll(".msg.user, .msg.ai")];
    const clear = () => all().forEach((m) => m.classList.remove("find-dim", "find-hit", "find-cur"));
    const go = (n) => {
      if (!hits.length) return;
      cur = (n + hits.length) % hits.length;
      hits.forEach((m, i) => m.classList.toggle("find-cur", i === cur));
      hits[cur].scrollIntoView({ block: "center", behavior: "smooth" });
      cnt.textContent = (cur + 1) + " / " + hits.length;
    };
    const run = () => {
      clear(); hits = []; cur = -1;
      const term = q.value.trim().toLowerCase();
      if (!term) { cnt.textContent = "0 / 0"; return; }
      all().forEach((m) => { if ((m.textContent || "").toLowerCase().includes(term)) { hits.push(m); m.classList.add("find-hit"); } else m.classList.add("find-dim"); });
      cnt.textContent = hits.length ? "1 / " + hits.length : "No match";
      if (hits.length) go(hits.length - 1);
    };
    const open = () => { bar.classList.remove("hidden"); q.focus(); q.select(); };
    const close = () => { bar.classList.add("hidden"); q.value = ""; clear(); hits = []; };
    q.addEventListener("input", run);
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); input() && input().focus(); }
    });
    $("find-next").addEventListener("click", () => go(cur + 1));
    $("find-prev").addEventListener("click", () => go(cur - 1));
    $("find-close").addEventListener("click", close);
    const fb = $("find-btn"); if (fb) fb.addEventListener("click", () => (bar.classList.contains("hidden") ? open() : close()));
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f" && !$("app").classList.contains("hidden")) { e.preventDefault(); open(); }
    });
    findApi = { open };
  });

  // ------------------------------------------------------------ regenerate on the latest answer
  guard(() => {
    const box = $("messages");
    if (!box) return;
    let queued = false;
    const apply = () => {
      queued = false;
      box.querySelectorAll(".msg-actions .regen").forEach((b) => b.remove());
      const ais = box.querySelectorAll(".msg.ai:not(.streaming)");
      const last = ais[ais.length - 1];
      const bar = last && last.querySelector(".msg-actions");
      if (!bar) return;
      const b = document.createElement("button");
      b.type = "button"; b.className = "regen"; b.textContent = "Regenerate";
      b.addEventListener("click", () => {
        if (busy()) return toast("Wait for the current reply, or press Stop.");
        const users = box.querySelectorAll(".msg.user");
        const u = users[users.length - 1];
        if (!u) return;
        const c = u.cloneNode(true); c.querySelectorAll("button").forEach((n) => n.remove());
        setInput((c.textContent || "").trim(), false);
        $("composer").requestSubmit();
      });
      bar.insertBefore(b, bar.querySelector(".msg-time"));
    };
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(apply); } }).observe(box, { childList: true, subtree: true });
  });

  // ------------------------------------------------------------ slash quick-prompts
  guard(() => {
    const menu = $("slash-menu"), t = input(), form = $("composer");
    if (!menu || !t || !form) return;
    const ITEMS = [
      { c: "/brief", d: "Brief me on my day", text: "Good morning, brief me on my day" },
      { c: "/summarize", d: "Summarize text in 5 bullets", text: "Summarize the following in 5 short bullet points:\n\n" },
      { c: "/translate", d: "Translate to Urdu", text: "Translate this to Urdu:\n\n" },
      { c: "/explain", d: "Explain in simple words", text: "Explain in simple words: " },
      { c: "/email", d: "Draft a professional email", text: "Write a polite, professional email about: " },
      { c: "/fix", d: "Fix grammar and style", text: "Fix the grammar and improve the style of this text, keep my meaning:\n\n" },
      { c: "/code", d: "Write code", text: "Write clean, commented code for: " },
      { c: "/plan", d: "Step-by-step plan", text: "Make a clear step-by-step plan for: " },
      { c: "/remind", d: "Set a reminder", text: "Remind me in 20 minutes to " },
      { c: "/spent", d: "Log an expense", text: "I spent 500 on " },
      { c: "/spending", d: "How much did I spend this month?", text: "How much did I spend this month, by category?", run: true },
      { c: "/habits", d: "Today's habits and streaks", text: "How are my habits today? What is still left?", run: true },
      { c: "/habit", d: "Tick or start a habit", text: "Mark this habit done for today: " },
      { c: "/prayer", d: "Prayer times for a city", text: "What are today's prayer times in " },
      { c: "/search", d: "Search everything I saved", text: "Search everything I saved for: " },
      { c: "/timer", d: "Instant 5 minute timer", text: "set a timer for 5 minutes", run: true },
      { c: "/focus", d: "Start a 25 minute focus session", act: () => focusApi && focusApi.start(25, "Focus") },
      { c: "/find", d: "Search this conversation", act: () => findApi && findApi.open() },
    ];
    let shown = [], sel = 0;
    const isOpen = () => !menu.classList.contains("hidden");
    const close = () => { menu.classList.add("hidden"); menu.textContent = ""; shown = []; };
    const paint = () => {
      menu.textContent = "";
      shown.forEach((it, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(i === sel));
        const b = document.createElement("b"); b.textContent = it.c;
        const s = document.createElement("span"); s.textContent = it.d;
        li.append(b, s);
        li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
        menu.appendChild(li);
      });
      const cur = menu.children[sel]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
    };
    const update = () => {
      const v = t.value;
      if (!/^\/[a-z]*$/i.test(v)) return close();
      shown = ITEMS.filter((i) => i.c.startsWith(v.toLowerCase()));
      if (!shown.length) return close();
      sel = Math.min(sel, shown.length - 1);
      menu.classList.remove("hidden"); paint();
    };
    function choose(i) {
      const it = shown[i]; if (!it) return;
      close();
      if (it.act) { setInput(""); it.act(); }
      else { setInput(it.text); if (it.run) form.requestSubmit(); }
    }
    t.addEventListener("input", () => { sel = 0; update(); });
    t.addEventListener("blur", () => setTimeout(close, 120));
    form.addEventListener("keydown", (e) => {
      if (e.target !== t || !isOpen()) return;
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopImmediatePropagation(); sel = (sel + 1) % shown.length; paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopImmediatePropagation(); sel = (sel - 1 + shown.length) % shown.length; paint(); }
      else if ((e.key === "Enter" && !e.shiftKey && !e.isComposing) || e.key === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); choose(sel); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    }, true);
  });

  // ------------------------------------------------------------ drop a text file into the message box
  guard(() => {
    const stage = $("stage"), hint = $("drop-hint");
    if (!stage || !hint) return;
    const TEXT = /\.(txt|md|csv|json|log|js|ts|py|html|css|xml|yml|yaml|sql|java|c|cpp|cs|go|rs|sh|ini|tex)$/i;
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
    stage.addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; hint.classList.remove("hidden"); } });
    stage.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) hint.classList.add("hidden"); });
    stage.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    stage.addEventListener("drop", async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; hint.classList.add("hidden");
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (!TEXT.test(f.name) && !/^text\//.test(f.type)) return toast("Only text-based files can be added.");
      if (f.size > 60000) return toast("That file is too large (60 KB max).");
      try {
        const txt = await f.text();
        const cur = input().value ? input().value.replace(/\s+$/, "") + "\n\n" : "";
        setInput(cur + "File: " + f.name + "\n```\n" + txt + "\n```\n");
        toast("Added " + f.name + " to your message.");
      } catch { toast("Could not read that file."); }
    });
  });

  // ------------------------------------------------------------ offline alert
  guard(() => {
    let bar = null;
    const show = () => {
      if (bar) return;
      bar = document.createElement("div"); bar.className = "offline-bar"; bar.setAttribute("role", "alert");
      bar.textContent = "You are offline. Instant commands still work; AI replies need a connection.";
      document.body.appendChild(bar);
    };
    const hide = () => { if (bar) { bar.remove(); bar = null; toast("Back online."); } };
    window.addEventListener("offline", show); window.addEventListener("online", hide);
    if (!navigator.onLine) show();
  });
})();
