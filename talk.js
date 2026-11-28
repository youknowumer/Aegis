// Aegis real-time talk (v21).
//
//   1. takeSentences(buf, opts)  cuts the finished sentences off the front of an answer that is still being written (any script:
//                                Urdu ۔ ؟, Hindi ।, Chinese 。, abbreviations and decimals are not sentence ends).
//   2. createLive(opts)          speaks the answer WHILE it streams in: first sentence as soon as it is complete, the rest as it arrives,
//                                one chunk at a time, so the voice starts after one sentence instead of after the whole reply.
//   3. createDetector / createBarge   lets the person interrupt by talking: Aegis stops and listens. The loudness of my own voice
//                                leaking into the microphone is measured first, and only speech clearly above it, for a quarter of a second,
//                                counts. The browser's echo cancellation is on. Off unless headphones are detected or the person turns it on.
//   4. headsetLikely()           true when the default speaker looks like headphones (barge-in is safe there).
//
// No dependencies. Everything that decides something is a pure function, so it is tested without a browser (tests/v21-talk.test.js).
(() => {
  "use strict";

  // ---------------------------------------------------------------- 1. sentences
  const ALWAYS_END = "!?\u061f\u06d4\u0964\u3002\uff01\uff1f\u2026";       // ! ? ؟ ۔ । 。 ！ ？ …
  const CLOSERS = "\"'\u201d\u2019)]\u00bb";
  const CLAUSE_BREAK = /[,;:\u060c\u061b\u3001\uff0c]\s/g;                // , ; : ، ؛ 、 ，
  const ABBREV = /(?:^|[\s(])(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|no|inc|ltd|co|mt|ft|approx|dept|est|fig|vol|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.$/i;
  const alnum = (t) => /[\p{L}\p{N}]/u.test(t);
  const bare = (t) => String(t).replace(/\[[a-z]{3,9}\]\s?/gi, "").trim();       // the AI's [joy] tags are not spoken, so they do not count as length
  // length as a listener feels it: one Chinese / Japanese / Korean character carries about as much as three Latin letters
  const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
  const weight = (t) => { let n = 0; for (const ch of String(t)) n += CJK.test(ch) ? 3 : 1; return n; };

  // Is the "." at index i the end of a sentence? (needs the character after it, so a "." at the very end of the buffer waits for more text)
  function dotEnds(text, i, start, final) {
    const next = text[i + 1];
    if (next === undefined) return final;
    if (!/[\s"'\u201d\u2019)\]\u00bb]/.test(next)) return false;                  // 3.5   www.site.com   e.g.x
    const head = text.slice(start, i + 1);
    if (ABBREV.test(head)) return false;                                         // Mr.  Dr.  etc.
    if (/(?:^|\s)\d{1,2}\.$/.test(head)) return false;                           // "1." of a numbered list
    if (/(?:^|[\s(])\p{Lu}\.$/u.test(head)) return false;                        // an initial: "A."
    return true;
  }

  // buf: text not spoken yet. -> { sentences: [...], rest }. opts.final: the answer is complete, take everything.
  // opts.first: nothing has been spoken yet this turn, so allow a shorter first chunk (the voice should start soon).
  function takeSentences(buf, opts) {
    opts = opts || {};
    const text = String(buf == null ? "" : buf);
    const minLen = opts.minLen || (opts.first ? 6 : 14), maxRun = opts.maxRun || 150;
    const cut = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      let end = false;
      if (c === "\n") end = true;
      else if (c === ".") end = dotEnds(text, i, start, !!opts.final);
      else if (ALWAYS_END.includes(c)) end = true;
      if (!end) continue;
      let j = i + 1;
      while (j < text.length && (ALWAYS_END.includes(text[j]) || text[j] === "." || CLOSERS.includes(text[j]))) j++;   // "?!"  "..."  '."'
      const seg = text.slice(start, j).trim();
      if (seg && alnum(seg)) cut.push(seg);
      start = j;
      i = j - 1;
    }
    let rest = text.slice(start).replace(/^\s+/, "");
    // a long run with no sentence end: cut at the last clause break so the voice does not wait for the whole paragraph
    if (!opts.final && weight(rest) > maxRun) {
      let at = -1, m;
      CLAUSE_BREAK.lastIndex = 0;
      while ((m = CLAUSE_BREAK.exec(rest))) if (m.index >= 50) at = m.index + 1;
      if (at > 0) { cut.push(rest.slice(0, at).trim()); rest = rest.slice(at).replace(/^\s+/, ""); }
    }
    if (opts.final && rest.trim() && alnum(rest)) { cut.push(rest.trim()); rest = ""; }
    // too-short pieces ("Hi.", "Haan.") are glued to the next one so the voice does not stutter
    const out = [];
    let hold = "";
    for (const seg of cut) {
      hold = hold ? hold + " " + seg : seg;
      if (weight(bare(hold)) >= minLen) { out.push(hold); hold = ""; }
    }
    if (hold) {
      if (opts.final) { if (out.length) out[out.length - 1] += " " + hold; else out.push(hold); }
      else rest = rest ? hold + " " + rest : hold;
    }
    return { sentences: out, rest };
  }

  // ---------------------------------------------------------------- 2. speak while the answer streams in
  // o.speak(text, done)  speak one chunk; call done() when it has finished (return false if nothing could be spoken)
  // o.canSpeakNow()      false while something else (a spoken "let me think") is still talking
  // o.later(fn, ms)      timer (defaults to setTimeout)
  // o.onIdle()           the answer is complete and everything was said
  function createLive(o) {
    const later = o.later || ((f, ms) => setTimeout(f, ms));
    const MAX_CHUNK = o.maxChunk || 320;
    let st;
    const fresh = (gen) => ({ gen, on: false, buf: "", queue: [], busy: false, done: false, spoke: false, muted: false, idled: false, waiting: false });
    st = fresh(0);

    function pump() {
      if (st.busy) return;
      if (!st.queue.length) {
        if (st.done && !st.idled) { st.idled = true; if (o.onIdle) o.onIdle(); }
        return;
      }
      if (o.canSpeakNow && !o.canSpeakNow()) {
        if (!st.waiting) { st.waiting = true; const g = st.gen; later(() => { if (g !== st.gen) return; st.waiting = false; pump(); }, 120); }
        return;
      }
      let text = st.queue.shift();
      while (st.queue.length && (text + " " + st.queue[0]).length <= MAX_CHUNK) text += " " + st.queue.shift();   // everything that finished while the last chunk was playing
      st.busy = true; st.spoke = true;
      const g = st.gen;
      let finished = false;
      const done = () => { if (finished || g !== st.gen) return; finished = true; st.busy = false; pump(); };
      let ok;
      try { ok = o.speak(text, done); } catch { ok = false; }
      if (ok === false) done();                                                // nothing could be spoken: do not stall the rest
    }

    return {
      // a piece of the answer arrived. Returns true when live speech is handling this turn.
      feed(delta) {
        if (st.done) st = fresh(st.gen + 1);                                  // the previous answer was complete: this is a new one
        if (st.muted) return false;
        st.on = true;
        st.buf += String(delta || "");
        const r = takeSentences(st.buf, { first: !st.spoke });
        st.buf = r.rest;
        st.queue.push(...r.sentences);
        pump();
        return true;
      },
      // one streamed segment ended (the AI is about to use a tool): the unfinished sentence is finished too
      flush() {
        if (!st.on || st.muted) return;
        const r = takeSentences(st.buf, { final: true });
        st.buf = ""; st.queue.push(...r.sentences);
        pump();
      },
      // the whole answer is here. Returns true when live speech took care of it (the caller must NOT speak the text again).
      finish() {
        if (!st.on) { const was = st.muted; st.muted = false; return was; }     // never streamed: the caller speaks it (unless the person cut me off)
        const r = takeSentences(st.buf, { final: true });
        st.buf = "";
        st.queue.push(...r.sentences);
        st.done = true;
        pump();
        return true;
      },
      // the person cut me off: stay silent for the rest of this answer (if the answer was already complete, nothing is left to silence)
      mute() { const wasDone = st.done; st = fresh(st.gen + 1); st.muted = !wasDone; },
      // a new turn, or speech was stopped: forget everything
      reset() { st = fresh(st.gen + 1); },
      active: () => st.on && !st.done || st.busy || st.queue.length > 0,
      spoke: () => st.spoke,
      state: () => ({ on: st.on, busy: st.busy, queued: st.queue.length, buffered: st.buf.length, done: st.done, muted: st.muted, spoke: st.spoke }),
    };
  }

  // ---------------------------------------------------------------- 3. interrupt by talking
  // Pure detector: feed it the microphone level (RMS 0..1) every ~50 ms. Returns true once, when the person is clearly talking over Aegis.
  function createDetector(opt) {
    const o = Object.assign({ minLevel: 0.045, ratio: 2.6, needMs: 260, calibrateMs: 650, cooldownMs: 1500, hangMs: 140 }, opt || {});
    let leak = 0, audioAt = 0, hotSince = 0, lastHot = 0, lastFire = -1e9, was = false;
    return {
      // a new piece of Aegis's voice started playing: listen to how much of it leaks into the microphone before judging anything
      audioStarted(now) { audioAt = now; hotSince = 0; },
      feed(rms, now, speaking) {
        if (!speaking) { was = false; hotSince = 0; leak *= 0.9; return false; }
        if (!was) { was = true; audioAt = now; leak *= 0.5; hotSince = 0; }
        if (now - audioAt < o.calibrateMs) { leak = Math.max(leak, rms); hotSince = 0; return false; }
        const bar = Math.max(o.minLevel, leak * o.ratio);
        if (rms > bar) {
          if (!hotSince) hotSince = now;
          lastHot = now;
          if (now - hotSince >= o.needMs && now - lastFire > o.cooldownMs) { lastFire = now; hotSince = 0; return true; }
        } else if (hotSince && now - lastHot > o.hangMs) hotSince = 0;
        return false;
      },
      level: () => leak,
    };
  }

  // WebAudio wrapper. o.isSpeaking() -> Aegis is talking; o.onInterrupt() -> stop her and listen. Echo cancellation and noise suppression are on.
  function createBarge(o) {
    const det = createDetector(o.detector);
    let stream = null, ctx = null, an = null, buf = null, timer = 0, opening = null;
    async function open() {
      if (stream) return true;
      if (opening) return opening;
      opening = (async () => {
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
          const AC = window.AudioContext || window.webkitAudioContext;
          ctx = new AC();
          const src = ctx.createMediaStreamSource(stream);
          an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
          buf = new Float32Array(an.fftSize);
          return true;
        } catch { close(); return false; }
        finally { opening = null; }
      })();
      return opening;
    }
    function close() {
      try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch {}
      try { if (ctx && ctx.close) ctx.close(); } catch {}
      stream = ctx = an = buf = null;
    }
    function rms() {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / buf.length);
    }
    function tick() {
      if (!an) return;
      const speaking = !!o.isSpeaking();
      if (det.feed(speaking ? rms() : 0, Date.now(), speaking)) { try { o.onInterrupt(); } catch {} }
    }
    return {
      async start() { if (timer) return true; if (!(await open())) return false; timer = setInterval(tick, 50); return true; },
      stop() { if (timer) clearInterval(timer); timer = 0; close(); },
      audioStarted() { det.audioStarted(Date.now()); },
      active: () => !!timer,
    };
  }

  // ---------------------------------------------------------------- 4. headphones?
  const HEADSET = /head(?:phone|set)|earbud|earphone|airpods|buds|bluetooth|hands-?free|\u0633\u0645\u0627\u0639/i;
  async function headsetLikely() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const out = list.filter((d) => d.kind === "audiooutput");
      const def = out.find((d) => d.deviceId === "default") || out[0];
      return !!(def && HEADSET.test(def.label || ""));
    } catch { return false; }
  }

  const api = { takeSentences, createLive, createDetector, createBarge, headsetLikely, supported: typeof navigator !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
  if (typeof window !== "undefined") window.AegisTalk = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
