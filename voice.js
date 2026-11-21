// Aegis voice: ONE female voice, with feeling.
//
// There is a single persona (a warm female voice). It is matched to the best female voice installed on the device
// (Neural / Natural / Premium / Siri voices are preferred; a male voice is never chosen while a female one exists).
// On top of that sits an emotion engine: every sentence is read for its feeling (joy, excitement, empathy, concern,
// urgency, curiosity, warmth, confidence...) and spoken with its own pitch, speed, volume and pause, so the voice
// does not sound like a monotone reader. No keys, no server: it all runs on the browser's built-in speech.
//
//   AegisVoice.resolve(lang, emotion?) -> { voice, lang, rate, pitch, volume }
//   AegisVoice.shape(text, lang, opts?) -> [{ text, emotion, rate, pitch, volume, pause }]   used by app.js to speak
//   AegisVoice.emotionOf(text)          -> "joy" | "excited" | "empathy" | "concern" | "urgent" | "curious" | "warm" | "confident" | "calm"
//   AegisVoice.tune({rate, pitch, volume, expression}) / reset() / describe() / preview() / find(text)
(() => {
  "use strict";

  const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  const $ = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  // ---------------------------------------------------------------- the one voice
  const PERSONA = { id: "aegis", name: "Aegis", desc: "Warm, expressive female voice", g: "f", pitch: 1.06, rate: 1.0 };

  const FEMALE = /\b(samantha|ava|allison|susan|victoria|karen|moira|tessa|fiona|veena|zira|hazel|aria|jenny|libby|sonia|natasha|clara|catherine|nicky|joana|serena|kate|heera|neerja|olivia|emma|amy|salli|joanna|kendra|kimberly|ivy|zoe|female|woman|siri voice [24]|lekha|kalpana|nora|ellen|laura|paulina|monica|sara|zuzana|mariska|ting-ting|mei-jia|sin-ji|kyoko|samira|salma|uzma|swara|michelle|ana|emily|maisie|ruth|nicole|jessica|sophia|isabella|ayesha|aisha|zariyah|fatima|hoda|hala|laila|ekaterina|svetlana|katja|elke|denise|lucia|paloma|elvira|vera)\b/i;
  const MALE = /\b(daniel|alex|fred|tom|oliver|arthur|aaron|rishi|david|mark|guy|ryan|george|james|richard|ravi|prabhat|male|man|thomas|liam|william|evan|gordon|lee|matthew|brian|justin|joey|kevin|russell|nathan|jorge|diego|siri voice [13]|hemant|madhur|henry|eddy|reed|rocko|salman|asad|christopher|eric|roger|steffan|mohan|ravi|hamed|naayf|maged|jamal)\b/i;
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

  // A female voice always beats a male one; accent follows the page language (en-GB page -> British female, and so on).
  function score(v, lang) {
    if (baseOf(v.lang) !== baseOf(lang)) return -1e9;                    // never read English with a Hindi voice
    let s = quality(v) + 100;
    const g = genderOf(v);
    if (g === "f") s += 400; else if (g === "m") s -= 400;
    const want = (normLang(lang).split("-")[1] || "").toUpperCase();
    if (want && regionOf(v) === want) s += 25;
    return s;
  }

  function best(lang) {
    let top = null, topScore = -1e8;
    for (const v of voices()) { const s = score(v, lang); if (s > topScore) { top = v; topScore = s; } }
    return top;
  }

  // ---------------------------------------------------------------- state
  const num = (k, d, lo, hi) => { const n = parseFloat(store.get(k)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const state = {
    pitch: num("aegis_pitch", 1, 0.6, 1.6),
    volume: num("aegis_volume", 1, 0.1, 1),
    expression: num("aegis_expression", 1, 0, 1.6),   // 0 = flat, 1 = natural, 1.6 = very dramatic
  };
  const listeners = new Set();
  const emit = () => { listeners.forEach((f) => { try { f(); } catch {} }); };
  function rateInput() { const r = $("rate"); return r ? parseFloat(r.value) || 1.02 : 1.02; }

  // ---------------------------------------------------------------- emotion engine
  // pitch / rate / volume are multipliers around the neutral voice; pause is the silence (ms) left after the sentence.
  const EMOTIONS = {
    calm:      { pitch: 1.00, rate: 1.00, volume: 1.00, pause: 240 },
    warm:      { pitch: 1.05, rate: 0.97, volume: 1.00, pause: 260 },
    joy:       { pitch: 1.12, rate: 1.05, volume: 1.00, pause: 240 },
    excited:   { pitch: 1.18, rate: 1.12, volume: 1.00, pause: 200 },
    curious:   { pitch: 1.09, rate: 1.00, volume: 0.98, pause: 300 },
    empathy:   { pitch: 0.93, rate: 0.88, volume: 0.90, pause: 420 },
    concern:   { pitch: 0.96, rate: 0.93, volume: 0.96, pause: 360 },
    urgent:    { pitch: 1.08, rate: 1.12, volume: 1.00, pause: 160 },
    confident: { pitch: 0.98, rate: 0.98, volume: 1.00, pause: 280 },
  };

  // Lexicon in English, Roman Urdu and Urdu script. Each hit is a point for that emotion.
  const LEX = {
    joy: /\b(great|awesome|wonderful|fantastic|excellent|perfect|congrat\w*|happy|glad|love|nice|brilliant|amazing|well done|good news|success\w*|celebrat\w*|mubarak|mubarik|shabash|zabardast|khush\w*|kamyab\w*|acha|achha|behtareen|kamaal|wah|bohat khoob|shandar)\b|مبارک|شاباش|زبردست|خوش|کامیاب|بہترین|واہ|شاندار/i,
    excited: /\b(wow|yay|incredible|unbelievable|can't wait|so exciting|let's go|hooray|woohoo|amazing news|finally)\b|واہ واہ|ماشاء ?اللہ/i,
    empathy: /\b(sorry|apolog\w*|unfortunately|sadly|regret|my condolences|i understand|that must be|hard time|difficult time|afsos|maaf\w*|dukh|takleef|mushkil waqt|sad|i'm here for you|take care|get well|condolence\w*)\b|معذرت|افسوس|معاف|دکھ|تکلیف|مشکل وقت/i,
    concern: /\b(warning|careful|caution|risk\w*|danger\w*|problem|issue|blocker|failed|failure|error|cannot|can't|couldn't|unable|missing|delay\w*|late|overdue|khatra|khatrey|masla|masail|ehtiyat|nakam\w*|ghalti|der ho|deri)\b|خطرہ|مسئلہ|احتیاط|ناکام|غلطی|تاخیر/i,
    urgent: /\b(urgent\w*|immediately|right now|asap|emergency|critical|alert|deadline today|abhi|fori|foran|jaldi|zaroori)\b|فوری|ابھی|جلدی|ضروری/i,
    warm: /\b(hello|hi there|hey|good (?:morning|afternoon|evening)|welcome|thank(?:s| you)|please|pleasure|assalam\w*|salam|shukriya|meherbani|khush amdeed|khair mubarak|aap ka shukriya)\b|سلام|شکریہ|مہربانی|خوش آمدید|السلام/i,
    confident: /\b(decided|decision|confirmed|approved|agreed|will do|done|completed|ready|sorted|settled|final|faisla|tay|manzoor|mukammal|ho gaya|ho gayi|tayyar)\b|فیصلہ|منظور|مکمل|تیار|طے/i,
  };

  // The feeling of one sentence. `hint` (from the caller) wins, so a meeting read-out can say "this part is serious".
  function emotionOf(text, hint) {
    if (hint && EMOTIONS[hint]) return hint;
    const t = String(text || "").trim();
    if (!t) return "calm";
    const score = {};
    for (const k of Object.keys(LEX)) { const m = t.match(new RegExp(LEX[k].source, "gi")); score[k] = m ? m.length : 0; }
    const bangs = (t.match(/!/g) || []).length;
    if (bangs) { score.excited += bangs > 1 ? 2 : 0; score.joy += 1; }
    if (/\?\s*$|؟\s*$/.test(t)) score.curious = (score.curious || 0) + 2;
    if (/\.{3}|…/.test(t)) score.empathy += 1;
    if (/[\u{1F600}-\u{1F64F}]/u.test(t)) score.joy += 1;
    let top = "calm", n = 0;
    for (const k of ["urgent", "empathy", "concern", "excited", "joy", "curious", "confident", "warm"]) {   // order = tie-break priority
      if ((score[k] || 0) > n) { top = k; n = score[k]; }
    }
    return top;
  }

  function splitSentences(text) {
    const parts = [];
    for (const para of String(text || "").split(/\n{2,}/)) {
      const ss = para.match(/[^.!?۔।؟\n]+(?:\.{3}|[.!?۔।؟]+)?/g) || [];
      ss.forEach((s, i) => { const x = s.trim(); if (x) parts.push({ text: x, para: i === ss.length - 1 }); });
    }
    return parts;
  }

  // text -> pieces ready for speechSynthesis. Short sentences are joined (fewer gaps), long ones are cut at commas.
  function shape(text, lang, opts) {
    opts = opts || {};
    const ex = opts.expression != null ? opts.expression : state.expression;
    const lerp = (m) => 1 + (m - 1) * ex;                 // scale a multiplier by the expression level
    const out = [];
    let idx = 0;
    for (const s of splitSentences(text)) {
      const emo = emotionOf(s.text, opts.emotion);
      const e = EMOTIONS[emo];
      // a gentle alternating lift so even a calm paragraph is never a flat line
      const drift = ex ? ((idx++ % 3) - 1) * 0.012 * ex : 0;
      const ell = /\.{3}|…\s*$/.test(s.text);
      let pieces = [s.text];
      if (s.text.length > 170) pieces = s.text.match(/.{1,170}(?:[,;،؛]\s|\s|$)/g) || [s.text];   // browsers cut long utterances
      pieces.forEach((p, i) => {
        const last = i === pieces.length - 1;
        out.push({
          text: p.trim(), emotion: emo,
          rate: clamp(lerp(e.rate) * (ell ? 0.94 : 1), 0.6, 1.7),
          pitch: clamp(lerp(e.pitch) + drift, 0.5, 1.9),
          volume: clamp(lerp(e.volume), 0.1, 1),
          pause: last ? Math.round(e.pause * (s.para ? 1.5 : 1) * (ell ? 1.6 : 1) * Math.max(0.4, ex)) : 70,
        });
      });
    }
    return out.filter((x) => x.text);
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------------------------------------------------------------- resolve (one voice, optional emotion)
  function resolve(lang, emotion) {
    lang = lang || "en-US";
    if (!hasTTS) return null;
    const v = best(lang);
    let pitch = PERSONA.pitch * state.pitch;
    if (!v) pitch *= 1.08;                                                    // the browser will pick; lean female
    else if (genderOf(v) === "m") pitch *= 1.28;                              // only male voices installed: lift towards female
    const e = EMOTIONS[emotion] || EMOTIONS.calm;
    return {
      voice: v, lang: v ? v.lang : lang,
      rate: clamp(rateInput() * PERSONA.rate * (1 + (e.rate - 1) * state.expression), 0.6, 1.8),
      pitch: clamp(pitch * (1 + (e.pitch - 1) * state.expression), 0.4, 2),
      volume: state.volume,
    };
  }
  function tuning() { return { pitch: state.pitch, volume: state.volume }; }

  // ---------------------------------------------------------------- control
  function tune(o) {
    if (o.rate != null) { const r = $("rate"); const nv = clamp(o.rate, 0.8, 1.4); if (r) { r.value = String(nv); store.set("aegis_rate", String(nv)); } }
    if (o.pitch != null) { state.pitch = clamp(o.pitch, 0.6, 1.6); store.set("aegis_pitch", String(state.pitch)); }
    if (o.volume != null) { state.volume = clamp(o.volume, 0.1, 1); store.set("aegis_volume", String(state.volume)); }
    if (o.expression != null) { state.expression = clamp(o.expression, 0, 1.6); store.set("aegis_expression", String(state.expression)); }
    emit();
    return { rate: rateInput(), pitch: state.pitch, volume: state.volume, expression: state.expression };
  }
  function reset() {
    state.pitch = 1; state.volume = 1; state.expression = 1;
    ["aegis_pitch", "aegis_volume", "aegis_expression"].forEach((k) => store.set(k, null));
    const r = $("rate"); if (r) { r.value = "1.02"; store.set("aegis_rate", "1.02"); }
    emit();
  }

  // Any request about "which voice" now has one answer. Male / accent requests are mapped to the single persona (or refused by the caller).
  function find(text) {
    const t = String(text || "").toLowerCase();
    if (/\b(?:male|man|boy|guy|mard|larka|he)\b/.test(t) && !/\bfemale\b/.test(t)) return null;   // we only have the female voice
    return PERSONA;
  }
  const list = () => [PERSONA];
  const set = () => PERSONA;
  const cycle = () => PERSONA;
  function describe() {
    const r = resolve("en-US");
    const vname = r && r.voice ? r.voice.name.replace(/^(Microsoft|Google)\s+/, "") : "";
    return PERSONA.name + " (female" + (vname ? ", " + vname : "") + ")";
  }

  // ---------------------------------------------------------------- preview
  const SAMPLES = [
    ["warm", "Hi, I'm Aegis. It's lovely to talk with you."],
    ["joy", "Great news! Your report is ready, and it looks wonderful."],
    ["empathy", "I'm sorry, that sounds really hard. I'm here to help."],
    ["concern", "Careful, there is a risk of a delay on this one."],
  ];
  let previewGen = 0;
  function speakShaped(text, opts) {
    if (!hasTTS) return;
    const gen = ++previewGen;
    speechSynthesis.cancel();
    const pieces = shape(text, "en-US", opts);
    const lang = "en-US";
    const step = (i) => {
      if (gen !== previewGen || i >= pieces.length) return;
      const p = pieces[i];
      const r = resolve(lang, p.emotion);
      const u = new SpeechSynthesisUtterance(p.text);
      if (r && r.voice) u.voice = r.voice;
      u.lang = r ? r.lang : lang;
      u.rate = p.rate * (rateInput() * PERSONA.rate); u.pitch = clamp(p.pitch * PERSONA.pitch * state.pitch, 0.4, 2); u.volume = p.volume * state.volume;
      u.onstart = () => { if (window.__aegisOrb) window.__aegisOrb.pulse(0.9); };
      u.onboundary = () => { if (gen === previewGen && window.__aegisOrb) window.__aegisOrb.pulse(0.4 + Math.random() * 0.5); };
      const next = () => { if (gen === previewGen) setTimeout(() => step(i + 1), p.pause); };
      u.onend = next; u.onerror = next;
      speechSynthesis.speak(u);
    };
    step(0);
  }
  let sampleIdx = 0;
  function preview() {
    const s = SAMPLES[sampleIdx++ % SAMPLES.length];
    speakShaped(s[1], { emotion: s[0] });
  }

  // ---------------------------------------------------------------- settings UI
  function mountUI() {
    const pick = $("voice-pick");
    const group = pick && pick.closest(".set-group");
    if (!group || group.querySelector(".vp")) return;
    const lab = pick.closest("label"); if (lab) lab.style.display = "none";       // one voice only: no manual voice picker
    const host = document.createElement("div");
    host.className = "vp";
    const h = document.createElement("div"); h.className = "vp-h"; h.textContent = "Aegis voice";
    const note = document.createElement("p"); note.className = "muted small vp-note";
    const refresh = () => { note.textContent = hasTTS ? "One female voice: " + describe() + ". It reads the feeling of each sentence and speaks it with matching tone, speed and pauses." : "This browser can't speak."; };
    refresh(); listeners.add(refresh);
    const mk = (label, min, max, step, get, set) => {
      const l = document.createElement("label"); l.className = "field";
      const sp = document.createElement("span"); sp.textContent = label;
      const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = String(get()); inp.setAttribute("aria-label", label);
      inp.addEventListener("input", () => set(parseFloat(inp.value)));
      inp.addEventListener("change", () => preview());
      l.append(sp, inp);
      return l;
    };
    const test = document.createElement("button"); test.type = "button"; test.className = "btn ghost small-btn"; test.textContent = "Hear my emotions";
    test.addEventListener("click", () => speakShaped(SAMPLES.map((s) => s[1]).join("\n\n")));
    host.append(h, note,
      mk("Emotion (0 flat, 1 natural, 1.6 dramatic)", "0", "1.6", "0.1", () => state.expression, (v) => { state.expression = v; store.set("aegis_expression", String(v)); }),
      mk("Pitch", "0.6", "1.6", "0.05", () => state.pitch, (v) => { state.pitch = v; store.set("aegis_pitch", String(v)); }),
      mk("Volume", "0.1", "1", "0.05", () => state.volume, (v) => { state.volume = v; store.set("aegis_volume", String(v)); }),
      test);
    group.querySelector("h4").after(host);
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
      mk("Emotion", "0", "1.6", "0.1", () => state.expression, (v) => tune({ expression: v })),
      mk("Speed", "0.8", "1.4", "0.05", rateInput, (v) => tune({ rate: v })),
      mk("Pitch", "0.6", "1.6", "0.05", () => state.pitch, (v) => tune({ pitch: v })),
      mk("Volume", "0.1", "1", "0.05", () => state.volume, (v) => tune({ volume: v })),
    ];
    const test = document.createElement("button"); test.type = "button"; test.className = "btn ghost small-btn vq-test"; test.textContent = "Hear my emotions";
    test.addEventListener("click", () => speakShaped(SAMPLES.map((s) => s[1]).join("\n\n")));
    box.append(head, eq, quick.now, ...quick.rows.map((r) => r.l), test);
    renderQuick();
  }
  function renderQuick() {
    if (!quick) return;
    quick.now.textContent = hasTTS ? describe() : "Speech is not supported in this browser";
    quick.rows.forEach((r) => { const v = r.get(); r.inp.value = String(v); r.out.textContent = Number(v).toFixed(2); });
  }
  listeners.add(renderQuick);

  if (hasTTS && typeof document !== "undefined") {
    speechSynthesis.addEventListener("voiceschanged", emit);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountUI); else mountUI();
  }

  const api = { mountQuick, resolve, shape, emotionOf, tuning, find, set, cycle, tune, reset, list, describe, preview, speakShaped, EMOTIONS, get persona() { return PERSONA.id; }, onChange(f) { listeners.add(f); } };
  if (typeof window !== "undefined") window.AegisVoice = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
