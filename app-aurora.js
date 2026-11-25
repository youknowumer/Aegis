// Aegis "Midnight Aurora" motion layer (JS half of app-aurora.css).
// Adds: living background, pointer spotlight, boot sequence, state-change shockwaves + edge flash, orb poke on click,
// extra HUD rings, card shine, magnetic buttons. Respects Calm mode and prefers-reduced-motion; pauses when the tab is hidden.
(() => {
  "use strict";
  const app = document.getElementById("app");
  if (!app) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const calm = () => document.body.classList.contains("calm");
  const stage = document.getElementById("stage");
  const zone = document.querySelector(".orb-zone");
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html) n.innerHTML = html; n.setAttribute("aria-hidden", "true"); return n; };

  // follow the assistant state with a body attribute so the background layers can share its colour
  const syncState = () => { if (stage) document.body.setAttribute("data-fx-state", stage.dataset.state || "idle"); };
  syncState();

  if (reduce) return;

  // ---- 1. background layers
  const blobs = el("div", "fx-blobs", "<i></i><i></i><i></i>");
  const spot = el("div", "fx-spot");
  const boot = el("div", "fx-boot");
  const edge = el("div", "fx-edge");
  const grid = document.querySelector(".bg-grid");
  document.body.insertBefore(blobs, grid ? grid.nextSibling : document.body.firstChild);
  document.body.append(spot, boot, edge);

  // ---- 2. pointer spotlight (one rAF, transform only)
  if (fine) {
    let x = innerWidth / 2, y = innerHeight / 3, tx = x, ty = y, raf = 0;
    const tick = () => {
      raf = 0; x += (tx - x) * 0.14; y += (ty - y) * 0.14;
      spot.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      if (Math.abs(tx - x) + Math.abs(ty - y) > 0.5) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", (e) => {
      tx = e.clientX; ty = e.clientY; spot.classList.add("on");
      if (!raf && !calm() && !document.hidden) raf = requestAnimationFrame(tick);
    }, { passive: true });
    document.addEventListener("pointerleave", () => spot.classList.remove("on"));
  }

  // ---- 3. orb extras: halo + radar sweep behind the canvas, more HUD rings in the SVG
  if (zone) {
    zone.insertBefore(el("div", "orb-sweep"), zone.firstChild);
    zone.insertBefore(el("div", "orb-halo"), zone.firstChild);
    const deco = zone.querySelector(".orb-deco");
    if (deco) {
      const NS = "http://www.w3.org/2000/svg";
      const mk = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); (parent || deco).appendChild(n); return n; };
      const g5 = mk("g", { class: "d-spin s5" }); mk("circle", { cx: 200, cy: 200, r: 196, class: "d-tick" }, g5);
      const g3 = mk("g", { class: "d-spin s3" }); mk("circle", { cx: 200, cy: 200, r: 183, class: "d-arc" }, g3);
      const g4 = mk("g", { class: "d-spin s4" }); mk("circle", { cx: 200, cy: 200, r: 168, class: "d-arc a2" }, g4);
    }
    // click / tap on the orb: big visible burst
    zone.addEventListener("pointerdown", () => { shock(); if (window.__aegisOrb && window.__aegisOrb.poke) window.__aegisOrb.poke(); }, { passive: true });
  }

  // ---- 4. shockwave rings + edge flash on every state change
  function shock() {
    if (!zone || calm() || document.hidden) return;
    ["", "b", "c"].forEach((c) => {
      const r = el("i", "fx-shock " + c);
      zone.insertBefore(r, zone.firstChild); setTimeout(() => r.remove(), 1800);
    });
  }
  function flashEdge() { edge.classList.remove("go"); void edge.offsetWidth; edge.classList.add("go"); }
  if (stage) {
    let prev = stage.dataset.state;
    new MutationObserver(() => {
      const now = stage.dataset.state; if (now === prev) return;
      prev = now; syncState();
      if (app.classList.contains("hidden") || calm()) return;
      shock();
      if (now === "listening" || now === "thinking" || now === "speaking") flashEdge();
    }).observe(stage, { attributes: true, attributeFilter: ["data-state"] });
  }

  // ---- 5. boot sequence whenever the app becomes visible
  let was = app.classList.contains("hidden");
  const playBoot = () => {
    if (calm()) return;
    boot.classList.remove("go"); void boot.offsetWidth; boot.classList.add("go");
    setTimeout(shock, 380);
  };
  new MutationObserver(() => {
    const now = app.classList.contains("hidden");
    if (was && !now) playBoot();
    was = now;
  }).observe(app, { attributes: true, attributeFilter: ["class"] });
  if (!was) setTimeout(playBoot, 120);

  // ---- 6. quick-card light sweep
  document.querySelectorAll(".qcard").forEach((c) => c.appendChild(el("span", "fx-shine")));

  // ---- 7. magnetic buttons (fine pointers only)
  if (fine) {
    const mags = document.querySelectorAll(".send, .composer .icon-btn, .topbar .icon-btn, .palette-btn");
    mags.forEach((b) => {
      b.classList.add("fx-mag");
      b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width, dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        b.style.translate = `${(dx * 7).toFixed(1)}px ${(dy * 6).toFixed(1)}px`;
      }, { passive: true });
      b.addEventListener("pointerleave", () => { b.style.translate = ""; });
    });
  }

  // ---- 8. pause the heavy CSS layers while the tab is hidden
  document.addEventListener("visibilitychange", () => document.body.classList.toggle("fx-paused", document.hidden));
})();
