/* Aegis landing: 66,000-dot point-cloud portrait (three.js 0.170). Loaded as an ES module; the import map is in index.html.
   Flow: stream the GLB (real byte progress) -> sample dots -> assemble from the ring -> shine, glint, cursor light. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

THREE.ColorManagement.enabled = false;   // colours are written straight to the screen by the shaders

const GLB = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261115_071021_742152ba-5554-4270-9dc5-286bcff36a1a.glb";
const N = 66000;
const RING_N = 96, RING_R = 92;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s) => document.querySelector(s);
const page = $(".page"), stage = $(".stage"), loader = $(".loader"), counter = $(".count"), label = $(".lbl"), ringSvg = $(".ring");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------- loader ring ---------- */
const ringDots = [];
for (let i = 0; i < RING_N; i++) {
  const a = (i / RING_N) * Math.PI * 2 - Math.PI / 2;
  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c.setAttribute("cx", (RING_R * Math.cos(a)).toFixed(2));
  c.setAttribute("cy", (RING_R * Math.sin(a)).toFixed(2));
  c.setAttribute("r", "1.6");
  ringSvg.appendChild(c);
  ringDots.push(c);
}
function setProgress(p) {
  p = clamp(p, 0, 1);
  ringDots.forEach((c, i) => c.toggleAttribute("data-on", i / RING_N < p));
  const n = Math.round(p * 100);
  counter.textContent = String(n).padStart(3, "0");
  loader.setAttribute("aria-valuenow", String(n));
}
function fail() {
  counter.textContent = "Could not load";
  counter.classList.add("err");
  label.textContent = "Refresh to try again";
}

/* ---------- download with real progress ---------- */
async function fetchModel() {
  const res = await fetch(GLB);
  if (!res.ok) throw new Error("http " + res.status);
  const total = +res.headers.get("content-length") || 0;
  const chunks = []; let got = 0;
  if (res.body && res.body.getReader) {
    const rd = res.body.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      chunks.push(value); got += value.length;
      setProgress(Math.min(0.99, total ? got / total : Math.min(0.95, got / 1.5e6)));
    }
  } else {
    const b = new Uint8Array(await res.arrayBuffer()); chunks.push(b); got = b.length;
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
const parseGLB = (buf) => new Promise((ok, no) => new GLTFLoader().parse(buf, "", ok, no));

/* ---------- build the dots ---------- */
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function buildDots(gltf) {
  const rng = mulberry(20261115);
  let mesh = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  if (!mesh) throw new Error("no mesh");
  const geo = mesh.geometry.clone();
  geo.applyMatrix4(mesh.matrixWorld);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geo)).build();

  /* candidates */
  const M = N * 5;
  const cp = new Float32Array(M * 3), cn = new Float32Array(M * 3);
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < M; i++) {
    sampler.sample(v, nn);
    cp[i * 3] = v.x; cp[i * 3 + 1] = v.y; cp[i * 3 + 2] = v.z;
    cn[i * 3] = nn.x; cn[i * 3 + 1] = nn.y; cn[i * 3 + 2] = nn.z;
  }

  /* leaf sprig and voxel keys */
  const VC = 0.022, K = 512;
  const leafAll = [], bustIdx = [], keys = new Int32Array(M);
  for (let i = 0; i < M; i++) {
    const x = cp[i * 3], y = cp[i * 3 + 1], z = cp[i * 3 + 2];
    if (x > 0.13 && y > 0.6 && (x - 0.02) * (x - 0.02) + (z + 0.06) * (z + 0.06) > 0.035) { leafAll.push(i); continue; }
    keys[i] = Math.floor((x + 2) / VC) + Math.floor((y + 2) / VC) * K + Math.floor((z + 2) / VC) * K * K;
    bustIdx.push(i);
  }
  const leafIdx = leafAll.slice(0, Math.floor(leafAll.length * 0.6));

  /* visor dot budget */
  const nTop = 950, nLow = 380, nEnd = 70, nLens = 1500, nArm = 70;
  const nVisor = nTop + nLow + nEnd * 2 + nLens + nArm * 2;
  const need = Math.max(0, N - nVisor - leafIdx.length);

  /* even density: smallest per-voxel cap that keeps 1.8x what is needed */
  const counts = new Map();
  for (const i of bustIdx) counts.set(keys[i], (counts.get(keys[i]) || 0) + 1);
  let maxC = 0; counts.forEach((c) => { if (c > maxC) maxC = c; });
  const ge = new Float64Array(maxC + 2);
  counts.forEach((c) => { for (let k = 1; k <= c; k++) ge[k]++; });
  const target = Math.ceil(need * 1.8);
  let cap = maxC, sum = 0;
  for (let k = 1; k <= maxC; k++) { sum += ge[k]; if (sum >= target) { cap = k; break; } }
  const used = new Map(), pool = [], rest = [];
  for (const i of bustIdx) {
    const u = used.get(keys[i]) || 0;
    if (u < cap) { used.set(keys[i], u + 1); pool.push(i); } else rest.push(i);
  }
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let bust = pool.slice(0, need);
  if (bust.length < need) bust = bust.concat(rest.slice(0, need - bust.length));

  /* visor */
  const W = 0.215, CL = 0.028;
  const fh = new Map(), cell = 0.01;
  for (let i = 0; i < M; i++) {
    if (cn[i * 3 + 2] < 0.2) continue;
    const x = cp[i * 3], y = cp[i * 3 + 1], z = cp[i * 3 + 2];
    if (x < -0.32 || x > 0.32 || y < 0.2 || y > 0.45) continue;
    const k = Math.floor((x + 0.32) / cell) + Math.floor((y - 0.2) / cell) * 1000;
    if (!(fh.get(k) >= z)) fh.set(k, z);
  }
  const heightAt = (x, y) => {
    const ix = Math.floor((x + 0.32) / cell), iy = Math.floor((y - 0.2) / cell);
    let m = -Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const h = fh.get(ix + dx + (iy + dy) * 1000); if (h > m) m = h; }
    return m;
  };
  const top = (x) => 0.378 - 0.022 * (x / W) ** 2;
  const low = (x) => 0.282 + 0.032 * Math.exp(-((x / 0.034) ** 2)) + 0.026 * (x / W) ** 4;
  let front = -Infinity;
  for (let x = -0.06; x <= 0.0601; x += 0.01) for (let y = 0.3; y <= 0.3601; y += 0.01) front = Math.max(front, heightAt(x, y));
  if (!isFinite(front)) front = 0.3;
  front += CL;
  let wrap = Infinity;
  for (let x = -W; x <= W + 1e-9; x += 0.01) {
    if (Math.abs(x) < 0.05) continue;
    let nd = -Infinity;
    const lo = low(x), hi = top(x);
    for (let y = lo; y <= hi + 1e-9; y += 0.01) nd = Math.max(nd, heightAt(x, y));
    nd = Math.max(nd, heightAt(x, hi));
    if (!isFinite(nd)) continue;
    wrap = Math.min(wrap, (front - nd - 0.7 * CL) / (x * x));
  }
  if (!isFinite(wrap) || wrap <= 0) wrap = 2.4;
  const lensZ = (x) => front - wrap * x * x;
  const jit = (a) => (rng() - 0.5) * 2 * a;

  const vp = [], vn = [], vpart = [];
  const addV = (x, y, z, nx, ny, nz, part) => { const l = Math.hypot(nx, ny, nz) || 1; vp.push(x, y, z); vn.push(nx / l, ny / l, nz / l); vpart.push(part); };
  const lensN = (x) => [2 * wrap * x, 0, 1];
  for (let i = 0; i < nTop; i++) { const x = (rng() * 2 - 1) * W; const y = top(x) - rng() * rng() * 0.016; addV(x, y, lensZ(x) + 0.004 + jit(0.002), ...lensN(x), 3); }
  for (let i = 0; i < nLow; i++) { const x = (rng() * 2 - 1) * W; addV(x, low(x) + jit(0.003), lensZ(x) + 0.002 + jit(0.002), ...lensN(x), 3); }
  for (const s of [-1, 1]) for (let i = 0; i < nEnd; i++) { const x = s * W + jit(0.003); const y = low(s * W) + rng() * (top(s * W) - low(s * W)); addV(x, y, lensZ(x) + jit(0.003), ...lensN(x), 3); }
  for (let i = 0; i < nLens; i++) { const x = (rng() * 2 - 1) * W; const y = low(x) + rng() * (top(x) - low(x)); addV(x, y, lensZ(x) + jit(0.001), ...lensN(x), 4); }
  for (const s of [-1, 1]) for (let i = 0; i < nArm; i++) { const t = rng(); addV(s * (W + 0.03 * t), top(s * W) - 0.008 + jit(0.003), lensZ(s * W) - 0.15 * t + jit(0.002), s, 0, 0.3, 3); }

  /* assemble final arrays (model units) */
  const nb = bust.length, nl = leafIdx.length, nv = vpart.length;
  const total = nb + nl + nv;
  const P = new Float32Array(total * 3), Nr = new Float32Array(total * 3), part = new Float32Array(total);
  let o = 0;
  for (const i of bust) { P.set(cp.subarray(i * 3, i * 3 + 3), o * 3); Nr.set(cn.subarray(i * 3, i * 3 + 3), o * 3); part[o++] = 0; }
  for (const i of leafIdx) { P.set(cp.subarray(i * 3, i * 3 + 3), o * 3); Nr.set(cn.subarray(i * 3, i * 3 + 3), o * 3); part[o++] = 2; }
  for (let k = 0; k < nv; k++) { P.set(vp.slice(k * 3, k * 3 + 3), o * 3); Nr.set(vn.slice(k * 3, k * 3 + 3), o * 3); part[o++] = vpart[k]; }

  /* depth values: ridge (proud vs crease) and thin (loose strands) from neighbouring candidates */
  const R = 0.03, half = M >> 1;
  const gk = (ix, iy, iz) => (ix + 64) + (iy + 64) * 256 + (iz + 64) * 65536;
  const grid = new Map();
  for (let i = 0; i < half; i++) {
    const k = gk(Math.floor(cp[i * 3] / R), Math.floor(cp[i * 3 + 1] / R), Math.floor(cp[i * 3 + 2] / R));
    const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]);
  }
  const ridge = new Float32Array(total), cnt = new Float32Array(total);
  for (let d = 0; d < total; d++) {
    const x = P[d * 3], y = P[d * 3 + 1], z = P[d * 3 + 2];
    const cx = Math.floor(x / R), cy = Math.floor(y / R), cz = Math.floor(z / R);
    let sx = 0, sy = 0, sz = 0, c = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
      const list = grid.get(gk(cx + a, cy + b, cz + e)); if (!list) continue;
      for (const i of list) {
        const dx = cp[i * 3] - x, dy = cp[i * 3 + 1] - y, dz = cp[i * 3 + 2] - z;
        if (dx * dx + dy * dy + dz * dz < R * R) { sx += dx; sy += dy; sz += dz; c++; }
      }
    }
    cnt[d] = c;
    ridge[d] = c ? -((sx * Nr[d * 3] + sy * Nr[d * 3 + 1] + sz * Nr[d * 3 + 2]) / c) / R : 0;
  }
  const abs = Array.from(ridge, Math.abs).sort((a, b) => a - b);
  const p90 = abs[Math.floor(abs.length * 0.9)] || 1;
  const med = Array.from(cnt).sort((a, b) => a - b)[total >> 1] || 1;
  const shade = new Float32Array(total * 2), rnd = new Float32Array(total);
  for (let d = 0; d < total; d++) {
    shade[d * 2] = clamp(ridge[d] / (p90 || 1), -1, 1);
    shade[d * 2 + 1] = clamp(1 - cnt[d] / (0.55 * med), 0, 1);
    rnd[d] = rng();
  }

  /* world space */
  let minX = Infinity, maxX = -Infinity;
  for (let d = 0; d < total; d++) {
    P[d * 3] *= 2.8; P[d * 3 + 1] = P[d * 3 + 1] * 2.8 - 0.68; P[d * 3 + 2] *= 2.8;
    if (part[d] >= 2) { minX = Math.min(minX, P[d * 3]); maxX = Math.max(maxX, P[d * 3]); }
  }
  return { P, Nr, rnd, shade, part, total, minX, maxX };
}

/* ---------- shaders ---------- */
const BUST_VS = /* glsl */`
uniform float uTime, uAssemble, uSize, uGlint, uShine, uRingRadius;
uniform vec2 uHead; uniform vec3 uLight, uRingCenter;
attribute float aRand; attribute vec2 aShade; attribute float aPart;
varying float vB, vA, vLens, vShine, vGlint;
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
void main(){
  vec3 home0 = position;
  float head = smoothstep(-1.3, -0.6, home0.y);
  mat3 R = rotY(uHead.x * (0.25 + 0.75*head)) * rotX(uHead.y * head);
  vec3 pivot = vec3(0.,-1.,0.);
  vec3 home = R * (home0 - pivot) + pivot;
  vec3 n = normalize(R * normal);
  home += n * sin(uTime*1.4 + aRand*60.) * 0.006;
  float r2 = fract(sin(aRand*91.7)*43758.5453);
  float t = clamp((uAssemble - aRand*0.45)/0.55, 0., 1.);
  float e = t < 0.5 ? 4.*t*t*t : 1. - pow(-2.*t + 2., 3.)/2.;
  float ang = aRand*6.2831853;
  float rr = uRingRadius * (1. + (r2-0.5)*0.06);
  vec3 start = uRingCenter + vec3(cos(ang)*rr, sin(ang)*rr, 0.);
  vec3 pos = mix(start, home, e);
  pos += vec3(sin(aRand*40. + uTime*0.3), cos(aRand*31.), 0.9 + r2*1.4) * sin(e*3.14159265) * 0.45;
  vec4 mv = modelViewMatrix * vec4(pos, 1.);
  gl_Position = projectionMatrix * mv;
  vec3 toL = uLight - pos;
  float lit = max(dot(n, normalize(toL)), 0.) / (1. + dot(toL,toL)*0.32);
  float key = max(dot(n, normalize(vec3(-0.5,0.6,0.7))), 0.);
  float facing = normalize(normalMatrix * n).z;
  float rim = pow(1. - abs(facing), 3.);
  float b = 0.3 + key*0.22 + lit*1.5 + rim*0.14;
  b *= mix(0.55, 1., smoothstep(-0.3, 0.25, facing));
  float ridge = aShade.x, thin = aShade.y;
  b *= ridge > 0. ? 1. + ridge*0.7 : 1. + ridge*0.5;
  b += thin * (0.26 + key*0.3);
  float leaf = step(1.5, aPart) * step(aPart, 2.5);
  float frame = step(2.5, aPart) * step(aPart, 3.5);
  float lens = step(3.5, aPart);
  b *= mix(1., 0.9, leaf);
  b *= mix(1., 0.78, max(frame, lens));
  b *= mix(1., 0.7, lens);
  b *= 0.7 + r2*0.5;
  float glint = (1. - smoothstep(0., 0.09, abs(home0.x - uGlint))) * max(leaf, max(frame, lens));
  b += glint * 1.2;
  float band = home.y - home.x*0.5 - uShine;
  float shine = exp(-band*band*4.);
  b += shine * 1.3;
  vB = b; vA = mix(0.75, 1., e); vLens = lens; vShine = shine; vGlint = glint;
  gl_PointSize = uSize * (0.45 + r2*r2*1.3) * (1. + shine*0.6) / -mv.z;
}`;
const BUST_FS = /* glsl */`
uniform vec3 uInk, uBlue, uCream;
varying float vB, vA, vLens, vShine, vGlint;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d2 = dot(c,c);
  if (d2 > 0.25) discard;
  float a = exp(-16.*d2) * vA;
  vec3 ink = mix(uInk, uCream, vShine*0.6);
  ink = mix(ink, uBlue, 0.6*vLens);
  ink = mix(ink, uBlue, vGlint*0.7);
  gl_FragColor = vec4(ink * vB * a, 1.);
}`;
const LIGHT_VS = /* glsl */`
uniform float uSize, uOn;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = uSize * uOn / -mv.z; }`;
const LIGHT_FS = /* glsl */`
uniform float uOn;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.;
  if (r > 1.) discard;
  float core = 1. - smoothstep(0.08, 0.14, r);
  float glow = exp(-4.*r)*0.45 + exp(-12.*r)*0.7;
  gl_FragColor = vec4(vec3(core + glow) * uOn, 1.);
}`;
const DUST_VS = /* glsl */`
uniform float uTime, uSize, uOn; attribute float aRand; varying float vA;
void main(){
  vec3 p = position;
  p.y = mod(p.y + uTime*(0.03 + aRand*0.05) + 6., 12.) - 6.;
  p.x += sin(uTime*0.2 + aRand*40.) * 0.15;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.5 + aRand) / -mv.z;
  vA = (0.1 + aRand*0.18) * uOn;
}`;
const DUST_FS = /* glsl */`
uniform vec3 uInk; varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d2 = dot(c,c);
  if (d2 > 0.25) discard;
  gl_FragColor = vec4(uInk * vA * exp(-16.*d2), 1.);
}`;

/* ---------- scene ---------- */
function start(d) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x0f110d, 1);
  stage.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const target = new THREE.Vector3(0, -0.15, 0);
  const scene = new THREE.Scene();
  const col = (h) => new THREE.Color(h);
  const mat = (o) => new THREE.ShaderMaterial(Object.assign({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }, o));

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(d.P, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(d.Nr, 3));
  g.setAttribute("aRand", new THREE.BufferAttribute(d.rnd, 1));
  g.setAttribute("aShade", new THREE.BufferAttribute(d.shade, 2));
  g.setAttribute("aPart", new THREE.BufferAttribute(d.part, 1));
  const U = {
    uTime: { value: 0 }, uAssemble: { value: reduce ? 1 : 0 }, uSize: { value: 26 * dpr }, uGlint: { value: -9 }, uShine: { value: 99 },
    uHead: { value: new THREE.Vector2() }, uLight: { value: new THREE.Vector3(-1.4, 1.2, 1.6) },
    uRingCenter: { value: target.clone() }, uRingRadius: { value: 1 },
    uInk: { value: col("#c9d4b8") }, uBlue: { value: col("#7fa8a3") }, uCream: { value: col("#f0e5c8") },
  };
  const bust = new THREE.Points(g, mat({ uniforms: U, vertexShader: BUST_VS, fragmentShader: BUST_FS }));
  bust.frustumCulled = false; scene.add(bust);

  const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  const LU = { uSize: { value: 240 * dpr }, uOn: { value: reduce ? 1 : 0 } };
  const light = new THREE.Points(lg, mat({ uniforms: LU, vertexShader: LIGHT_VS, fragmentShader: LIGHT_FS }));
  light.frustumCulled = false; scene.add(light);

  const DN = 900, dp = new Float32Array(DN * 3), dr = new Float32Array(DN);
  for (let i = 0; i < DN; i++) { dp[i * 3] = (Math.random() * 2 - 1) * 9; dp[i * 3 + 1] = (Math.random() * 2 - 1) * 6; dp[i * 3 + 2] = -6 + Math.random() * 8; dr[i] = Math.random(); }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute("position", new THREE.BufferAttribute(dp, 3)); dg.setAttribute("aRand", new THREE.BufferAttribute(dr, 1));
  const DU = { uTime: { value: 0 }, uSize: { value: 22 * dpr }, uOn: { value: reduce ? 1 : 0 }, uInk: { value: col("#c9d4b8") } };
  const dust = new THREE.Points(dg, mat({ uniforms: DU, vertexShader: DUST_VS, fragmentShader: DUST_FS }));
  dust.frustumCulled = false; scene.add(dust);

  const T15 = Math.tan(Math.PI / 12);
  function resize() {
    const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    const dist = Math.max(2.35 / T15, 1.7 / (T15 * aspect));
    camera.position.set(0, -0.15, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    U.uRingRadius.value = RING_R * (2 * dist * T15 / h);
  }
  window.addEventListener("resize", resize); resize();

  /* pointer */
  const ptr = { active: false, nx: 0, ny: 0, last: 0, touch: false };
  const onPtr = (e) => { ptr.nx = (e.clientX / window.innerWidth) * 2 - 1; ptr.ny = -((e.clientY / window.innerHeight) * 2 - 1); ptr.active = true; ptr.last = performance.now(); ptr.touch = e.pointerType === "touch"; };
  window.addEventListener("pointermove", onPtr); window.addEventListener("pointerdown", onPtr);
  document.documentElement.addEventListener("pointerleave", () => { ptr.active = false; });
  window.addEventListener("blur", () => { ptr.active = false; });
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2.6);
  const hit = new THREE.Vector3(), lightT = new THREE.Vector3(-1.4, 1.2, 1.6), head = new THREE.Vector2(), headT = new THREE.Vector2();

  let t = 0, prev = performance.now(), ready = false;
  const ease = (rate, dt) => 1 - Math.exp(-dt * rate);
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now; t += dt;
    const time = reduce ? 0 : t;
    U.uTime.value = time; DU.uTime.value = time;
    if (!reduce) U.uAssemble.value = Math.min(1, t / 2.6);
    if (!ready && U.uAssemble.value > 0.55) { ready = true; page.dataset.phase = "ready"; }

    if (!reduce) {
      LU.uOn.value += (Math.min(1, 1.6 * U.uAssemble.value) - LU.uOn.value) * ease(4, dt);
      DU.uOn.value += (1 - DU.uOn.value) * ease(0.8, dt);
      /* shine: one diagonal band, once */
      const s = (t - 2.34) / 2.2;
      U.uShine.value = s >= 0 && s <= 1 ? 2.8 - (1 - (1 - s) * (1 - s)) * 7.4 : 99;
      /* glint: across the visor, then the leaves */
      const g0 = t - 4.6;
      if (g0 >= 0) { const c = g0 % 4.2; U.uGlint.value = c < 0.9 ? (d.minX - 0.15) + (c / 0.9) * ((d.maxX + 0.15) - (d.minX - 0.15)) : -9; }
    }

    const usePtr = ptr.active && (!ptr.touch || performance.now() - ptr.last < 1500);
    if (usePtr) {
      ray.setFromCamera({ x: ptr.nx, y: ptr.ny }, camera);
      if (ray.ray.intersectPlane(plane, hit)) lightT.copy(hit);
      headT.set(0.5 * ptr.nx, 0.18 * ptr.ny);
    } else {
      lightT.set(1.9 * Math.sin(0.45 * t), 0.5 + 0.8 * Math.cos(0.33 * t), 2.6);
      headT.set(0.35 * Math.sin(0.45 * t), 0.12 * Math.cos(0.33 * t));
    }
    if (reduce) { U.uLight.value.copy(lightT); head.set(0, 0); }
    else {
      U.uLight.value.lerp(lightT, ease(5, dt));
      head.lerp(headT, ease(usePtr ? 3 : 1.5, dt));
    }
    U.uHead.value.set(head.x, -head.y);
    light.position.copy(U.uLight.value);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  prev = performance.now();
  if (reduce) page.dataset.phase = "ready";
  requestAnimationFrame(frame);
}

/* ---------- go ---------- */
(async () => {
  setProgress(0);
  try {
    const buf = await fetchModel();
    const gltf = await parseGLB(buf);
    await new Promise((r) => setTimeout(r, 0));
    const dots = buildDots(gltf);
    setProgress(1);
    if (!reduce) await new Promise((r) => setTimeout(r, 380));
    start(dots);
  } catch (err) {
    console.error("Aegis landing:", err);
    fail();
  }
})();
