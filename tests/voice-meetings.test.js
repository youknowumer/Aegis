"use strict";
const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const load = (file, extra) => {
  const window = Object.assign({}, extra && extra.window);
  const ctx = Object.assign({ window, document: { readyState: "complete", getElementById: () => null, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console }, extra && extra.globals);
  if (window.speechSynthesis) ctx.speechSynthesis = window.speechSynthesis;   // in a browser window === globalThis
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), ctx);
  return ctx.window;
};
const voice = (voices) => load("voice.js", {
  window: { speechSynthesis: { getVoices: () => voices, addEventListener() {} } },
  globals: { SpeechSynthesisUtterance: function () {} },
}).AegisVoice;
const V = (name, lang, local = true) => ({ name, lang, localService: local });

test("there is exactly one voice and it is female", () => {
  const A = voice([]);
  assert.strictEqual(A.list().length, 1);
  assert.match(A.describe(), /female/);
  assert.strictEqual(A.find("british male"), null);       // no male voice on offer
  assert.ok(A.find("use a female voice"));
  assert.strictEqual(A.cycle().id, A.set("anything").id);  // nothing to switch to
});

test("a female voice always beats a male one, whatever the quality ranking says", () => {
  const A = voice([V("Microsoft Guy Online (Natural) - English (United States)", "en-US", false), V("Microsoft Aria Online (Natural) - English (United States)", "en-US", false), V("Microsoft Ryan Online (Natural) - English (United Kingdom)", "en-GB", false)]);
  assert.match(A.resolve("en-US").voice.name, /Aria/);
  const B = voice([V("Daniel", "en-GB"), V("Samantha", "en-US", true)]);
  assert.strictEqual(B.resolve("en-US").voice.name, "Samantha");
  assert.strictEqual(B.resolve("en-GB").voice.name, "Samantha");   // an en-GB page still gets the female voice, not Daniel
});

test("Urdu and Hindi pick their own female voices, never an English one", () => {
  const A = voice([V("Microsoft Asad Online (Natural) - Urdu (Pakistan)", "ur-PK", false), V("Microsoft Uzma Online (Natural) - Urdu (Pakistan)", "ur-PK", false), V("Microsoft Aria", "en-US"), V("Microsoft Madhur Online (Natural) - Hindi (India)", "hi-IN", false), V("Microsoft Swara Online (Natural) - Hindi (India)", "hi-IN", false)]);
  assert.match(A.resolve("ur-PK").voice.name, /Uzma/);
  assert.match(A.resolve("hi-IN").voice.name, /Swara/);
});

test("only male voices installed: the pitch is lifted so the one voice still leans female", () => {
  const A = voice([V("Daniel", "en-GB")]);
  const A2 = voice([V("Samantha", "en-US")]);
  assert.ok(A.resolve("en-GB").pitch > A2.resolve("en-US").pitch * 1.2);
});

test("emotion detection: English, Roman Urdu and Urdu", () => {
  const A = voice([]);
  const e = (t, h) => A.emotionOf(t, h);
  assert.strictEqual(e("Congratulations, that is wonderful news!"), "joy");
  assert.strictEqual(e("I'm so sorry, unfortunately it failed."), "empathy");
  assert.strictEqual(e("Warning: there is a risk of delay."), "concern");
  assert.strictEqual(e("This is urgent, do it right now."), "urgent");
  assert.strictEqual(e("Would you like me to open it?"), "curious");
  assert.strictEqual(e("Hello, welcome back."), "warm");
  assert.strictEqual(e("The decision is confirmed and approved."), "confident");
  assert.strictEqual(e("Bohat bohat mubarak ho, zabardast!"), "joy");
  assert.strictEqual(e("Mujhe afsos hai, maaf kijiye ga."), "empathy");
  assert.strictEqual(e("Abhi fori karo, yeh zaroori hai."), "urgent");
  assert.strictEqual(e("آپ کا شکریہ"), "warm");
  assert.strictEqual(e("افسوس، یہ نہیں ہو سکا۔"), "empathy");
  assert.strictEqual(e("The table has four legs."), "calm");
  assert.strictEqual(e("The table has four legs.", "concern"), "concern");   // a caller's hint wins
});

test("shape(): each sentence gets its own tone, speed and pause; sad is slower and softer than joyful", () => {
  const A = voice([]);
  const p = A.shape("Great news, we won! I'm sorry about the delay. Is that fine?", "en-US");
  assert.strictEqual(p.length, 3);
  assert.deepStrictEqual(Array.from(p, (x) => x.emotion), ["joy", "empathy", "curious"]);
  assert.ok(p[0].pitch > p[1].pitch && p[0].rate > p[1].rate && p[0].volume >= p[1].volume);
  assert.ok(p[1].pause > p[0].pause, "sad sentences linger longer");
  assert.ok(p.every((x) => x.rate >= 0.6 && x.rate <= 1.7 && x.pitch >= 0.5 && x.pitch <= 1.9 && x.volume <= 1));
});

test("expression 0 is flat, higher expression exaggerates, long sentences are cut for the browser", () => {
  const A = voice([]);
  const flat = A.shape("Great news!", "en-US", { expression: 0 })[0];
  const wild = A.shape("Great news!", "en-US", { expression: 1.6 })[0];
  assert.ok(Math.abs(flat.pitch - 1) < 0.02 && Math.abs(flat.rate - 1) < 0.02);
  assert.ok(wild.pitch > flat.pitch + 0.1);
  const long = A.shape(("word ").repeat(120) + ".", "en-US");
  assert.ok(long.length > 1 && long.every((x) => x.text.length <= 175));
  assert.strictEqual(A.shape("", "en-US").length, 0);
});

test("meeting read-out script: every section is spoken with the right feeling, in the chosen language", () => {
  const M = load("meetings.js").AegisMeetings;
  const notes = {
    summary: "We agreed to ship on Friday.", important_points: [{ point: "Launch moves to Friday", importance: "high" }, { point: "Budget is unchanged", importance: "low" }],
    decisions: ["Ship on Friday"], action_items: [{ task: "Prepare release notes", owner: "Sara", due: "Thursday", priority: "high" }, { task: "Book the demo room", owner: "", due: "", priority: "low" }],
    risks: ["QA is short-staffed"], next_steps: ["Review on Monday"],
  };
  const s = M.scriptFor(notes, "en");
  const emo = (t) => s.find((x) => x.text.includes(t)).emotion;
  assert.strictEqual(s[0].emotion, "warm");
  assert.strictEqual(emo("Launch moves"), "urgent");
  assert.strictEqual(emo("Budget is unchanged"), "calm");
  assert.strictEqual(emo("Ship on Friday."), "confident");
  assert.strictEqual(emo("QA is short-staffed"), "concern");
  assert.strictEqual(emo("Review on Monday"), "warm");
  assert.match(s.find((x) => x.text.includes("release notes")).text, /Sara is on it, due Thursday\.$/);
  assert.match(s.find((x) => x.text.includes("demo room")).text, /^Book the demo room\.$/);
  assert.strictEqual(s[s.length - 1].text, "The full notes are on your screen.");
  assert.match(M.scriptFor(notes, "roman")[0].text, /Meeting khatam ho gayi/);
  assert.match(M.scriptFor(notes, "ur")[0].text, /میٹنگ ختم/);
  // an empty meeting is handled gently, never a silent crash
  const e = M.scriptFor({}, "en");
  assert.ok(e.some((x) => x.emotion === "empathy"));
  // caps: no endless read-outs
  const big = M.scriptFor({ important_points: Array.from({ length: 30 }, (_, i) => ({ point: "P" + i, importance: "low" })) }, "en");
  assert.ok(big.filter((x) => /^P\d+\.$/.test(x.text)).length === 5);
});

test("present mode is off by default and exposed to the speech layer", () => {
  const M = load("meetings.js").AegisMeetings;
  assert.strictEqual(M.isPresent(), false);
  assert.strictEqual(typeof M.present, "function");
  assert.strictEqual(typeof M.extract, "function");
});
