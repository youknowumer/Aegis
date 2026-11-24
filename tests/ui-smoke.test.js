"use strict";
// Loads the REAL app.html with every script in jsdom and checks behaviour that only exists once everything is wired together:
// wake word, hidden emotion tags, per-sentence languages, studio voice and its fallback.
// Needs jsdom (dev only):  npm install --no-save jsdom   -> without it these tests are skipped.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

let jsdom = null;
try { jsdom = require("jsdom"); } catch { /* skipped below */ }
const root = path.join(__dirname, "..");

async function boot(opts) {
  opts = opts || {};
  const { JSDOM, VirtualConsole } = jsdom;
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push((e.detail && e.detail.stack || e.message).split("\n").slice(0, 2).join(" | ")));
  const calls = [], spoken = [], played = [];
  // scripts are inlined, so the test needs no server and works with any jsdom version
  const html = fs.readFileSync(path.join(root, "app.html"), "utf8")
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script src="([^"]+)"><\/script>/g, (m, f) => "<script>" + fs.readFileSync(path.join(root, f), "utf8") + "</script>");
  const dom = new JSDOM(html, {
    url: "http://localhost/app.html", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "canvas" ? {} : () => ({ addColorStop() {}, width: 0 })), set: () => true });
      w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
      w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
      w.speechSynthesis = {
        getVoices: () => [{ name: "Microsoft Aria Online (Natural)", lang: "en-US", localService: false }, { name: "Microsoft Elvira Online (Natural)", lang: "es-ES", localService: false }, { name: "Microsoft Uzma Online (Natural)", lang: "ur-PK", localService: false }],
        addEventListener() {}, cancel() {}, speaking: false,
        speak(u) { spoken.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name }); setTimeout(() => u.onend && u.onend(), 1); },
      };
      w.SpeechSynthesisUtterance = function (t) { this.text = t; };
      w.URL.createObjectURL = () => "blob:fake"; w.URL.revokeObjectURL = () => {};
      w.Audio = class { constructor(u) { this.src = u; } play() { played.push(this.src); setTimeout(() => this.onended && this.onended(), 1); return Promise.resolve(); } pause() {} };
      w.__AEGIS_TEST__ = true;
      if (opts.studio) w.localStorage.setItem("aegis_token", "tok");
      w.fetch = async (url, init) => {
        calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
        if (String(url).endsWith("/api/tts/status")) return { ok: !!opts.studio, status: 200, json: async () => ({ available: true, provider: "openai", chars_left: 5000 }) };
        if (String(url).endsWith("/api/tts")) return { ok: opts.ttsStatus === undefined, status: opts.ttsStatus || 200, blob: async () => ({}) };
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
      };
    },
  });
  await new Promise((r) => dom.window.addEventListener("load", () => setTimeout(r, 50)));
  return { w: dom.window, errors, calls, spoken, played };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function withApp(opts, fn) {
  const app = await boot(opts);
  try { await fn(app); } finally { app.w.close(); }
}
const T = jsdom ? test : test.skip;

T("the whole app loads without a single script error and carries no old assistant name", async () => withApp(undefined, async ({ w, errors }) => {
  assert.deepStrictEqual(errors, []);
  assert.ok(w.AegisVoice && w.AegisApp);
  assert.ok(!/jarvis/i.test(w.document.documentElement.outerHTML));
  assert.strictEqual(w.document.querySelectorAll("#lang option").length, 21);
}));

T("wake word: Aegis only, mis-hearings and other scripts accepted, a stray mention does not wake it", async () => withApp(undefined, async ({ w }) => {
  const x = w.__aegis.extractWake;
  assert.strictEqual(x("Aegis open Chrome"), "open Chrome");
  assert.strictEqual(x("hey aegis what's the weather"), "what's the weather");
  assert.strictEqual(x("ejis open youtube"), "open youtube");
  assert.strictEqual(x("hola aegis qué hora es"), "qué hora es");
  assert.strictEqual(x("ایجس موسم کیسا ہے"), "موسم کیسا ہے");
  assert.strictEqual(x("एजिस मौसम बताओ"), "मौसम बताओ");
  assert.strictEqual(x("イージス天気を教えて"), "天気を教えて");
  assert.strictEqual(x("Jarvis open Chrome"), null);                 // the old name no longer wakes anything
  assert.strictEqual(x("the shield of aegis was famous in myth"), null);
}));

T("wake word: common mis-hearings (ages, edges, ajis) wake it after a greeting, ordinary words do not", async () => withApp(undefined, async ({ w }) => {
  const x = w.__aegis.extractWake;
  assert.strictEqual(x("hey ages what time is it"), "what time is it");
  assert.strictEqual(x("hey edges open chrome"), "open chrome");
  assert.strictEqual(x("ok ajis mausam batao"), "mausam batao");
  assert.strictEqual(x("hey guess what happened"), null);
  assert.strictEqual(x("hey jess how are you"), null);
  assert.strictEqual(x("ages open chrome"), "open chrome");                 // a mis-heard name at the start still wakes it
  assert.strictEqual(x("people of different ages"), null);                    // ...but never at the end of an ordinary sentence
}));

T("auto language follows the person: Urdu script, Spanish and English move the listening language", async () => withApp(undefined, async ({ w }) => {
  const a = w.__aegis;
  w.document.getElementById("lang").value = "auto";
  a.noteLang("آج موسم کیسا ہے");
  assert.strictEqual(a.lastLangNow(), "ur-PK");
  assert.strictEqual(a.recLang("once", false), "ur-PK");
  assert.match(a.recLang("wake", false), /^en/);      // the wake word is always listened for in English
  assert.strictEqual(a.recLang("once", true), "auto");  // Whisper detects by itself
  a.noteLang("hola, ¿cómo estás? gracias por todo");
  assert.strictEqual(a.lastLangNow(), "es-ES");
  a.noteLang("what is the weather today", "english");
  assert.match(a.lastLangNow(), /^en/);
}));

T("spoken approvals: yes / no in many languages, a casual ok is not enough for risky actions, unclear answers stay unanswered", async () => withApp(undefined, async ({ w }) => {
  const yn = w.__aegis.yesNo;
  for (const s of ["yes please", "haan ji kar do", "ہاں", "हाँ", "sí", "oui", "ja", "はい", "go ahead"]) assert.strictEqual(yn(s, "send_email"), true, s);
  for (const s of ["no", "nahi", "نہیں", "नहीं", "don't do it", "mat karo", "non", "いいえ", "haan ya nahi"]) assert.strictEqual(yn(s, "send_email"), false, s);
  assert.strictEqual(yn("ok", "send_email"), true);
  assert.strictEqual(yn("ok", "power_action"), null);        // shutting down needs a clear yes
  assert.strictEqual(yn("yes", "power_action"), true);
  assert.strictEqual(yn("what time is it", "send_email"), null);
}));

T("how they sounded: slow + hesitant speech is noticed, normal speech sends nothing; deep thinking is recognised in any wording", async () => withApp(undefined, async ({ w }) => {
  const a = w.__aegis;
  assert.strictEqual(a.makeVibe("what is the weather like today in lahore", { vibe: { speechMs: 2600, avg: 0.04, pauses: 0 } }), null);
  const slow = a.makeVibe("um I think I need to check my schedule", { vibe: { speechMs: 7000, avg: 0.02, pauses: 3 } });
  assert.strictEqual(slow.pace, "slow"); assert.strictEqual(slow.hesitant, true);
  const fast = a.makeVibe("open my inbox and read me the latest three emails right now please", { vibe: { speechMs: 2500, avg: 0.04, pauses: 0 } });
  assert.strictEqual(fast.pace, "fast");
  for (const s of ["think deeply about my budget", "gehrai se socho is plan ke baare mein", "take your time with this", "گہرائی سے سوچ کر بتاؤ"]) assert.ok(a.DEEP_RX.test(s), s);
  assert.ok(!a.DEEP_RX.test("what is the weather"));
}));

T("emotion tags never reach the screen, the clipboard text or the read-back", async () => withApp(undefined, async ({ w }) => {
  const el = w.document.createElement("div");
  w.__aegis.rich(el, "[warm] Good morning! [joy] Your report is ready.\n\n[curious] Shall I send it?");
  assert.ok(!/\[/.test(el.textContent), el.textContent);
  assert.match(el.textContent, /Good morning! Your report is ready\./);
}));

T("each sentence is spoken with the voice of its own language, tags removed", async () => withApp(undefined, async ({ w, spoken, errors }) => {
  w.AegisApp.speakScript([{ text: "[warm] Hello there. [joy] ¡Qué buena noticia! [calm] آپ کا کام ہو گیا ہے۔" }]);
  await wait(3000);
  const byText = (re) => spoken.find((s) => re.test(s.text));
  assert.strictEqual(byText(/Hello/).lang, "en-US");
  assert.match(byText(/buena/).voice, /Elvira/);
  assert.strictEqual(byText(/buena/).lang, "es-ES");
  assert.match(byText(/کام/).voice, /Uzma/);
  assert.ok(spoken.every((s) => !/\[|\]/.test(s.text)));
  assert.deepStrictEqual(errors, []);
}));

T("studio voice: used when the server offers it, one request per feeling and language, browser voice stays silent", async () => withApp({ studio: true }, async ({ w, calls, spoken, played }) => {
  await wait(200);
  assert.ok(w.AegisVoice.cloud.ready());
  w.AegisApp.speakScript([{ text: "[joy] Great news. [joy] Well done. [empathy] I am sorry about the delay. [warm] ¡Hola, amigo! Muchas gracias." }]);
  await wait(2500);
  const tts = calls.filter((c) => c.url.endsWith("/api/tts"));
  assert.deepStrictEqual(tts.map((c) => [c.body.emotion, c.body.lang]), [["joy", "en"], ["empathy", "en"], ["warm", "es"]]);
  assert.strictEqual(tts[0].body.text, "Great news. Well done.");
  assert.strictEqual(played.length, 3);
  assert.strictEqual(spoken.length, 0);
}));

T("studio voice failing (out of quota) falls back to the browser voice without losing a word, and stops asking", async () => withApp({ studio: true, ttsStatus: 429 }, async ({ w, calls, spoken, played }) => {
  await wait(200);
  w.AegisApp.speakScript([{ text: "[warm] First sentence here. [empathy] Second sentence here." }]);
  await wait(2500);
  assert.strictEqual(played.length, 0);
  assert.deepStrictEqual(spoken.map((s) => s.text), ["First sentence here.", "Second sentence here."]);
  assert.strictEqual(w.AegisVoice.cloud.ready(), false);            // a 429 switches it off for the session
  const before = calls.filter((c) => c.url.endsWith("/api/tts")).length;
  w.AegisApp.speakScript([{ text: "[warm] Third." }]);
  await wait(200);
  assert.strictEqual(calls.filter((c) => c.url.endsWith("/api/tts")).length, before);
  assert.ok(spoken.some((s) => s.text === "Third."));
}));

T("settings panel: studio voice toggle and language sampler are there, and the toggle really switches the studio voice off", async () => withApp({ studio: true }, async ({ w }) => {
  await wait(200);
  const vp = w.document.querySelector(".vp");
  assert.ok(vp, "voice panel is mounted");
  const box = vp.querySelector('input[type="checkbox"]');
  assert.ok(box && box.checked);
  assert.match(vp.textContent, /Studio voice is on \(openai\)\. 5,000 characters left today\./);
  assert.ok([...vp.querySelectorAll("button")].some((b) => /Hear another language/.test(b.textContent)));
  assert.ok(w.AegisVoice.cloud.ready());
  box.checked = false; box.dispatchEvent(new w.Event("change"));
  assert.strictEqual(w.localStorage.getItem("aegis_studio"), "0");
  assert.strictEqual(w.AegisVoice.cloud.ready(), false);
}));
