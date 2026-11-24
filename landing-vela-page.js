// Aegis landing: "vela" motion for the rest of the page. Headline words rise and un-blur, pastel panels drift with the scroll,
// glossy stickers pop in, providers scroll as a ticker, cards catch a soft highlight under the pointer, the footer wordmark rises letter by letter.
// All of it is skipped for reduced-motion users, and nothing here hides content when JS is off.
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ------------------------------------------------------------ hues: cards cycle lemon / peach / sage / rose
  $$(".cap, .pc, .cmd").forEach((el, i, all) => { el.dataset.hue = String((i % 4) + 1); });
  $$(".steps li").forEach((el, i) => { el.dataset.hue = String((i % 4) + 1); });
  $$(".plan:not(.feat)").forEach((el, i) => { el.dataset.hue = i ? "3" : "1"; });

  // ------------------------------------------------------------ stickers: copy the hero's resolved, tinted icons
  const stickers = $$(".stk");
  function syncStickers() {
    const heroIcons = $$(".hero-sec.vela .vic");
    if (!heroIcons.length) return;
    stickers.forEach((s) => {
      const src = heroIcons[Number(s.dataset.ic) % heroIcons.length];
      s.replaceChildren(src.cloneNode(true));
      const v = s.firstElementChild; v.style.opacity = ""; v.style.transform = ""; v.style.filter = "";
    });
  }
  syncStickers();
  [500, 1600, 4500].forEach((ms) => setTimeout(syncStickers, ms));
  addEventListener("load", syncStickers);

  // ------------------------------------------------------------ pointer highlight on cards
  if (fine) {
    document.addEventListener("pointermove", (e) => {
      const el = e.target.closest && e.target.closest(".pc, .cmd, .scene");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
      el.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
    }, { passive: true });
    $$(".cmd").forEach((c) => {
      c.addEventListener("pointerenter", () => c.style.setProperty("--hl", "1"));
      c.addEventListener("pointerleave", () => c.style.setProperty("--hl", "0"));
    });
  }

  // ------------------------------------------------------------ ticker for the provider row
  const prov = document.querySelector(".prov ul");
  if (prov && !reduce) {
    const wrap = document.createElement("div"); wrap.className = "marq";
    const track = document.createElement("div"); track.className = "marq-track";
    const clone = prov.cloneNode(true); clone.setAttribute("aria-hidden", "true");
    prov.parentNode.insertBefore(wrap, prov); track.append(prov, clone); wrap.append(track);
  }

  // ------------------------------------------------------------ footer wordmark: letters
  const mark = document.getElementById("foot-mark");
  if (mark && !reduce) {
    const t = mark.textContent.trim();
    mark.replaceChildren(...[...t].map((ch, i) => { const s = document.createElement("span"); s.className = "fl"; s.style.setProperty("--i", i); s.textContent = ch; return s; }));
  } else if (mark) {
    mark.innerHTML = [...mark.textContent.trim()].map((c) => `<span class="fl">${c}</span>`).join("");
  }

  if (reduce) return;

  // ------------------------------------------------------------ headline words
  $$(".block-head h2, .split-copy h2, .get h2, .see h2").forEach((h) => {
    if (h.children.length) return;
    const words = h.textContent.trim().split(/\s+/);
    h.setAttribute("aria-label", words.join(" "));
    h.replaceChildren(...words.flatMap((w, i) => {
      const s = document.createElement("span"); s.className = "vw"; s.setAttribute("aria-hidden", "true");
      s.style.setProperty("--i", i); s.textContent = w;
      return [s, document.createTextNode(" ")];
    }));
  });

  // ------------------------------------------------------------ reveal panels, stickers, steps, footer mark
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.18, rootMargin: "0px 0px -6% 0px" });
    $$(".scene, .stk, #foot-mark").forEach((el) => io.observe(el));
  } else { $$(".scene, .stk, #foot-mark").forEach((el) => el.classList.add("in")); }

  // ------------------------------------------------------------ scroll parallax: --py runs -1..1 as a panel crosses the viewport
  const tracked = $$(".scene, main > .band");
  let ticking = false;
  function update() {
    ticking = false;
    const vh = innerHeight;
    tracked.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      const k = ((r.top + r.height / 2) - vh / 2) / (vh / 2 + r.height / 2);
      el.style.setProperty("--py", Math.max(-1, Math.min(1, k)).toFixed(3));
    });
  }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener("resize", update);
  update();
})();
