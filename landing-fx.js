// Aegis landing: scroll-linked blur, word scrub, 3D preview, cursor light. Motion-safe: does nothing for reduced-motion users.
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const body = document.body;

  // ---- word-by-word scrub on section headings
  const scrubs = [...document.querySelectorAll(".block-head h2, .get h2")];
  scrubs.forEach((h) => {
    const words = h.textContent.trim().split(/\s+/);
    h.setAttribute("aria-label", words.join(" "));
    h.style.setProperty("--n", words.length);
    const nodes = [];
    words.forEach((w, i) => {
      const s = document.createElement("span");
      s.className = "sw";
      s.setAttribute("aria-hidden", "true");
      s.style.setProperty("--i", i);
      s.textContent = w;
      nodes.push(s, document.createTextNode(" "));
    });
    h.replaceChildren(...nodes);
    h.classList.add("scrub");
  });

  // ---- scroll-linked blur targets (only after their reveal has finished)
  const live = [...document.querySelectorAll(".block-head, .cap, .cmd, .col, .proofs li, .steps li, .node, .plan, .get, .faq, .ui-points li, .ui-frame, .cmd-note")];
  live.forEach((el) => {
    if (!el.hasAttribute("data-reveal")) return;
    const arm = () => el.classList.add("live");
    if (el.classList.contains("in")) setTimeout(arm, 1100);
    else new MutationObserver((_, mo) => { if (el.classList.contains("in")) { mo.disconnect(); setTimeout(arm, 1100); } }).observe(el, { attributes: true, attributeFilter: ["class"] });
  });

  // ---- spotlight on cards
  const spots = [...document.querySelectorAll(".cap, .cmd, .plan, .node, .col, .get, .cmd-note")];
  if (fine) spots.forEach((c) => {
    c.classList.add("spot");
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty("--mx", e.clientX - r.left + "px");
      c.style.setProperty("--my", e.clientY - r.top + "px");
    }, { passive: true });
  });

  // ---- cursor light that eases after the pointer
  const glow = document.getElementById("cursor-glow");
  if (glow && fine) {
    let tx = innerWidth / 2, ty = innerHeight / 3, x = tx, y = ty, raf = 0;
    const loop = () => {
      x += (tx - x) * 0.09; y += (ty - y) * 0.09;
      glow.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(loop) : 0;
    };
    window.addEventListener("pointermove", (e) => {
      tx = e.clientX; ty = e.clientY;
      glow.classList.add("on");
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
    document.addEventListener("pointerleave", () => glow.classList.remove("on"));
  }

  // ---- demo window: tilt toward the pointer + glare
  const demo = document.getElementById("demo");
  if (demo && fine) {
    const g = document.createElement("span");
    g.className = "demo-glare";
    g.setAttribute("aria-hidden", "true");
    demo.appendChild(g);
    demo.addEventListener("pointermove", (e) => {
      const r = demo.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      demo.style.setProperty("--ry", ((px - 0.5) * 7).toFixed(2) + "deg");
      demo.style.setProperty("--rx", ((0.5 - py) * 6).toFixed(2) + "deg");
      demo.style.setProperty("--gx", px * 100 + "%");
      demo.style.setProperty("--gy", py * 100 + "%");
    }, { passive: true });
    demo.addEventListener("pointerleave", () => {
      demo.style.setProperty("--rx", "0deg");
      demo.style.setProperty("--ry", "0deg");
    });
  }

  // ---- magnetic primary buttons
  if (fine) document.querySelectorAll(".btn.big").forEach((b) => {
    b.addEventListener("pointermove", (e) => {
      const r = b.getBoundingClientRect();
      b.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * 0.12).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * 0.22).toFixed(1)}px)`;
    });
    b.addEventListener("pointerleave", () => { b.style.transform = ""; });
  });

  // ---- one rAF loop for everything scroll-linked
  const frame = document.querySelector(".ui-frame");
  const mock = document.querySelector(".mock");
  const NAV = 70;
  let ticking = false;

  function update() {
    ticking = false;
    const vh = window.innerHeight;
    const y = window.scrollY;
    body.classList.toggle("is-scrolled", y > 24);
    body.classList.toggle("has-more", y + vh < document.documentElement.scrollHeight - 60);

    // read
    const rects = live.map((el) => (el.classList.contains("live") ? el.getBoundingClientRect() : null));
    const srects = scrubs.map((h) => h.getBoundingClientRect());
    const fr = frame ? frame.getBoundingClientRect() : null;

    // write
    live.forEach((el, i) => {
      const r = rects[i];
      if (!r) return;
      const enter = clamp((vh - 24 - r.top) / (vh * 0.2));
      const exit = clamp((r.bottom - NAV) / (vh * 0.18));
      const amt = 1 - Math.min(enter, exit);
      if (amt < 0.02) {
        if (el.classList.contains("soft")) el.classList.remove("soft");
        return;
      }
      if (!el.classList.contains("soft")) el.classList.add("soft");
      el.style.setProperty("--sb", (amt * 9).toFixed(2) + "px");
      el.style.setProperty("--so", (1 - amt * 0.6).toFixed(3));
      el.style.setProperty("--ss", (1 - amt * 0.035).toFixed(4));
    });

    scrubs.forEach((h, i) => {
      const r = srects[i];
      h.style.setProperty("--tp", clamp((vh * 0.92 - r.top) / (vh * 0.42)).toFixed(3));
    });

    if (fr && mock) {
      mock.style.setProperty("--fp", clamp((vh * 0.95 - fr.top) / (vh * 0.55)).toFixed(3));
    }
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
})();
