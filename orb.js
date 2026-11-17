// Aegis 3D core: a real perspective-projected hologram on a 2D canvas (no libraries, no WebGL needed).
// A glowing wireframe globe with a breathing particle shell, three tilting gyroscope rings, orbiting satellites and
// a pulsing core. It follows your pointer in 3D and reacts to the assistant's state.
// AegisOrb.mount(canvas) -> { setState(name), destroy() };  AegisOrb.setTheme([r,g,b]) recolours every orb.
// States: offline | idle | listening | thinking | speaking
(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const BASE = [47, 227, 255];
  const STATES = {
    offline:   { rgb: [100, 116, 139], k: 0, spin: 0.06, pulse: 0.0, amp: 0.02, glow: 0.35, dim: 0.45 },
    idle:      { k: 0, spin: 0.22, pulse: 0.5, amp: 0.10, glow: 0.80, dim: 1 },
    listening: { rgb: [52, 230, 150], spin: 0.5, pulse: 1.4, amp: 0.55, glow: 1.0, dim: 1 },
    thinking:  { rgb: [140, 130, 255], spin: 2.2, pulse: 1.0, amp: 0.20, glow: 1.05, dim: 1 },
    speaking:  { k: 1, spin: 0.8, pulse: 2.2, amp: 0.95, glow: 1.2, dim: 1 },
  };
  const theme = { rgb: BASE.slice(), lite: [180, 245, 255] };
  const instances = new Set();
  const pointer = { x: 0, y: 0 }; // -1..1, shared

  if (typeof window !== "undefined") {
    window.addEventListener("pointermove", (e) => {
      pointer.x = (e.clientX / innerWidth) * 2 - 1;
      pointer.y = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }

  function fib(n) {
    const out = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), a = i * ga;
      out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return out;
  }

  function mount(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return { setState() {}, destroy() {} };
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = canvas.getBoundingClientRect().width < 260;
    let w = 1, h = 1, state = "idle", raf = 0, last = 0, t = 0, yaw = 0, destroyed = false;
    let px = 0, py = 0; // smoothed pointer
    const cur = { rgb: theme.rgb.slice(), spin: 0.22, pulse: 0.5, amp: 0.1, glow: 0.8, dim: 1 };

    const pts = fib(small ? 160 : 340);
    const shell = Array.from({ length: small ? 28 : 70 }, () => ({
      a: Math.random() * TAU, b: Math.acos(2 * Math.random() - 1), r: 1.9 + Math.random() * 0.7, s: (0.08 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1), z: 0.6 + Math.random() * 1.4,
    }));
    const rings = [
      { r: 1.42, ax: 0.0, ay: 0.0, sx: 0.31, sy: 0.19, lw: 2.2, arc: 1.0, beads: 2 },
      { r: 1.62, ax: 1.1, ay: 0.4, sx: -0.23, sy: 0.27, lw: 1.6, arc: 0.72, beads: 1 },
      { r: 1.84, ax: 2.0, ay: 1.2, sx: 0.17, sy: -0.21, lw: 1.2, arc: 0.55, beads: 3 },
    ];

    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) draw(0, true);
    }

    const rgba = (a, c) => { const q = c || cur.rgb; return `rgba(${q[0] | 0},${q[1] | 0},${q[2] | 0},${Math.max(0, Math.min(1, a))})`; };

    function ease(dt, snap) {
      const to = STATES[state];
      const target = to.rgb || (to.k === 1 ? theme.lite : theme.rgb);
      const k = snap ? 1 : 1 - Math.pow(0.004, dt);
      for (let i = 0; i < 3; i++) cur.rgb[i] += (target[i] - cur.rgb[i]) * k;
      for (const key of ["spin", "pulse", "amp", "glow", "dim"]) cur[key] += (to[key] - cur[key]) * k;
    }

    // rotate a point by yaw (Y axis), then pitch (X axis), then roll (Z axis)
    function rot(p, ay, ax, az) {
      let [x, y, z] = p;
      let c = Math.cos(ay), s = Math.sin(ay); [x, z] = [x * c + z * s, -x * s + z * c];
      c = Math.cos(ax); s = Math.sin(ax); [y, z] = [y * c - z * s, y * s + z * c];
      if (az) { c = Math.cos(az); s = Math.sin(az); [x, y] = [x * c - y * s, x * s + y * c]; }
      return [x, y, z];
    }

    function draw(dt, snap) {
      ease(dt, snap);
      t += dt;
      yaw += dt * cur.spin;
      px += (pointer.x - px) * Math.min(1, dt * 3.5 || 1);
      py += (pointer.y - py) * Math.min(1, dt * 3.5 || 1);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) / 2 / 2.35;   // 1 unit in world space, in pixels
      const D = 4.2;                          // camera distance (perspective strength)
      const tiltY = yaw + px * 0.55, tiltX = 0.32 + py * 0.4;
      const beat = 0.5 + 0.5 * Math.sin(t * cur.pulse * TAU * 0.5);
      const proj = (p) => { const s = D / (D - p[2]); return [cx + p[0] * R * s, cy + p[1] * R * s, s, p[2]]; };

      // atmosphere glow
      const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 2.3);
      g.addColorStop(0, rgba(0.34 * cur.glow)); g.addColorStop(0.45, rgba(0.09 * cur.glow)); g.addColorStop(1, rgba(0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "lighter";

      // --- globe wireframe (latitudes + meridians)
      const wire = (fn, n, alpha) => {
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const q = proj(rot(fn(i / n), tiltY, tiltX, 0));
          if (prev) {
            const depth = (q[3] + prev[3]) / 2;
            ctx.strokeStyle = rgba(alpha * (0.35 + 0.65 * (depth + 1) / 2) * cur.dim);
            ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
          }
          prev = q;
        }
      };
      ctx.lineWidth = 1;
      const lat = small ? 4 : 6, mer = small ? 6 : 10, rad = 1.0 + cur.amp * 0.05 * beat;
      for (let i = 1; i <= lat; i++) {
        const phi = (i / (lat + 1)) * Math.PI - Math.PI / 2, y = Math.sin(phi) * rad, rr = Math.cos(phi) * rad;
        wire((u) => [Math.cos(u * TAU) * rr, y, Math.sin(u * TAU) * rr], 48, 0.42);
      }
      for (let i = 0; i < mer; i++) {
        const th = (i / mer) * Math.PI;
        wire((u) => { const a = u * TAU; return [Math.cos(a) * Math.cos(th) * rad, Math.sin(a) * rad, Math.cos(a) * Math.sin(th) * rad]; }, 48, 0.3);
      }

      // --- particle shell: breathes with the voice amplitude
      const sorted = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const wob = Math.sin(t * 5.5 + i * 0.9) * Math.sin(t * 2.3 + i * 0.37);
        const rr = 1.02 + cur.amp * 0.26 * (0.5 + 0.5 * wob) + 0.02 * beat;
        const q = proj(rot([p[0] * rr, p[1] * rr, p[2] * rr], tiltY, tiltX, 0));
        sorted.push(q);
      }
      for (const q of sorted) {
        const f = (q[3] + 1.2) / 2.4;
        ctx.fillStyle = rgba((0.15 + 0.85 * f) * cur.dim * (0.75 + 0.25 * beat));
        ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(0.6, R * 0.016 * q[2] * (0.6 + f)), 0, TAU); ctx.fill();
      }

      // --- gyroscope rings with travelling beads
      rings.forEach((rg, idx) => {
        const ax = rg.ax + t * rg.sx * (0.5 + cur.spin), ay = rg.ay + t * rg.sy * (0.5 + cur.spin);
        const N = 90, span = TAU * rg.arc, off = t * (0.25 + idx * 0.12) * (idx % 2 ? -1 : 1);
        let prev = null;
        ctx.lineWidth = rg.lw;
        for (let i = 0; i <= N; i++) {
          const a = off + (i / N) * span;
          const q = proj(rot(rot([Math.cos(a) * rg.r, 0, Math.sin(a) * rg.r], ax, ay, 0), tiltY * 0.35, tiltX * 0.5, 0));
          if (prev) {
            const f = (q[3] + rg.r) / (2 * rg.r);
            ctx.strokeStyle = rgba((0.18 + 0.7 * f) * cur.dim, idx === 1 ? theme.lite.map((v, k) => (v + cur.rgb[k]) / 2) : cur.rgb);
            ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
          }
          prev = q;
        }
        for (let b = 0; b < rg.beads; b++) {
          const a = off * 2.4 + (b / rg.beads) * TAU;
          const q = proj(rot(rot([Math.cos(a) * rg.r, 0, Math.sin(a) * rg.r], ax, ay, 0), tiltY * 0.35, tiltX * 0.5, 0));
          ctx.fillStyle = rgba(0.95 * cur.dim, theme.lite);
          ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(1.4, R * 0.04 * q[2]), 0, TAU); ctx.fill();
        }
      });

      // --- orbiting satellites (far field, gives depth)
      for (const s of shell) {
        s.a += s.s * dt * (0.3 + cur.spin * 0.6);
        const p = [Math.sin(s.b) * Math.cos(s.a) * s.r, Math.cos(s.b) * s.r * 0.8, Math.sin(s.b) * Math.sin(s.a) * s.r];
        const q = proj(rot(p, tiltY * 0.5, tiltX * 0.6, 0));
        const f = (q[3] + 2.6) / 5.2;
        ctx.fillStyle = rgba((0.15 + 0.7 * f) * cur.dim);
        ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(0.5, s.z * q[2] * (small ? 0.7 : 1)), 0, TAU); ctx.fill();
      }

      // --- voice equaliser ring (flat, in front of the globe)
      const N = 64, inner = R * 1.0;
      ctx.lineWidth = Math.max(1.4, R * 0.02);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU + yaw * 0.2;
        const wob = 0.5 + 0.5 * Math.sin(t * 6 + i * 0.7) * Math.sin(t * 3.1 + i * 0.31);
        const len = R * (0.02 + cur.amp * 0.3 * wob);
        const r1 = R * 1.12;
        ctx.strokeStyle = rgba(0.75 * cur.dim);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * (r1 + len), cy + Math.sin(a) * (r1 + len));
        ctx.stroke();
      }

      // --- core
      const coreR = R * (0.34 + 0.05 * beat * (0.4 + cur.amp));
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 1.6);
      core.addColorStop(0, "rgba(255,255,255,0.95)"); core.addColorStop(0.25, rgba(0.9)); core.addColorStop(0.6, rgba(0.28)); core.addColorStop(1, rgba(0));
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, coreR * 1.6, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
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
      cancelAnimationFrame(raf); last = 0;
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };

    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }
    else window.addEventListener("resize", resize);
    resize();
    if (reduce) draw(0, true);
    else { document.addEventListener("visibilitychange", onVis); raf = requestAnimationFrame(loop); }

    const api = {
      setState(name) {
        if (!STATES[name] || name === state) return;
        state = name;
        if (reduce) draw(0, true);
      },
      refresh() { if (reduce) draw(0, true); },
      destroy() {
        destroyed = true; cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("resize", resize);
        if (ro) ro.disconnect();
        instances.delete(api);
      },
    };
    instances.add(api);
    return api;
  }

  function setTheme(rgb, lite) {
    theme.rgb = rgb.slice();
    theme.lite = lite || rgb.map((v) => Math.min(255, v + (255 - v) * 0.65));
    instances.forEach((i) => i.refresh());
  }

  window.AegisOrb = { mount, setTheme };
})();
