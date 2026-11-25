/* Aegis landing: "ultra" layer (colour field, word-split headings, scroll reveals, card spotlight, scroll-linked lines). */
(() => {
  "use strict";
  const d = document, root = d.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $$ = (s, c = d) => Array.from(c.querySelectorAll(s));

  /* 1. fixed colour field */
  const field = d.createElement("div");
  field.className = "ux-field"; field.setAttribute("aria-hidden", "true");
  field.innerHTML = "<i></i><i></i><i></i>";
  d.body.prepend(field);

  /* 2. split section headings into words (keeps inner elements, keeps the accessible name) */
  const heads = $$("main section:not(.hero-sec) h2");
  heads.forEach((h) => {
    const label = h.textContent.replace(/\s+/g, " ").trim();
    h.setAttribute("aria-label", label);
    let n = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((c) => {
        if (c.nodeType === 3) {
          const frag = d.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach((tok) => {
            if (!tok) return;
            if (/^\s+$/.test(tok)) { frag.appendChild(d.createTextNode(" ")); return; }
            const w = d.createElement("span"); w.className = "ux-w"; w.setAttribute("aria-hidden", "true");
            w.style.setProperty("--i", n++); w.textContent = tok; frag.appendChild(w);
          });
          c.replaceWith(frag);
        } else if (c.nodeType === 1) walk(c);
      });
    };
    walk(h);
    const total = Math.max(1, n - 1);
    $$(".ux-w", h).forEach((w) => w.style.setProperty("--t", (w.style.getPropertyValue("--i") / total * 0.9).toFixed(2)));
  });
  if (!reduce) root.classList.add("ux-split");

  /* 3. mark reveal targets */
  const targets = [];
  const add = (el, mode, delay) => { if (!el || el.classList.contains("ux-r")) return; el.classList.add("ux-r"); if (mode) el.dataset.ux = mode; if (delay != null) el.style.setProperty("--d", delay); targets.push(el); };
  $$(".caps > .cap").forEach((el, i) => add(el, "", i % 3));
  $$(".cmd-grid > .cmd").forEach((el, i) => add(el, "", i));
  $$(".pgrid > .pc").forEach((el, i) => add(el, "", i % 3));
  $$(".plans > .plan").forEach((el, i) => add(el, "", i));
  $$(".steps > li").forEach((el, i) => add(el, "", i));
  $$(".split .demo, .split .mock, .split .vmock, .split .mtmock").forEach((el) => add(el, el.closest(".rev") ? "l" : "r"));
  $$("#download .get, .band .node, #faq details").forEach((el, i) => add(el, "", i % 4));
  if (reduce) targets.forEach((el) => el.classList.add("ux-show"));

  /* 4. corner ticks on big panels */
  $$(".scene, .get").forEach((el) => { ["tl", "br"].forEach((p) => { const t = d.createElement("i"); t.className = "ux-tick " + p; t.setAttribute("aria-hidden", "true"); el.appendChild(t); }); });

  /* 5. observers */
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target;
    el.classList.add("ux-show", "ux-in");
    if (el.matches("h2")) el.classList.add("ux-on");
    if (el.matches(".block-head")) el.classList.add("ux-on");
    io.unobserve(el);
  }), { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });
  targets.forEach((el) => io.observe(el));
  heads.forEach((h) => io.observe(h));
  $$(".block-head, .scene, .get").forEach((el) => io.observe(el));

  /* 6. pointer spotlight on cards */
  if (matchMedia("(hover: hover)").matches) {
    d.addEventListener("pointermove", (e) => {
      const c = e.target.closest && e.target.closest(".cap, .cmd, .pc, .plan, .node");
      if (!c) return;
      const r = c.getBoundingClientRect();
      c.style.setProperty("--px", e.clientX - r.left + "px");
      c.style.setProperty("--py", e.clientY - r.top + "px");
    }, { passive: true });
  }

  /* 7. scroll-linked: page progress, parallax stickers, steps line */
  const stk = $$(".stk");
  const steps = d.getElementById("steps");
  let ticking = false;
  const frame = () => {
    ticking = false;
    const vh = innerHeight, max = Math.max(1, root.scrollHeight - vh);
    root.style.setProperty("--ux-sp", Math.min(1, scrollY / max).toFixed(4));
    if (!reduce) {
      stk.forEach((s) => {
        const r = s.parentElement.getBoundingClientRect();
        if (r.bottom < -100 || r.top > vh + 100) return;
        const k = (r.top + r.height / 2 - vh / 2) / vh;
        s.style.setProperty("--py2", (k * -46).toFixed(1));
        if (!s.hasAttribute("data-px")) s.setAttribute("data-px", "");
      });
    }
    if (steps) {
      const r = steps.getBoundingClientRect();
      const p = reduce ? 1 : Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.2)));
      steps.style.setProperty("--ux-steps", p.toFixed(3));
    }
  };
  const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener("scroll", req, { passive: true });
  addEventListener("resize", req);
  frame();
})();
