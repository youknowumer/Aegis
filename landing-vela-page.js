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

  // ------------------------------------------------------------ stickers: glossy tinted 3D icons (self-hosted file first, CDN copy as a fallback)
  const ICONS = [
    { f: "message", tint: "#E9C22E", cdn: "83de7c35-dd91-4e56-bfb8-0ffafc83d0e0" },
    { f: "browse",  tint: "#F2772F", cdn: "4d952211-0474-48cc-af48-58f68b3b7525" },
    { f: "transact", tint: "#3FB874", cdn: "e2e91fca-5b3f-4e0e-a437-8a581592e407" },
    { f: "web",     tint: "#C564C4", cdn: "6b32bb47-4ad6-4938-a637-c997b373c68b" },
  ];
  const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/";
  const abs = (u) => new URL(u, document.baseURI).href;
  const probe = (url, cors) => new Promise((res) => {
    const t = new Image(); if (cors) t.crossOrigin = "anonymous";
    t.onload = () => res(true); t.onerror = () => res(false); t.src = url;
  });
  $$(".stk").forEach((s) => {
    const ic = ICONS[Number(s.dataset.ic) % ICONS.length];
    const wrap = document.createElement("span"); wrap.className = "vic";
    const img = document.createElement("img"); img.alt = ""; img.width = 320; img.height = 320; img.decoding = "async";
    const tint = document.createElement("i"); tint.className = "tint"; tint.style.setProperty("--tint", ic.tint);
    wrap.append(img, tint); s.replaceChildren(wrap);
    const local = "assets/vela/" + ic.f + ".webp", cdn = CDN + ic.cdn + ".webp";
    const use = (url, masked) => {
      img.src = url;
      if (masked) { tint.style.setProperty("--icon", `url("${abs(url)}")`); wrap.classList.add("ok"); }
    };
    (async () => {
      if (await probe(local)) return use(local, true);
      if (await probe(cdn, true)) return use(cdn, true);
      if (await probe(cdn)) return use(cdn, false);
      wrap.hidden = true;
    })();
  });

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
