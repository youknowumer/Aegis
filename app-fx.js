// Aegis app v7 motion: pointer parallax depth, ambient dust, pointer-lit panels, card tilt, click ripples, counter bumps.
// Pauses when the tab is hidden, the app is not showing, Calm mode is on, or the user prefers reduced motion.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  if (!app) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const calm = () => document.body.classList.contains("calm");
  const live = () => !app.classList.contains("hidden") && !document.hidden && !calm();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---- send button launch + counters + click ripples (work even with reduced motion off only)
  const sendBtn = $("send-btn");
  if (sendBtn && $("composer")) {
    $("composer").addEventListener("submit", () => {
      if (reduce) return;
      sendBtn.classList.remove("launch"); void sendBtn.offsetWidth; sendBtn.classList.add("launch");
    });
    sendBtn.addEventListener("animationend", (e) => { if (e.target.tagName === "svg" || e.target === sendBtn) sendBtn.classList.remove("launch"); });
  }
  if (!reduce) {
    document.querySelectorAll(".count").forEach((c) => {
      let first = true;
      new MutationObserver(() => {
        if (first) { first = false; return; }
        c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
      }).observe(c, { childList: true, characterData: true, subtree: true });
      c.addEventListener("animationend", () => c.classList.remove("bump"));
    });
    document.addEventListener("pointerdown", (e) => {
      if (calm()) return;
      const t = e.target.closest && e.target.closest(".qcard, .btn.primary");
      if (!t) return;
      const r = t.getBoundingClientRect(), s = document.createElement("span");
      s.className = "fx-rip"; s.style.left = e.clientX - r.left + "px"; s.style.top = e.clientY - r.top + "px";
      t.appendChild(s); setTimeout(() => s.remove(), 700);
    }, { passive: true });
  }
  if (reduce) return;

  // ---- orb ripples
  const zone = document.querySelector(".orb-zone");
  if (zone) {
    const r = document.createElement("div");
    r.className = "orb-ripples"; r.setAttribute("aria-hidden", "true"); r.innerHTML = "<i></i><i></i><i></i>";
    zone.insertBefore(r, zone.firstChild);
  }

  // ---- pointer-lit panels + card tilt (event delegation, one rAF per move)
  if (fine) {
    let pending = null, raf = 0;
    const apply = () => {
      raf = 0; const e = pending; if (!e) return;
      const t = e.target.closest && e.target.closest(".blk, .qcard");
      if (!t) return;
      const r = t.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      t.style.setProperty("--mx", x + "px"); t.style.setProperty("--my", y + "px");
      if (t.classList.contains("qcard")) {
        t.style.setProperty("--ry", ((x / r.width - 0.5) * 12).toFixed(2) + "deg");
        t.style.setProperty("--rx", ((0.5 - y / r.height) * 10).toFixed(2) + "deg");
      }
    };
    document.addEventListener("pointermove", (e) => { pending = e; if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    document.addEventListener("pointerout", (e) => {
      const t = e.target.closest && e.target.closest(".qcard");
      if (t && !t.contains(e.relatedTarget)) { t.style.setProperty("--rx", "0deg"); t.style.setProperty("--ry", "0deg"); }
    }, { passive: true });
  }

  // ---- parallax depth: layers drift by different amounts so the screen reads as stacked planes
  const layer = (sel, px, py, tilt) => ({ el: document.querySelector(sel), px, py, tilt: tilt || 0 });
  const layers = [
    layer(".bg-aurora", -26, -16), layer(".bg-grid", -12, -8),
    layer(".rail.left", -3, -2), layer(".rail.right", -3, -2),
    layer(".orb-zone", 7, 5), layer(".orb-deco", 15, 10, 7),
  ].filter((l) => l.el);
  const cur = { x: 0, y: 0 }, tgt = { x: 0, y: 0 };
  let prl = 0;
  function paint() {
    prl = 0;
    if (!live()) return;
    cur.x += (tgt.x - cur.x) * 0.07; cur.y += (tgt.y - cur.y) * 0.07;
    layers.forEach((l) => {
      l.el.style.translate = (cur.x * l.px).toFixed(2) + "px " + (cur.y * l.py).toFixed(2) + "px";
      if (l.tilt) l.el.style.transform = `perspective(900px) rotateX(${(-cur.y * l.tilt).toFixed(2)}deg) rotateY(${(cur.x * l.tilt).toFixed(2)}deg)`;
    });
    if (Math.abs(tgt.x - cur.x) + Math.abs(tgt.y - cur.y) > 0.002) prl = requestAnimationFrame(paint);
  }
  if (fine) {
    window.addEventListener("pointermove", (e) => {
      tgt.x = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1); tgt.y = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
      if (!prl) prl = requestAnimationFrame(paint);
    }, { passive: true });
    document.addEventListener("pointerleave", () => { tgt.x = tgt.y = 0; if (!prl) prl = requestAnimationFrame(paint); });
  }

  // ---- ambient dust: 46 motes at different depths, drawn from one pre-rendered sprite
  const cv = document.createElement("canvas");
  cv.id = "fx-dust"; cv.setAttribute("aria-hidden", "true");
  const bg = document.querySelector(".bg-grid");
  (bg && bg.parentNode || document.body).insertBefore(cv, bg ? bg.nextSibling : document.body.firstChild);
  const ctx = cv.getContext("2d");
  const sprite = document.createElement("canvas"); sprite.width = sprite.height = 32;
  let spriteRgb = "";
  function makeSprite() {
    const rgb = getComputedStyle(document.documentElement).getPropertyValue("--ac").trim() || "47,227,255";
    if (rgb === spriteRgb) return; spriteRgb = rgb;
    const s = sprite.getContext("2d"); s.clearRect(0, 0, 32, 32);
    const g = s.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.25, `rgba(${rgb},.7)`); g.addColorStop(1, `rgba(${rgb},0)`);
    s.fillStyle = g; s.fillRect(0, 0, 32, 32);
  }
  let W = 0, H = 0, dpr = 1;
  function resize() { dpr = Math.min(1, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; }
  resize(); window.addEventListener("resize", resize);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const motes = Array.from({ length: 38 }, () => ({ x: Math.random(), y: Math.random(), z: rnd(0.15, 1), ph: rnd(0, 6.28), sp: rnd(0.4, 1) }));
  let last = 0, spriteT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!live()) { last = 0; return; }
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if ((spriteT += dt) > 2) { spriteT = 0; makeSprite(); }
    if (!spriteRgb) makeSprite();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    for (const m of motes) {
      m.y -= dt * 0.012 * m.z * m.sp; m.ph += dt * m.sp;
      if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      const x = m.x * W + Math.sin(m.ph) * 14 * m.z - cur.x * 38 * m.z;
      const y = m.y * H - cur.y * 24 * m.z;
      const s = 5 + m.z * 22;
      ctx.globalAlpha = (0.12 + m.z * 0.4) * (0.6 + 0.4 * Math.sin(m.ph * 1.6));
      ctx.drawImage(sprite, x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(frame);
})();
