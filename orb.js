// Animated "arc reactor" orb. Pure canvas, no libraries.
// AegisOrb.mount(canvas) -> { setState(name), destroy() }
// States: offline | idle | listening | thinking | speaking
(() => {
  "use strict";

  const STATES = {
    offline:   { rgb: [100, 116, 139], spin: 0.05, pulse: 0.0, amp: 0.02, glow: 0.35 },
    idle:      { rgb: [56, 214, 242],  spin: 0.25, pulse: 0.5, amp: 0.10, glow: 0.75 },
    listening: { rgb: [52, 211, 153],  spin: 0.55, pulse: 1.4, amp: 0.55, glow: 1.0 },
    thinking:  { rgb: [155, 140, 255], spin: 2.4,  pulse: 1.0, amp: 0.18, glow: 1.0 },
    speaking:  { rgb: [103, 232, 249], spin: 0.8,  pulse: 2.2, amp: 0.95, glow: 1.15 },
  };
  const TAU = Math.PI * 2;

  function mount(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return { setState() {}, destroy() {} };
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 1, h = 1, state = "idle", raf = 0, last = 0, t = 0, angle = 0, destroyed = false;
    const cur = { rgb: STATES.idle.rgb.slice(), spin: 0.25, pulse: 0.5, amp: 0.1, glow: 0.75 };
    const parts = Array.from({ length: 26 }, () => ({
      a: Math.random() * TAU,
      r: 0.56 + Math.random() * 0.4,
      s: (0.12 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
      z: 0.7 + Math.random() * 1.5,
    }));

    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) draw(0);
    }

    const rgba = (a) => `rgba(${cur.rgb[0] | 0},${cur.rgb[1] | 0},${cur.rgb[2] | 0},${a})`;

    function ease(dt, snap) {
      const to = STATES[state];
      const k = snap ? 1 : 1 - Math.pow(0.004, dt);
      for (let i = 0; i < 3; i++) cur.rgb[i] += (to.rgb[i] - cur.rgb[i]) * k;
      for (const key of ["spin", "pulse", "amp", "glow"]) cur[key] += (to[key] - cur[key]) * k;
    }

    function draw(dt, snap) {
      ease(dt, snap);
      t += dt;
      angle += dt * cur.spin;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) / 2 * 0.94;
      const beat = 0.5 + 0.5 * Math.sin(t * cur.pulse * TAU * 0.5);

      // soft glow behind everything
      const g = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R * 1.05);
      g.addColorStop(0, rgba(0.38 * cur.glow));
      g.addColorStop(0.5, rgba(0.10 * cur.glow));
      g.addColorStop(1, rgba(0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      ctx.lineCap = "round";

      // outer tick ring
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle * 0.35);
      for (let i = 0; i < 72; i++) {
        const long = i % 6 === 0;
        const a = (i / 72) * TAU;
        const r1 = R * (long ? 0.90 : 0.93), r2 = R * 0.97;
        ctx.strokeStyle = rgba(long ? 0.75 : 0.32);
        ctx.lineWidth = long ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();

      // rotating arc rings
      const rings = [
        { r: 0.84, n: 3, gap: 0.5, w: 2.4, dir: 1, sp: 1.0 },
        { r: 0.72, n: 5, gap: 0.35, w: 1.6, dir: -1, sp: 1.6 },
        { r: 0.60, n: 2, gap: 0.9, w: 3.2, dir: 1, sp: 0.7 },
      ];
      rings.forEach((rg, idx) => {
        const seg = TAU / rg.n;
        const base = angle * rg.dir * rg.sp + idx;
        ctx.strokeStyle = rgba(0.55 + 0.35 * beat * (idx === 2 ? 1 : 0.4));
        ctx.lineWidth = rg.w;
        for (let i = 0; i < rg.n; i++) {
          ctx.beginPath();
          ctx.arc(cx, cy, R * rg.r, base + i * seg, base + i * seg + seg * (1 - rg.gap));
          ctx.stroke();
        }
      });

      // orbiting particles
      for (const p of parts) {
        p.a += p.s * dt * (0.3 + cur.spin * 0.6);
        const rr = R * p.r;
        ctx.fillStyle = rgba(0.55);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(p.a) * rr, cy + Math.sin(p.a) * rr, p.z, 0, TAU);
        ctx.fill();
      }

      // waveform ring (reacts to listening / speaking)
      const N = 64, inner = R * 0.40;
      ctx.strokeStyle = rgba(0.9);
      ctx.lineWidth = Math.max(1.5, R * 0.012);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU + angle * 0.2;
        const wob = 0.5 + 0.5 * Math.sin(t * 6 + i * 0.7) * Math.sin(t * 3.1 + i * 0.31);
        const len = R * (0.015 + cur.amp * 0.13 * wob);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
        ctx.stroke();
      }

      // core
      const coreR = R * (0.30 + 0.025 * beat * (0.4 + cur.amp));
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      core.addColorStop(0, "rgba(255,255,255,0.95)");
      core.addColorStop(0.35, rgba(0.95));
      core.addColorStop(1, rgba(0.05));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(0.9);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 1.18, 0, TAU);
      ctx.stroke();
    }

    function loop(now) {
      if (destroyed) return;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      draw(dt);
      raf = requestAnimationFrame(loop);
    }

    const onVis = () => {
      if (reduce || destroyed) return;
      cancelAnimationFrame(raf);
      last = 0;
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };

    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }
    else window.addEventListener("resize", resize);
    resize();
    if (reduce) draw(0, true);
    else { document.addEventListener("visibilitychange", onVis); raf = requestAnimationFrame(loop); }

    return {
      setState(name) {
        if (!STATES[name] || name === state) return;
        state = name;
        if (reduce) draw(0, true);
      },
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("resize", resize);
        if (ro) ro.disconnect();
      },
    };
  }

  window.AegisOrb = { mount };
})();
