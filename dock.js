// Aegis live docks: a fixed "live view" pinned to the bottom of each side rail, so the rails are never empty.
//   Left  : LIVE SCAN      radar whose blips are your REAL tasks, reminders and memories (counts read from the panels);
//                          sweep speed and colour follow the assistant's state.
//   Right : LIVE TELEMETRY four scrolling traces of real measurements: server latency, frame rate, main-thread delay and
//                          JS heap (Chrome) or network downlink. Nothing here is simulated.
// Rendering pauses when the tab is hidden or the rail is closed, and draws a still frame for "reduce motion".
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const num = (id) => { const e = $(id); return e ? Math.max(0, parseInt(e.textContent, 10) || 0) : 0; };
  const STATE_RGB = { offline: [120, 118, 135], listening: [52, 230, 150], thinking: [140, 130, 255] };
  const STATE_LABEL = { offline: "Offline", idle: "Standing by", listening: "Listening", thinking: "Working", speaking: "Speaking" };
  const accent = () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--ac").split(",").map((x) => parseFloat(x));
    return v.length === 3 && v.every((x) => x >= 0) ? v : [222, 216, 250];
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
    const kinds = [["tasks", "Tasks", [222, 216, 250]], ["reminders", "Reminders", [255, 176, 46]], ["memory", "Memory", [168, 160, 255]]];
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
  // Four real measurements, sampled 10 times a second over a 12 second window:
  //   Server latency  round trip of a tiny /healthz request every 1.2 s (held between probes)
  //   Frame rate      instantaneous, smoothed, from real animation frames
  //   Main thread     worst timer delay in each sample (how long the page was too busy to respond)
  //   JS heap         Chrome only; otherwise the network downlink the browser reports
  function telemetry() {
    const rail = $("right");
    const d = dock(rail, null, { title: "Live telemetry", alt: "Scrolling charts of server latency, frame rate, main-thread delay and memory use" });
    if (!d) return;
    const N = 120, HZ = 10;
    const mono = '600 11px ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace';
    const niceCeil = (v) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-6)))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
    const GOOD = [52, 230, 150], WARN = [255, 176, 46], BAD = [248, 113, 113];
    const grade = (v, warn, bad, invert) => {
      if (v == null || isNaN(v)) return [141, 138, 154];
      if (invert) return v < bad ? BAD : v < warn ? WARN : GOOD;
      return v > bad ? BAD : v > warn ? WARN : GOOD;
    };

    // ---- probes
    let rtt = null, probing = false, nextProbe = 0, lagMax = 0, slow = 0;
    async function probe() {
      if (probing) return; probing = true;
      const base = window.__aegisApi ? window.__aegisApi() : "";
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 4000), t0 = performance.now();
      try { const r = await fetch(base + "/healthz?_=" + Date.now(), { cache: "no-store", signal: ctl.signal }); rtt = r.ok ? performance.now() - t0 : null; }
      catch { rtt = null; }
      clearTimeout(to); probing = false;
    }
    let expect = performance.now() + 50;
    setInterval(() => { const n = performance.now(); lagMax = Math.max(lagMax, n - expect); expect = n + 50; }, 50);

    const hasHeap = !!(performance && performance.memory);
    const hasNet = !hasHeap && navigator.connection && navigator.connection.downlink != null;
    const lanes = [
      { key: "lat", label: "Server latency", unit: "ms", fixedMax: null, floor: 100, grade: (v) => grade(v, 250, 600), dec: 0, ref: 250, data: [] },
      { key: "fps", label: "Frame rate", unit: "fps", fixedMax: 70, grade: (v) => grade(v, 45, 25, true), dec: 0, ref: 60, data: [] },
      { key: "lag", label: "Main thread delay", unit: "ms", fixedMax: null, floor: 20, grade: (v) => grade(v, 50, 120), dec: 0, ref: 50, data: [] },
    ];
    if (hasHeap) lanes.push({ key: "mem", label: "JS heap", unit: "MB", zoom: true, grade: () => [140, 130, 255], dec: 1, data: [] });
    else if (hasNet) lanes.push({ key: "net", label: "Downlink", unit: "Mb/s", floor: 5, grade: () => [140, 130, 255], dec: 1, data: [] });
    lanes.forEach((l) => { l.data = new Array(N).fill(NaN); l.lo = 0; l.hi = l.fixedMax || l.floor || 10; });

    const chips = {};
    [["win", "Window"], ["slow", "Slow frames"], ["net", "Link"]].forEach(([k, label]) => {
      const c = el("span", "dl-chip"); c.innerHTML = "<em></em><b>-</b>"; c.querySelector("em").textContent = label;
      d.legend.appendChild(c); chips[k] = c.querySelector("b");
    });
    chips.win.textContent = Math.round(N / HZ) + " s";

    let last = 0, acc = 0, fps = 60, scroll = 0, since = 0, mem0 = null;
    const fmt = (v, dec) => (v == null || isNaN(v) ? "-" : v.toFixed(dec));

    function frame(now) {
      const dt = Math.min(0.25, (now - (last || now)) / 1000); last = now;
      if (dt > 0) { fps += (1 / dt - fps) * 0.12; if (dt > 0.05) slow++; }
      if (now > nextProbe && !document.hidden && $("app") && !$("app").classList.contains("hidden")) { nextProbe = now + 1200; probe(); }
      acc += dt;
      while (acc >= 1 / HZ) {
        acc -= 1 / HZ; since++;
        const v = { lat: rtt == null ? NaN : rtt, fps, lag: lagMax, mem: hasHeap ? performance.memory.usedJSHeapSize / 1048576 : NaN, net: hasNet ? navigator.connection.downlink : NaN };
        lagMax = 0;
        lanes.forEach((l) => { l.data.push(v[l.key]); l.data.shift(); });
      }
      scroll = (scroll + dt * 40) % 40;

      const { ctx, w, h } = sized(d.canvas);
      d.status.textContent = "LIVE · " + HZ + " Hz";
      chips.slow.textContent = String(slow);
      chips.net.textContent = navigator.connection && navigator.connection.effectiveType ? navigator.connection.effectiveType.toUpperCase() : (navigator.onLine ? "Online" : "Offline");
      ctx.clearRect(0, 0, w, h);

      const rows = h < 200 && lanes.length > 3 ? lanes.slice(0, 3) : lanes;
      const laneH = h / rows.length, padL = 0, plotW = w - padL;
      rows.forEach((l, i) => {
        const top = i * laneH, head = 13, y0 = top + head + 3, hh = laneH - head - 8;
        const fin = l.data.filter((x) => !isNaN(x)), cur = l.data[N - 1];
        // scale: smoothed target so the axis does not jitter
        let tlo = 0, thi;
        if (l.fixedMax) thi = l.fixedMax;
        else if (l.zoom && fin.length) { const mn = Math.min.apply(null, fin), mx = Math.max.apply(null, fin); const span = Math.max(2, mx - mn); tlo = Math.max(0, mn - span * 0.3); thi = mx + span * 0.3; }
        else thi = niceCeil(Math.max(l.floor || 10, (fin.length ? Math.max.apply(null, fin) : 0) * 1.25));
        l.lo += (tlo - l.lo) * 0.1; l.hi += (thi - l.hi) * 0.1;
        const col = l.grade(isNaN(cur) ? null : cur);
        const yv = (v) => y0 + hh - Math.max(0, Math.min(1, (v - l.lo) / Math.max(1e-6, l.hi - l.lo))) * hh;
        const xv = (j) => padL + (j / (N - 1)) * plotW;

        // lane separator
        if (i) { ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(w, top + 0.5); ctx.stroke(); }
        // header: label left, value right
        ctx.font = '600 9.5px "Segoe UI", system-ui, sans-serif'; ctx.textBaseline = "top"; ctx.textAlign = "left";
        ctx.fillStyle = "rgba(180,192,212,.75)"; ctx.fillText(l.label.toUpperCase(), 0, top + 5);
        ctx.font = mono; ctx.textAlign = "right";
        const none = l.key === "lat" && isNaN(cur);
        ctx.fillStyle = rgba(col, 1);
        ctx.fillText(none ? "no link" : fmt(cur, l.dec) + " " + l.unit, w, top + 4);
        if (!none && fin.length > 5) {
          const avg = fin.reduce((a, b) => a + b, 0) / fin.length;
          ctx.font = '500 9.5px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = "rgba(141,138,154,.9)";
          const vw = (function () { ctx.font = mono; return ctx.measureText(fmt(cur, l.dec) + " " + l.unit).width; })();
          ctx.font = '500 9.5px "Segoe UI", system-ui, sans-serif'; ctx.fillText("avg " + fmt(avg, l.dec), w - vw - 8, top + 5);
        }

        // moving time grid + horizontal guides
        ctx.strokeStyle = "rgba(255,255,255,.045)"; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = plotW - scroll; x > 0; x -= 40) { ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, y0 + hh); }
        ctx.moveTo(0, y0 + hh + 0.5); ctx.lineTo(w, y0 + hh + 0.5);
        ctx.moveTo(0, y0 + hh / 2 + 0.5); ctx.lineTo(w, y0 + hh / 2 + 0.5);
        ctx.stroke();
        // reference line (target / warning level)
        if (l.ref && l.ref > l.lo && l.ref < l.hi) {
          const ry = yv(l.ref); ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(255,176,46,.28)"; ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(w, ry); ctx.stroke(); ctx.setLineDash([]);
        }
        // axis max label
        ctx.font = '500 8.5px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = "left"; ctx.fillStyle = "rgba(141,138,154,.55)";
        ctx.textBaseline = "bottom"; ctx.fillText(fmt(l.hi, l.hi < 10 ? 1 : 0), 2, y0 + 9); ctx.textBaseline = "top";

        // smooth area + line, broken where there is no data
        const segs = []; let cs = [];
        l.data.forEach((v, j) => { if (isNaN(v)) { if (cs.length) segs.push(cs); cs = []; } else cs.push([xv(j), yv(v)]); });
        if (cs.length) segs.push(cs);
        const grad = ctx.createLinearGradient(0, y0, 0, y0 + hh); grad.addColorStop(0, rgba(col, 0.32)); grad.addColorStop(1, rgba(col, 0));
        segs.forEach((pts) => {
          if (pts.length < 2) return;
          const path = () => { ctx.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length - 1; k++) { const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2; ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my); } ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
          ctx.beginPath(); path(); ctx.lineTo(pts[pts.length - 1][0], y0 + hh); ctx.lineTo(pts[0][0], y0 + hh); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
          ctx.beginPath(); path(); ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
        });
        // peak marker
        if (fin.length > 10 && !l.zoom) {
          let pj = 0, pv = -1; l.data.forEach((v, j) => { if (!isNaN(v) && v > pv) { pv = v; pj = j; } });
          if (pj < N - 6 && pj > 4 && pv > (l.lo + (l.hi - l.lo) * 0.35)) { ctx.fillStyle = rgba(col, 0.9); ctx.beginPath(); ctx.arc(xv(pj), yv(pv), 1.8, 0, TAU); ctx.fill(); }
        }
        // live head
        if (!isNaN(cur)) {
          const ex = xv(N - 1) - 1, ey = yv(cur);
          ctx.fillStyle = rgba(col, 0.22 + 0.1 * Math.sin(now / 260)); ctx.beginPath(); ctx.arc(ex, ey, 6, 0, TAU); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, 2.2, 0, TAU); ctx.fill();
        }
      });
      // fade the oldest samples into the left edge
      const fade = ctx.createLinearGradient(0, 0, w * 0.12, 0);
      ctx.globalCompositeOperation = "destination-out"; fade.addColorStop(0, "rgba(0,0,0,.85)"); fade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fade; ctx.fillRect(0, 0, w * 0.12, h); ctx.globalCompositeOperation = "source-over";
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
