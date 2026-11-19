// Aegis voice studio: Siri-style voice personas on top of the browser's built-in speech voices. No keys, no server.
//
// A persona (Aria, Ethan, Olivia, Oliver, ...) is a *recipe*: gender, accent, pitch and speed. At speaking time the
// recipe is matched against the voices actually installed on this device, so the same persona sounds as good as your
// system allows (Siri / Neural / Natural / Premium voices are preferred). If a device has no voice of that gender,
// the closest voice is used and the pitch is shifted so the persona still sounds different.
//
//   AegisVoice.resolve(lang) -> { voice, lang, rate, pitch, volume }     used by app.js when speaking
//   AegisVoice.find("british male") -> persona | null                     used by voice commands
//   AegisVoice.set(id) / cycle() / tune({rate, pitch, volume}) / reset() / list() / describe() / preview()
(() => {
  "use strict";

  const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  // region = preferred accent (BCP-47 region), g = gender wanted (f / m), pitch + rate = the persona's character
  const PERSONAS = [
    { id: "aria",   name: "Aria",   desc: "Warm, friendly, American",     region: "US", g: "f", pitch: 1.05, rate: 1.0 },
    { id: "ethan",  name: "Ethan",  desc: "Calm, clear, American",        region: "US", g: "m", pitch: 0.95, rate: 1.0 },
    { id: "olivia", name: "Olivia", desc: "Polished British",             region: "GB", g: "f", pitch: 1.0,  rate: 0.98 },
    { id: "oliver", name: "Oliver", desc: "Refined British butler",       region: "GB", g: "m", pitch: 0.9,  rate: 0.96 },
    { id: "ruby",   name: "Ruby",   desc: "Bright Australian",            region: "AU", g: "f", pitch: 1.05, rate: 1.03 },
    { id: "noah",   name: "Noah",   desc: "Relaxed Australian",           region: "AU", g: "m", pitch: 0.95, rate: 1.0 },
    { id: "priya",  name: "Priya",  desc: "Indian English, gentle",       region: "IN", g: "f", pitch: 1.02, rate: 1.0 },
    { id: "arjun",  name: "Arjun",  desc: "Indian English, steady",       region: "IN", g: "m", pitch: 0.95, rate: 1.0 },
    { id: "nova",   name: "Nova",   desc: "Fast, bright, energetic",      region: "US", g: "f", pitch: 1.22, rate: 1.14 },
    { id: "atlas",  name: "Atlas",  desc: "Deep, slow, commanding",       region: "US", g: "m", pitch: 0.72, rate: 0.9 },
  ];
  const SIRI = { id: "siri", name: "Siri-style", desc: "Your device's Siri voice (Apple devices)", region: "US", g: "f", pitch: 1, rate: 1, siri: true };
  const AUTO = { id: "auto", name: "Auto", desc: "Best voice on this device", region: "", g: "", pitch: 1, rate: 1 };
  const SYSTEM = { id: "system", name: "Pick manually", desc: "Choose any installed voice", region: "", g: "", pitch: 1, rate: 1 };

  const FEMALE = /\b(samantha|ava|allison|susan|victoria|karen|moira|tessa|fiona|veena|zira|hazel|aria|jenny|libby|sonia|natasha|clara|catherine|nicky|joana|serena|kate|heera|neerja|olivia|emma|amy|salli|joanna|kendra|kimberly|ivy|zoe|female|woman|siri voice [24]|google (?:us|uk) english female|lekha|kalpana|nora|ellen|laura|paulina|monica|sara|zuzana|mariska|ting-ting|mei-jia|sin-ji|kyoko|samira|salma|uzma)\b/i;
  const MALE = /\b(daniel|alex|fred|tom|oliver|arthur|aaron|rishi|david|mark|guy|ryan|george|james|richard|ravi|prabhat|male|man|thomas|liam|william|evan|gordon|lee|matthew|brian|justin|joey|joey|kevin|russell|nathan|jorge|diego|siri voice [13]|hemant|madhur|henry|eddy|reed|rocko|salman|asad)\b/i;
  const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|pipe organ|grandma|grandpa|ralph)\b/i;
  const QUALITY = [[/siri/i, 40], [/neural|natural|online/i, 30], [/premium|enhanced|studio|plus/i, 24], [/google/i, 12], [/microsoft/i, 8]];

  const genderOf = (v) => (FEMALE.test(v.name) ? "f" : MALE.test(v.name) ? "m" : "");
  const normLang = (l) => String(l || "").replace("_", "-");
  const regionOf = (v) => (normLang(v.lang).split("-")[1] || "").toUpperCase();
  const baseOf = (l) => normLang(l).split("-")[0].toLowerCase();
  const voices = () => (hasTTS ? speechSynthesis.getVoices() : []);

  function quality(v) {
    let q = 0;
    for (const [re, pts] of QUALITY) if (re.test(v.name)) q += pts;
    if (NOVELTY.test(v.name)) q -= 60;
    if (v.localService) q += 3;
    return q;
  }

  function score(v, p, lang) {
    let s = quality(v);
    if (baseOf(v.lang) === baseOf(lang)) s += 100; else return -1e9;      // never read English with a Hindi voice
    if (p.region && baseOf(lang) === "en") s += regionOf(v) === p.region ? 60 : 0;
    if (p.g) { const g = genderOf(v); if (g === p.g) s += 45; else if (g && g !== p.g) s -= 45; }
    if (p.siri && /siri/i.test(v.name)) s += 200;
    return s;
  }

  const hasSiri = () => voices().some((v) => /siri/i.test(v.name));
  const allPersonas = () => [AUTO, ...(hasSiri() ? [SIRI] : []), ...PERSONAS, SYSTEM];
  const byId = (id) => allPersonas().find((p) => p.id === id) || AUTO;

  // ---------------------------------------------------------------- state
  const state = {
    persona: store.get("aegis_persona") || "auto",
    pitch: parseFloat(store.get("aegis_pitch")) || 1,
    volume: store.get("aegis_volume") == null ? 1 : Math.max(0, Math.min(1, parseFloat(store.get("aegis_volume")))),
  };
  const listeners = new Set();
  const emit = () => { listeners.forEach((f) => { try { f(); } catch {} }); render(); };

  function rateInput() { const r = $("rate"); return r ? parseFloat(r.value) || 1.02 : 1.02; }

  function best(p, lang) {
    let top = null, topScore = -1e8;
    for (const v of voices()) { const s = score(v, p, lang); if (s > topScore) { top = v; topScore = s; } }
    return top;
  }

  // the one function app.js needs. Returns null when personas have nothing to say (auto / manual), so the old picker runs.
  function resolve(lang) {
    lang = lang || "en-US";
    const p = byId(state.persona);
    if (p.id === "auto" || p.id === "system" || !hasTTS) return null;
    const v = best(p, lang);
    let pitch = p.pitch * state.pitch;
    if (v && p.g) { const g = genderOf(v); if (g && g !== p.g) pitch *= p.g === "f" ? 1.28 : 0.74; }   // wrong-gender fallback: shift to match
    return {
      voice: v, lang: v ? v.lang : lang,
      rate: Math.max(0.6, Math.min(1.8, rateInput() * p.rate)),
      pitch: Math.max(0.4, Math.min(2, pitch)),
      volume: state.volume,
    };
  }

  // extra tuning that applies for auto / manual too (pitch + volume)
  function tuning() { return { pitch: state.pitch, volume: state.volume }; }

  // ---------------------------------------------------------------- control
  function set(id) {
    const p = byId(id);
    state.persona = p.id;
    store.set("aegis_persona", p.id);
    emit();
    return p;
  }
  function cycle(dir) {
    const list = allPersonas().filter((p) => p.id !== "system");
    const i = list.findIndex((p) => p.id === state.persona);
    return set(list[(i + (dir || 1) + list.length) % list.length].id);
  }
  function tune(o) {
    if (o.rate != null) { const r = $("rate"); const nv = Math.max(0.8, Math.min(1.4, o.rate)); if (r) { r.value = String(nv); store.set("aegis_rate", String(nv)); } }
    if (o.pitch != null) { state.pitch = Math.max(0.6, Math.min(1.6, o.pitch)); store.set("aegis_pitch", String(state.pitch)); }
    if (o.volume != null) { state.volume = Math.max(0.1, Math.min(1, o.volume)); store.set("aegis_volume", String(state.volume)); }
    emit();
    return { rate: rateInput(), pitch: state.pitch, volume: state.volume };
  }
  function reset() { state.pitch = 1; state.volume = 1; store.set("aegis_pitch", null); store.set("aegis_volume", null); const r = $("rate"); if (r) { r.value = "1.02"; store.set("aegis_rate", "1.02"); } emit(); }

  // free-text voice request -> persona ("british male", "deep voice", "siri", "indian woman" ...)
  function find(text) {
    const t = String(text || "").toLowerCase();
    const named = allPersonas().find((p) => p.id !== "auto" && p.id !== "system" && new RegExp("\\b" + p.name.toLowerCase().replace("-style", "") + "\\b").test(t));
    if (named) return named;
    if (/\bsiri\b/.test(t)) return hasSiri() ? SIRI : byId("aria");
    if (/\b(?:robot|robotic|jarvis|butler)\b/.test(t)) return byId("oliver");
    if (/\b(?:deep|low|heavy|bass|commanding)\b/.test(t)) return byId("atlas");
    if (/\b(?:fast|energetic|bright|young|cheerful)\b/.test(t)) return byId("nova");
    const g = /\b(?:female|woman|girl|lady|aurat|larki|she)\b/.test(t) ? "f" : /\b(?:male|man|boy|guy|mard|larka|he)\b/.test(t) ? "m" : "";
    const region = /\b(?:brit\w*|uk|english uk|london|angrez\w*)\b/.test(t) ? "GB" : /\b(?:austral\w*|aussie|au)\b/.test(t) ? "AU" : /\b(?:indian?|desi|india)\b/.test(t) ? "IN" : /\b(?:americ\w*|us|usa)\b/.test(t) ? "US" : "";
    if (g || region) {
      const hit = PERSONAS.find((p) => (!g || p.g === g) && (!region || p.region === region) && !/nova|atlas/.test(p.id));
      return hit || null;
    }
    if (/\bauto(?:matic)?\b|\bdefault\b/.test(t)) return AUTO;
    return null;
  }

  function describe() {
    const p = byId(state.persona);
    const pr = resolve("en-US");
    const vname = pr && pr.voice ? pr.voice.name.replace(/^(Microsoft|Google)\s+/, "") : "";
    return p.name + (vname ? " (" + vname + ")" : "");
  }
  const list = () => allPersonas().filter((p) => p.id !== "auto" && p.id !== "system");

  // ---------------------------------------------------------------- preview
  let previewGen = 0;
  function preview(id) {
    if (!hasTTS) return;
    const prev = state.persona;
    const p = id ? byId(id) : byId(prev);
    const lang = "en-US";
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(p.id === "auto" || p.id === "system" ? "Hello, this is how I sound." : "Hi, I'm " + p.name.replace("-style", "") + ". How can I help you today?");
    // preview a persona without switching to it
    const saved = state.persona; state.persona = p.id;
    const r = resolve(lang); state.persona = saved;
    const gen = ++previewGen;
    if (r) { if (r.voice) u.voice = r.voice; u.lang = r.lang; u.rate = r.rate; u.pitch = r.pitch; u.volume = r.volume; }
    else { u.lang = lang; u.rate = rateInput(); u.pitch = state.pitch; u.volume = state.volume; }
    u.onstart = () => { if (window.__aegisOrb) window.__aegisOrb.pulse(0.9); };
    u.onboundary = () => { if (gen === previewGen && window.__aegisOrb) window.__aegisOrb.pulse(0.4 + Math.random() * 0.5); };
    speechSynthesis.speak(u);
  }

  // ---------------------------------------------------------------- settings UI
  let host = null, grid = null, note = null, pitchEl = null, volEl = null;
  function render() {
    if (!grid) return;
    const cur = state.persona;
    grid.textContent = "";
    allPersonas().forEach((p) => {
      const card = document.createElement("div");
      card.className = "vp-card" + (p.id === cur ? " on" : "");
      card.setAttribute("role", "radio");
      card.setAttribute("aria-checked", p.id === cur ? "true" : "false");
      card.tabIndex = 0;
      const av = document.createElement("span");
      av.className = "vp-av"; av.dataset.g = p.g || "n";
      av.textContent = p.id === "auto" ? "✨" : p.id === "system" ? "⚙" : p.name.charAt(0);
      const tx = document.createElement("span");
      tx.className = "vp-tx";
      const b = document.createElement("b"); b.textContent = p.name;
      const s = document.createElement("small"); s.textContent = p.desc;
      tx.append(b, s);
      const play = document.createElement("button");
      play.type = "button"; play.className = "vp-play"; play.setAttribute("aria-label", "Preview " + p.name); play.title = "Preview";
      play.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
      play.addEventListener("click", (e) => { e.stopPropagation(); preview(p.id); });
      const pick = () => { set(p.id); preview(p.id); };
      card.addEventListener("click", pick);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      card.append(av, tx, play);
      grid.appendChild(card);
    });
    const manual = $("voice-pick");
    if (manual) manual.closest("label").style.display = cur === "system" ? "" : "none";
    if (note) {
      const siri = hasSiri();
      note.textContent = (hasTTS ? "Now using: " + describe() + ". " : "This browser can't speak. ") +
        (siri ? "Siri voices detected on this device. " : voices().length ? "More voices appear here when you install them in your system's speech settings. " : "Loading voices...");
    }
    if (pitchEl) pitchEl.value = String(state.pitch);
    if (volEl) volEl.value = String(state.volume);
  }

  function mountUI() {
    const group = $("voice-pick") && $("voice-pick").closest(".set-group");
    if (!group || host) return;
    host = document.createElement("div");
    host.className = "vp";
    const h = document.createElement("div"); h.className = "vp-h"; h.textContent = "Voice personality";
    grid = document.createElement("div"); grid.className = "vp-grid"; grid.setAttribute("role", "radiogroup"); grid.setAttribute("aria-label", "Voice personality");
    note = document.createElement("p"); note.className = "muted small vp-note";
    const mk = (label, min, max, step, onInput) => {
      const l = document.createElement("label"); l.className = "field";
      const sp = document.createElement("span"); sp.textContent = label;
      const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.setAttribute("aria-label", label);
      inp.addEventListener("input", () => onInput(parseFloat(inp.value)));
      l.append(sp, inp);
      return [l, inp];
    };
    const [pl, pi] = mk("Pitch", "0.6", "1.6", "0.05", (v) => { state.pitch = v; store.set("aegis_pitch", String(v)); });
    const [vl, vi] = mk("Volume", "0.1", "1", "0.05", (v) => { state.volume = v; store.set("aegis_volume", String(v)); });
    [pi, vi].forEach((i) => i.addEventListener("change", () => preview()));
    pitchEl = pi; volEl = vi;
    host.append(h, grid, note, pl, vl);
    // put personas first inside the Voice group, right under its title
    const title = group.querySelector("h4");
    title.after(host);
    render();
  }

  // compact controller for the right-hand "Voice" tab (tabs.js creates #vp-quick; safe to call twice)
  let quick = null;
  function mountQuick() {
    const box = $("vp-quick");
    if (!box || quick) return;
    quick = { box };
    box.textContent = "";
    const head = document.createElement("div"); head.className = "row blk-head static";
    head.innerHTML = '<h3><svg class="h-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>Voice studio</h3>';
    const eq = document.createElement("div"); eq.className = "vq-eq"; eq.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 24; i++) { const b = document.createElement("i"); b.style.setProperty("--i", i); eq.appendChild(b); }
    quick.now = document.createElement("p"); quick.now.className = "vq-now";
    quick.chips = document.createElement("div"); quick.chips.className = "vq-chips"; quick.chips.setAttribute("role", "radiogroup"); quick.chips.setAttribute("aria-label", "Voice personality");
    const mk = (label, min, max, step, get, set) => {
      const l = document.createElement("label"); l.className = "vq-row";
      const sp = document.createElement("span"); sp.textContent = label;
      const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.setAttribute("aria-label", label);
      const out = document.createElement("output");
      inp.addEventListener("input", () => { set(parseFloat(inp.value)); out.textContent = parseFloat(inp.value).toFixed(2); });
      inp.addEventListener("change", () => preview());
      l.append(sp, inp, out);
      return { l, inp, out, get };
    };
    quick.rows = [
      mk("Speed", "0.8", "1.4", "0.05", rateInput, (v) => tune({ rate: v })),
      mk("Pitch", "0.6", "1.6", "0.05", () => state.pitch, (v) => tune({ pitch: v })),
      mk("Volume", "0.1", "1", "0.05", () => state.volume, (v) => tune({ volume: v })),
    ];
    const test = document.createElement("button"); test.type = "button"; test.className = "btn ghost small-btn vq-test"; test.textContent = "Test voice";
    test.addEventListener("click", () => preview());
    box.append(head, eq, quick.now, quick.chips, ...quick.rows.map((r) => r.l), test);
    renderQuick();
  }
  function renderQuick() {
    if (!quick) return;
    quick.now.textContent = hasTTS ? describe() : "Speech is not supported in this browser";
    quick.chips.textContent = "";
    allPersonas().filter((p) => p.id !== "system").forEach((p) => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "vq-chip" + (p.id === state.persona ? " on" : ""); c.textContent = p.name.replace("-style", ""); c.title = p.desc;
      c.setAttribute("role", "radio"); c.setAttribute("aria-checked", p.id === state.persona ? "true" : "false");
      c.addEventListener("click", () => { set(p.id); preview(p.id); });
      quick.chips.appendChild(c);
    });
    quick.rows.forEach((r) => { const v = r.get(); r.inp.value = String(v); r.out.textContent = Number(v).toFixed(2); });
  }
  listeners.add(renderQuick);

  if (hasTTS) {
    speechSynthesis.addEventListener("voiceschanged", () => emit());
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountUI); else mountUI();
  }

  window.AegisVoice = { mountQuick, resolve, tuning, find, set, cycle, tune, reset, list, describe, preview, get persona() { return state.persona; }, onChange(f) { listeners.add(f); } };
})();
