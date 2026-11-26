// Aegis landing: motion layer (v14). Hero intro trigger, pointer parallax + spotlight, drifting sparks, scroll recede,
// staggered reveal variants, button magnet. Does nothing under reduced motion except mark the hero as ready.
(() => {
  "use strict";
  const hero = document.querySelector(".hero-sec.vela");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const heroFx = !!hero && !reduce;
  if (hero && reduce) hero.classList.add("go");
  if (heroFx) {
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
  // hero word colours (same order as the .vl layers: Ask, Search, Automate, Connect), blended smoothly between words
  const HERO = [[246, 200, 40], [249, 120, 48], [60, 190, 120], [214, 100, 210]];
  let cur = HERO[1].slice();
  function heroRGB(now) {
    const clk = window.__velaClock, t = clk && typeof clk.currentTime === "number" ? clk.currentTime : now;
    const k = t / 1750, i = Math.floor(k) % 4, f = k - Math.floor(k), a = HERO[((i % 4) + 4) % 4], b = HERO[(i + 1) % 4];
    const m = f > 0.8 ? (f - 0.8) / 0.2 : 0;
    for (let c = 0; c < 3; c++) cur[c] = Math.round(a[c] + (b[c] - a[c]) * m);
    hero.style.setProperty("--hg", cur.join(" "));
    return cur;
  }
  function draw(now) {
    raf = 0; if (!running) return;
    ctx.clearRect(0, 0, W, H);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const hg = heroRGB(now);
    ctx.fillStyle = `rgb(${hg[0]},${hg[1]},${hg[2]})`;
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

  } // end of hero-only effects (the old pastel hero; the current hero lives in landing-halora.js)

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

// ======================= smoothness + detailing (v14.1) =======================
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const NAV = 84;

  // ---- eased anchor scrolling (replaces the browser's linear jump; keeps URL hash and focus correct)
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let anim = 0;
  // target is a function so late layout changes (images, fonts, reveals) never make the scroll land short or long
  function scrollToY(target, ms) {
    cancelAnimationFrame(anim);
    const from = scrollY, first = target();
    if (reduce || Math.abs(first - from) < 2) { scrollTo({ top: first, behavior: "instant" }); return; }
    const t0 = performance.now(), dur = ms || clamp(Math.abs(first - from) / 2.2, 450, 1200);
    const stop = () => cancelAnimationFrame(anim);
    addEventListener("wheel", stop, { once: true, passive: true });
    addEventListener("touchstart", stop, { once: true, passive: true });
    const step = (now) => { const k = clamp((now - t0) / dur); scrollTo({ top: from + (target() - from) * ease(k), behavior: "instant" }); if (k < 1) anim = requestAnimationFrame(step); };
    anim = requestAnimationFrame(step);
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const id = a.getAttribute("href").slice(1);
    const el = id ? document.getElementById(id) : document.body;
    if (!el) return;
    e.preventDefault();
    scrollToY(() => (id ? Math.max(0, el.getBoundingClientRect().top + scrollY - (id === "top" ? 0 : NAV) + 1) : 0));
    history.pushState(null, "", id ? "#" + id : location.pathname);
    el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true });
  });

  // ---- fade out when leaving for the app, and warm the app page on hover
  document.querySelectorAll('a[href^="app.html"]').forEach((a) => {
    const warm = () => { if (a.dataset.warm) return; a.dataset.warm = "1"; const l = document.createElement("link"); l.rel = "prefetch"; l.href = "app.html"; document.head.appendChild(l); };
    a.addEventListener("pointerenter", warm, { once: true }); a.addEventListener("focus", warm, { once: true });
    a.addEventListener("click", (e) => {
      if (reduce || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
      e.preventDefault(); document.body.classList.add("leaving");
      setTimeout(() => { location.href = a.href; }, 240);
    });
  });
  addEventListener("pageshow", () => document.body.classList.remove("leaving"));

  // ---- scrollspy: nav indicator + section rail
  const links = [...document.querySelectorAll("#links a[href^='#']")];
  const secs = [...document.querySelectorAll("main section[id]")];
  const NAMES = { top: "Top", see: "See it work", interface: "Interface", voice: "Voice", meetings: "Meetings", what: "What it does", commands: "Commands", control: "Your control", how: "How it works", platform: "Platform", plans: "Plans", download: "Download", faq: "Questions" };
  const nl = document.getElementById("links");
  let ind = null;
  if (nl) { ind = document.createElement("i"); ind.className = "nav-ind"; ind.setAttribute("aria-hidden", "true"); nl.appendChild(ind); }
  const rail = document.createElement("nav");
  rail.className = "rail"; rail.setAttribute("aria-label", "Page sections");
  secs.filter((s) => NAMES[s.id]).forEach((s) => {
    const a = document.createElement("a"); a.href = "#" + s.id; a.setAttribute("aria-label", NAMES[s.id]);
    a.innerHTML = "<span>" + NAMES[s.id] + "</span>"; rail.appendChild(a);
  });
  document.body.appendChild(rail);
  const railLinks = [...rail.querySelectorAll("a")];
  let current = "";
  const HUES = { 1: ["#E9C22E", "233, 194, 46"], 2: ["#F2772F", "242, 119, 47"], 3: ["#3FB874", "63, 184, 116"], 4: ["#C564C4", "197, 100, 196"] };
  const root = document.documentElement;
  function tintPage(sec) {
    const h = sec && HUES[sec.dataset.hue];
    if (h) { root.style.setProperty("--secc", h[0]); root.style.setProperty("--spot", h[1]); }
    else { root.style.removeProperty("--secc"); root.style.removeProperty("--spot"); }
  }
  function spy() {
    const mid = innerHeight * 0.4;
    let id = "";
    for (const s of secs) { const r = s.getBoundingClientRect(); if (r.top <= mid && r.bottom > mid) id = s.id; }
    if (id === current) return;
    current = id;
    railLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + id));
    tintPage(secs.find((x) => x.id === id));
    let hit = null;
    links.forEach((a) => { const on = a.getAttribute("href") === "#" + id; a.classList.toggle("active", on); if (on) hit = a; });
    if (ind) {
      if (hit) { ind.style.width = hit.offsetWidth + "px"; ind.style.setProperty("--nx", hit.offsetLeft + "px"); ind.classList.add("on"); }
      else ind.classList.remove("on");
    }
  }

  // ---- smart header, rail visibility, to-top ring (one rAF-throttled scroll handler)
  const nav = document.getElementById("nav"), top = document.getElementById("to-top");
  let lastY = scrollY, tk = false;
  function onScroll() {
    if (tk) return; tk = true;
    requestAnimationFrame(() => {
      tk = false;
      const y = scrollY, dy = y - lastY;
      if (nav && !reduce) {
        if (y > 520 && dy > 6) nav.classList.add("hide");
        else if (dy < -6 || y < 520) nav.classList.remove("hide");
      }
      lastY = y;
      rail.classList.toggle("on", y > innerHeight * 0.6);
      if (top) top.style.setProperty("--p", clamp(y / Math.max(1, document.documentElement.scrollHeight - innerHeight)).toFixed(3));
      spy();
    });
  }
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => { current = ""; onScroll(); });
  nav && nav.addEventListener("focusin", () => nav.classList.remove("hide"));
  spy();

  // ---- pointer tilt on cards
  if (fine && !reduce) {
    document.querySelectorAll(".plan, .cap, .cmd, .node").forEach((c) => {
      c.classList.add("tilt");
      c.addEventListener("pointerenter", () => c.classList.add("on"));
      c.addEventListener("pointermove", (e) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty("--ty", (((e.clientX - r.left) / r.width - 0.5) * 6).toFixed(2) + "deg");
        c.style.setProperty("--tx", ((0.5 - (e.clientY - r.top) / r.height) * 5).toFixed(2) + "deg");
      }, { passive: true });
      c.addEventListener("pointerleave", () => { c.classList.remove("on"); c.style.setProperty("--tx", "0deg"); c.style.setProperty("--ty", "0deg"); });
    });
  }

  // ---- FAQ: only one answer open at a time
  const dets = [...document.querySelectorAll(".faq details")];
  dets.forEach((d) => d.addEventListener("toggle", () => { if (d.open) dets.forEach((o) => { if (o !== d) o.open = false; }); }));
})();
