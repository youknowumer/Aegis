// Aegis landing: "vela" hero. One clock (a long Web Animation's currentTime) drives the cycling verb, its tinted icon,
// the panel colour, the idle drift and the Start button flash, so a frame-by-frame recorder can seek it
// (window.__velaClock.currentTime = ms). Pauses in a hidden tab, stops painting off-screen, still "Search" state for reduced motion.
(() => {
  "use strict";
  const sec = document.querySelector(".hero-sec.vela");
  if (!sec) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const items = [...sec.querySelectorAll(".vitem")];
  const layers = [...sec.querySelectorAll(".vl")];
  const btn = document.getElementById("vbtn-a");
  const N = items.length;                 // 4 words
  const SLOT = 1750;                      // ms per word
  const ENTER = 500, LEAVE = 420, ICON_DELAY = 60;
  const WIN = 770;                        // panel crossfade window, centred on each word change
  const STILL = 1;                        // reduced motion shows "Search"
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const outCubic = (k) => 1 - Math.pow(1 - k, 3);
  const inCubic = (k) => k * k * k;
  const smooth = (k) => k * k * (3 - 2 * k);

  // ------------------------------------------------------------ icons: local file first, the CDN copy as a fallback.
  // The tint needs the image as a CSS mask, which must be same-origin or CORS-enabled. If neither works the icon stays plain grey.
  const abs = (u) => new URL(u, document.baseURI).href;
  items.forEach((it) => {
    const wrap = it.querySelector(".vic");
    const img = wrap.querySelector("img");
    const tint = wrap.querySelector(".tint");
    const local = img.getAttribute("src"), cdn = img.dataset.cdn;
    const use = (url, masked) => {
      img.src = url;
      if (masked) { tint.style.setProperty("--icon", `url("${abs(url)}")`); wrap.classList.add("ok"); }
      else wrap.classList.remove("ok");
    };
    const probe = (url, cors) => new Promise((res) => {
      const t = new Image(); if (cors) t.crossOrigin = "anonymous";
      t.onload = () => res(true); t.onerror = () => res(false); t.src = url;
    });
    (async () => {
      if (await probe(local)) return use(local, true);
      if (cdn && await probe(cdn, true)) return use(cdn, true);
      if (cdn && await probe(cdn)) return use(cdn, false);
    })();
  });

  // ------------------------------------------------------------ the frame renderer: a pure function of time
  function frame(t) {
    const k = Math.floor(t / SLOT), local = t - k * SLOT, idx = ((k % N) + N) % N;

    items.forEach((it, i) => {
      const wrap = it.firstElementChild;
      if (i !== idx) { it.style.visibility = "hidden"; it.style.opacity = "0"; return; }
      const lv = clamp((local - (SLOT - LEAVE)) / LEAVE);
      const out = inCubic(lv);
      const e = outCubic(clamp(local / ENTER));
      const ei = outCubic(clamp((local - ICON_DELAY) / ENTER));
      const op = e * (1 - out);
      // word
      it.style.visibility = "visible";
      it.style.opacity = "1";
      const word = it.lastElementChild;
      word.style.opacity = op.toFixed(3);
      word.style.transform = `translateY(${((1 - e) * 0.32 - out * 0.16).toFixed(4)}em) scale(${(0.96 + 0.04 * e).toFixed(4)})`;
      word.style.filter = `blur(${((1 - e) * 10 + out * 8).toFixed(2)}px)`;
      // icon: follows 60 ms later, scales up and untwists, and floats gently the whole time
      const fy = Math.sin(t / 1000 * (Math.PI * 2 / 3.4)) * 0.028;
      const fr = Math.sin(t / 1000 * (Math.PI * 2 / 4.6) + 1.2) * 3;
      const ie = ei * (1 - out);
      wrap.style.opacity = ie.toFixed(3);
      wrap.style.transform = `translateY(${(fy + (1 - ei) * 0.32 - out * 0.16).toFixed(4)}em) rotate(${(fr + (1 - ei) * -14).toFixed(2)}deg) scale(${(0.7 + 0.3 * ei).toFixed(4)})`;
      wrap.style.filter = `blur(${((1 - ei) * 10 + out * 8).toFixed(2)}px)`;
    });

    // panel colour: crossfade across a 770 ms window straddling each word change (passes through a soft muted mix)
    const half = WIN / 2;
    const op = new Array(N).fill(0);
    if (local < half) { const p = smooth((local + half) / WIN); op[((k - 1) % N + N) % N] = 1 - p; op[idx] = p; }
    else if (local > SLOT - half) { const p = smooth((local - (SLOT - half)) / WIN); op[idx] = 1 - p; op[(idx + 1) % N] = p; }
    else op[idx] = 1;
    layers.forEach((l, i) => {
      l.style.opacity = op[i].toFixed(3);
      // idle drift: slow, never frozen (+-2.2% / +-1.6% at scale 1.08)
      const x = Math.sin(t / 1000 * (Math.PI * 2 / 11) + i * 1.7) * 2.2;
      const y = Math.cos(t / 1000 * (Math.PI * 2 / 13) + i * 2.3) * 1.6;
      l.style.transform = `translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0) scale(1.08)`;
    });

    // the Start button fills to ink while the last word holds, then releases
    if (btn) {
      let f = 0;
      if (idx === N - 1) f = smooth(clamp((local - 200) / 280)) * (1 - smooth(clamp((local - 1230) / 280)));
      btn.classList.add("driven");
      btn.style.setProperty("--f", f.toFixed(3));
    }
  }

  // ------------------------------------------------------------ stats: count up once
  const nums = [...sec.querySelectorAll("[data-count]")];
  function countUp() {
    nums.forEach((el) => {
      const end = Number(el.dataset.count);
      if (!end || reduce) return;
      const t0 = performance.now(), dur = 1300;
      const tick = (now) => {
        const k = clamp((now - t0) / dur);
        el.textContent = String(Math.round(end * outCubic(k)));
        if (k < 1) requestAnimationFrame(tick);
      };
      el.textContent = "0";
      requestAnimationFrame(tick);
    });
  }
  countUp();

  // ------------------------------------------------------------ reduced motion: one still state, no loop
  if (reduce) {
    frame(STILL * SLOT + 1200);
    layers.forEach((l, i) => { l.style.transform = "none"; l.style.opacity = i === STILL ? "1" : "0"; });
    items.forEach((it) => { const w = it.firstElementChild, wd = it.lastElementChild;
      w.style.transform = "none"; w.style.filter = "none"; wd.style.transform = "none"; wd.style.filter = "none"; });
    if (btn) btn.style.removeProperty("--f");
    return;
  }

  // ------------------------------------------------------------ one clock
  const clock = sec.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1e9, iterations: 1 });
  window.__velaClock = clock;
  let visible = true, raf = 0;
  const render = () => { raf = 0; frame(Number(clock.currentTime) || 0); if (visible && !document.hidden) raf = requestAnimationFrame(render); };
  const kick = () => { if (!raf) raf = requestAnimationFrame(render); };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }, { threshold: 0 }).observe(sec);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clock.pause(); else { clock.play(); kick(); }
  });
  frame(0);
  kick();
})();
