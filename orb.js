// Aegis 3D core: a real perspective-projected hologram on a 2D canvas (no libraries, no WebGL needed).
// A glowing wireframe globe with a breathing particle shell, three tilting gyroscope rings, orbiting satellites and
// a pulsing core. It follows your pointer in 3D and reacts to the assistant's state.
// AegisOrb.mount(canvas) -> { setState(name), pulse(strength 0..1), setLevel(0..1), destroy() };  AegisOrb.setTheme([r,g,b]) recolours every orb.
// States: offline | idle | listening | thinking | speaking
(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const BASE = [47, 227, 255];
  const STATES = {
    offline:   { rgb: [100, 116, 139], k: 0, spin: 0.06, pulse: 0.0, amp: 0.02, glow: 0.35, dim: 0.45, arcs: 0, inflow: 0 },
    idle:      { k: 0, spin: 0.22, pulse: 0.5, amp: 0.10, glow: 0.80, dim: 1, arcs: 0, inflow: 0 },
    listening: { rgb: [52, 230, 150], spin: 0.5, pulse: 1.4, amp: 0.55, glow: 1.0, dim: 1, arcs: 0, inflow: 1 },
    thinking:  { rgb: [140, 130, 255], spin: 2.2, pulse: 1.0, amp: 0.20, glow: 1.05, dim: 1, arcs: 1, inflow: 0 },
    speaking:  { k: 1, spin: 0.8, pulse: 2.2, amp: 0.95, glow: 1.2, dim: 1, arcs: 0, inflow: 0 },
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
    const cur = { rgb: theme.rgb.slice(), spin: 0.22, pulse: 0.5, amp: 0.1, glow: 0.8, dim: 1, arcs: 0, inflow: 0 };
    let level = 0, levelT = 0;               // live voice level (0..1): real speech events feed this
    const waves = [];                        // expanding shockwave discs
    const stars = Array.from({ length: small ? 40 : 110 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: 0.15 + Math.random() * 0.85, ph: Math.random() * TAU }));
    const inflow = Array.from({ length: small ? 14 : 30 }, () => ({ a: Math.random() * TAU, b: Math.acos(2 * Math.random() - 1), p: Math.random(), s: 0.35 + Math.random() * 0.5 }));
    const bolts = Array.from({ length: small ? 3 : 6 }, () => ({ i: 0, j: 0, born: -9, life: 0.5 }));

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
      for (const key of ["spin", "pulse", "amp", "glow", "dim", "arcs", "inflow"]) cur[key] += (to[key] - cur[key]) * k;
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
      levelT *= Math.pow(0.02, dt);                       // level decays quickly between speech events
      level += (levelT - level) * Math.min(1, dt * 14);
      const amp = Math.min(1.2, cur.amp * (0.62 + 0.9 * level) + level * 0.18);
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

      // --- deep field: parallax stars on three depth layers (near ones drift more with the pointer)
      for (const st of stars) {
        const sx = cx + (st.x * 1.15 * w / 2) - px * st.z * 22, sy = cy + (st.y * 1.15 * h / 2) - py * st.z * 16;
        const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + st.z) + st.ph);
        ctx.fillStyle = rgba(0.10 + 0.45 * st.z * tw * cur.dim);
        ctx.beginPath(); ctx.arc(sx, sy, 0.5 + st.z * 1.1, 0, TAU); ctx.fill();
      }

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
      const lat = small ? 4 : 6, mer = small ? 6 : 10, rad = 1.0 + amp * 0.05 * beat;
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
        const rr = 1.02 + amp * 0.26 * (0.5 + 0.5 * wob) + 0.02 * beat;
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
          for (let k = 7; k >= 0; k--) {                       // comet tail: older positions are smaller and fainter
            const q = proj(rot(rot([Math.cos(a - k * 0.09) * rg.r, 0, Math.sin(a - k * 0.09) * rg.r], ax, ay, 0), tiltY * 0.35, tiltX * 0.5, 0));
            const head = k === 0;
            ctx.fillStyle = rgba((head ? 0.95 : 0.34 * (1 - k / 8)) * cur.dim, theme.lite);
            ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(head ? 1.4 : 0.7, R * (head ? 0.04 : 0.03 * (1 - k / 9)) * q[2]), 0, TAU); ctx.fill();
          }
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
        const len = R * (0.02 + amp * 0.3 * wob);
        const r1 = R * 1.12;
        ctx.strokeStyle = rgba(0.75 * cur.dim);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * (r1 + len), cy + Math.sin(a) * (r1 + len));
        ctx.stroke();
      }

      // --- shockwaves: tilted 3D discs that expand from the core on every spoken word / state change
      for (let i = waves.length - 1; i >= 0; i--) {
        const wv = waves[i], age = t - wv.t0, life = 1.1;
        if (age > life) { waves.splice(i, 1); continue; }
        const u = age / life, rr = 1.05 + u * 1.25, fade = (1 - u) * (1 - u) * wv.s;
        ctx.lineWidth = Math.max(1, R * 0.03 * (1 - u));
        let prev = null;
        for (let k = 0; k <= 56; k++) {
          const a = (k / 56) * TAU;
          const q = proj(rot([Math.cos(a) * rr, 0, Math.sin(a) * rr], tiltY * 0.4, tiltX + 0.25, 0));
          if (prev) { ctx.strokeStyle = rgba(fade * (0.25 + 0.75 * (q[3] + rr) / (2 * rr)) * cur.dim, theme.lite); ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
          prev = q;
        }
      }

      // --- listening: particles stream inward toward the core (it "hears" you)
      if (cur.inflow > 0.02) {
        for (const f of inflow) {
          f.p = (f.p + dt * f.s * (0.6 + level)) % 1;
          const rr = 2.3 - f.p * 1.35, a = f.a + f.p * 1.4;
          const q = proj(rot([Math.sin(f.b) * Math.cos(a) * rr, Math.cos(f.b) * rr, Math.sin(f.b) * Math.sin(a) * rr], tiltY, tiltX, 0));
          ctx.fillStyle = rgba(Math.sin(f.p * Math.PI) * 0.85 * cur.inflow * cur.dim, theme.lite);
          ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(0.8, R * 0.03 * q[2] * (1 - f.p * 0.5)), 0, TAU); ctx.fill();
        }
      }

      // --- thinking: neural arcs flash between points on the shell, lifted off the surface
      if (cur.arcs > 0.02) {
        ctx.lineWidth = 1.3;
        for (const bt of bolts) {
          if (t - bt.born > bt.life) { bt.born = t + Math.random() * 0.25; bt.life = 0.35 + Math.random() * 0.45; bt.i = (Math.random() * pts.length) | 0; bt.j = (Math.random() * pts.length) | 0; }
          const age = (t - bt.born) / bt.life;
          if (age < 0 || age > 1) continue;
          const A = pts[bt.i], B = pts[bt.j], mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], ml = Math.hypot(mid[0], mid[1], mid[2]) || 1;
          const lift = 1.0 + 0.9 * (1 - ml) + 0.35;
          const qa = proj(rot(A, tiltY, tiltX, 0)), qb = proj(rot(B, tiltY, tiltX, 0)), qm = proj(rot([mid[0] / ml * lift, mid[1] / ml * lift, mid[2] / ml * lift], tiltY, tiltX, 0));
          ctx.strokeStyle = rgba(Math.sin(age * Math.PI) * 0.9 * cur.arcs * cur.dim, theme.lite);
          ctx.beginPath(); ctx.moveTo(qa[0], qa[1]); ctx.quadraticCurveTo(qm[0], qm[1], qb[0], qb[1]); ctx.stroke();
        }
      }

      // --- specular highlight: makes the globe read as a lit sphere, not a flat disc
      const sp = ctx.createRadialGradient(cx - R * 0.38 - px * R * 0.1, cy - R * 0.42 - py * R * 0.1, 0, cx - R * 0.38, cy - R * 0.42, R * 0.9);
      sp.addColorStop(0, rgba(0.16 * cur.dim, theme.lite)); sp.addColorStop(1, rgba(0));
      ctx.fillStyle = sp; ctx.beginPath(); ctx.arc(cx, cy, R * 1.05, 0, TAU); ctx.fill();

      // --- core
      const coreR = R * (0.34 + 0.05 * beat * (0.4 + amp));
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
        levelT = Math.max(levelT, 0.5); waves.push({ t0: t, s: 0.9 });   // state change: one clear shockwave
        if (reduce) draw(0, true);
      },
      // a short burst of energy: call on each spoken word (strength 0..1)
      pulse(strength) {
        const v = Math.max(0, Math.min(1, strength == null ? 0.6 : strength));
        levelT = Math.max(levelT, 0.35 + 0.65 * v);
        if (waves.length < 6 && v > 0.45) waves.push({ t0: t, s: 0.35 + 0.65 * v });
      },
      setLevel(v) { levelT = Math.max(0, Math.min(1, v)); },
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
