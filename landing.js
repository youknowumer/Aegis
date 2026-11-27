/* Aegis landing: curved WebGL gallery with a glass rim and RGB edge lights.
   - ten feature cards drawn on canvas (no remote images, so a strict CSP is fine)
   - one WebGL scene (background + 30 wrapped card meshes) rendered into a target
   - a full-screen glass pass that refracts the rim and drifts red, green and blue light around the border
   Motion is scroll driven with eased inertia. Only the edge lights and the spinning cross move on their own. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const pad = (n) => String(n).padStart(2, "0");
  const R = Math.random;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ================================================================== content */
  const CARDS = [
    { key: "voice",     label: "VOX CALL",  desc: "Say Hey Aegis and talk. It answers out loud in short, natural sentences, and risky actions still wait for your Allow." },
    { key: "meetings",  label: "MEET LOG",  desc: "Record a call and Aegis writes the notes: ranked key points, action items with owners and ideas worth keeping." },
    { key: "files",     label: "FILE SORT", desc: "Ask in plain English and Aegis lists, reads and sorts your files, only inside Documents, Desktop and Downloads." },
    { key: "memory",    label: "MEM BANK",  desc: "Tell it once and it remembers. Every saved fact sits in a panel where you can delete it in one click." },
    { key: "commands",  label: "INST CMD",  desc: "Timers, notes, maths and app launches run in your browser in milliseconds, free and without the server." },
    { key: "control",   label: "ASK FIRST", desc: "Reading and opening happen straight away. Anything that changes or removes something stops and waits for your yes." },
    { key: "interface", label: "ONE SCRN",  desc: "Tasks on the left, the conversation in the middle, a live activity log on the right. Nothing happens out of sight." },
    { key: "plans",     label: "PLAN TIER", desc: "Start free with 15 messages a day. Plans differ only by how many messages you can send." },
    { key: "download",  label: "WIN APP",   desc: "The web app runs anywhere. The Windows app adds PC control, with the same account and the same memory." },
    { key: "faq",       label: "FAQ 08",    desc: "Eight answers to what people ask first: safety, Mac and Linux, updates, memory and voice." },
  ];
  const ALIAS = { what: "files", how: "interface", platform: "commands", see: "voice", ui: "interface", pc: "download", windows: "download", questions: "faq" };
  const N = CARDS.length;

  /* ================================================================== posters (2D canvas, aspect .68) */
  const PW = 640, PH = 941;
  const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
  const font = (px, wt = 500) => `${wt} ${px}px ${MONO}`;
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  function hud(c, i, label, col, sub) {
    c.save();
    c.fillStyle = col; c.font = font(22); c.textBaseline = "alphabetic"; c.textAlign = "left";
    c.fillText("AEG/" + pad(i + 1), 28, 50);
    c.textAlign = "right"; c.fillText(sub || "V1", PW - 28, 50);
    c.textAlign = "left"; c.fillText(label, 28, PH - 28);
    c.textAlign = "right"; c.fillText("\u25CF\u25CF\u25CF", PW - 28, PH - 28);
    c.restore();
  }

  const POSTERS = [
    function voice(c) {
      c.fillStyle = "#050508"; c.fillRect(0, 0, PW, PH);
      const r = rng(11), n = 40, bw = (PW * .84) / n, x0 = PW * .08, cy = PH * .44;
      const amps = []; for (let i = 0; i < n; i++) amps.push((.2 + .8 * r()) * Math.sin(((i + .5) / n) * Math.PI));
      c.globalCompositeOperation = "lighter";
      [["#ff2d6f", -7], ["#14ffe0", 7], ["#4650ff", 0]].forEach(([col, dx]) => {
        c.fillStyle = col;
        amps.forEach((a, i) => { const h = a * PH * .42 + 6; c.fillRect(x0 + i * bw + dx, cy - h / 2, bw * .58, h); });
      });
      c.globalCompositeOperation = "source-over";
      c.fillStyle = "rgba(0,0,0,.4)"; for (let y = 0; y < PH; y += 5) c.fillRect(0, y, PW, 2);
      c.fillStyle = "#e7e4ee"; c.font = font(34); c.textAlign = "left"; c.fillText("\u201CHey Aegis\u201D", 28, PH * .8);
      c.fillStyle = "rgba(231,228,238,.6)"; c.font = font(20); c.fillText("LISTENING  00:03", 28, PH * .8 + 36);
      hud(c, 0, "VOX CALL", "#e7e4ee", "WHISPER");
    },
    function meetings(c) {
      const g = c.createLinearGradient(0, 0, PW * .4, PH);
      g.addColorStop(0, "#ff8a3d"); g.addColorStop(.55, "#d6407a"); g.addColorStop(1, "#4a2bd6");
      c.fillStyle = g; c.fillRect(0, 0, PW, PH);
      const r = rng(22); let y = 130;
      for (let i = 0; i < 9; i++) {
        const w = PW * (.34 + r() * .48), hot = i === 2 || i === 6;
        if (hot) { c.fillStyle = "#0b0b10"; c.fillRect(28, y - 14, w + 24, 36); }
        c.fillStyle = hot ? "#ffd9a8" : "rgba(11,11,16,.78)"; c.fillRect(40, y, w, 9); y += 50;
      }
      c.fillStyle = "#0b0b10"; c.font = font(76); c.textAlign = "left"; c.fillText("00:42", 28, PH * .745);
      c.fillStyle = "#ff2a3d"; c.beginPath(); c.arc(PW - 54, PH * .745 - 28, 11, 0, 7); c.fill();
      ["POINTS", "ACTIONS", "IDEAS"].forEach((t, i) => {
        const x = 28 + i * 196, yy = PH * .8;
        c.strokeStyle = "#0b0b10"; c.lineWidth = 2; c.strokeRect(x, yy, 180, 56);
        c.fillStyle = "#0b0b10"; c.font = font(20); c.fillText(t, x + 16, yy + 35);
      });
      hud(c, 1, "MEET LOG", "#0b0b10", "REC");
    },
    function files(c) {
      c.fillStyle = "#0a0a0a"; c.fillRect(0, 0, PW, PH);
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], s = 8, lim = PH * .5;
      c.fillStyle = "#f2f2f2";
      for (let y = 70; y < lim; y += s) for (let x = 0; x < PW; x += s) {
        const v = clamp(1 - ((x / PW) * .55 + ((y - 70) / (lim - 70)) * .8), 0, 1);
        if (v > (bayer[((y / s) & 3) * 4 + ((x / s) & 3)] + .5) / 16) c.fillRect(x, y, s, s);
      }
      c.fillStyle = "#f2f2f2"; c.font = font(26); c.textAlign = "left"; c.fillText("23 FILES \u2192 5 FOLDERS", 28, PH * .58);
      const names = ["IMG", "DOC", "VID", "AUD", "ZIP"], cw = (PW - 56) / 5, counts = [5, 4, 3, 6, 2];
      names.forEach((n, i) => {
        const x = 28 + i * cw;
        for (let k = 0; k < counts[i]; k++) { c.fillStyle = k % 2 ? "#f2f2f2" : "#a9a9a9"; c.fillRect(x + 2, PH * .87 - k * 30 - 26, cw - 12, 22); }
        c.fillStyle = "#f2f2f2"; c.font = font(18); c.fillText(n, x + 2, PH * .87 + 22);
      });
      hud(c, 2, "FILE SORT", "#f2f2f2", "3 FOLDERS");
    },
    function memory(c) {
      c.fillStyle = "#1b38ff"; c.fillRect(0, 0, PW, PH);
      const r = rng(44);
      for (let y = 78; y < PH - 90; y += 28) for (let x = 28; x < PW - 20; x += 28) { c.fillStyle = r() > .87 ? "#a9b9ff" : "rgba(6,8,40,.32)"; c.fillRect(x, y, 12, 12); }
      const S = ["XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", ".XXXXXXXXXXXX.", ".XXXXXXXXXXXX.", "..XXXXXXXXXX..", "...XXXXXXXX...", "....XXXXXX....", ".....XXXX.....", "......XX......"];
      const px = 28, ox = (PW - 14 * px) / 2, oy = PH * .25;
      c.fillStyle = "#07091f"; S.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "X") c.fillRect(ox + i * px + 12, oy + j * px + 12, px, px); }));
      S.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "X") { c.fillStyle = i < 7 ? "#ff2a3d" : "#c9172c"; c.fillRect(ox + i * px, oy + j * px, px, px); } }));
      c.fillStyle = "#ffd1d6"; for (let i = 0; i < 14; i++) c.fillRect(ox + i * px, oy, px, 6);
      c.fillStyle = "#07091f"; [[3, 6], [4, 7], [5, 8], [6, 7], [7, 6], [8, 5], [9, 4]].forEach(([i, j]) => c.fillRect(ox + i * px, oy + j * px, px, px));
      c.fillStyle = "#fff"; c.font = font(30); c.textAlign = "left"; c.fillText("12 FACTS SAVED", 28, PH * .8);
      c.fillStyle = "rgba(255,255,255,.7)"; c.font = font(20); c.fillText("DELETE ANY, ANY TIME", 28, PH * .8 + 34);
      hud(c, 3, "MEM BANK", "#fff", "EDITABLE");
    },
    function commands(c) {
      c.fillStyle = "#050507"; c.fillRect(0, 0, PW, PH);
      const g = c.createLinearGradient(0, PH * .14, 0, PH * .34);
      g.addColorStop(0, "#ffffff"); g.addColorStop(.35, "#8d93a8"); g.addColorStop(.5, "#1d1e26"); g.addColorStop(.62, "#cfd3e2"); g.addColorStop(1, "#ffffff");
      c.fillStyle = g; c.font = font(112); c.textAlign = "center"; c.fillText("CTRL+K", PW / 2, PH * .3);
      c.textAlign = "left";
      const bx = 40, by = PH * .42, bw = PW - 80;
      c.strokeStyle = "#4a4d5c"; c.lineWidth = 2; c.strokeRect(bx, by, bw, 300);
      c.fillStyle = "rgba(231,228,238,.14)"; c.fillRect(bx + 2, by + 70, bw - 4, 56);
      c.font = font(26);
      [["> open YouTube", 40], ["> time in Tokyo", 110], ["> timer 10 min", 180], ["> note buy milk", 250]].forEach(([t, dy], i) => {
        c.fillStyle = i === 1 ? "#ffffff" : "#aeb2c4"; c.fillText(t, bx + 24, by + dy + 4);
      });
      c.fillStyle = "#e7e4ee"; c.font = font(64); c.fillText("<1 MS", 28, PH * .86);
      hud(c, 4, "INST CMD", "#aeb2c4", "LOCAL");
    },
    function control(c) {
      c.fillStyle = "#e3ff1f"; c.fillRect(0, 0, PW, PH);
      c.fillStyle = "#0a0a0a"; c.font = font(146); c.textAlign = "left"; c.fillText("ALLOW?", 20, PH * .27);
      const cx = PW / 2, cy = PH * .46, rr = 92;
      c.strokeStyle = "rgba(10,10,10,.22)"; c.lineWidth = 12; c.beginPath(); c.arc(cx, cy, rr, 0, 7); c.stroke();
      c.strokeStyle = "#0a0a0a"; c.beginPath(); c.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 1.5); c.stroke();
      c.fillStyle = "#0a0a0a"; c.font = font(54); c.textAlign = "center"; c.fillText("60s", cx, cy + 18); c.textAlign = "left";
      for (let y = PH * .62; y < PH * .78; y += 18) for (let x = 14; x < PW; x += 18) { const rad = 1 + ((y - PH * .62) / (PH * .16)) * 6.5; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill(); }
      c.fillRect(28, PH * .81, 290, 58); c.fillStyle = "#e3ff1f"; c.font = font(24); c.fillText("ALLOW", 54, PH * .81 + 37);
      c.strokeStyle = "#0a0a0a"; c.lineWidth = 3; c.strokeRect(332, PH * .81, 280, 58); c.fillStyle = "#0a0a0a"; c.fillText("DENY", 360, PH * .81 + 37);
      hud(c, 5, "ASK FIRST", "#0a0a0a", "18 / 65");
    },
    function iface(c) {
      c.fillStyle = "#04070a"; c.fillRect(0, 0, PW, PH);
      c.strokeStyle = "#35ff7a"; c.fillStyle = "#35ff7a"; c.lineWidth = 2; c.shadowColor = "#35ff7a"; c.shadowBlur = 12;
      const top = 110, ph = PH * .56;
      c.strokeRect(28, top, 150, ph); c.strokeRect(PW - 178, top, 150, ph);
      for (let i = 0; i < 6; i++) { c.strokeRect(42, top + 24 + i * 70, 14, 14); c.fillRect(66, top + 29 + i * 70, 90 - (i % 3) * 18, 4); c.fillRect(66, top + 47 + i * 70, 60, 3); }
      c.strokeRect(PW - 164, top + 24, 122, 70); c.fillRect(PW - 150, top + 44, 70, 4); c.fillRect(PW - 150, top + 62, 40, 4);
      for (let i = 0; i < 3; i++) { c.strokeRect(PW - 164, top + 130 + i * 60, 122, 8); c.fillRect(PW - 164, top + 130 + i * 60, 122 * [.86, .42, .68][i], 8); }
      const cx = PW / 2, cy = top + ph * .42, r = 112;
      c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke();
      for (let k = -2; k <= 2; k++) { const a = k * .5, y = cy + r * Math.sin(a), rx = r * Math.cos(a); c.beginPath(); c.ellipse(cx, y, rx, rx * .26, 0, 0, 7); c.stroke(); }
      for (let k = 1; k <= 3; k++) { c.beginPath(); c.ellipse(cx, cy, Math.max(1, Math.abs(r * Math.cos((k * Math.PI) / 6 + .12))), r, 0, 0, 7); c.stroke(); }
      c.strokeRect(205, top + ph - 60, PW - 410, 40); c.fillRect(218, top + ph - 44, 90, 4);
      c.shadowBlur = 0; c.font = font(22); c.textAlign = "left"; c.fillText("TASKS \u00B7 CHAT \u00B7 LOG", 28, PH * .81);
      hud(c, 6, "ONE SCRN", "#35ff7a", "3 PANELS");
    },
    function plans(c) {
      const bg = c.createLinearGradient(0, 0, 0, PH); bg.addColorStop(0, "#14121c"); bg.addColorStop(1, "#0a0910");
      c.fillStyle = bg; c.fillRect(0, 0, PW, PH);
      const base = PH * .8, bars = [[15, 120, "15"], [150, 330, "150"], [1000, 540, "1,000"]], bw = 170, gap = 30, x0 = (PW - (3 * bw + 2 * gap)) / 2;
      bars.forEach(([, h, label], i) => {
        const x = x0 + i * (bw + gap), g = c.createLinearGradient(x, base - h, x + bw, base);
        g.addColorStop(0, "#ffd1f3"); g.addColorStop(.35, "#b6a5ff"); g.addColorStop(.7, "#9be6ff"); g.addColorStop(1, "#a8ffd9");
        c.fillStyle = g; c.fillRect(x, base - h, bw, h);
        c.save(); c.beginPath(); c.rect(x, base - h, bw, h); c.clip();
        c.fillStyle = "rgba(255,255,255,.16)"; for (let k = -h; k < bw; k += 26) { c.beginPath(); c.moveTo(x + k, base); c.lineTo(x + k + h, base - h); c.lineTo(x + k + h + 10, base - h); c.lineTo(x + k + 10, base); c.fill(); }
        c.restore();
        c.fillStyle = "#e7e4ee"; c.font = font(46); c.textAlign = "center"; c.fillText(label, x + bw / 2, base - h - 16);
      });
      c.textAlign = "left"; c.fillStyle = "rgba(231,228,238,.6)"; c.font = font(20); c.fillText("MESSAGES / DAY", 28, base + 40);
      c.fillStyle = "#e7e4ee"; c.textAlign = "center"; ["FREE", "BASIC", "POWER"].forEach((n, i) => c.fillText(n, x0 + i * (bw + gap) + bw / 2, base + 78)); c.textAlign = "left";
      hud(c, 7, "PLAN TIER", "#e7e4ee", "3 PLANS");
    },
    function windows(c) {
      const g = c.createLinearGradient(0, 0, PW, PH);
      g.addColorStop(0, "#c8d6ff"); g.addColorStop(.35, "#ffd0f0"); g.addColorStop(.7, "#c6fff0"); g.addColorStop(1, "#cdb8ff");
      c.fillStyle = g; c.fillRect(0, 0, PW, PH);
      const b1 = c.createRadialGradient(PW * .2, PH * .2, 0, PW * .2, PH * .2, PW * .7); b1.addColorStop(0, "rgba(255,255,255,.7)"); b1.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = b1; c.fillRect(0, 0, PW, PH);
      // an installer window with the Aegis shield inside
      const wx = 70, wy = PH * .13, ww = PW - 140, wh = 330;
      c.fillStyle = "#0e0d15"; c.fillRect(wx, wy, ww, wh);
      c.fillStyle = "#1c1b27"; c.fillRect(wx, wy, ww, 40);
      ["#ff5f57", "#febc2e", "#28c840"].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(wx + 24 + i * 24, wy + 20, 7, 0, 7); c.fill(); });
      c.strokeStyle = "#e7e4ee"; c.lineWidth = 6; c.lineJoin = "round"; c.lineCap = "round";
      const sx = wx + ww / 2, sy = wy + 190;
      c.beginPath(); c.moveTo(sx, sy - 100); c.lineTo(sx + 78, sy - 70); c.lineTo(sx + 78, sy + 4); c.quadraticCurveTo(sx + 78, sy + 74, sx, sy + 104); c.quadraticCurveTo(sx - 78, sy + 74, sx - 78, sy + 4); c.lineTo(sx - 78, sy - 70); c.closePath(); c.stroke();
      c.beginPath(); c.moveTo(sx - 34, sy + 2); c.lineTo(sx - 8, sy + 30); c.lineTo(sx + 40, sy - 26); c.stroke();
      c.strokeStyle = "#0b0a12"; c.lineWidth = 8; c.lineCap = "round"; c.lineJoin = "round";
      const cx = PW / 2, ay = PH * .6;
      c.strokeStyle = "#0b0a12"; c.beginPath(); c.moveTo(cx, ay - 70); c.lineTo(cx, ay + 50); c.moveTo(cx - 44, ay + 8); c.lineTo(cx, ay + 52); c.lineTo(cx + 44, ay + 8); c.stroke();
      c.beginPath(); c.moveTo(cx - 90, ay + 90); c.lineTo(cx - 90, ay + 120); c.lineTo(cx + 90, ay + 120); c.lineTo(cx + 90, ay + 90); c.stroke();
      c.fillStyle = "#0b0a12"; c.font = font(44); c.textAlign = "left"; c.fillText("138 MB", 28, PH * .86);
      c.font = font(20); c.fillText("WINDOWS 10 / 11 \u00B7 64-BIT", 28, PH * .86 + 32);
      hud(c, 8, "WIN APP", "#0b0a12", "SETUP.EXE");
    },
    function faq(c) {
      const g = c.createLinearGradient(0, 0, PW * .6, PH); g.addColorStop(0, "#c9b3ff"); g.addColorStop(1, "#ff9fd2");
      c.fillStyle = g; c.fillRect(0, 0, PW, PH);
      c.fillStyle = "#0d0c12"; c.font = font(700); c.textAlign = "center"; c.fillText("?", PW / 2, PH * .72);
      c.fillStyle = "rgba(255,255,255,.55)";
      for (let y = 20; y < PH * .72; y += 22) for (let x = 11 + ((y / 22) & 1) * 11; x < PW; x += 22) { const rad = 1 + ((y / PH) * 4.2); c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill(); }
      c.fillStyle = "#0d0c12"; c.font = font(72); c.textAlign = "left"; c.fillText("08", 28, PH * .9);
      hud(c, 9, "FAQ 08", "#0d0c12", "ASK ANYTHING");
    },
  ];

  function makePoster(i) {
    const cv = document.createElement("canvas");
    cv.width = PW; cv.height = PH;
    const c = cv.getContext("2d");
    c.textBaseline = "alphabetic";
    POSTERS[i](c);
    return cv;
  }

  /* ================================================================== shared ui (works even without WebGL) */
  const stage = $("stage"), ov = $("ov"), ovCv = $("ov-cv"), ovBody = $("ov-body"), ovCopy = $("ov-copy");
  const panelsBox = $("panels");
  let posters = [];
  let ovOpen = false, curPanel = null, restoreT = 0, lastFocus = null;
  const hooks = { onOpen: null };

  // account state: the app link changes when somebody is already signed in
  let signedIn = false;
  try { signedIn = !!localStorage.getItem("aegis_token"); } catch (e) { /* storage blocked */ }
  if (signedIn) {
    $("signin-link").style.display = "none";
    const s = $("start-link"); s.textContent = "Open app"; s.setAttribute("href", "app.html");
  }
  const yr = $("year"); if (yr) yr.textContent = new Date().getFullYear();

  // toast
  let toastT = 0;
  function toast(msg) {
    const el = $("toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 1800);
  }

  // sfx: tiny square-wave blips
  let actx = null, sfxOn = false;
  function beep(freq, dur, force) {
    if (!sfxOn && !force) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = actx || new AC(); if (actx.state === "suspended") actx.resume();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime, d = dur || .07;
      o.type = "square"; o.frequency.value = freq;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.035, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d + .03);
    } catch (e) { /* audio not available */ }
  }
  $("sfx").addEventListener("click", () => {
    sfxOn = !sfxOn; $("sfx").setAttribute("aria-pressed", String(sfxOn));
    if (sfxOn) beep(660, .08, true);
  });

  // background tint
  const PAL = { black: [.055, .055, .065], red: [.085, .05, .06], green: [.059, .055, .078], yellow: [.08, .075, .05], blue: [.05, .06, .09] };
  const baseT = PAL.green.slice();
  $("pal").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-c]"); if (!b) return;
    $("pal").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    const v = PAL[b.dataset.c]; if (v) { baseT[0] = v[0]; baseT[1] = v[1]; baseT[2] = v[2]; }
  });

  $("btn-about").addEventListener("click", () => toast("Aegis: an AI assistant for the web and Windows"));

  // panels: each card has a hidden section that is moved into the overlay while it is open
  const panels = CARDS.map((c) => $("pn-" + c.key));
  function restorePanel() {
    clearTimeout(restoreT);
    if (curPanel) { panelsBox.appendChild(curPanel); curPanel = null; }
  }

  // overlay
  const blocks = $("ov-blocks");
  for (let i = 0; i < 35; i++) blocks.appendChild(document.createElement("i"));
  const ovCtx = ovCv.getContext("2d");

  function openCard(id) {
    if (ovOpen || id < 0 || id >= N) return;
    ovOpen = true; lastFocus = document.activeElement;
    restorePanel();
    const c = CARDS[id];
    $("ov-no").textContent = "Feature " + pad(id + 1);
    $("ov-h").textContent = c.label;
    $("ov-p").textContent = c.desc;
    if (panels[id]) { curPanel = panels[id]; ovBody.appendChild(curPanel); }
    ovCv.width = PW; ovCv.height = PH; ovCtx.drawImage(posters[id], 0, 0);
    blocks.querySelectorAll("i").forEach((b) => b.style.setProperty("--d", (reduce ? 0 : 300 + R() * 700) + "ms"));
    ovCopy.scrollTop = 0;
    stage.setAttribute("inert", ""); ov.removeAttribute("inert");
    void ov.offsetWidth;
    ov.classList.add("open");
    beep(440, .08);
    try { history.replaceState(null, "", "#" + c.key); } catch (e) { /* file:// */ }
    setTimeout(() => $("ov-x").focus({ preventScroll: true }), 60);
    if (hooks.onOpen) hooks.onOpen();
  }
  function closeCard() {
    if (!ovOpen) return;
    ovOpen = false;
    ov.classList.remove("open"); ov.setAttribute("inert", ""); stage.removeAttribute("inert");
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* file:// */ }
    restoreT = setTimeout(restorePanel, 780);
    const f = lastFocus; lastFocus = null;
    if (f && document.contains(f) && f.focus) f.focus({ preventScroll: true });
  }
  $("ov-x").addEventListener("click", closeCard);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && ovOpen) { e.preventDefault(); closeCard(); } });

  // links inside a panel that point at another card (#plans, #download ...) switch cards without a reload
  function idFromHash() {
    let k = decodeURIComponent((location.hash || "").slice(1)).toLowerCase();
    if (ALIAS[k]) k = ALIAS[k];
    return CARDS.findIndex((c) => c.key === k);
  }

  // keyboard and screen reader list
  const fx = $("fx-list");
  CARDS.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "lk"; b.textContent = pad(i + 1) + " " + c.label;
    b.addEventListener("click", () => openCard(i));
    fx.appendChild(b);
  });

  /* ================================================================== WebGL */
  const VERT_CARD = `
    uniform float uX, uS, uGrid, uMob, uCW;
    uniform vec2 uRes;
    uniform vec4 uGR;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      float W = uRes.x, H = uRes.y;
      float k  = mix(1.0, 1.6, uMob);
      float tb = mix(0.217, 0.26, uMob);
      float bb = mix(0.659, 0.60, uMob);
      float xc = W * 0.5 + uX * W;
      float px = xc + position.x * uCW * W;
      float topY = H * (tb - 0.03  * smoothstep(0.30, 0.45, abs(px - W * 0.5) / W * k));
      float botY = H * (bb - 0.135 * smoothstep(0.12, 0.39, abs(uX) * k));
      float topC = H * (tb - 0.03  * smoothstep(0.30, 0.45, abs(uX) * k));
      float t = position.y + 0.5;
      vec2 p = vec2(px, mix(botY, topY, t));
      vec2 ctr = vec2(xc, (topC + botY) * 0.5);
      p = ctr + (p - ctr) * uS;
      vec2 g = vec2(uGR.x + uv.x * uGR.z, uGR.y + (1.0 - uv.y) * uGR.w);
      vec2 gc = uGR.xy + uGR.zw * 0.5;
      g = gc + (g - gc) * uS;
      p = mix(p, g, uGrid);
      gl_Position = vec4(p.x / W * 2.0 - 1.0, 1.0 - p.y / H * 2.0, 0.0, 1.0);
    }`;

  const FRAG_CARD = `
    uniform sampler2D uTex;
    uniform vec2 uSize;
    uniform float uRev, uHover, uSeed, uFade, uLoaded;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 p = (vUv - 0.5) * uSize;
      float rad = uSize.x * 0.048;
      vec2 q = abs(p) - uSize * 0.5 + rad;
      float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
      float a = 1.0 - smoothstep(-0.8, 0.8, d);
      vec3 col = vec3(0.05);
      if (uLoaded > 0.5) {
        col = texture2D(uTex, vUv).rgb;
        vec2 cell = floor(vec2(vUv.x * 5.0, vUv.y * 7.0));
        float r = hash(cell + uSeed) * 0.92 + 0.04;
        if (r > uRev) {
          vec3 dark = vec3(0.043, 0.043, 0.058);
          if (r < uRev + 0.12) {
            vec3 pix = texture2D(uTex, (cell + 0.5) / vec2(5.0, 7.0)).rgb * 0.8;
            col = mix(dark, pix, 0.85);
          } else col = dark;
        }
      }
      col *= 1.0 + 0.08 * uHover;
      gl_FragColor = vec4(col, a * uFade);
    }`;

  const VERT_QUAD = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  const FRAG_BG = `
    uniform vec3 uBase;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      float r = clamp(length((vUv - 0.5) * 2.0) / 1.41421356, 0.0, 1.0);
      vec3 col = uBase * (1.0 + 0.25 * (1.0 - r));
      col += (hash(gl_FragCoord.xy) - 0.5) * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }`;

  const FRAG_GLASS = `
    uniform sampler2D tScene;
    uniform vec2 uRes;
    uniform float uTime;
    varying vec2 vUv;
    float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      float W = uRes.x, H = uRes.y, m = min(W, H);
      vec2 px = uv * uRes, c = uRes * 0.5;
      float R = 0.22 * m;
      float d = -sdRound(px - c, c, R);
      float rim = 0.17 * m * (1.0 + 0.3 * (1.0 - smoothstep(0.0, 0.25, uv.y)));
      float t = clamp(1.0 - d / rim, 0.0, 1.0);

      vec2 e = vec2(1.0, 0.0);
      vec2 g = vec2(sdRound(px + e.xy - c, c, R) - sdRound(px - e.xy - c, c, R),
                    sdRound(px + e.yx - c, c, R) - sdRound(px - e.yx - c, c, R));
      vec2 n = normalize(g + vec2(1e-6));
      vec2 tg = vec2(-n.y, n.x);
      float off = t * t * rim * 0.46;
      float spread = t * t * t * 0.003 * m;

      vec3 col = vec3(0.0);
      for (int i = 0; i < 5; i++) {
        float s = (float(i) - 2.0) * 0.5 * spread;
        col.r += texture2D(tScene, (px - n * off * 1.06 + tg * s) / uRes).r;
        col.g += texture2D(tScene, (px - n * off * 1.00 + tg * s) / uRes).g;
        col.b += texture2D(tScene, (px - n * off * 0.94 + tg * s) / uRes).b;
      }
      col /= 5.0;

      float ang = atan((px.y - H * 0.5) / H, (px.x - W * 0.5) / W);
      float T = uTime;
      float lr = 0.5 + 0.5 * (0.62 * sin(2.0 * ang + 0.55 * T) + 0.38 * sin(3.0 * ang - 0.41 * T + 1.7));
      float lg = 0.5 + 0.5 * (0.62 * sin(2.0 * ang - 0.47 * T + 2.3) + 0.38 * sin(ang - 0.33 * T + 4.1));
      float lb = 0.5 + 0.5 * (0.62 * sin(ang + 0.38 * T + 4.6) + 0.38 * sin(3.0 * ang + 0.52 * T + 0.9));
      vec3 L = vec3(smoothstep(0.32, 0.9, lr), smoothstep(0.32, 0.9, lg), smoothstep(0.32, 0.9, lb));
      L.g *= 1.0 - 0.65 * L.r;
      float xEdge = min(px.x, W - px.x);
      float k = clamp(min(min(xEdge / (0.12 * W), px.y / (0.19 * H)), (H - px.y) / (0.09 * H)), 0.0, 1.0);
      float mask = pow(1.0 - k, 1.7);
      vec3 light = L + vec3(0.16, 0.15, 0.34);
      light = mix(light, vec3(dot(light, vec3(0.299, 0.587, 0.114))), 0.12);
      col += light * mask * 0.34;
      col += (hash(gl_FragCoord.xy) - 0.5) * 0.006;
      gl_FragColor = vec4(col, 1.0);
    }`;

  function startGL() {
    if (typeof THREE === "undefined") return false;
    const canvas = $("gl");
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" }); }
    catch (e) { return false; }
    renderer.setClearColor(0x0f0e14, 1);

    const S = { W: innerWidth, H: innerHeight, dpr: 1, mob: false, cardW: .174, pitch: .1786, span: 30 * .1786, pos: 0, target: 0, g: 0, gt: 0, ge: 0, time: 0, vel: 0, spin: 1, center: -1 };
    const uResV = new THREE.Vector2(S.W, S.H);
    const baseV = new THREE.Vector3(baseT[0], baseT[1], baseT[2]);

    // ---- scene A: background + 30 wrapped cards, drawn into a render target
    const rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
    rt.texture.generateMipmaps = false;
    const sceneA = new THREE.Scene(), sceneB = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { uBase: { value: baseV } }, vertexShader: VERT_QUAD, fragmentShader: FRAG_BG, depthTest: false, depthWrite: false,
    }));
    bg.frustumCulled = false; bg.renderOrder = 0; sceneA.add(bg);

    const textures = posters.map((cv) => {
      const t = new THREE.CanvasTexture(cv);
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      return t;
    });
    const cardGeo = new THREE.PlaneGeometry(1, 1, 48, 1);
    const meshes = [];
    for (let i = 0; i < 30; i++) {
      const id = i % N;
      const u = {
        uTex: { value: textures[id] }, uX: { value: 0 }, uS: { value: 1 }, uGrid: { value: 0 }, uGR: { value: new THREE.Vector4() },
        uRes: { value: uResV }, uMob: { value: 0 }, uCW: { value: S.cardW }, uSize: { value: new THREE.Vector2(1, 1) },
        uRev: { value: 0 }, uHover: { value: 0 }, uSeed: { value: id * 3.7 + 1.3 }, uFade: { value: 1 }, uLoaded: { value: 1 },
      };
      const mesh = new THREE.Mesh(cardGeo, new THREE.ShaderMaterial({
        uniforms: u, vertexShader: VERT_CARD, fragmentShader: FRAG_CARD, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }));
      mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.visible = false; sceneA.add(mesh);
      const lb = document.createElement("div"); lb.className = "lb"; lb.textContent = pad(id + 1) + " " + CARDS[id].label;
      $("labels").appendChild(lb);
      meshes.push({ i, id, mesh, u, lb, x: 0, s: 1, h: 0, on: false, rs: Infinity, rd: .75, rev: 0, owner: false, gr: [0, 0, 1, 1], topC: 0, botY: 0 });
    }

    // ---- scene B: the glass slab
    const post = { tScene: { value: rt.texture }, uRes: { value: uResV }, uTime: { value: 0 } };
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: post, vertexShader: VERT_QUAD, fragmentShader: FRAG_GLASS, depthTest: false, depthWrite: false }));
    quad.frustumCulled = false; sceneB.add(quad);

    // ---- layout
    const gridRects = new Array(N).fill(0).map(() => [0, 0, 1, 1]);
    function layoutGrid() {
      const W = S.W, H = S.H, cols = 5, gap = .012 * W;
      let cw = S.mob ? .17 * W : .13 * W, ch = cw / .68;
      const maxH = H * .7;
      if (ch * 2 + gap > maxH) { ch = (maxH - gap) / 2; cw = ch * .68; }
      const tw = cols * cw + (cols - 1) * gap, th = 2 * ch + gap, x0 = (W - tw) / 2, y0 = H * .47 - th / 2;
      for (let id = 0; id < N; id++) { const r = gridRects[id]; r[0] = x0 + (id % cols) * (cw + gap); r[1] = y0 + Math.floor(id / cols) * (ch + gap); r[2] = cw; r[3] = ch; }
      meshes.forEach((m) => { m.gr = gridRects[m.id]; });
    }
    function resize() {
      const W = innerWidth, H = innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2), mob = W < 760 || W / H < .8;
      const oldPitch = S.pitch;
      S.mob = mob; S.cardW = mob ? Math.min(.46, (.34 * H * .68) / W) : .174; S.pitch = S.cardW + .0046; S.span = 30 * S.pitch;
      if (oldPitch !== S.pitch) { const k = S.pitch / oldPitch; S.pos *= k; S.target *= k; }
      S.W = W; S.H = H; S.dpr = dpr;
      renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
      rt.setSize(Math.max(2, Math.round(W * dpr)), Math.max(2, Math.round(H * dpr)));
      uResV.set(W, H);
      meshes.forEach((m) => { m.u.uMob.value = mob ? 1 : 0; m.u.uCW.value = S.cardW; });
      layoutGrid();
      if (cross) cross.size();
    }

    // ---- CPU mirror of the vertex shader: u 0..1 left to right, v 0..1 top to bottom
    function wrap(v) { const sp = S.span; return ((((v + sp / 2) % sp) + sp) % sp) - sp / 2; }
    function cardPoint(m, u, v) {
      const W = S.W, H = S.H, k = S.mob ? 1.6 : 1, tb = S.mob ? .26 : .217, bb = S.mob ? .60 : .659;
      const xc = W * .5 + m.x * W, px = xc + (u - .5) * S.cardW * W;
      const topY = H * (tb - .03 * sstep(.30, .45, Math.abs(px - W * .5) / W * k));
      const cy = (m.topC + m.botY) * .5;
      let x = px, y = topY + (m.botY - topY) * v;
      x = xc + (x - xc) * m.s; y = cy + (y - cy) * m.s;
      if (S.ge > 0) {
        const r = m.gr, gcx = r[0] + r[2] / 2, gcy = r[1] + r[3] / 2;
        let gx = r[0] + u * r[2], gy = r[1] + v * r[3];
        gx = gcx + (gx - gcx) * m.s; gy = gcy + (gy - gcy) * m.s;
        x = lerp(x, gx, S.ge); y = lerp(y, gy, S.ge);
      }
      return [x, y];
    }
    function inPoly(pt, poly) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    }
    function pick(x, y) {
      let best = null, bd = 1e9;
      for (const m of meshes) {
        if (!m.mesh.visible || m.u.uFade.value < .5) continue;
        const poly = [];
        for (let k = 0; k <= 6; k++) poly.push(cardPoint(m, k / 6, 0));
        for (let k = 6; k >= 0; k--) poly.push(cardPoint(m, k / 6, 1));
        if (inPoly([x, y], poly)) { const d = Math.abs(m.x); if (d < bd) { bd = d; best = m; } }
      }
      return best;
    }

    // ---- cross (small second renderer, drawn with screen blending so black disappears)
    function initCross() {
      const cv = $("cross");
      let r;
      try { r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, powerPreference: "low-power" }); }
      catch (e) { $("cross-btn").style.display = "none"; return null; }
      r.setClearColor(0x000000, 0);
      const sc = new THREE.Scene(), cm = new THREE.PerspectiveCamera(28, 1912 / 1080, .1, 50);
      cm.position.set(0, 0, 10.5);
      const mat = new THREE.MeshPhongMaterial({ color: 0x15141c, specular: 0xb4b0ff, shininess: 70 });
      const grp = new THREE.Group();
      const hb = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.05, 1.05), mat), vb = new THREE.Mesh(new THREE.BoxGeometry(1.05, 3.4, 1.04), mat);
      [hb, vb].forEach((b) => { b.add(new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), new THREE.LineBasicMaterial({ color: 0x8d8aa8, transparent: true, opacity: .55 }))); grp.add(b); });
      sc.add(grp, new THREE.AmbientLight(0x30304a, 1.1));
      const l1 = new THREE.DirectionalLight(0xffffff, 1.15); l1.position.set(3, 4, 6);
      const l2 = new THREE.DirectionalLight(0xff4fb0, .9); l2.position.set(-5, -2, 3);
      const l3 = new THREE.DirectionalLight(0x4aa8ff, .9); l3.position.set(4, -4, -2);
      sc.add(l1, l2, l3);
      let ang = 0;
      return {
        size() { const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight); r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.setSize(w, h, false); },
        draw(dt, spin) { ang += dt * (Math.PI * 2 / 5) * spin; grp.rotation.set(.36, ang, 0); r.render(sc, cm); },
      };
    }
    const cross = initCross();

    resize();
    window.addEventListener("resize", resize);

    // ---- reveal + grid state
    let now = 0;
    function startReveal(m, delay) { m.on = true; m.rs = now + delay; m.rd = reduce ? .001 : .75; }
    function setGrid(on) {
      if (ovOpen) return;
      S.gt = on ? 1 : 0;
      root.classList.toggle("is-grid", on);
      $("btn-grid").setAttribute("aria-pressed", String(on));
      meshes.forEach((m) => { m.owner = false; });
      if (on) {
        for (let id = 0; id < N; id++) {
          let bm = null;
          meshes.forEach((m) => { if (m.id === id && (!bm || Math.abs(m.x) < Math.abs(bm.x))) bm = m; });
          bm.owner = true; startReveal(bm, R() * .12);
        }
        hoverM = null; canvas.classList.remove("hov");
      } else {
        meshes.forEach((m) => { if (Math.abs(m.x) < .62) startReveal(m, R() * .12); });
      }
      beep(on ? 900 : 700, .05);
    }
    $("btn-grid").addEventListener("click", () => setGrid(!S.gt));

    // ---- input
    let hoverM = null, drag = null, hintGone = false;
    const hideHint = () => { if (!hintGone) { hintGone = true; $("hint").classList.add("gone"); } };
    function snapTo(dir) { S.target = (Math.round(S.target / S.pitch) + dir) * S.pitch; hideHint(); }

    window.addEventListener("wheel", (e) => {
      if (ovOpen || e.ctrlKey) return;
      e.preventDefault();
      if (S.gt) return;
      let d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= S.H;
      S.target += d * .00042 * (S.mob ? 2 : 1); hideHint();
    }, { passive: false });

    canvas.addEventListener("pointerdown", (e) => {
      if (ovOpen || e.button > 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: S.target, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (drag && e.pointerId === drag.id) {
        if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) { drag.moved = true; canvas.classList.add("drag"); hideHint(); }
        if (drag.moved && !S.gt) S.target = drag.t - ((e.clientX - drag.x) / S.W) * 1.1;
        return;
      }
      if (e.pointerType === "mouse" && !ovOpen) { hoverM = pick(e.clientX, e.clientY); canvas.classList.toggle("hov", !!hoverM); }
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null; canvas.classList.remove("drag");
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (!d.moved && e.type === "pointerup") { const m = pick(e.clientX, e.clientY); if (m) openCard(m.id); }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", () => { if (!drag) { hoverM = null; canvas.classList.remove("hov"); } });

    window.addEventListener("keydown", (e) => {
      if (ovOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { if (!S.gt) { e.preventDefault(); snapTo(1); } }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { if (!S.gt) { e.preventDefault(); snapTo(-1); } }
      else if (e.key === "Enter" && document.activeElement === document.body && S.center >= 0) openCard(S.center);
    });

    $("cross-btn").addEventListener("click", () => {
      if (ovOpen || S.gt) return;
      beep(220, .09);
      snapTo(3 + ((R() * 4) | 0));
    });

    // ---- title scramble
    const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const rc = (n) => { let s = ""; for (let i = 0; i < n; i++) s += ALPHA[(R() * 36) | 0]; return s; };
    const scramble = () => rc(2 + ((R() * 2) | 0)) + " " + rc(3 + ((R() * 2) | 0));
    const titleEl = $("title"), tickEl = $("tick");
    let scrambling = false, shown = -1, frameN = 0;

    // ---- main loop
    let last = 0, t0 = 0, ranFirst = false;
    const bfVec = baseV;
    function frame(ts) {
      requestAnimationFrame(frame);
      const t = ts / 1000;
      if (!t0) { t0 = t; last = t; intro.forEach(([m, d]) => { m.rs = t + d; }); }
      const dt = clamp(t - last, 0, .1); last = t; now = t; S.time = t - t0;

      const prev = S.pos;
      S.pos += (S.target - S.pos) * (1 - Math.pow(1 - .12, dt * 30));
      S.vel += ((S.pos - prev) / Math.max(dt, 1e-3) - S.vel) * clamp(dt * 8);

      S.g += (S.gt - S.g) * (1 - Math.pow(.88, dt * 60));
      if (Math.abs(S.g - S.gt) < .0005) S.g = S.gt;
      S.ge = S.g * S.g * (3 - 2 * S.g);

      const bf = 1 - Math.pow(.95, dt * 60);
      bfVec.x += (baseT[0] - bfVec.x) * bf; bfVec.y += (baseT[1] - bfVec.y) * bf; bfVec.z += (baseT[2] - bfVec.z) * bf;

      // positions + centre card
      let best = 1e9, bi = 0;
      for (const m of meshes) { m.x = wrap(m.i * S.pitch - S.pos); const ax = Math.abs(m.x); if (ax < best) { best = ax; bi = m.id; } }
      if (bi !== S.center) {
        const first = S.center < 0;
        S.center = bi;
        tickEl.style.left = (bi / (N - 1)) * 100 + "%";
        $("live").textContent = CARDS[bi].label;
        if (!first) beep(1400, .05);
      }

      const k = S.mob ? 1.6 : 1, tb = S.mob ? .26 : .217, bb = S.mob ? .60 : .659, gridOn = S.g > .0005 || S.gt;
      for (const m of meshes) {
        const ax = Math.abs(m.x), inR = ax < .62, u = m.u;
        const want = gridOn ? (m.owner || (S.ge < .999 && inR)) : inR;
        if (want && !m.on) startReveal(m, R() * .12);
        else if (!want && m.on) { m.on = false; m.rs = Infinity; }
        m.mesh.visible = want;
        if (!want) { m.lb.style.display = "none"; continue; }

        m.h += ((hoverM === m ? 1 : 0) - m.h) * (1 - Math.exp(-dt * 12));
        m.s = 1 + .015 * m.h;
        m.rev = clamp((now - m.rs) / m.rd, 0, 1);

        const ak = ax * k;
        m.topC = S.H * (tb - .03 * sstep(.30, .45, ak));
        m.botY = S.H * (bb - .135 * sstep(.12, .39, ak));
        const sw = S.cardW * S.W * m.s, sh = (m.botY - m.topC) * m.s, gr = m.gr;

        u.uX.value = m.x; u.uS.value = m.s; u.uGrid.value = S.ge; u.uGR.value.set(gr[0], gr[1], gr[2], gr[3]);
        u.uSize.value.set(lerp(sw, gr[2] * m.s, S.ge), lerp(sh, gr[3] * m.s, S.ge));
        u.uRev.value = m.rev; u.uHover.value = m.h;
        u.uFade.value = m.owner && gridOn ? 1 : 1 - S.ge;

        // label: bottom-left sits just above the card's top-left corner and follows the top edge's tilt
        const p0 = cardPoint(m, 0, 0), p1 = cardPoint(m, .3, 0);
        const a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const vis = p0[0] > -160 && p0[0] < S.W + 20;
        if (vis) {
          m.lb.style.display = "block";
          m.lb.style.transform = `translate(${(p0[0] + 2).toFixed(1)}px, ${(p0[1] - .006 * S.H).toFixed(1)}px) rotate(${a.toFixed(4)}rad) translateY(-100%)`;
          m.lb.style.opacity = (clamp((m.rev - .15) * 3) * u.uFade.value).toFixed(3);
        } else m.lb.style.display = "none";
      }

      // title: random codes while the strip is moving, the card name once it settles
      frameN++;
      const moving = !reduce && !S.gt && Math.abs(S.target - S.pos) > .004;
      if (moving) { if (frameN % 3 === 0) titleEl.textContent = scramble(); scrambling = true; }
      else if (scrambling || shown !== S.center) { titleEl.textContent = CARDS[S.center].label; scrambling = false; shown = S.center; }

      // cross spins faster the faster you scroll
      if (cross) {
        const want = clamp(1 + Math.abs(S.vel) * 5, 1, 7);
        S.spin += (want - S.spin) * clamp(dt * 5);
        if (S.ge < .98) cross.draw(dt, S.spin);
      }

      // render: scene into the target, then the glass pass to the screen
      post.uTime.value = S.time;
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(sceneA, cam);
      renderer.setRenderTarget(null); renderer.render(sceneB, cam);

      if (!ranFirst) {
        ranFirst = true;
        requestAnimationFrame(() => {
          root.classList.add("ready");
          const id = idFromHash();
          if (id >= 0) { jumpTo(id); setTimeout(() => openCard(id), 700); }
        });
      }
    }

    // ---- start: intro reveal is staggered by distance from the centre
    function jumpTo(id) {
      const k0 = Math.round(S.target / S.pitch), delta = ((((id - k0) % N) + N + N / 2) % N) - N / 2;
      S.target = S.pos = (k0 + Math.round(delta)) * S.pitch;
    }
    for (const m of meshes) {
      m.x = wrap(m.i * S.pitch);
      if (Math.abs(m.x) < .62) { m.on = true; m.rs = reduce ? 0 : .2 + Math.abs(m.x) * .8 + .05; m.rd = reduce ? .001 : .9; }
    }
    // rs above is relative to the first frame; frame() shifts it once the first timestamp is known
    const intro = meshes.filter((m) => m.on).map((m) => [m, m.rs]);

    hooks.onOpen = () => { drag = null; canvas.classList.remove("drag"); };
    window.addEventListener("hashchange", () => {
      const id = idFromHash();
      if (id >= 0 && !ovOpen) { if (!S.gt) jumpTo(id); openCard(id); }
      else if (id < 0 && ovOpen) closeCard();
    });
    document.addEventListener("visibilitychange", () => { last = performance.now() / 1000; });

    requestAnimationFrame(frame);
    return true;
  }

  /* ================================================================== no-WebGL fallback */
  function buildFallback() {
    const fb = $("fb");
    CARDS.forEach((c, i) => {
      const b = document.createElement("button"); b.type = "button";
      const cv = document.createElement("canvas"); cv.width = 320; cv.height = 471; cv.getContext("2d").drawImage(posters[i], 0, 0, 320, 471);
      const s = document.createElement("span"); s.className = "t"; s.textContent = pad(i + 1) + " " + c.label;
      b.append(cv, s); b.addEventListener("click", () => openCard(i)); fb.appendChild(b);
    });
    $("title").textContent = "AEGIS";
    root.classList.add("no-gl", "ready");
    $("btn-grid").style.display = "none"; $("pal").style.display = "none";
    const id = idFromHash(); if (id >= 0) setTimeout(() => openCard(id), 300);
  }

  /* ================================================================== boot */
  async function boot() {
    try {
      if (document.fonts && document.fonts.load) {
        const f = Promise.all([document.fonts.load('500 20px "JetBrains Mono"'), document.fonts.load('400 20px "JetBrains Mono"')]).then(() => document.fonts.ready).catch(() => {});
        await Promise.race([f, new Promise((r) => setTimeout(r, 1800))]);
      }
    } catch (e) { /* draw with the fallback mono font */ }
    posters = CARDS.map((c, i) => makePoster(i));
    let ok = false;
    try { ok = startGL(); } catch (e) { if (window.console) console.error("Aegis landing: WebGL failed", e); ok = false; }
    if (!ok) buildFallback();
  }
  boot();
})();
