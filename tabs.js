// Aegis side-rail tabs: both rails become tabbed so nothing is hidden or squeezed on short screens.
//   Left :  Plan (tasks + reminders) | Focus (timer + scratchpad) | Memory
//   Right:  Activity | Status (link, usage, device) | World (weather + shortcuts) | Voice (personas, speed, pitch)
// The original blocks are MOVED, not copied, so every id and every handler in app.js / features.js / hud.js keeps working.
// Tabs: animated sliding indicator, live count badges, "ping" when something new lands in a hidden tab, keyboard (arrows,
// Home/End, Alt+1..7), remembered choice, and AegisTabs.show("memory") for voice commands.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const el = (tag, cls, attrs) => { const e = document.createElement(tag); if (cls) e.className = cls; if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const svg = (d) => '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  const IC = {
    plan: svg('<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
    focus: svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 1.5M9.5 2.5h5"/>'),
    memory: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
    activity: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
    status: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
    world: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>'),
    voice: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  };

  const registry = {};   // tab id -> { rail, select }
  const order = [];      // every tab id, left to right

  function build(rail, key, defs) {
    if (!rail) return;
    rail.classList.add("tabbed");
    const bar = el("div", "tabbar", { role: "tablist", "aria-label": key === "left" ? "Workspace" : "Assistant" });
    const ind = el("span", "tab-ind"); ind.setAttribute("aria-hidden", "true");
    bar.appendChild(ind);
    const panes = el("div", "tabpanes");
    const anchor = rail.querySelector(".side-actions");
    rail.insertBefore(bar, anchor);
    rail.insertBefore(panes, anchor);

    const tabs = defs.map((d, i) => {
      const btn = el("button", "tab-btn", { type: "button", role: "tab", id: "tab-" + d.id, "aria-controls": "pane-" + d.id, "aria-selected": "false", tabindex: "-1", title: d.label + "  (Alt+" + (order.length + 1) + ")" });
      btn.innerHTML = IC[d.id] + '<span class="tab-label"></span><span class="tab-badge" hidden>0</span>';
      btn.querySelector(".tab-label").textContent = d.label;
      const pane = el("div", "tabpane", { role: "tabpanel", id: "pane-" + d.id, "aria-labelledby": "tab-" + d.id });
      pane.hidden = true;
      (d.blocks || []).forEach((sel) => {
        let b = typeof sel === "string" ? rail.querySelector(sel) : sel;
        if (b) { b.classList.remove("collapsed"); pane.appendChild(b); }
      });
      if (d.make) d.make(pane);
      bar.appendChild(btn); panes.appendChild(pane);
      order.push(d.id);
      return { d, btn, pane, badge: btn.querySelector(".tab-badge"), seen: 0 };
    });

    // block headers inside tabs are plain titles now: the tab does the job of the collapse arrow
    rail.addEventListener("click", (e) => { if (e.target.closest(".tabpane .blk-head")) e.stopPropagation(); }, true);
    rail.addEventListener("keydown", (e) => { if (e.target.closest && e.target.closest(".tabpane .blk-head") && (e.key === "Enter" || e.key === " ") && e.target.matches(".blk-head")) e.stopPropagation(); }, true);

    let cur = null;
    function place() {
      const t = tabs.find((x) => x.d.id === cur);
      if (!t || !t.btn.offsetWidth) return;
      bar.style.setProperty("--x", t.btn.offsetLeft + "px");
      bar.style.setProperty("--w", t.btn.offsetWidth + "px");
    }
    function select(id, opts) {
      opts = opts || {};
      const t = tabs.find((x) => x.d.id === id) || tabs[0];
      if (t.d.id === cur && !opts.force) return t;
      const prevI = tabs.findIndex((x) => x.d.id === cur), nextI = tabs.indexOf(t);
      cur = t.d.id;
      tabs.forEach((x) => {
        const on = x === t;
        x.btn.setAttribute("aria-selected", String(on));
        x.btn.tabIndex = on ? 0 : -1;
        x.btn.classList.toggle("on", on);
        x.pane.hidden = !on;
      });
      store.set("aegis_tab_" + key, cur);
      t.seen = badgeValue(t); t.btn.classList.remove("ping"); refreshBadge(t);
      // direction-aware entrance + a light sweep across the rail
      t.pane.dataset.dir = prevI < 0 || nextI >= prevI ? "r" : "l";
      t.pane.classList.remove("enter"); void t.pane.offsetWidth; t.pane.classList.add("enter");
      if (!opts.silent) { rail.classList.remove("sweep"); void rail.offsetWidth; rail.classList.add("sweep"); if (window.__aegisOrb) window.__aegisOrb.pulse(0.55); }
      place();
      if (opts.focus) t.btn.focus();
      return t;
    }
    tabs.forEach((t, i) => {
      t.btn.addEventListener("click", (e) => {
        const r = t.btn.getBoundingClientRect();
        const rip = el("span", "tab-rip"); rip.style.left = e.clientX - r.left + "px"; rip.style.top = e.clientY - r.top + "px";
        t.btn.appendChild(rip); setTimeout(() => rip.remove(), 650);
        select(t.d.id);
      });
      t.btn.addEventListener("keydown", (e) => {
        const k = e.key; let j = -1;
        if (k === "ArrowRight") j = (i + 1) % tabs.length; else if (k === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
        else if (k === "Home") j = 0; else if (k === "End") j = tabs.length - 1;
        if (j >= 0) { e.preventDefault(); select(tabs[j].d.id, { focus: true }); }
      });
      registry[t.d.id] = { select: (o) => select(t.d.id, o), rail };
    });

    // count badges: sum the numbers in the blocks' own ".count" chips; ping when a hidden tab gains something
    function badgeValue(t) { let n = 0; t.pane.querySelectorAll(".count").forEach((c) => { n += parseInt(c.textContent, 10) || 0; }); return n; }
    function refreshBadge(t) {
      const v = badgeValue(t);
      if (!t.d.badge) { t.badge.hidden = true; return; }
      t.badge.hidden = v <= 0; t.badge.textContent = v > 99 ? "99+" : String(v);
      if (t.d.id !== cur && v > t.seen) { t.btn.classList.remove("ping"); void t.btn.offsetWidth; t.btn.classList.add("ping"); }
      if (t.d.id === cur) t.seen = v;
    }
    tabs.forEach((t) => {
      refreshBadge(t);
      t.pane.querySelectorAll(".count").forEach((c) => new MutationObserver(() => refreshBadge(t)).observe(c, { childList: true, characterData: true, subtree: true }));
    });
    if (window.ResizeObserver) new ResizeObserver(place).observe(bar); else window.addEventListener("resize", place);
    // drawers on small screens are display:none until opened: re-measure when they appear
    new MutationObserver(place).observe(rail, { attributes: true, attributeFilter: ["class"] });

    const saved = store.get("aegis_tab_" + key);
    select(tabs.some((t) => t.d.id === saved) ? saved : defs[0].id, { silent: true, force: true });
    requestAnimationFrame(place);
  }

  // ----------------------------------------------------------------- the two rails
  build($("left"), "left", [
    { id: "plan", label: "Plan", blocks: [".tasksbox", ".remindbox"], badge: true },
    { id: "focus", label: "Focus", blocks: [".focusbox", ".padbox"], badge: false },
    { id: "memory", label: "Memory", blocks: [".membox"], badge: true },
  ]);
  build($("right"), "right", [
    { id: "activity", label: "Activity", blocks: [".actbox"], badge: true },
    { id: "status", label: "Status", blocks: [".statusbox", ".sysbox"], badge: false },
    { id: "world", label: "World", blocks: [".wxbox", ".linksbox"], badge: false },
    { id: "voice", label: "Voice", blocks: [], badge: false, make(p) { const s = el("section", "blk voicebox"); s.id = "vp-quick"; p.appendChild(s); } },
  ]);
  if (window.AegisVoice && AegisVoice.mountQuick) AegisVoice.mountQuick();

  // Alt+1..7 jumps straight to a tab (does not fire while typing a plain character)
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const n = parseInt(e.code.replace("Digit", ""), 10);
    if (n >= 1 && n <= order.length) { e.preventDefault(); AegisTabs.show(order[n - 1], { focus: true }); }
  });

  // ----------------------------------------------------------------- the orb listens to you typing and sending
  const input = $("input");
  if (input) {
    let last = 0;
    input.addEventListener("input", () => { const now = Date.now(); if (now - last > 90 && window.__aegisOrb) { last = now; window.__aegisOrb.pulse(0.35 + Math.random() * 0.2); } });
  }
  const form = $("composer");
  if (form) form.addEventListener("submit", () => { if (window.__aegisOrb) window.__aegisOrb.pulse(1); });

  // opens the drawer too on phones, so "show memory tab" always lands somewhere visible
  window.AegisTabs = {
    list: () => order.slice(),
    show(id, o) {
      const r = registry[id];
      if (!r) return false;
      if (getComputedStyle(r.rail).display === "none") { const btn = r.rail.id === "left" ? $("menu-btn") : $("activity-btn"); if (btn) btn.click(); }
      r.select(o);
      return true;
    },
  };
})();
