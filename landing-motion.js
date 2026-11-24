// Aegis landing: motion layer (v14). Hero intro trigger, pointer parallax + spotlight, drifting sparks, scroll recede,
// staggered reveal variants, button magnet. Does nothing under reduced motion except mark the hero as ready.
(() => {
  "use strict";
  const hero = document.querySelector(".hero-sec.vela");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  if (!hero) return;
  if (reduce) { hero.classList.add("go"); return; }

  // intro: wait one frame so the hidden start state paints first
  requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.add("go")));

  // ---- spotlight + sparks inside the panel
  const panel = hero.querySelector(".v-panel");
  const spot = document.createElement("i");
  spot.className = "v-spot"; spot.setAttribute("aria-hidden", "true");
  const cv = document.createElement("canvas");
  cv.className = "v-sparks"; cv.setAttribute("aria-hidden", "true");
  const grain = panel.querySelector(".v-grain");
  panel.insertBefore(spot, grain || null);
  panel.insertBefore(cv, grain || null);
  const ctx = cv.getContext("2d");
  let W = 0, H = 0, dpr = 1, running = false, raf = 0;
  const S = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  function size() {
    const r = panel.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  size();
  const N = innerWidth < 760 ? 16 : 34;
  for (let i = 0; i < N; i++) S.push({ x: rnd(0, 1), y: rnd(0, 1), r: rnd(1, 3), v: rnd(0.01, 0.04), ph: rnd(0, 6.28), dx: rnd(-0.01, 0.01) });
  let px = 0.5, py = 0.4;
  function draw(now) {
    raf = 0; if (!running) return;
    ctx.clearRect(0, 0, W, H);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    ctx.fillStyle = dark ? "rgb(47,227,255)" : "rgb(255,255,255)";
    for (const s of S) {
      s.y -= s.v * 0.004; s.x += s.dx * 0.002 + Math.sin(now / 2000 + s.ph) * 0.0003;
      if (s.y < -0.05) { s.y = 1.05; s.x = rnd(0, 1); }
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(now / 900 + s.ph));
      const X = s.x * W, Y = s.y * H;
      const near = fine ? clamp(1 - Math.hypot(X - px * W, Y - py * H) / 220) : 0;
      ctx.globalAlpha = (dark ? 0.5 : 0.8) * tw * (0.5 + near);
      ctx.beginPath(); ctx.arc(X, Y, s.r * (1 + near * 1.2), 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  }
  const start = () => { if (running || document.hidden) return; running = true; if (!raf) raf = requestAnimationFrame(draw); };
  const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
  new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop())).observe(hero);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  new ResizeObserver(size).observe(panel);

  // ---- pointer parallax (eased, one rAF)
  if (fine) {
    let tx = 0, ty = 0, x = 0, y = 0, pr = 0;
    const tick = () => {
      x += (tx - x) * 0.08; y += (ty - y) * 0.08;
      hero.style.setProperty("--mx", x.toFixed(3)); hero.style.setProperty("--my", y.toFixed(3));
      pr = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width; py = (e.clientY - r.top) / (r.height * 0.75);
      tx = px * 2 - 1; ty = clamp(py, 0, 1) * 2 - 1;
      spot.style.setProperty("--sx", px * 100 + "%"); spot.style.setProperty("--sy", clamp(py, 0, 1) * 100 + "%");
      hero.classList.add("hot");
      if (!pr) pr = requestAnimationFrame(tick);
    }, { passive: true });
    hero.addEventListener("pointerleave", () => { tx = ty = 0; hero.classList.remove("hot"); if (!pr) pr = requestAnimationFrame(tick); });
    document.querySelectorAll(".vbtn").forEach((b) => {
      b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * 0.1).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * 0.18).toFixed(1)}px)`;
      });
      b.addEventListener("pointerleave", () => { b.style.transform = ""; });
    });
  }

  // ---- scroll recede of the hero
  let tk = false;
  const onScroll = () => { if (tk) return; tk = true; requestAnimationFrame(() => {
    tk = false;
    hero.style.setProperty("--hp", clamp(scrollY / (innerHeight * 0.8)).toFixed(3));
  }); };
  addEventListener("scroll", onScroll, { passive: true });

  // ---- reveal variants + stagger for sibling groups
  const groups = ".caps, .cmds, .plans, .steps, .proofs, .nodes, .cols, .ui-points, .faq-list";
  document.querySelectorAll(groups).forEach((g) => {
    [...g.children].forEach((c, i) => {
      if (!c.hasAttribute("data-reveal")) return;
      if (!c.style.getPropertyValue("--d")) c.style.setProperty("--d", Math.min(i, 8) * 70 + "ms");
      c.dataset.m = "zoom";
    });
  });
  document.querySelectorAll(".see-copy, .vmock-copy").forEach((el) => { if (el.hasAttribute("data-reveal")) el.dataset.m = "left"; });
  document.querySelectorAll(".see-demo, .demo, .ui-frame").forEach((el) => { if (el.hasAttribute("data-reveal")) el.dataset.m = "right"; });
  // eyebrow underline follows its parent's reveal
  document.querySelectorAll(".eyebrow").forEach((e) => {
    const host = e.closest("[data-reveal]");
    if (!host) { e.classList.add("in"); return; }
    if (host.classList.contains("in")) e.classList.add("in");
    else new MutationObserver((_, mo) => { if (host.classList.contains("in")) { e.classList.add("in"); mo.disconnect(); } }).observe(host, { attributes: true, attributeFilter: ["class"] });
  });
})();
