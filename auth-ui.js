// Aegis sign-in / sign-up motion layer (pairs with auth-ui.css).
// Same language as the landing page: red / green / blue edge lights drifting around the border, a dot field that
// follows the cursor, a boot counter, scramble text and a card that tips toward the pointer.
// Runs only while #auth is visible, pauses when the tab is hidden, and respects prefers-reduced-motion.
(() => {
  "use strict";
  const auth = document.getElementById("auth");
  const cv = document.getElementById("auth-gl");
  if (!auth) return;
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  let visible = false, shownOnce = false, startedAt = 0, raf = 0, clockTimer = 0, bootTimer = 0, goTimer = 0, leaveTimer = 0;

  /* ================================================================ scramble text (monospace, so nothing jumps) */
  function scramble(el, text, dur = 900, delay = 0) {
    if (!el) return;
    el._final = text;
    if (reduce) { el.textContent = text; return; }
    const id = (el._sid = (el._sid || 0) + 1);
    const t0 = performance.now() + delay, n = text.length;
    const step = (now) => {
      if (el._sid !== id) return;
      const t = (now - t0) / dur;
      let out = "";
      for (let i = 0; i < n; i++) {
        const c = text[i];
        if (c === " " || c === "\n") { out += c; continue; }
        out += t >= (i / n) * 0.72 + 0.28 ? c : ALPHA[(Math.random() * ALPHA.length) | 0];
      }
      el.textContent = t >= 1 ? text : out;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const scrambleAll = () => {
    const title = $("auth-title"), sub = $("auth-sub");
    auth.querySelectorAll("[data-scramble]").forEach((el) => {
      const final = el._final || el.textContent;
      el._final = final;
      scramble(el, final, el === title ? 1000 : 1400, el === title ? 120 : 260);
    });
    if (sub) scramble(sub, sub.textContent, 800, 420);
  };

  /* ================================================================ boot counter -> curtain -> staged reveal */
  function boot() {
    clearTimeout(bootTimer); clearTimeout(goTimer); clearTimeout(leaveTimer);
    body.classList.remove("auth-go", "auth-leave");
    const fill = $("al-fill"), num = $("al-n"), txt = $("al-t");
    const done = () => {
      body.classList.add("auth-go", "auth-leave");
      scrambleAll();
      leaveTimer = setTimeout(() => body.classList.remove("auth-boot", "auth-leave"), 800);
      goTimer = setTimeout(() => body.classList.remove("auth-go"), 3000);
    };
    if (reduce || !fill) { body.classList.remove("auth-boot"); body.classList.add("auth-go"); scrambleAll(); goTimer = setTimeout(() => body.classList.remove("auth-go"), 1200); return; }
    const dur = shownOnce ? 650 : 1250, t0 = performance.now();
    const words = ["OPENING SECURE CHANNEL", "CHECKING SERVER", "LOADING INTERFACE", "READY"];
    body.classList.add("auth-boot");
    const tick = (now) => {
      if (!visible) return;
      const k = clamp((now - t0) / dur), e = 1 - Math.pow(1 - k, 2.2);
      const pct = Math.round(e * 100);
      fill.style.transform = "scaleX(" + e.toFixed(3) + ")";
      num.textContent = String(pct).padStart(3, "0");
      txt.textContent = words[k < 0.34 ? 0 : k < 0.7 ? 1 : k < 1 ? 2 : 3];
      if (k < 1) requestAnimationFrame(tick); else bootTimer = setTimeout(done, 140);
    };
    requestAnimationFrame(tick);
    bootTimer = setTimeout(() => { if (body.classList.contains("auth-boot") && !body.classList.contains("auth-go")) done(); }, dur + 1500); // safety
  }

  /* ================================================================ backdrop: edge lights + cursor dot field */
  const ctx = cv && cv.getContext ? cv.getContext("2d") : null;
  const low = document.createElement("canvas"), lctx = low.getContext("2d");
  let W = 0, H = 0, dpr = 1, S = 28, cols = 0, rows = 0, ox = 0, oy = 0;
  const ptr = { x: 0, y: 0, tx: 0, ty: 0, last: 0, on: false };
  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    low.width = Math.max(2, Math.ceil(W / 8)); low.height = Math.max(2, Math.ceil(H / 8));
    S = clamp(W / 62, 22, 34);
    cols = Math.ceil(W / S) + 2; rows = Math.ceil(H / S) + 2;
    ox = (W - (cols - 1) * S) / 2; oy = (H - (rows - 1) * S) / 2;
    if (!ptr.on) { ptr.x = ptr.tx = W / 2; ptr.y = ptr.ty = H / 2; }
    if (visible && (reduce || !raf)) draw(0);
  }

  // [r, g, b, alpha, speed, phase]: three lights on three different rhythms, same trick as the landing's glass pass
  const LIGHTS = [[255, 45, 111, 0.66, 0.55, 0.0], [20, 255, 224, 0.44, -0.47, 2.3], [70, 80, 255, 0.74, 0.38, 4.6]];
  function draw(t) {
    if (!ctx) return;
    const intro = shownOnce ? clamp((t - startedAt) / 2.2) : clamp((t - startedAt) / 2.8);
    const lw = low.width, lh = low.height;
    // 1) edge lights on a small canvas, centre erased, then scaled up (the scaling is the blur)
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(0, 0, lw, lh);
    lctx.globalCompositeOperation = "lighter";
    const cx = lw / 2, cy = lh / 2, rx = lw * 0.6, ry = lh * 0.6, rad = Math.max(lw, lh) * 0.52;
    for (const [r, g, b, a, sp, ph] of LIGHTS) {
      const ang = sp * t + ph + 0.9 * Math.sin(t * 0.21 + ph);
      const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
      const gr = lctx.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, "rgba(" + r + "," + g + "," + b + "," + a + ")");
      gr.addColorStop(0.55, "rgba(" + r + "," + g + "," + b + "," + (a * 0.3) + ")");
      gr.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
      lctx.fillStyle = gr; lctx.fillRect(0, 0, lw, lh);
    }
    lctx.globalCompositeOperation = "destination-out";
    const R = Math.hypot(lw, lh) / 2, er = lctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    er.addColorStop(0, "rgba(0,0,0,1)"); er.addColorStop(0.4, "rgba(0,0,0,.95)"); er.addColorStop(0.66, "rgba(0,0,0,.5)"); er.addColorStop(0.9, "rgba(0,0,0,0)");
    lctx.fillStyle = er; lctx.fillRect(0, 0, lw, lh);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#0f0e14"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55 + 0.45 * intro;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(low, 0, 0, W, H);
    ctx.globalAlpha = 1;

    // 2) pointer: follows the cursor, drifts on its own after a pause
    if (!fine || t - ptr.last > 2.6) { ptr.tx = W * (0.5 + 0.32 * Math.sin(t * 0.31)); ptr.ty = H * (0.5 + 0.26 * Math.sin(t * 0.23 + 1.3)); }
    ptr.x += (ptr.tx - ptr.x) * 0.1; ptr.y += (ptr.ty - ptr.y) * 0.1;

    // 3) dot field: hairline grid of dots, a slow wave, a pool of light under the cursor with a little RGB split
    ctx.globalCompositeOperation = "source-over";
    const mx = ptr.x, my = ptr.y, inv = 1 / (2 * 190 * 190), mcx = W / 2, mcy = H / 2, reach = intro * Math.hypot(W, H) * 0.75;
    for (let j = 0; j < rows; j++) {
      const by = oy + j * S;
      for (let i = 0; i < cols; i++) {
        const bx = ox + i * S;
        const dcx = bx - mcx, dcy = by - mcy;
        const dc = Math.sqrt(dcx * dcx + dcy * dcy);
        const born = clamp((reach - dc) / 260);          // the field assembles outward from the centre
        if (born <= 0) continue;
        const dx = bx - mx, dy = by - my, f = Math.exp(-(dx * dx + dy * dy) * inv);
        const wave = 0.5 + 0.5 * Math.sin(dc * 0.011 - t * 0.9);
        const a = (0.11 + 0.08 * wave + 0.85 * f) * born;
        if (a < 0.02) continue;
        const x = bx + (mx - bx) * 0.12 * f, y = by + (my - by) * 0.12 * f;
        const s = (1 + 1.7 * f) * (0.4 + 0.6 * born);
        if (f > 0.3) {
          ctx.fillStyle = "rgba(255,45,111," + (0.55 * f * born).toFixed(3) + ")"; ctx.fillRect(x - 1.3 - s / 2, y - s / 2, s, s);
          ctx.fillStyle = "rgba(70,80,255," + (0.6 * f * born).toFixed(3) + ")"; ctx.fillRect(x + 1.3 - s / 2, y - s / 2, s, s);
        }
        ctx.fillStyle = "rgba(231,228,238," + a.toFixed(3) + ")";
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
    // 4) soft vignette keeps the card readable
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, "rgba(15,14,20,.55)"); v.addColorStop(1, "rgba(15,14,20,0)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  function loop(ms) {
    raf = 0;
    if (!visible || document.hidden) return;
    draw(ms / 1000);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    resize();
    startedAt = performance.now() / 1000;
    if (reduce) { draw(startedAt + 3); return; }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  /* ================================================================ card tilt + pointer */
  const card = $("auth-card");
  window.addEventListener("pointermove", (e) => {
    if (!visible) return;
    ptr.on = true; ptr.tx = e.clientX; ptr.ty = e.clientY; ptr.last = performance.now() / 1000;
    if (card && fine && !reduce && window.innerWidth > 1100) {
      const r = card.getBoundingClientRect();
      const nx = clamp(((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)), -1, 1);
      const ny = clamp(((e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)), -1, 1);
      card.style.setProperty("--ry", (nx * 4).toFixed(2) + "deg");
      card.style.setProperty("--rx", (-ny * 3.2).toFixed(2) + "deg");
    }
  }, { passive: true });
  document.addEventListener("pointerleave", () => { if (card) { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); } });
  window.addEventListener("resize", () => { if (visible) resize(); });
  document.addEventListener("visibilitychange", () => { if (visible && !document.hidden && !raf && !reduce) raf = requestAnimationFrame(loop); });

  /* ================================================================ tab switch + live clock */
  let modeEvents = 0;
  document.addEventListener("aegis:authmode", () => {
    modeEvents++;
    if (!card || modeEvents < 2 || !visible) return;       // the first event is the page setting its initial mode
    card.classList.remove("swap"); void card.offsetWidth; card.classList.add("swap");
    setTimeout(() => card.classList.remove("swap"), 650);
    const sub = $("auth-sub"); if (sub) scramble(sub, sub.textContent, 520);
  });
  const clock = $("auth-clock");
  const tickClock = () => {
    if (!clock) return;
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    clock.textContent = "ENCRYPTED \u00b7 " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  };

  /* ================================================================ show / hide */
  function sync() {
    const now = !auth.classList.contains("hidden");
    if (now === visible) return;
    visible = now;
    body.classList.toggle("on-auth", now);
    if (now) {
      start(); boot(); shownOnce = true;
      tickClock(); clearInterval(clockTimer); clockTimer = setInterval(tickClock, 1000);
    } else {
      cancelAnimationFrame(raf); raf = 0; clearInterval(clockTimer);
      clearTimeout(bootTimer); clearTimeout(goTimer); clearTimeout(leaveTimer);
      body.classList.remove("auth-boot", "auth-leave", "auth-go");
    }
  }
  new MutationObserver(sync).observe(auth, { attributes: true, attributeFilter: ["class"] });
  sync();
})();
