"use strict";
// v21: real-time talk (talk.js: sentences, live speech, interrupt detector) and the voice that follows the listener (voice.js region).
// The first groups need nothing. The last group loads the REAL app.html in jsdom (npm install --no-save jsdom): skipped without it.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const T = require(path.join(root, "talk.js"));
const V = require(path.join(root, "voice.js"));

let jsdom = null;
try { jsdom = require("jsdom"); } catch { /* skipped below */ }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 4000) { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await wait(15); return cond(); }
const take = (s, o) => T.takeSentences(s, o);

// ---------------------------------------------------------------- 1. sentences
test("sentences: finished ones are cut off, the unfinished one waits", () => {
  const r = take("Hello there. How are you doing today? I am fi");
  assert.deepStrictEqual(r.sentences, ["Hello there. How are you doing today?"]);
  assert.strictEqual(r.rest, "I am fi");
});

test("sentences: decimals, abbreviations, initials, list numbers and web addresses are not sentence ends", () => {
  assert.deepStrictEqual(take("The price is 3.5 dollars. Dr. Khan agrees with it. Next").sentences, ["The price is 3.5 dollars.", "Dr. Khan agrees with it."]);
  assert.deepStrictEqual(take("Visit www.example.com for more details. Then").sentences, ["Visit www.example.com for more details."]);
  assert.deepStrictEqual(take("Ask J. Smith about it today. ok", { final: true }).sentences, ["Ask J. Smith about it today. ok"]);
  assert.deepStrictEqual(take("1. First item. 2. Second item here", { final: true }).sentences, ["1. First item.", "2. Second item here"]);   // "1." is a number, the items are sentences
});

test("sentences: a full stop at the very end of the buffer waits for the next character (it could be 3.5)", () => {
  assert.deepStrictEqual(take("It costs 3.", {}), { sentences: [], rest: "It costs 3." });
  assert.deepStrictEqual(take("It costs 3.", { final: true }).sentences, ["It costs 3."]);
});

test("sentences: Urdu, Hindi, Arabic and Chinese sentence marks", () => {
  assert.deepStrictEqual(take("آپ کیسی ہیں؟ میں ٹھیک ہوں۔ شکریہ").sentences, ["آپ کیسی ہیں؟ میں ٹھیک ہوں۔"]);
  assert.strictEqual(take("آپ کیسی ہیں؟ میں ٹھیک ہوں۔ شکریہ").rest, "شکریہ");
  assert.deepStrictEqual(take("आप कैसे हैं? मैं ठीक हूँ। धन्यवाद", {}).sentences, ["आप कैसे हैं? मैं ठीक हूँ।"]);
  assert.deepStrictEqual(take("你好，今天怎么样？我很好。再见", { first: true }).sentences, ["你好，今天怎么样？", "我很好。"]);
});

test("sentences: the first chunk may be short (the voice should start soon), later chunks are glued so speech does not stutter", () => {
  assert.deepStrictEqual(take("Sure thing. And then", { first: true }).sentences, ["Sure thing."]);
  assert.deepStrictEqual(take("Sure thing. And then", {}).sentences, []);                    // 10 characters: held back for the next sentence
  assert.deepStrictEqual(take("Sure thing. I will do that right now. More", {}).sentences, ["Sure thing. I will do that right now."]);
});

test("sentences: emotion tags do not count as length and an unfinished tag is never cut", () => {
  const r = take("[joy] Great news! [warm] I am happy for you. [con");
  assert.deepStrictEqual(r.sentences, ["[joy] Great news! [warm] I am happy for you."]);
  assert.strictEqual(r.rest, "[con");
});

test("sentences: a very long run without a full stop is cut at a clause break", () => {
  const long = "Well, this is a very long sentence that keeps going and going without any real ending, so we cut it at a comma because waiting is bad, and more words keep coming";
  const r = take(long);
  assert.strictEqual(r.sentences.length, 1);
  assert.ok(r.sentences[0].endsWith(",") && r.rest.length > 0 && (r.sentences[0] + " " + r.rest).replace(/\s+/g, " ") === long);
});

test("sentences: final takes everything, nothing is lost or repeated across calls", () => {
  const answer = "[warm] Haan, bilkul. [joy] Yeh kaam ho gaya hai! Aur kuch chahiye? Bas itna hi";
  let buf = "", spoken = [];
  for (const piece of answer.match(/.{1,5}/g)) {                      // the answer arrives in small pieces
    buf += piece;
    const r = take(buf, { first: spoken.length === 0 });
    spoken.push(...r.sentences); buf = r.rest;
  }
  spoken.push(...take(buf, { final: true }).sentences);
  assert.strictEqual(spoken.join(" ").replace(/\s+/g, " "), answer);
});

// ---------------------------------------------------------------- 2. live speech
function liveHarness(extra) {
  const said = [], timers = [];
  let speaking = false, idle = 0, release = null;
  const dones = [];
  const live = T.createLive(Object.assign({
    speak: (text, done) => { said.push(text); speaking = true; dones.push(done); release = () => { speaking = false; done(); }; return true; },
    canSpeakNow: () => !speaking,
    later: (f) => timers.push(f),
    onIdle: () => { idle++; },
  }, extra || {}));
  return { live, said, dones, idle: () => idle, finishChunk: () => release && release(), timers, setSpeaking: (v) => { speaking = v; } };
}

test("live: the first sentence is spoken as soon as it is complete, the rest follows chunk by chunk, nothing twice", () => {
  const h = harness();
  function harness() { return liveHarness(); }
  h.live.feed("[warm] Of course, I can do that for you. [joy] It will");
  assert.deepStrictEqual(h.said, ["[warm] Of course, I can do that for you."]);     // spoken before the answer is complete
  h.live.feed(" take a moment, and then it is done. [calm] Anything else");
  assert.strictEqual(h.said.length, 1);                                              // the first chunk is still playing: the next waits
  h.finishChunk();
  assert.deepStrictEqual(h.said[1], "[joy] It will take a moment, and then it is done.");
  assert.strictEqual(h.live.finish(), true);                                         // the caller must not speak the full text again
  h.finishChunk();
  assert.deepStrictEqual(h.said[2], "[calm] Anything else");
  assert.strictEqual(h.idle(), 0);
  h.finishChunk();
  assert.strictEqual(h.idle(), 1);
});

test("live: sentences that finish while a chunk is playing are spoken together afterwards", () => {
  const h = liveHarness();
  h.live.feed("First sentence is here. ");
  h.live.feed("Second sentence is here. Third sentence is here. Fourth is here too. ");
  assert.strictEqual(h.said.length, 1);
  h.finishChunk();
  assert.strictEqual(h.said[1], "Second sentence is here. Third sentence is here. Fourth is here too.");
  assert.strictEqual(h.said.length, 2);
});

test("live: flush finishes the half sentence (the AI is about to use a tool); a reply that never streamed is left to the caller", () => {
  const h = liveHarness();
  h.live.feed("Let me check that for you");
  assert.strictEqual(h.said.length, 0);
  h.live.flush();
  assert.deepStrictEqual(h.said, ["Let me check that for you"]);
  const none = liveHarness();
  assert.strictEqual(none.live.finish(), false);                                     // no deltas at all: speak(text) as before
});

test("live: when the person cuts me off, the rest of that answer stays silent and the next answer speaks again", () => {
  const h = liveHarness();
  h.live.feed("I was saying something long. And more");
  assert.strictEqual(h.said.length, 1);
  h.live.mute();
  h.live.feed(" is coming here. Even more text arrives now.");
  assert.strictEqual(h.said.length, 1);
  assert.strictEqual(h.live.finish(), true);                                         // silent, and not spoken again by the caller
  h.live.reset();
  h.setSpeaking(false);                                                              // stopSpeaking() silenced the old chunk
  h.live.feed("A brand new answer starts here. And continues");
  assert.strictEqual(h.said.length, 2);
});

test("live: a chunk that cannot be spoken does not stall the rest; a late spoken cue is waited for", () => {
  const fail = liveHarness({ speak: (text) => { fail.said.push(text); return false; } });
  fail.live.feed("This one cannot be spoken. Neither can this second one. And");
  fail.live.finish();
  assert.strictEqual(fail.idle(), 1);
  const cue = liveHarness();
  cue.setSpeaking(true);                                                             // "Hmm, let me think" is still talking
  cue.live.feed("The answer is ready for you now. More");
  assert.strictEqual(cue.said.length, 0);
  cue.setSpeaking(false);
  cue.timers.shift()();
  assert.strictEqual(cue.said.length, 1);
});

test("live: reset forgets a running answer, and a stale 'finished' callback cannot revive it", () => {
  const h = liveHarness();
  h.live.feed("Some text that is long enough. More text");
  const stale = h.dones[0];
  h.live.reset();
  h.setSpeaking(false);
  h.live.feed("Fresh start of an answer here. And");
  assert.strictEqual(h.said.length, 2);
  stale();                                                                           // the old chunk "finishes" late: ignored, the new one is still playing
  assert.strictEqual(h.live.state().busy, true);
  assert.strictEqual(h.live.state().queued, 0);
});

// ---------------------------------------------------------------- 3. interrupt detector
function run(det, levels, from, step = 50) {
  let fired = [], t = from;
  for (const l of levels) { if (det.feed(l, t, true)) fired.push(t); t += step; }
  return fired;
}

test("interrupt: Aegis's own voice leaking into the microphone never interrupts her, however loud", () => {
  const det = T.createDetector();
  const leak = Array(80).fill(0).map((_, i) => 0.06 + (i % 3) * 0.01);               // loud speakers: 0.06-0.08 all along
  assert.deepStrictEqual(run(det, leak, 1000), []);
});

test("interrupt: speech clearly above the leak, for a quarter of a second, interrupts once", () => {
  const det = T.createDetector();
  const calm = Array(16).fill(0.02), speech = Array(10).fill(0.16);
  const fired = run(det, [...calm, ...speech, ...speech], 0);
  assert.strictEqual(fired.length, 1);
  assert.ok(fired[0] >= 16 * 50 + 250 && fired[0] < 16 * 50 + 450);
});

test("interrupt: a short cough or click does not, a gap in the middle of speech does not reset it for good", () => {
  const det = T.createDetector();
  const calm = Array(16).fill(0.02);
  assert.deepStrictEqual(run(det, [...calm, 0.3, 0.3, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02], 0), []);
  const det2 = T.createDetector();
  assert.strictEqual(run(det2, [...calm, 0.15, 0.15, 0.15, 0.02, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15], 0).length, 1);
});

test("interrupt: nothing happens while Aegis is silent, each new piece of her voice is calibrated again, and there is a cooldown", () => {
  const det = T.createDetector();
  for (let t = 0; t < 2000; t += 50) assert.strictEqual(det.feed(0.5, t, false), false);   // not speaking: the person talking is simply the next turn
  const calm = Array(16).fill(0.02);
  const first = run(det, [...calm, ...Array(12).fill(0.2)], 3000);
  assert.strictEqual(first.length, 1);
  assert.strictEqual(run(det, Array(20).fill(0.2), first[0] + 50).length, 0);             // cooldown: no second interrupt right away
  const det2 = T.createDetector();
  run(det2, calm, 0);
  det2.audioStarted(1000);                                                                // a louder chunk starts: its leak is learned before judging
  assert.deepStrictEqual(run(det2, Array(12).fill(0.09), 1000), []);
});

// ---------------------------------------------------------------- 4. the voice follows the listener (voice.js, pure parts)
test("region: own choice > server country > time zone > browser language (en-US is ignored)", () => {
  const d = V.profile.detectRegion;
  assert.strictEqual(d({ override: "gb", net: "PK", tz: "Asia/Karachi", langs: ["ur-PK"] }), "GB");
  assert.strictEqual(d({ net: "ae", tz: "Asia/Karachi" }), "AE");
  assert.strictEqual(d({ tz: "Asia/Karachi", langs: ["en-US"] }), "PK");
  assert.strictEqual(d({ tz: "Etc/UTC", langs: ["en-US", "en-GB"] }), "GB");
  assert.strictEqual(d({ tz: "Etc/UTC", langs: ["en-US"] }), "");
  assert.strictEqual(d({ override: "<b>", net: "pk1" }), "");
});

test("region: the accent a listener hears best, and the language's default when nothing fits", () => {
  const L = V.localeFor;
  assert.deepStrictEqual([L("en", "PK"), L("en", "IN"), L("en", "BD"), L("en", "GB"), L("en", "AU"), L("en", "US"), L("en", "JP")], ["en-IN", "en-IN", "en-IN", "en-GB", "en-AU", "en-US", "en-US"]);
  assert.deepStrictEqual([L("ur", "PK"), L("ur", "IN"), L("ur", "GB")], ["ur-PK", "ur-IN", "ur-PK"]);
  assert.deepStrictEqual([L("ar", "EG"), L("ar", "AE"), L("ar", "PK")], ["ar-EG", "ar-AE", "ar-SA"]);
  assert.deepStrictEqual([L("es", "MX"), L("es", "ES"), L("pt", "PT"), L("pt", "IN"), L("fr", "CA"), L("de", "AT"), L("zh", "TW")], ["es-MX", "es-ES", "pt-PT", "pt-BR", "fr-CA", "de-AT", "zh-TW"]);
  assert.strictEqual(L("en", ""), "en-US");
});

// ---------------------------------------------------------------- 5. the real app (jsdom)
async function boot(opts) {
  opts = opts || {};
  const { JSDOM, VirtualConsole } = jsdom;
  const errors = [], spoken = [], calls = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push((e.detail && e.detail.stack || e.message).split("\n").slice(0, 2).join(" | ")));
  const html = fs.readFileSync(path.join(root, "app.html"), "utf8")
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script src="([^"]+)"><\/script>/g, (m, f) => "<script>" + fs.readFileSync(path.join(root, f.split("?")[0]), "utf8") + "</script>");
  const dom = new JSDOM(html, {
    url: "http://localhost/app.html", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "canvas" ? {} : () => ({ addColorStop() {}, width: 0 })), set: () => true });
      w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
      w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
      w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
      w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
      w.speechSynthesis = {
        getVoices: () => [{ name: "Microsoft Aria Online (Natural)", lang: "en-US", localService: false }, { name: "Microsoft Neerja Online (Natural)", lang: "en-IN", localService: false },
          { name: "Microsoft Uzma Online (Natural)", lang: "ur-PK", localService: false }, { name: "Microsoft Sonia Online (Natural)", lang: "en-GB", localService: false }],
        addEventListener() {}, cancel() {}, speaking: false,
        speak(u) { spoken.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name }); setTimeout(() => u.onend && u.onend(), 1); },
      };
      w.SpeechSynthesisUtterance = function (t) { this.text = t; };
      w.URL.createObjectURL = () => "blob:fake"; w.URL.revokeObjectURL = () => {};
      w.Audio = class { constructor(u) { this.src = u; } play() { setTimeout(() => this.onended && this.onended(), 1); return Promise.resolve(); } pause() {} };
      w.__AEGIS_TEST__ = true;
      if (opts.region) w.localStorage.setItem("aegis_region", opts.region);
      if (opts.studio) w.localStorage.setItem("aegis_token", "tok");
      w.fetch = async (url, init) => {
        calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
        if (String(url).endsWith("/api/tts/status")) return { ok: !!opts.studio, status: 200, json: async () => ({ available: true, provider: "edge", chars_left: 5000 }) };
        if (String(url).endsWith("/api/voice/profile")) return { ok: true, status: 200, json: async () => ({ region: "AE", source: "network" }) };
        if (String(url).endsWith("/api/tts")) return { ok: true, status: 200, blob: async () => ({}) };
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
      };
    },
  });
  await new Promise((r) => dom.window.addEventListener("load", () => setTimeout(r, 50)));
  return { w: dom.window, errors, spoken, calls };
}
async function withApp(opts, fn) { const a = await boot(opts); try { await fn(a); } finally { a.w.close(); } }
const skip = jsdom ? false : "jsdom is not installed (npm install --no-save jsdom)";

test("app: talk.js is loaded, the new settings exist and nothing throws", { skip }, () => withApp({}, ({ w, errors }) => {
  assert.deepStrictEqual(errors, []);
  assert.ok(w.AegisTalk && w.AegisTalk.takeSentences);
  for (const id of ["live-speak", "barge-in", "barge-note"]) assert.ok(w.document.getElementById(id), id);
  assert.strictEqual(w.document.getElementById("live-speak").checked, true);          // on by default
  assert.strictEqual(w.document.getElementById("barge-in").checked, false);           // off without headphones
}));

test("app: the voice region setting follows the person: English, Urdu and Spanish get the regional voice", { skip }, () => withApp({ region: "PK" }, ({ w, errors }) => {
  const A = w.AegisVoice;
  assert.strictEqual(A.profile.region(), "PK");
  assert.strictEqual(A.analyze("Good morning, how are you doing today?", "en-US").lang, "en-IN");
  assert.strictEqual(A.analyze("آپ کیسی ہیں، میں ٹھیک ہوں", "ur-PK").lang, "ur-PK");
  assert.strictEqual(w.__aegis.pageLang(), "en-US");                                  // the select says English: the page language is a language
  A.profile.setRegion("MX");
  assert.strictEqual(A.analyze("Hola amigo, ¿cómo estás?", "es-ES").lang, "es-MX");
  assert.strictEqual(A.analyze("Hola amigo", "es-AR").lang, "es-AR");                 // a deliberate regional page language is kept
  A.profile.setRegion("");                                                            // back to automatic
  assert.strictEqual(A.profile.isChosen(), false);
  const sel = [...w.document.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === "Voice region");
  assert.ok(sel, "the Voice region picker is in settings");
  assert.deepStrictEqual(errors, []);
}));

test("app: the browser voice of the listener's region is chosen (Indian English for a listener in Pakistan, British for the UK)", { skip }, () => withApp({ region: "PK" }, ({ w }) => {
  const A = w.AegisVoice;
  assert.strictEqual(A.resolve(A.analyze("Good morning to you, my friend", "en-US").lang).voice.name, "Microsoft Neerja Online (Natural)");
  A.profile.setRegion("GB");
  assert.strictEqual(A.resolve(A.analyze("Good morning to you, my friend", "en-US").lang).voice.name, "Microsoft Sonia Online (Natural)");
}));

test("app: the studio voice gets the listener (region + the language they speak) with every request, and the server's country is asked once", { skip }, () => withApp({ studio: true, region: "PK" }, async ({ w, calls }) => {
  const A = w.AegisVoice;
  await A.cloud.refresh(true);
  await wait(30);
  assert.strictEqual(calls.filter((c) => c.url.endsWith("/api/voice/profile")).length, 1);
  w.__aegis.noteLang("آپ کیسی ہیں؟ میں ٹھیک ہوں", "");
  await A.cloud.audio({ text: "Good morning", emotion: "warm", tts: "en" }, undefined);
  const req = calls.filter((c) => c.url.endsWith("/api/tts")).pop().body;
  assert.strictEqual(req.region, "PK");                                               // the person's own choice beats the server's guess (AE)
  assert.strictEqual(req.speaker, "ur");
  assert.strictEqual(req.lang, "en");
}));

test("app: the server's country is used when the person has not chosen one", { skip }, () => withApp({ studio: true }, async ({ w, calls }) => {
  const A = w.AegisVoice;
  await A.cloud.refresh(true);
  await wait(30);
  assert.strictEqual(A.profile.region(), "AE");
  await A.cloud.audio({ text: "مرحبا", emotion: "calm", tts: "ar" }, undefined);
  assert.strictEqual(calls.filter((c) => c.url.endsWith("/api/tts")).pop().body.region, "AE");
}));

test("app: an answer is spoken sentence by sentence WHILE it streams in, once, with its tags removed", { skip }, () => withApp({}, async ({ w, spoken, errors }) => {
  const a = w.__aegis;
  w.document.getElementById("speak").checked = true;
  a.liveFeed("[warm] Of course, I can help you with that. [joy] It is");
  await wait(20);
  assert.deepStrictEqual(spoken.map((s) => s.text), ["Of course, I can help you with that."]);       // spoken before the answer is complete
  a.liveFeed(" all done now, and it went well. [calm] Anything else");
  assert.strictEqual(a.liveFinish(), true);
  assert.ok(await until(() => spoken.length >= 3), "all three parts are spoken");
  await wait(50);
  const texts = spoken.map((s) => s.text.replace(/\s+/g, " ").trim());
  assert.deepStrictEqual(texts, ["Of course, I can help you with that.", "It is all done now, and it went well.", "Anything else"]);
  assert.ok(spoken.every((s) => !/\[/.test(s.text)));
  assert.deepStrictEqual(errors, []);
}));

test("app: nothing is spoken when read-aloud is off, and the full reply is then left to speak() (which also stays silent)", { skip }, () => withApp({}, async ({ w, spoken }) => {
  const a = w.__aegis;
  w.document.getElementById("speak").checked = false;
  a.liveFeed("This is a long enough sentence to speak. And another one here.");
  await wait(20);
  assert.strictEqual(spoken.length, 0);
  assert.strictEqual(a.liveFinish(), false);
}));

test("app: interrupting stops her, and the rest of that answer stays silent", { skip }, () => withApp({}, async ({ w, spoken }) => {
  const a = w.__aegis;
  w.document.getElementById("speak").checked = true;
  a.liveFeed("I was in the middle of saying something. And I have more to tell");
  assert.strictEqual(spoken.length, 1);
  a.onInterrupt();
  a.liveFeed(" you about that. Even more arrives. And more arrives too.");
  await wait(30);
  assert.strictEqual(spoken.length, 1);
  assert.strictEqual(a.liveFinish(), true);                                           // silent, and the full reply is not read out instead
  assert.strictEqual(a.liveFinish(), false);                                          // the next answer is spoken as usual
}));

test("app: turning live speech off in settings goes back to speaking the whole reply at the end", { skip }, () => withApp({}, async ({ w, spoken }) => {
  const a = w.__aegis, box = w.document.getElementById("live-speak");
  w.document.getElementById("speak").checked = true;
  box.checked = false; box.dispatchEvent(new w.Event("change"));
  a.liveFeed("A full sentence arrives while streaming. And more");
  await wait(20);
  assert.strictEqual(spoken.length, 0);
  assert.strictEqual(a.liveFinish(), false);
}));
