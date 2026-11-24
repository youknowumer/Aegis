// Aegis x Groq: one small module for everything that talks to Groq from the browser.
//
//   AegisGroq.canListen()            -> true when Groq Whisper can be the microphone's ears
//   AegisGroq.engine()               -> "groq" | "browser"   (what voice input uses right now)
//   AegisGroq.Recognizer             -> drop-in for the browser's SpeechRecognition (used by app.js for push-to-talk / voice mode)
//   AegisGroq.transcribe(blob, opts) -> { text, language, duration, segments:[{start,end,text}] }
//   AegisGroq.analyze(text, opts)    -> { notes, id? }   structured meeting notes
//   AegisGroq.toMarkdown(notes)      -> string
//
// With an Aegis server linked, audio and transcripts go through it (it holds the prompts, caps and history).
// With no server (GitHub Pages "local" mode) the browser talks to api.groq.com directly using the key you saved.
// The key is kept on this device only (localStorage, or sessionStorage when "remember" is off) and is sent to Groq or to
// your own Aegis server over https, never anywhere else.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const KEY = "aegis_groq_key", PREF = "aegis_stt", TOKEN = "aegis_token";
  const GROQ = "https://api.groq.com/openai/v1";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
    sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    sset(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
  };
  const api = () => (window.__aegisApi ? window.__aegisApi() : "");
  const isLocal = () => !!(window.AEGIS_RUNTIME && window.AEGIS_RUNTIME.local);
  const token = () => store.get(TOKEN) || "";

  // ---------------------------------------------------------------- key + server status
  let serverKey = false, statusAt = 0;
  const getKey = () => store.get(KEY) || store.sget(KEY) || "";
  function setKey(k, remember) {
    k = String(k || "").trim().replace(/^["']|["']$/g, "");
    store.set(KEY, null); store.sset(KEY, null);
    if (k) (remember === false ? store.sset : store.set)(KEY, k);
    renderSettings();
  }
  const hasKey = () => !!getKey() || serverKey;
  const pref = () => store.get(PREF) || "auto";

  async function refreshStatus(force) {
    if (isLocal() || !token()) return;
    if (!force && Date.now() - statusAt < 60000) return;
    statusAt = Date.now();
    try {
      const r = await fetch(api() + "/api/groq/status", { headers: { Authorization: "Bearer " + token() } });
      if (r.ok) { serverKey = !!(await r.json()).server_key; renderSettings(); }
    } catch {}
  }

  function engine() {
    const p = pref();
    if (p === "browser") return "browser";
    if (p === "groq") return hasKey() ? "groq" : "browser";
    return hasKey() ? "groq" : "browser"; // auto
  }
  const hasMic = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const canListen = () => hasMic() && engine() === "groq";

  // ---------------------------------------------------------------- calls
  class GroqError extends Error { constructor(m, status) { super(m); this.status = status || 0; } }
  async function readError(res) {
    let msg = "";
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : (j.error && (j.error.message || j.error)) || ""; } catch {}
    if (res.status === 401 && !msg) msg = "Please sign in again.";
    if (res.status === 429 && !msg) msg = "Groq's rate limit was reached. Try again in a minute.";
    return new GroqError(msg || "Request failed (" + res.status + ").", res.status);
  }
  const baseType = (b) => ((b && b.type) || "audio/webm").split(";")[0] || "audio/webm";

  const HALLU = /^\W*(?:thank you(?: so much)?(?: for watching)?|thanks for watching|please subscribe|subtitles by .*|amara\.org.*|you|bye|\.+)\W*$/i;
  function cleanSegments(j) {
    const segs = (j.segments || []).filter((s) => {
      const t = String(s.text || "").trim();
      if (!t) return false;
      if ((s.no_speech_prob || 0) > 0.6 && (s.avg_logprob || 0) < -0.7) return false;
      if (HALLU.test(t) && (s.no_speech_prob || 0) > 0.25) return false;
      return true;
    }).map((s) => ({ start: +(+s.start || 0).toFixed(2), end: +(+s.end || 0).toFixed(2), text: String(s.text).trim() }));
    return { text: j.segments ? segs.map((s) => s.text).join(" ") : String(j.text || "").trim(), language: j.language || "", duration: +j.duration || 0, segments: segs };
  }

  async function transcribe(blob, o) {
    o = o || {};
    const lang = String(o.lang || "").split("-")[0].replace("auto", "");
    if (isLocal()) {
      const key = getKey();
      if (!key) throw new GroqError("Add your Groq key in Settings > Voice & meetings first.", 400);
      const fd = new FormData();
      fd.append("file", blob, "audio." + (baseType(blob).includes("mp4") ? "m4a" : baseType(blob).includes("ogg") ? "ogg" : "webm"));
      fd.append("model", o.best || (lang && lang !== "en") ? "whisper-large-v3" : "whisper-large-v3-turbo");   // the full model for every language except English
      fd.append("response_format", "verbose_json");
      fd.append("temperature", "0");
      if (lang) fd.append("language", lang);
      if (o.prompt) fd.append("prompt", String(o.prompt).slice(-400));
      let res;
      try { res = await fetch(GROQ + "/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + key }, body: fd, signal: o.signal }); }
      catch (e) { if (e.name === "AbortError") throw e; throw new GroqError("Couldn't reach Groq. Check your internet connection.", 0); }
      if (!res.ok) throw await readError(res);
      return cleanSegments(await res.json());
    }
    const qs = new URLSearchParams();
    if (lang) qs.set("lang", lang);
    if (o.prompt) qs.set("prompt", String(o.prompt).slice(-400));
    if (o.best) qs.set("best", "1");
    const headers = { Authorization: "Bearer " + token(), "Content-Type": baseType(blob) };
    if (getKey()) headers["X-Groq-Key"] = getKey();
    let res;
    try { res = await fetch(api() + "/api/transcribe?" + qs, { method: "POST", headers, body: blob, signal: o.signal }); }
    catch (e) { if (e.name === "AbortError") throw e; throw new GroqError("Can't reach the Aegis server. If it's on free hosting it may be waking up; try again in 30 seconds.", 0); }
    if (!res.ok) throw await readError(res);
    return res.json();
  }

  // ---- meeting notes (local mode only: with a server, the server does this)
  const LANG_NAME = { en: "English", roman: "Roman Urdu (Urdu in the English alphabet; keep technical terms in English)", ur: "Urdu (Urdu script)", hi: "Hindi (Devanagari)", auto: "the language the meeting was held in" };
  const NOTES_PROMPT = (lang) => "You are an expert meeting analyst. Read this possibly imperfect speech-to-text transcript (Urdu/Hindi/English may be mixed) and write precise notes in " + (LANG_NAME[lang] || LANG_NAME.en) +
    ". Use ONLY what is in the transcript; never invent names, numbers, dates or owners. One clear sentence per item. Return ONLY JSON with keys: title (string), summary (3-5 sentences), " +
    "important_points [{point, importance: high|medium|low}], decisions [string], action_items [{task, owner, due, priority}], " +
    "enhancements [{idea, why, impact: high|medium|low, source: meeting|suggested}] (improvement ideas for the product/process/plan, mark your own ideas \"suggested\"), " +
    "risks [string], open_questions [string], next_steps [string], participants [string], topics [string].";
  const CHUNK = 12000;
  async function chatJson(system, user, model) {
    const key = getKey();
    if (!key) throw new GroqError("Add your Groq key in Settings > Voice & meetings first.", 400);
    let res;
    for (let i = 0; i < 3; i++) {
      try {
        res = await fetch(GROQ + "/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ model: model || "llama-3.3-70b-versatile", temperature: 0.2, max_tokens: 2500, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
      } catch { throw new GroqError("Couldn't reach Groq. Check your internet connection.", 0); }
      if (res.status === 429 && i < 2) { await new Promise((r) => setTimeout(r, Math.min(20, +res.headers.get("retry-after") || 8) * 1000)); continue; }
      break;
    }
    if (!res.ok) throw await readError(res);
    const txt = (await res.json()).choices[0].message.content || "";
    try { return JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } throw new GroqError("The AI answered in a format I couldn't read. Please try again.", 502); }
  }
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const s = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n || 400);
  const lvl = (v) => (["high", "medium", "low"].includes(String(v).toLowerCase()) ? String(v).toLowerCase() : "medium");
  const rank = { high: 0, medium: 1, low: 2 };
  function normalize(j, fallback) {
    j = j || {};
    const o = { title: s(j.title, 120) || fallback || "Meeting notes", summary: s(j.summary, 1500) };
    o.important_points = arr(j.important_points).map((p) => (typeof p === "object" ? { point: s(p.point || p.text), importance: lvl(p.importance) } : { point: s(p), importance: "medium" })).filter((p) => p.point).sort((a, b) => rank[a.importance] - rank[b.importance]).slice(0, 30);
    o.action_items = arr(j.action_items).map((a) => (typeof a === "object" ? { task: s(a.task || a.action || a.text), owner: s(a.owner, 60), due: s(a.due, 60), priority: lvl(a.priority) } : { task: s(a), owner: "", due: "", priority: "medium" })).filter((a) => a.task).slice(0, 40);
    o.enhancements = arr(j.enhancements).map((e) => (typeof e === "object" ? { idea: s(e.idea || e.text), why: s(e.why || e.reason), impact: lvl(e.impact), source: /^sugg/i.test(e.source || "") ? "suggested" : "meeting" } : { idea: s(e), why: "", impact: "medium", source: "meeting" })).filter((e) => e.idea).sort((a, b) => rank[a.impact] - rank[b.impact]).slice(0, 20);
    ["decisions", "risks", "open_questions", "next_steps", "participants", "topics"].forEach((k) => { o[k] = arr(j[k]).map((x) => s(x, 300)).filter(Boolean).slice(0, 25); });
    return o;
  }
  function splitText(t) {
    const parts = []; let cur = "";
    t.split("\n").forEach((line) => { if (cur.length + line.length + 1 > CHUNK && cur) { parts.push(cur); cur = ""; } cur += line.slice(0, CHUNK) + "\n"; });
    if (cur.trim()) parts.push(cur);
    return parts.length ? parts : [t];
  }

  async function analyze(text, o) {
    o = o || {};
    text = String(text || "").trim();
    if (text.length < 20) throw new GroqError("There isn't enough speech in the transcript to write notes yet.", 400);
    if (!isLocal()) {
      const headers = { Authorization: "Bearer " + token(), "Content-Type": "application/json" };
      if (getKey()) headers["X-Groq-Key"] = getKey();
      let res;
      try { res = await fetch(api() + "/api/meetings", { method: "POST", headers, body: JSON.stringify({ transcript: text, title: o.title || "", duration: o.duration || 0, output_lang: o.lang || "en", save: o.save !== false, quick: !!o.quick }) }); }
      catch { throw new GroqError("Can't reach the Aegis server. If it's on free hosting it may be waking up; try again in 30 seconds.", 0); }
      if (!res.ok) throw await readError(res);
      return res.json();
    }
    const sys = NOTES_PROMPT(o.lang);
    const head = o.title ? "Meeting title: " + o.title + "\n\n" : "";
    if (o.quick) return { notes: normalize(await chatJson(sys, head + "Transcript so far (latest part):\n" + text.slice(-CHUNK), "llama-3.1-8b-instant"), o.title) };
    const parts = splitText(text.slice(0, 300000));
    if (parts.length === 1) return { notes: normalize(await chatJson(sys, head + "Transcript:\n" + parts[0]), o.title) };
    const partial = [];
    for (let i = 0; i < parts.length; i++) partial.push(normalize(await chatJson(sys, head + "Part " + (i + 1) + " of " + parts.length + ":\n" + parts[i]), o.title));
    return { notes: normalize(await chatJson("You merge partial meeting notes (JSON) of one long meeting into ONE final JSON with the same keys. Remove duplicates, keep every action item, write a 4-6 sentence summary. Language: " + (LANG_NAME[o.lang] || LANG_NAME.en) + ".", JSON.stringify(partial).slice(0, 30000)), o.title) };
  }

  function toMarkdown(n, date, transcript) {
    const L = ["# " + (n.title || "Meeting notes")];
    if (date) L.push("*" + date + "*");
    if ((n.participants || []).length) L.push("**Participants:** " + n.participants.join(", "));
    L.push("", "## Summary", n.summary || "");
    const sec = (name, items, f) => { if (items && items.length) { L.push("", "## " + name); items.forEach((x) => L.push(f(x))); } };
    sec("Important points", n.important_points, (p) => "- **" + p.importance.toUpperCase() + "**: " + p.point);
    sec("Decisions", n.decisions, (x) => "- " + x);
    sec("Action items", n.action_items, (a) => "- [ ] " + a.task + (a.owner ? " — **" + a.owner + "**" : "") + (a.due ? " (due " + a.due + ")" : ""));
    sec("Enhancements", n.enhancements, (e) => "- **" + e.impact.toUpperCase() + " impact**: " + e.idea + (e.why ? " — " + e.why : "") + (e.source === "suggested" ? " *(suggested)*" : ""));
    sec("Risks and blockers", n.risks, (x) => "- " + x);
    sec("Open questions", n.open_questions, (x) => "- " + x);
    sec("Next steps", n.next_steps, (x) => "- " + x);
    if (transcript) L.push("", "## Transcript", transcript);
    return L.join("\n").trim() + "\n";
  }

  // ---------------------------------------------------------------- the microphone's new ears
  // Looks like webkitSpeechRecognition to app.js (start / abort / stop, onstart / onresult / onerror / onend) but records the
  // utterance, waits for you to stop talking, and has Groq Whisper transcribe it: far better at Urdu, Hindi and mixed speech.
  function pickMime() {
    const c = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    return c.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "";
  }
  class Recognizer {
    constructor() { this.lang = "en-US"; this.continuous = false; this.interimResults = true; this.maxAlternatives = 1; this.onstart = this.onresult = this.onerror = this.onend = null; this._dead = false; this._done = false; }
    _fire(name, ev) { if (!this._dead && typeof this[name] === "function") { try { this[name](ev); } catch {} } }
    _end() { if (this._done) return; this._done = true; this._cleanup(); this._fire("onend", {}); }
    _fail(code, message) { this._fire("onerror", { error: code, message }); this._end(); }
    _cleanup() {
      clearInterval(this._timer); clearTimeout(this._maxT);
      try { if (this._rec && this._rec.state !== "inactive") this._rec.stop(); } catch {}
      try { this._stream && this._stream.getTracks().forEach((t) => t.stop()); } catch {}
      try { this._ac && this._ac.close(); } catch {}
      if (window.__aegisOrb && window.__aegisOrb.setLevel) window.__aegisOrb.setLevel(0);
    }
    abort() { this._dead = true; this._done = true; this._aborted = true; this._cleanup(); }
    stop() { this._finish(); }
    async start() {
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        return this._fail(e && e.name === "NotFoundError" ? "audio-capture" : "not-allowed");
      }
      if (this._aborted) return this._cleanup();
      const AC = window.AudioContext || window.webkitAudioContext;
      this._ac = new AC();
      const src = this._ac.createMediaStreamSource(this._stream), an = this._ac.createAnalyser();
      an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const mime = pickMime();
      const chunks = [];
      try { this._rec = new MediaRecorder(this._stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined); }
      catch { return this._fail("audio-capture", "This browser can't record audio."); }
      this._rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      this._rec.onstop = () => { this._blob = new Blob(chunks, { type: this._rec.mimeType || mime || "audio/webm" }); if (this._wantSend) this._send(); };
      this._rec.start(250);
      this._fire("onstart", {});
      const t0 = performance.now();
      let noise = 0, nN = 0, speechMs = 0, lastSpeech = 0, heard = false, last = t0, rmsSum = 0, rmsN = 0, pauses = 0, gapAt = 0;
      this._timer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length), now = performance.now(), dt = now - last; last = now;
        if (window.__aegisOrb && window.__aegisOrb.setLevel) window.__aegisOrb.setLevel(Math.min(1, rms * 9));
        if (now - t0 < 260) { noise += rms; nN++; return; }          // learn the room's background noise first
        const thr = Math.min(0.035, Math.max(0.014, (noise / Math.max(1, nN)) * 2.6 + 0.006)); // capped: speaking right after the click must not be mistaken for room noise
        if (rms > thr) {
          speechMs += dt; lastSpeech = now; rmsSum += rms; rmsN++;
          if (speechMs > 140) heard = true;
          if (gapAt && heard && now - gapAt > 450) pauses++;      // a pause in the middle of speaking: hesitation
          gapAt = 0;
        } else if (heard && !gapAt) gapAt = now;
        if (heard && now - lastSpeech > (speechMs > 6000 ? 1100 : 800)) this._finish();       // you stopped talking
        else if (!heard && now - t0 > 9000) { this._noSpeech = true; this._finish(); }          // nobody spoke
      }, 40);
      this._maxT = setTimeout(() => this._finish(), 45000);
      this._heard = () => heard;
      this._stats = () => ({ avg: rmsN ? rmsSum / rmsN : 0, speechMs, pauses });
    }
    _finish() {
      if (this._finishing || this._done) return;
      this._finishing = true;
      clearInterval(this._timer); clearTimeout(this._maxT);
      if (window.__aegisOrb && window.__aegisOrb.setLevel) window.__aegisOrb.setLevel(0);
      if (this._noSpeech || !(this._heard && this._heard())) return this._fail("no-speech");
      this._wantSend = true;
      this._fire("onresult", { resultIndex: 0, results: [Object.assign([{ transcript: "Transcribing..." }], { isFinal: false })] });
      try { this._stream.getTracks().forEach((t) => t.stop()); } catch {}
      if (this._rec.state !== "inactive") this._rec.stop(); else if (this._blob) this._send();
    }
    async _send() {
      if (this._sent) return; this._sent = true;
      try {
        const r = await transcribe(this._blob, { lang: this.lang === "auto" ? "" : this.lang, prompt: "Aegis." });
        const text = String(r.text || "").trim();
        if (!text) return this._fail("no-speech");
        this._fire("onresult", { resultIndex: 0, language: r.language || "", vibe: this._stats ? this._stats() : null, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
        this._end();
      } catch (e) {
        if (this._dead) return;
        this._fail("groq", e.message || "Groq transcription failed.");
      }
    }
  }

  // ---------------------------------------------------------------- settings UI (markup lives in app.html)
  function renderSettings() {
    const st = $("groq-status");
    if (!st) return;
    const own = !!getKey();
    st.textContent = own ? "Using your Groq key on this device." : serverKey ? "Using the server's Groq key (shared, with a daily limit). Add your own free key for no limit." : "No Groq key yet. Add one to unlock Whisper voice and meeting notes.";
    const eng = $("stt-engine");
    if (eng) eng.value = pref();
    const now = $("stt-now");
    if (now) now.textContent = "Voice input right now: " + (engine() === "groq" ? "Groq Whisper (accurate, Urdu/Hindi/English)" : "your browser's built-in speech");
    if ($("groq-clear")) $("groq-clear").classList.toggle("hidden", !own);
  }
  function msg(text, kind) { const m = $("groq-msg"); if (m) { m.textContent = text || ""; m.className = kind === "ok" ? "ok-msg" : kind === "warn" ? "warn-msg" : "error"; } }

  function wire() {
    if (!$("groq-key")) return;
    $("groq-key").value = getKey();
    $("groq-remember").checked = !!store.get(KEY) || !getKey();
    $("groq-show").addEventListener("click", () => { const k = $("groq-key"); const show = k.type === "password"; k.type = show ? "text" : "password"; $("groq-show").textContent = show ? "Hide" : "Show"; });
    $("stt-engine").addEventListener("change", () => { store.set(PREF, $("stt-engine").value); renderSettings(); document.dispatchEvent(new Event("aegis:stt")); });
    $("groq-save").addEventListener("click", async () => {
      const k = $("groq-key").value.trim();
      if (!k) return msg("Paste your Groq key first (it starts with gsk_).");
      if (/\s/.test(k)) return msg("The key has spaces in it. Paste only the key.");
      setKey(k, $("groq-remember").checked);
      msg("Saved. Testing it with Groq...", "warn");
      await test();
      document.dispatchEvent(new Event("aegis:stt"));
    });
    $("groq-test").addEventListener("click", test);
    $("groq-clear").addEventListener("click", () => { setKey("", true); $("groq-key").value = ""; msg("Removed from this device.", "ok"); document.dispatchEvent(new Event("aegis:stt")); });
    document.addEventListener("aegis:open-settings", () => { $("groq-key").value = getKey(); refreshStatus(true); renderSettings(); });
    renderSettings();
  }
  async function test() {
    const k = getKey();
    if (!k && !serverKey && !isLocal()) await refreshStatus(true);
    if (!k && !serverKey) return msg("Paste a key first.");
    msg("Testing...", "warn");
    try {
      if (isLocal()) {
        const r = await fetch(GROQ + "/models", { headers: { Authorization: "Bearer " + k } });
        if (!r.ok) throw await readError(r);
        msg("Works! Groq accepted the key. Whisper voice and meeting notes are ready.", "ok");
      } else {
        const r = await fetch(api() + "/api/groq/test", { method: "POST", headers: Object.assign({ Authorization: "Bearer " + token() }, k ? { "X-Groq-Key": k } : {}) });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new GroqError(j.error || j.detail || "Groq test failed.");
        msg("Works! Groq accepted the key (" + (j.whisper || []).join(", ") + "). Whisper voice and meeting notes are ready.", "ok");
      }
    } catch (e) { msg(e.message); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
  setTimeout(refreshStatus, 1500);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshStatus(); });

  window.AegisGroq = { canListen, engine, hasKey, hasMic, getKey, setKey, refreshStatus, Recognizer, transcribe, analyze, toMarkdown, GroqError, isLocal, apiBase: api, token };
})();
