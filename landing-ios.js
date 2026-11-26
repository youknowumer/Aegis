// Aegis landing: iOS-feel motion layer.
//  - hero depth parallax (pointer) + scroll recede, driven by one spring-damped loop (frame-rate independent)
//  - glass cards catch light under the pointer; numerals count up once the entrance is done
//  - magnetic buttons
//  - inertial wheel scrolling (mouse wheels only; touch, keyboard, anchors, nested scrollers and reduced motion are left alone)
// Everything is skipped for reduced motion. Hero parallax uses the CSS `translate` / `scale` properties, so it never fights the
// entrance animation (which uses `transform`).
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const hero = document.getElementById("top");
  if (reduce) return;

  // ------------------------------------------------------------ hero parallax + scroll recede
  if (hero && hero.classList.contains("halora")) {
    const copy = hero.querySelector(".h-copy");
    const cardsBox = hero.querySelector(".h-cards");
    const cards = [...hero.querySelectorAll(".h-card")];
    const media = hero.querySelector(".h-media");
    const DEPTH = { copy: 10, cards: [16, 24, 32], media: -9 };   // px at the screen edge
    let tx = 0, ty = 0, cx = 0, cy = 0, sp = 0, cp = 0;          // pointer target/current, scroll progress target/current
    let raf = 0, last = 0, on = true;

    const apply = () => {
      const p = cp, e = p * p * (3 - 2 * p);
      if (copy) { copy.style.translate = `${(cx * DEPTH.copy).toFixed(2)}px ${(cy * DEPTH.copy * .6 - e * 70).toFixed(2)}px`; copy.style.opacity = String((1 - clamp(e * 1.25)).toFixed(3)); }
      if (cardsBox) cardsBox.style.opacity = String((1 - clamp(e * 1.25)).toFixed(3));
      cards.forEach((c, i) => { const d = DEPTH.cards[i % 3]; c.style.translate = `${(cx * d).toFixed(2)}px ${(cy * d * .7 - e * (90 + i * 22)).toFixed(2)}px`; });
      if (media) { media.style.translate = `${(cx * DEPTH.media).toFixed(2)}px ${(cy * DEPTH.media * .5 + e * 36).toFixed(2)}px`; media.style.scale = (1.018 + e * .07).toFixed(4); }
    };
    const step = (now) => {
      raf = 0;
      const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
      const k = 1 - Math.exp(-dt * 6.5);           // critically damped feel: ~0.35s to settle
      cx += (tx - cx) * k; cy += (ty - cy) * k; cp += (sp - cp) * (1 - Math.exp(-dt * 9));
      apply();
      if (on && (Math.abs(tx - cx) > .0008 || Math.abs(ty - cy) > .0008 || Math.abs(sp - cp) > .0008)) raf = requestAnimationFrame(step);
      else last = 0;
    };
    const kick = () => { if (on && !raf) raf = requestAnimationFrame(step); };

    if (fine) {
      hero.addEventListener("pointermove", (e) => {
        const r = hero.getBoundingClientRect();
        tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1); ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
        kick();
      }, { passive: true });
      hero.addEventListener("pointerleave", () => { tx = ty = 0; kick(); });
    }
    const onScroll = () => { sp = clamp(scrollY / (hero.offsetHeight * .85)); kick(); };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
    new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on) kick(); }).observe(hero);
    apply();

    // glass cards: highlight follows the pointer
    cards.forEach((c) => {
      c.addEventListener("pointermove", (e) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty("--px", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
        c.style.setProperty("--py", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
      }, { passive: true });
    });

    // numerals count up once the entrance has played
    const nums = cards.map((c) => c.querySelector(".hc-num")).filter(Boolean);
    const targets = nums.map((n) => parseInt(n.textContent, 10));
    const count = () => {
      const t0 = performance.now(), D = 1500;
      nums.forEach((n) => { n.style.minWidth = n.offsetWidth + "px"; n.textContent = "0"; });
      const tick = (now) => {
        const k = clamp((now - t0) / D), ease = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
        nums.forEach((n, i) => { n.textContent = String(Math.round(targets[i] * clamp(ease - i * .0))); });
        if (k < 1) requestAnimationFrame(tick); else nums.forEach((n) => (n.style.minWidth = ""));
      };
      requestAnimationFrame(tick);
    };
    if (nums.length && targets.every(Number.isFinite)) {
      if (hero.classList.contains("h-pre")) {
        const mo = new MutationObserver(() => { if (!hero.classList.contains("h-pre")) { mo.disconnect(); setTimeout(count, 1250); } });
        mo.observe(hero, { attributes: true, attributeFilter: ["class"] });
      }
    }
  }

  // ------------------------------------------------------------ magnetic buttons
  if (fine) {
    document.querySelectorAll(".h-cta, .hn-pill").forEach((b) => {
      b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        b.style.translate = `${((e.clientX - r.left - r.width / 2) * .16).toFixed(1)}px ${((e.clientY - r.top - r.height / 2) * .24).toFixed(1)}px`;
      }, { passive: true });
      b.addEventListener("pointerleave", () => { b.style.translate = ""; });
    });
  }

  // ------------------------------------------------------------ scroll-linked soft focus (stronger + eased than landing-fx.js's linear ramp)
  // Items blur, fade, shrink and drift a little as they enter from the bottom or leave at the top, like iOS sheets.
  // landing-fx.js sets --sb/--so/--ss first; this runs after it in the same frame and replaces the values with eased ones.
  (() => {
    const sel = ".block-head, .cap, .cmd, .col, .proofs li, .steps li, .node, .plan, .get, .faq, .ui-points li, .ui-frame, .cmd-note";
    const els = [...document.querySelectorAll(sel)];
    const NAVH = 84, smooth = (k) => k * k * (3 - 2 * k);
    let tk = false;
    const run = () => {
      tk = false;
      const vh = innerHeight;
      const rects = els.map((el) => (el.classList.contains("live") ? el.getBoundingClientRect() : null));
      els.forEach((el, i) => {
        const r = rects[i]; if (!r) return;
        const enter = clamp((vh - 24 - r.top) / (vh * .3));     // 30% of the screen to settle in
        const exit = clamp((r.bottom - NAVH) / (vh * .26));
        const inAmt = 1 - smooth(enter), outAmt = 1 - smooth(exit);
        const amt = Math.max(inAmt, outAmt);
        if (amt < .015) { if (el.classList.contains("soft")) el.classList.remove("soft"); el.style.removeProperty("--sy"); return; }
        if (!el.classList.contains("soft")) el.classList.add("soft");
        el.style.setProperty("--sb", (amt * 14).toFixed(2) + "px");
        el.style.setProperty("--so", (1 - amt * .72).toFixed(3));
        el.style.setProperty("--ss", (1 - amt * .05).toFixed(4));
        el.style.setProperty("--sy", ((inAmt >= outAmt ? 1 : -.6) * amt * 34).toFixed(1) + "px");
      });
    };
    const on = () => { if (!tk) { tk = true; requestAnimationFrame(run); } };
    addEventListener("scroll", on, { passive: true }); addEventListener("resize", on);
    setTimeout(on, 600);
  })();

  // ------------------------------------------------------------ inertial wheel scrolling
  // Mouse wheels arrive in coarse 100px steps; trackpads and touch already have native momentum, so only wheel-like input is smoothed.
  const root = document.documentElement;
  let target = scrollY, cur = scrollY, rafS = 0, lastT = 0, driving = false;
  const max = () => Math.max(0, root.scrollHeight - innerHeight);
  const scrollable = (el) => {
    for (; el && el !== document.body && el !== root; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) return true;
    }
    return false;
  };
  const loop = (now) => {
    rafS = 0;
    const dt = Math.min(.05, (now - (lastT || now)) / 1000); lastT = now;
    cur += (target - cur) * (1 - Math.exp(-dt * 9));
    if (Math.abs(target - cur) < .4) cur = target;
    driving = true; scrollTo({ top: cur, behavior: "instant" }); driving = false;
    if (cur !== target) rafS = requestAnimationFrame(loop); else lastT = 0;
  };
  addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.defaultPrevented || e.deltaX && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (scrollable(e.target)) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    const dy = e.deltaY * unit;
    // trackpads/smooth-scroll devices send small fractional deltas, leave them native
    if (e.deltaMode === 0 && Math.abs(dy) < 50 && !Number.isInteger(dy)) return;
    if (e.deltaMode === 0 && Math.abs(dy) < 4) return;
    e.preventDefault();
    if (!rafS) { cur = scrollY; if (Math.abs(target - cur) > 2) target = cur; }
    target = clamp(target + dy * .9, 0, max());
    if (!rafS) rafS = requestAnimationFrame(loop);
  }, { passive: false });
  // anything else that moves the page (anchors, keyboard, scrollbar drag, touch) takes over: re-sync
  addEventListener("scroll", () => { if (!driving && !rafS) { target = cur = scrollY; } else if (!driving && Math.abs(scrollY - cur) > 3) { if (rafS) cancelAnimationFrame(rafS); rafS = 0; target = cur = scrollY; } }, { passive: true });
  ["keydown", "touchstart", "mousedown"].forEach((t) => addEventListener(t, () => { if (rafS) cancelAnimationFrame(rafS); rafS = 0; target = cur = scrollY; }, { passive: true }));
})();
