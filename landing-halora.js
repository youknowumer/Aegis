// Aegis landing: hero + header behaviour.
//  1. One Web Animations entrance timeline (backwards fill). It starts once fonts (and the photo, if there is one) are ready,
//     then cancels every animation so the page falls back to its authored styles.
//  2. The background video: two stacked copies of the same clip dissolve into each other during the last second, so the loop never
//     jumps and never plays backwards. It fades in (0.8s) once its first frame is ready.
//  3. The burger menu below 820px.
// Reduced motion: no entrance, no transitions, no video. Nothing in the scene is drawn in code.
(() => {
  "use strict";
  const hero = document.getElementById("top");
  const nav = document.getElementById("nav");
  if (!hero || !hero.classList.contains("halora")) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = hero) => r.querySelector(s);
  const $$ = (s, r = hero) => [...r.querySelectorAll(s)];

  // ------------------------------------------------------------ burger menu
  (() => {
    const burger = document.getElementById("hn-burger");
    const panel = document.getElementById("hn-panel");
    if (!nav || !burger || !panel) return;
    const set = (open) => {
      nav.classList.toggle("open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      // links inside a closed (hidden) panel must not be tabbable
      panel.toggleAttribute("inert", !open && matchMedia("(max-width: 819px)").matches);
    };
    burger.addEventListener("click", () => set(!nav.classList.contains("open")));
    panel.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.classList.contains("open")) { set(false); burger.focus(); } });
    document.addEventListener("pointerdown", (e) => { if (nav.classList.contains("open") && !nav.contains(e.target)) set(false); });
    const sync = () => { if (!matchMedia("(max-width: 819px)").matches) { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); panel.removeAttribute("inert"); } else if (!nav.classList.contains("open")) panel.setAttribute("inert", ""); };
    matchMedia("(max-width: 819px)").addEventListener("change", sync);
    sync();
  })();

  // ------------------------------------------------------------ photo (optional): assets/halora/hero.jpg, same box as the video
  const media = $(".h-media");
  const photoURL = hero.dataset.photo;
  const photoReady = new Promise((res) => {
    if (!photoURL || !media) return res(false);
    const img = new Image();
    img.className = "h-photo"; img.alt = ""; img.decoding = "async"; img.setAttribute("aria-hidden", "true");
    img.onload = () => { media.insertBefore(img, media.firstChild); res(true); };
    img.onerror = () => res(false);
    img.src = photoURL;
  });

  // ------------------------------------------------------------ entrance timeline
  const fontsReady = (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).catch(() => {});
  const E = "cubic-bezier(.22, .8, .24, 1)";
  function enter() {
    hero.classList.remove("h-pre");
    nav && nav.classList.remove("h-pre");
    if (reduce) return;
    const all = [];
    const go = (el, frames, delay, dur) => { if (!el) return; all.push(el.animate(frames, { duration: dur, delay, easing: E, fill: "backwards" })); };
    const drop = [{ opacity: 0, transform: "translateY(-26px)" }, { opacity: 1, transform: "none" }];

    // header items drop in from the top, one after another
    if (nav) {
      let n = 0;
      go($(".brand", nav), drop, 0, 800);
      $$(".links a", nav).forEach((a) => go(a, drop, 90 + 70 * n++, 800));
      $$(".hn-cta > *", nav).forEach((a) => go(a, drop, 90 + 70 * n++, 800));
      go($(".hn-burger", nav), drop, 120, 800);
    }
    // the tracking dot switches on with a circular clip, its label follows
    go($(".h-dot"), [{ clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(100% at 50% 50%)" }], 420, 520);
    go($(".h-eyebrow span"), [{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }], 700, 700);
    // each headline line rises inside its own mask
    $$(".h-title .h-line > span").forEach((l, i) => go(l, [{ transform: "translateY(110%)", opacity: 1 }, { transform: "none", opacity: 1 }], 520 + 140 * i, 1000));
    // paragraph and button settle in
    const settle = [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }];
    go($(".h-lead"), settle, 900, 900);
    go($(".h-cta"), settle, 1050, 900);
    // glass cards rise one after another
    $$(".h-card").forEach((c, i) => go(c, [{ opacity: 0, transform: "translateY(46px)" }, { opacity: 1, transform: "none" }], 1100 + 150 * i, 1000));

    // then hand everything back to the stylesheet
    Promise.all(all.map((a) => a.finished)).then(() => all.forEach((a) => a.cancel())).catch(() => all.forEach((a) => { try { a.cancel(); } catch (e) {} }));
  }
  let started = false;
  const begin = () => { if (started) return; started = true; requestAnimationFrame(enter); };
  Promise.all([fontsReady, photoReady]).then(begin);
  setTimeout(begin, 2500);                 // never leave the page hidden if a font or the photo is slow

  // ------------------------------------------------------------ background video with a one-second self-crossfade
  const src = hero.dataset.video;
  const box = $(".h-vidbox");
  if (!reduce && src && box) {
    const XF = 1;                           // seconds of dissolve
    const mk = (z) => {
      const v = document.createElement("video");
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = false; v.preload = "auto";
      v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
      v.tabIndex = -1; v.disablePictureInPicture = true; v.disableRemotePlayback = true;
      v.style.zIndex = z; v.style.opacity = z === 1 ? "1" : "0";
      v.src = src;
      box.appendChild(v);
      return v;
    };
    let front = mk(1), back = mk(0);
    let fading = false, visible = true, raf = 0, wantPlay = true;

    front.addEventListener("loadeddata", () => { media.classList.add("ready"); }, { once: true });
    front.addEventListener("error", () => { box.style.display = "none"; }, { once: true });
    front.play().catch(() => {});

    const swap = () => {
      front.pause();
      front.style.transition = "none"; front.style.opacity = "0"; front.style.zIndex = "0";
      try { front.currentTime = 0; } catch (e) {}
      [front, back] = [back, front];
      front.style.zIndex = "1";
      fading = false;
    };
    const startFade = () => {
      fading = true;
      try { back.currentTime = 0; } catch (e) {}
      back.style.zIndex = "2";
      back.style.transition = "none"; back.style.opacity = "0";
      void back.offsetWidth;
      back.style.transition = `opacity ${XF}s linear`;
      back.style.opacity = "1";
      back.play().catch(() => {});
    };
    const tick = () => {
      raf = 0;
      if (!visible || document.hidden) return;
      const d = front.duration;
      if (!fading && d && isFinite(d) && !front.paused && front.currentTime >= d - XF) startFade();
      else if (fading && (back.currentTime >= XF - 0.03 || front.ended)) swap();
      // a frozen/ended front (stalled decode) must never leave the loop stuck
      else if (!fading && front.ended) startFade();
      raf = requestAnimationFrame(tick);
    };
    const run = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const pause = () => { if (raf) cancelAnimationFrame(raf); raf = 0; front.pause(); if (fading) back.pause(); };
    const resume = () => { if (!visible || document.hidden || !wantPlay) return; front.play().catch(() => {}); if (fading) back.play().catch(() => {}); run(); };

    new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? resume() : pause(); }, { threshold: 0 }).observe(hero);
    document.addEventListener("visibilitychange", () => (document.hidden ? pause() : resume()));
    run();
  }
})();
