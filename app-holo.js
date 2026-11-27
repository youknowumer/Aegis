// Aegis "Holo HUD" motion layer (JS half of app-holo.css).
// Builds the HUD backdrop (ringed schematic behind the orb, corner frame, scan lines), readouts, boot sequence,
// state-change impact rings, orb poke, card shine and magnetic buttons. Pauses when the tab is hidden; respects Calm mode and reduced motion.
(() => {
  "use strict";
  const app = document.getElementById("app");
  if (!app) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const calm = () => document.body.classList.contains("calm");
  const stage = document.getElementById("stage");
  const zone = document.querySelector(".orb-zone");
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html) n.innerHTML = html; n.setAttribute("aria-hidden", "true"); return n; };

  // HUD look pins the orb to Aegis lavender whatever accent was picked in Settings
  if (window.AegisOrb && AegisOrb.setTheme && !AegisOrb.__holo) {
    const orig = AegisOrb.setTheme; AegisOrb.__holo = true;
    AegisOrb.setTheme = () => orig([222, 216, 250], [245, 243, 255]);
    AegisOrb.setTheme();
  }

  const syncState = () => { if (stage) document.body.setAttribute("data-fx-state", stage.dataset.state || "idle"); };
  syncState();
  if (reduce) return;

  // ---- HUD backdrop: concentric machinery centred on the orb
  const hud = el("div", "hud-bg", `<svg viewBox="0 0 1000 1000">
    <circle class="r-line" cx="500" cy="500" r="486"/>
    <g class="g1"><circle class="r-tick" cx="500" cy="500" r="470"/></g>
    <g class="g2"><circle class="r-dash" cx="500" cy="500" r="430"/></g>
    <g class="g3"><circle class="r-or" cx="500" cy="500" r="390"/><circle class="r-or2" cx="500" cy="500" r="390" style="stroke-dashoffset:-1200"/></g>
    <circle class="r-line pulse" cx="500" cy="500" r="352"/>
    <g class="g4"><circle class="r-cy" cx="500" cy="500" r="320"/></g>
    <g class="g5"><circle class="r-fine" cx="500" cy="500" r="292"/></g>
    <g class="g6"><circle class="r-dash" cx="500" cy="500" r="262" style="stroke-width:1.2;stroke-dasharray:60 20 6 20"/></g>
    <path class="x-line" d="M10 500H180M820 500H990M500 10V180M500 820V990"/>
    <path class="x-mark" d="M4 500l10-6v12zM996 500l-10-6v12zM500 4l-6 10h12zM500 996l-6-10h12z"/>
  </svg>`);
  const grid = document.querySelector(".bg-grid");
  document.body.insertBefore(hud, grid ? grid.nextSibling : document.body.firstChild);
  const spot = el("div", "fx-spot"), scan = el("div", "hud-scan"), frame = el("div", "hud-frame");
  const boot = el("div", "fx-boot", "<span>AEGIS // SYSTEM ONLINE</span>"), edge = el("div", "fx-edge");
  document.body.append(spot, scan, frame, boot, edge);

  // keep the backdrop centred on the orb, also while the orb zone animates between welcome and chat
  const place = () => {
    if (!zone) return;
    const r = zone.getBoundingClientRect();
    if (!r.width) return;
    hud.style.setProperty("--ox", (r.left + r.width / 2).toFixed(1) + "px");
    hud.style.setProperty("--oy", (r.top + r.height / 2).toFixed(1) + "px");
  };
  let placing = 0;
  const trackPlace = (ms) => { const end = performance.now() + ms; cancelAnimationFrame(placing); const f = () => { place(); if (performance.now() < end) placing = requestAnimationFrame(f); }; f(); };
  window.addEventListener("resize", () => trackPlace(200));
  if (window.ResizeObserver && zone) new ResizeObserver(() => trackPlace(120)).observe(zone);
  trackPlace(1500);

  // ---- orb extras
  if (zone) {
    zone.insertBefore(el("div", "orb-sweep"), zone.firstChild);
    zone.insertBefore(el("div", "orb-halo"), zone.firstChild);
    const deco = zone.querySelector(".orb-deco");
    if (deco) {
      const NS = "http://www.w3.org/2000/svg";
      const mk = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); (parent || deco).appendChild(n); return n; };
      mk("circle", { cx: 200, cy: 200, r: 196, class: "d-tick" }, mk("g", { class: "d-spin s5" }));
      mk("circle", { cx: 200, cy: 200, r: 183, class: "d-arc" }, mk("g", { class: "d-spin s3" }));
      mk("circle", { cx: 200, cy: 200, r: 168, class: "d-arc a2" }, mk("g", { class: "d-spin s4" }));
    }
    // readouts beside the orb
    const rl = el("div", "hud-read l"), rr = el("div", "hud-read r");
    zone.append(rl, rr);
    const upd = () => {
      if (document.hidden) return;
      const st = ($("orb-label") && $("orb-label").textContent || "").trim() || "Standby";
      const lk = ($("link-pill") && $("link-pill").textContent || "").trim() || "Offline";
      const d = new Date(), p = (n) => String(n).padStart(2, "0");
      rl.innerHTML = `State<br><b>${st}</b><br>Link<br><b>${lk}</b>`;
      rr.innerHTML = `Local time<br><b>${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}</b><br>Display<br><b>Holo HUD</b>`;
    };
    upd(); setInterval(upd, 1000);
    zone.addEventListener("pointerdown", () => { shock(); if (window.__aegisOrb && window.__aegisOrb.poke) window.__aegisOrb.poke(); }, { passive: true });
  }

  // ---- pointer spotlight
  if (fine) {
    let x = innerWidth / 2, y = innerHeight / 3, tx = x, ty = y, raf = 0;
    const tick = () => { raf = 0; x += (tx - x) * 0.14; y += (ty - y) * 0.14; spot.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`; if (Math.abs(tx - x) + Math.abs(ty - y) > 0.5) raf = requestAnimationFrame(tick); };
    window.addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY; spot.classList.add("on"); if (!raf && !calm() && !document.hidden) raf = requestAnimationFrame(tick); }, { passive: true });
    document.addEventListener("pointerleave", () => spot.classList.remove("on"));
  }

  // ---- impact rings + edge pulse on every state change
  function shock() {
    if (!zone || calm() || document.hidden) return;
    ["", "b", "c"].forEach((c) => { const r = el("i", "fx-shock " + c); zone.insertBefore(r, zone.firstChild); setTimeout(() => r.remove(), 1800); });
  }
  const flashEdge = () => { edge.classList.remove("go"); void edge.offsetWidth; edge.classList.add("go"); };
  if (stage) {
    let prev = stage.dataset.state;
    new MutationObserver(() => {
      const now = stage.dataset.state; if (now !== prev) {
        prev = now; syncState();
        if (!app.classList.contains("hidden") && !calm()) { shock(); if (now === "listening" || now === "thinking" || now === "speaking") flashEdge(); }
      }
    }).observe(stage, { attributes: true, attributeFilter: ["data-state"] });
    new MutationObserver(() => trackPlace(900)).observe(stage, { attributes: true, attributeFilter: ["data-chat"] });
  }

  // ---- boot sequence whenever the app becomes visible
  let was = app.classList.contains("hidden");
  const playBoot = () => { if (calm()) return; boot.classList.remove("go"); void boot.offsetWidth; boot.classList.add("go"); setTimeout(() => { place(); shock(); }, 380); };
  new MutationObserver(() => { const now = app.classList.contains("hidden"); if (was && !now) { trackPlace(1500); playBoot(); } was = now; }).observe(app, { attributes: true, attributeFilter: ["class"] });
  if (!was) setTimeout(playBoot, 120);

  // ---- card shine + magnetic buttons
  document.querySelectorAll(".qcard").forEach((c) => c.appendChild(el("span", "fx-shine")));
  if (fine) {
    document.querySelectorAll(".send, .composer .icon-btn, .topbar .icon-btn, .palette-btn").forEach((b) => {
      b.classList.add("fx-mag");
      b.addEventListener("pointermove", (e) => { const r = b.getBoundingClientRect(); b.style.translate = `${(((e.clientX - (r.left + r.width / 2)) / r.width) * 7).toFixed(1)}px ${(((e.clientY - (r.top + r.height / 2)) / r.height) * 6).toFixed(1)}px`; }, { passive: true });
      b.addEventListener("pointerleave", () => { b.style.translate = ""; });
    });
  }
  document.addEventListener("visibilitychange", () => document.body.classList.toggle("fx-paused", document.hidden));
})();
