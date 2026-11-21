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
