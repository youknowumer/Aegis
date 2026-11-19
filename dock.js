// Aegis live docks: a fixed "live view" pinned to the bottom of each side rail, so the rails are never empty.
//   Left  : LIVE SCAN      radar whose blips are your REAL tasks, reminders and memories (counts read from the panels);
//                          sweep speed and colour follow the assistant's state.
//   Right : LIVE TELEMETRY three scrolling traces of real measurements: voice level (from the orb), frame rate, and
//                          JS heap (Chrome) or network downlink where available. Nothing here is simulated.
// Rendering pauses when the tab is hidden or the rail is closed, and draws a still frame for "reduce motion".
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const num = (id) => { const e = $(id); return e ? Math.max(0, parseInt(e.textContent, 10) || 0) : 0; };
  const STATE_RGB = { offline: [100, 116, 139], listening: [52, 230, 150], thinking: [140, 130, 255] };
  const STATE_LABEL = { offline: "Offline", idle: "Standing by", listening: "Listening", thinking: "Working", speaking: "Speaking" };
  const accent = () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--ac").split(",").map((x) => parseFloat(x));
    return v.length === 3 && v.every((x) => x >= 0) ? v : [47, 227, 255];
  };
  const stateOf = () => { const s = $("stage"); return (s && s.dataset.state) || "idle"; };
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;

  function sized(canvas) {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function dock(rail, where, cfg) {
    if (!rail) return null;
    const box = el("section", "dock");
    box.setAttribute("aria-label", cfg.title);
    box.innerHTML = '<div class="dock-head"><span class="dock-dot" aria-hidden="true"></span><b></b><small></small></div>';
    box.querySelector("b").textContent = cfg.title;
    const status = box.querySelector("small");
    const canvas = el("canvas"); canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", cfg.alt);
    const legend = el("div", "dock-legend");
    box.append(canvas, legend);
    if (where) rail.insertBefore(box, where); else rail.appendChild(box);
    return { box, canvas, legend, status };
  }

  // ------------------------------------------------------------------ LEFT: live scan
  function radar() {
    const rail = $("left");
    const d = dock(rail, rail && rail.querySelector(".side-actions"), { title: "Live scan", alt: "Radar showing your tasks, reminders and memories" });
    if (!d) return;
    const rings = { tasks: [0.30, 0.55], reminders: [0.58, 0.78], memory: [0.8, 0.96] };
    const seeded = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
    const kinds = [["tasks", "Tasks", [47, 227, 255]], ["reminders", "Reminders", [255, 176, 46]], ["memory", "Memory", [168, 160, 255]]];
    const chips = {};
    kinds.forEach(([k, label, c]) => {
      const s = el("span", "dl-chip"); s.innerHTML = '<i></i><em></em><b>0</b>';
      s.querySelector("i").style.background = rgba(c, 1); s.querySelector("em").textContent = label;
      d.legend.appendChild(s); chips[k] = s.querySelector("b");
    });
    let sweep = 0, last = 0, counts = { tasks: 0, reminders: 0, memory: 0 }, speed = 0.9, tick = 0;

    function frame(now) {
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      const { ctx, w, h } = sized(d.canvas);
      const st = stateOf(), ac = accent(), col = STATE_RGB[st] || ac;
      const lvl = window.__aegisOrb && window.__aegisOrb.getLevel ? window.__aegisOrb.getLevel() : 0;
      const want = { offline: 0.2, idle: 0.9, listening: 1.6, thinking: 3.4, speaking: 2.0 }[st] || 0.9;
      speed += (want - speed) * Math.min(1, dt * 4);
      sweep = (sweep + dt * speed) % TAU;
      if ((tick += dt) > 0.4) { tick = 0; counts = { tasks: num("task-count"), reminders: num("remind-count"), memory: num("memory-count") }; for (const k in counts) chips[k].textContent = counts[k]; }
      d.status.textContent = STATE_LABEL[st] || "";
      d.box.style.setProperty("--dc", col.map((x) => x | 0).join(","));

      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 4;
      // field
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, rgba(col, 0.1)); g.addColorStop(1, rgba(col, 0.01));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
      ctx.lineWidth = 1;
      [0.3, 0.58, 0.8, 1].forEach((f, i) => { ctx.strokeStyle = rgba(col, i === 3 ? 0.5 : 0.2 + lvl * 0.25); ctx.beginPath(); ctx.arc(cx, cy, R * f * (1 + (i === 3 ? 0 : lvl * 0.02)), 0, TAU); ctx.stroke(); });
      ctx.strokeStyle = rgba(col, 0.14);
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      for (let i = 0; i < 72; i++) { const a = (i / 72) * TAU, l = i % 6 === 0 ? 7 : 3; ctx.strokeStyle = rgba(col, i % 6 === 0 ? 0.55 : 0.22); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.lineTo(cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l)); ctx.stroke(); }
      // sweep with a fading trail
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 46; i++) {
        const a1 = sweep - i * 0.026, a0 = a1 - 0.03;
        ctx.fillStyle = rgba(col, 0.3 * Math.pow(1 - i / 46, 2));
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1 + 0.004); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();
      // real items as blips: bright when the sweep has just passed, then they settle
      kinds.forEach(([k, , c]) => {
        const n = Math.min(14, counts[k]), [r0, r1] = rings[k];
        for (let i = 0; i < n; i++) {
          const a = seeded(i, k.length * 7) * TAU, rr = (r0 + (r1 - r0) * seeded(i, k.length * 13 + 5)) * R;
          const age = ((sweep - a) % TAU + TAU) % TAU;
          const glow = Math.max(0, 1 - age / 2.4);
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
          if (age < 0.9) { ctx.strokeStyle = rgba(c, (1 - age / 0.9) * 0.8); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 3 + age * 16, 0, TAU); ctx.stroke(); }
          ctx.fillStyle = rgba(c, 0.35 + 0.65 * glow); ctx.beginPath(); ctx.arc(x, y, 2.6 + glow * 1.6, 0, TAU); ctx.fill();
        }
      });
      // core
      const cr = 3 + lvl * 5 + (st === "thinking" ? 1.5 * Math.sin(now / 120) : 0);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 3);
      cg.addColorStop(0, "rgba(255,255,255,.95)"); cg.addColorStop(0.35, rgba(col, 0.8)); cg.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr * 3, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    return { d, frame };
  }

  // ------------------------------------------------------------------ RIGHT: live telemetry
  function telemetry() {
    const rail = $("right");
    const d = dock(rail, null, { title: "Live telemetry", alt: "Scrolling charts of voice level, frame rate and memory use" });
    if (!d) return;
    const N = 80;
    const lanes = [
      { key: "voice", label: "Voice level", unit: "%", max: 100, get: () => (window.__aegisOrb && window.__aegisOrb.getLevel ? window.__aegisOrb.getLevel() * 100 : 0), data: [] },
      { key: "fps", label: "Frame rate", unit: " fps", max: 70, get: null, data: [] },
    ];
    if (performance && performance.memory) lanes.push({ key: "heap", label: "JS heap", unit: " MB", max: null, get: () => performance.memory.usedJSHeapSize / 1048576, data: [] });
    else if (navigator.connection && navigator.connection.downlink != null) lanes.push({ key: "net", label: "Network", unit: " Mb/s", max: null, get: () => navigator.connection.downlink, data: [] });
    lanes.forEach((l) => { l.chip = el("span", "dl-chip"); l.chip.innerHTML = "<i></i><em></em><b>-</b>"; l.chip.querySelector("em").textContent = l.label; d.legend.appendChild(l.chip); l.val = l.chip.querySelector("b"); for (let i = 0; i < N; i++) l.data.push(0); });
    const tones = [[47, 227, 255], [52, 230, 150], [255, 176, 46]];
    lanes.forEach((l, i) => { l.chip.querySelector("i").style.background = rgba(tones[i], 1); });
    let last = 0, acc = 0, fps = 60, frames = 0, fAcc = 0;

    function frame(now) {
      const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
      frames++; fAcc += dt;
      if (fAcc >= 0.5) { fps = frames / fAcc; frames = 0; fAcc = 0; }
      acc += dt;
      while (acc >= 0.1) {
        acc -= 0.1;
        lanes.forEach((l) => { const v = l.key === "fps" ? fps : l.get(); l.data.push(v); l.data.shift(); });
      }
      const { ctx, w, h } = sized(d.canvas);
      d.status.textContent = STATE_LABEL[stateOf()] || "";
      ctx.clearRect(0, 0, w, h);
      const laneH = h / lanes.length;
      lanes.forEach((l, i) => {
        const y0 = i * laneH + 4, hh = laneH - 10, c = tones[i];
        const max = l.max || Math.max(10, Math.max.apply(null, l.data) * 1.25);
        const cur = l.data[N - 1];
        l.val.textContent = (l.key === "voice" ? Math.round(cur) : l.key === "fps" ? Math.round(cur) : cur.toFixed(l.key === "net" ? 1 : 0)) + l.unit;
        // grid
        ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y0 + hh + 0.5); ctx.lineTo(w, y0 + hh + 0.5); ctx.moveTo(0, y0 + hh / 2); ctx.lineTo(w, y0 + hh / 2); ctx.stroke();
        // area + line
        const pt = (j) => [(j / (N - 1)) * w, y0 + hh - Math.min(1, l.data[j] / max) * hh];
        const grad = ctx.createLinearGradient(0, y0, 0, y0 + hh);
        grad.addColorStop(0, rgba(c, 0.4)); grad.addColorStop(1, rgba(c, 0));
        ctx.beginPath(); ctx.moveTo(0, y0 + hh);
        for (let j = 0; j < N; j++) { const [x, y] = pt(j); ctx.lineTo(x, y); }
        ctx.lineTo(w, y0 + hh); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
        ctx.beginPath();
        for (let j = 0; j < N; j++) { const [x, y] = pt(j); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.strokeStyle = rgba(c, 0.95); ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke();
        const [ex, ey] = pt(N - 1);
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex - 2, ey, 2.4, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(c, 0.25); ctx.beginPath(); ctx.arc(ex - 2, ey, 5 + 2 * Math.sin(now / 260), 0, TAU); ctx.fill();
      });
    }
    return { d, frame };
  }

  // ------------------------------------------------------------------ runner
  const live = [radar(), telemetry()].filter(Boolean);
  let raf = 0;
  function run(now) {
    raf = 0;
    if (document.hidden) return;
    live.forEach((x) => { if (x.d.canvas.offsetParent !== null) x.frame(now); });   // skip docks inside a closed drawer
    if (!reduce) raf = requestAnimationFrame(run);
  }
  const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(run); };
  document.addEventListener("visibilitychange", kick);
  if (reduce) setInterval(() => run(performance.now()), 1000); else kick();
  window.AegisDock = { refresh: kick };
})();
