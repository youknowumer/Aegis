// Aegis landing: hero scene. Particles fly in and assemble into the Aegis shield, hold, then dissolve into a living network that
// follows the pointer; a scan ring sweeps out when the shield forms. Pauses off-screen / hidden tab. Static for reduced motion.
(() => {
  "use strict";
  const sec = document.querySelector(".hero-sec");
  if (!sec) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;

  const cv = document.createElement("canvas");
  cv.id = "hero-fx"; cv.setAttribute("aria-hidden", "true");
  sec.insertBefore(cv, sec.firstChild);
  const ctx = cv.getContext("2d");
  if (!ctx) return;

  // ---- sample the shield mark (same path as the logo) into target points
  const NS = "http://www.w3.org/2000/svg";
  function sample(d, n) {
    const p = document.createElementNS(NS, "path"); p.setAttribute("d", d);
    const L = p.getTotalLength(), out = [];
    for (let i = 0; i < n; i++) { const pt = p.getPointAtLength((i / n) * L); out.push([pt.x / 32, pt.y / 32]); }
    return out;
  }
  const small = innerWidth < 760;
  const NSH = small ? 70 : 130, NCK = small ? 14 : 26, NFREE = small ? 22 : 48;
  const shield = sample("M16 2l11 4v9c0 7-4.6 12.2-11 15C9.6 27.2 5 22 5 15V6z", NSH);
  const check = sample("M11 16l4 4 7-8", NCK);
  const targets = shield.concat(check);

  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, size = 0;
  const P = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const color = () => getComputedStyle(document.documentElement).getPropertyValue("--teal").trim() || "#2fc9bd";
  let tint = color(), amber = "#f5b83d";

  function layout() {
    const r = sec.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    size = Math.min(H * 0.82, W * 0.5, 520);
    // the shield sits behind the demo window on wide screens, centred on small ones
    cx = W > 980 ? W * 0.74 : W * 0.5; cy = Math.min(H * 0.48, 340);
    P.forEach((q, i) => { if (q.t) { q.tx = cx + (q.t[0] - 0.5) * size; q.ty = cy + (q.t[1] - 0.5) * size; } });
  }

  for (let i = 0; i < targets.length + NFREE; i++) {
    const t = targets[i] || null;
    const a = rnd(0, Math.PI * 2), d = rnd(0.4, 1) * Math.max(innerWidth, 700);
    P.push({ t, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, sx: Math.cos(a) * d, sy: Math.sin(a) * d, delay: rnd(0, 0.9), r: rnd(1.1, 2.3), amber: !t ? false : i >= NSH && Math.random() < 0.5, ph: rnd(0, 6.28) });
  }
  layout();
  P.forEach((q) => { q.x = cx + q.sx; q.y = cy + q.sy; });

  let phase = "form", t0 = performance.now(), pulseAt = -1, mx = -999, my = -999, running = false, raf = 0, lastForm = 0;
  const ease = (x) => 1 - Math.pow(1 - x, 3);

  function enter(p) { phase = p; t0 = performance.now(); if (p === "hold") pulseAt = performance.now(); }

  function frame(now) {
    raf = 0;
    if (!running) return;
    const el = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);

    if (phase === "form" && el > 2.6) enter("hold");
    else if (phase === "hold" && el > 2.4) enter("drift");
    else if (phase === "drift" && el > 11) { enter("form"); P.forEach((q) => { q.sx = q.x - cx; q.sy = q.y - cy; }); }

    for (const q of P) {
      const wob = Math.sin(now / 900 + q.ph);
      if (q.t && (phase === "form" || phase === "hold")) {
        const k = phase === "form" ? ease(Math.min(1, Math.max(0, (el - q.delay) / 1.5))) : 1;
        const fx = phase === "form" ? cx + q.sx : q.tx, fy = phase === "form" ? cy + q.sy : q.ty;
        q.x = fx + (q.tx - fx) * k + (phase === "hold" ? wob * 0.8 : 0);
        q.y = fy + (q.ty - fy) * k + (phase === "hold" ? Math.cos(now / 800 + q.ph) * 0.8 : 0);
        q.vx = q.vy = 0;
      } else {
        // free flight: gentle swirl around the hero, soft pull to keep everyone on screen
        q.vx += Math.cos(now / 2400 + q.ph * 3) * 0.012 + (cx - q.x) * 0.00004;
        q.vy += Math.sin(now / 2700 + q.ph * 2) * 0.012 + (cy - q.y) * 0.00004;
        if (!q.t) { q.vx += (Math.random() - 0.5) * 0.01; q.vy += (Math.random() - 0.5) * 0.01; }
        q.x += q.vx; q.y += q.vy; q.vx *= 0.985; q.vy *= 0.985;
        if (q.x < -40) q.x = W + 40; else if (q.x > W + 40) q.x = -40;
        if (q.y < -40) q.y = H + 40; else if (q.y > H + 40) q.y = -40;
      }
      if (fine) {                                   // pointer pushes particles aside
        const dx = q.x - mx, dy = q.y - my, d2 = dx * dx + dy * dy;
        if (d2 < 14400 && d2 > 1) { const d = Math.sqrt(d2), f = (120 - d) / 120; q.x += (dx / d) * f * 3.2; q.y += (dy / d) * f * 3.2; }
      }
    }

    // network lines
    const maxD = phase === "drift" ? 120 : 62, max2 = maxD * maxD;
    ctx.lineWidth = 1;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      for (let j = i + 1; j < P.length; j++) {
        const b = P[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < max2) {
          ctx.globalAlpha = (1 - d2 / max2) * (phase === "drift" ? 0.22 : 0.3);
          ctx.strokeStyle = tint;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    // dots
    for (const q of P) {
      const tw = 0.55 + 0.45 * Math.sin(now / 500 + q.ph);
      ctx.globalAlpha = (q.t ? 0.9 : 0.6) * tw + 0.1;
      ctx.fillStyle = q.amber ? amber : tint;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.fill();
    }
    // scan ring when the shield completes
    if (pulseAt > 0) {
      const pe = (now - pulseAt) / 1400;
      if (pe < 1) {
        ctx.globalAlpha = (1 - pe) * 0.55; ctx.strokeStyle = tint; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, size * (0.25 + pe * 0.95), 0, 6.2832); ctx.stroke();
      } else pulseAt = -1;
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  function start() { if (running || document.hidden) return; running = true; if (!raf) raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { threshold: 0 }).observe(sec);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  new ResizeObserver(() => layout()).observe(sec);
  if (fine) {
    sec.addEventListener("pointermove", (e) => { const r = sec.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; }, { passive: true });
    sec.addEventListener("pointerleave", () => { mx = my = -999; });
  }
  // follow theme changes (the toggle sets data-theme on <html>)
  new MutationObserver(() => { tint = color(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  requestAnimationFrame(() => cv.classList.add("on"));
  start();
})();
