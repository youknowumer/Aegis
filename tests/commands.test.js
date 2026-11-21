const test=require('node:test'),assert=require('node:assert'),vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={window:{crypto:require('node:crypto').webcrypto},crypto:require('node:crypto').webcrypto,document:{},navigator:{},localStorage:{getItem(){return null},setItem(){}},console};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','commands.js'),'utf8'),ctx);
const A=ctx.window.AegisCommands;
const cases=[
["open youtube","open"],["youtube kholo","open"],["open github.com","open"],["open spotify please","open"],["یوٹیوب کھولو","open"],
["google quantum computing","search"],["play coke studio on youtube","search"],["search biryani on maps","search"],["lahore weather google karo","search"],["directions to Islamabad","search"],
["what time is it","time"],["time kya hua hai","time"],["time in tokyo","zone-time"],["what's the date","date"],["aaj kya tareekh hai","date"],
["calculate 15% of 2400","math"],["what is 25*4+2","math"],["12 times 8","math"],["what is sqrt(144)","math"],["square root of 81","math"],
["convert 10 km to miles","convert"],["100 f to c","convert"],
["set a timer for 10 minutes","timer-set"],["5 minute ka timer laga do","timer-set"],["remind me in 2 hours to call mom","timer-set"],["cancel timer","timer-cancel"],["how much time is left","timer-left"],
["take a note buy milk","note-add"],["show my notes","note-list"],
["weather","weather"],["weather in lahore","weather"],["lahore ka mausam","weather"],["system status","status"],["battery","status"],
["voice mode on","voice-mode"],["voice mode off","voice-mode"],["switch to urdu","language"],["urdu","language"],["change theme to red","theme"],["red theme","theme"],
["focus mode","focus"],["full screen","fullscreen"],["clear chat","clear"],["stop","stop"],["mute","mute"],["be quiet","mute"],["repeat that","repeat"],["help","help"],
["flip a coin","coin"],["roll a dice","dice"],["random number between 5 and 10","random"],
["hello","hello"],["thanks","thanks"],
["change voice to british male","voice-set"],["use siri voice","voice-set"],["use a deep voice","voice-set"],["speak in an australian accent","voice-set"],["switch to aria voice","voice-set"],
["next voice","voice-next"],["change voice","voice-next"],["speak faster","voice-tune"],["slower","voice-tune"],["louder","voice-tune"],["deeper voice","voice-tune"],["reset voice","voice-tune"],
["what voices do you have","voice-list"],["say hello world","say"],
["start stopwatch","stopwatch"],["lap","stopwatch"],["stop stopwatch","stopwatch"],["reset stopwatch","stopwatch"],
["generate a password","password"],["password 20","password"],["days until christmas","days-until"],["how many days until 25 december","days-until"],["copy that","copy"],["show memory tab","show-tab"],["open the activity panel","show-tab"],["show voice tab","show-tab"],
["start meeting","meeting-start"],["start a meeting","meeting-start"],["record the meeting","meeting-start"],["meeting shuru karo","meeting-start"],["start recording","meeting-start"],
["stop meeting","meeting-stop"],["end the meeting","meeting-stop"],["stop recording","meeting-stop"],["meeting khatam karo","meeting-stop"],["pause meeting","meeting-pause"],["resume the meeting","meeting-pause"],
["show meeting notes","meeting-notes"],["open meetings","meeting-notes"],["meeting notes","meeting-notes"],["show my last meeting","meeting-notes"],
// should go to AI (null)
["summarize my meeting with ali",null],["what was decided in my last meeting",null],["schedule a meeting tomorrow at 3",null],["how do I run a good meeting",null],["write meeting minutes for me",null],
["what is the capital of france",null],["explain quantum physics",null],["tell me a joke",null],["write an email to my boss",null],["who won the world cup in 2022",null],["open my downloads folder",null],["what is 2022",null],["translate hello to urdu",null],["how do I make biryani",null],
];
test("commands route correctly (and unknown things fall through to the AI)",()=>{
  for(const [t,exp] of cases){const m=A.match(t,{online:false});assert.strictEqual(m?m.name:null,exp,JSON.stringify(t));}
});
test("small talk is left to the AI when the server is online",()=>{assert.strictEqual(A.match("hello",{online:true}),null);});
test("calculator is exact and never evaluates code",()=>{
  assert.strictEqual(A.calc("15% of 2400"),"360");assert.strictEqual(A.calc("25*4+2"),"102");assert.strictEqual(A.calc("square root of 81"),"9");
  assert.strictEqual(A.calc("2^10"),"1024");assert.strictEqual(A.calc("alert(1)"),null);assert.strictEqual(A.calc("constructor"),null);
});

test("voice phrases that used to fall through to the AI now match (English + Roman Urdu)", () => {
  const hit = (phrase, name) => {
    const m = A.match(phrase, { online: false });
    assert.ok(m, "no match for: " + phrase);
    assert.equal(m.name, name, phrase + " -> " + m.name);
  };
  hit("play despacito", "search");
  hit("despacito chalao", "search");
  hit("date batao", "date");
  hit("aaj ki date kya hai", "date");
  hit("abhi time kya hai", "time");
  hit("focus mode off", "focus");
  hit("chat saaf karo", "clear");
  hit("mere notes dikhao", "note-list");
  hit("battery kitni hai", "status");
  hit("mausam batao", "weather");
  hit("lahore se islamabad directions", "search");
  hit("bolna band karo", "stop");
  // must NOT be hijacked by the new "X chalao" -> YouTube rule
  assert.equal(A.match("voice mode chalao", { online: false })?.name === "search", false);
  assert.equal(A.match("timer chalao", { online: false })?.name === "search", false);
});

test("Roman Urdu percent maths is exact", async () => {
  const m = A.match("2400 ka 15 percent", { online: false });
  assert.equal(m.name, "math");
  let said = "";
  await m.run({ say: (t) => { said = t; } });
  assert.match(said, /360/);
});

test("focus mode on/off resolves to the right state", async () => {
  for (const [phrase, want] of [["focus mode off", false], ["focus mode on", true], ["focus mode band karo", false]]) {
    let got;
    await A.match(phrase, { online: false }).run({ toggleFocus: (v) => (got = v), say: () => {} });
    assert.equal(got, want, phrase);
  }
});

test("voice commands drive the single female AegisVoice and utilities behave", async () => {
  const said = [], calls = [];
  const V = { tune(o) { calls.push(["tune", o]); return { rate: 1.02, pitch: 1, volume: 1, expression: 1 }; }, reset() { calls.push(["reset"]); },
    find(q) { calls.push(["find", q]); return /\bmale\b/.test(q) && !/female/.test(q) ? null : { id: "aegis", name: "Aegis" }; },
    preview() { calls.push(["preview"]); }, list() { return [{ name: "Aegis" }]; }, describe() { return "Aegis (female, Aria)"; } };
  const c = { voice: V, say: (t) => { said.push(t); return Promise.resolve(); }, copy: () => Promise.resolve(true), lastReply: () => "hi" };
  const run = (t) => A.match(t, { online: false }).run(c);
  await run("change voice to male"); assert.match(said.pop(), /only have one voice, a female voice/);
  assert.ok(!calls.some((x) => x[0] === "preview"));
  await run("use a female voice"); assert.ok(calls.some((x) => x[0] === "preview"));
  await run("more emotion"); assert.ok(calls.some((x) => x[0] === "tune" && x[1].expression > 1));
  await run("emotions off"); assert.ok(calls.some((x) => x[0] === "tune" && x[1].expression === 0)); assert.match(said.pop(), /Emotions off/);
  await run("speak faster"); assert.ok(calls.some((x) => x[0] === "tune" && x[1].rate > 1.02));
  await run("deeper voice"); assert.ok(calls.some((x) => x[0] === "tune" && x[1].pitch < 1));
  await run("what voices do you have"); assert.match(said.pop(), /one voice: a warm female voice/);
  await run("change voice"); assert.match(said.pop(), /only have one voice/);
  await run("start stopwatch"); assert.match(said.pop(), /started/i);
  await run("lap"); assert.match(said.pop(), /Lap 1/);
  await run("stop stopwatch"); assert.match(said.pop(), /Stopped at/);
  await run("password 20"); assert.match(said.pop(), /20-character password: \S{20}\n/);
  await run("days until christmas"); assert.match(said.pop(), /day.*until .*December/);
  await run("say hello world"); assert.strictEqual(said.pop(), "Hello world.");
});

test("present mode and 'extract meeting points' route to the meeting assistant (English, Roman Urdu, Urdu)", async () => {
  const hit = (phrase, name) => { const m = A.match(phrase, { online: false }); assert.ok(m, "no match for: " + phrase); assert.equal(m.name, name, phrase + " -> " + m.name); };
  for (const p of ["present mode", "join the meeting", "meeting suno", "meeting chal rahi hai", "meeting chal rhi hai sun lo", "میٹنگ سنو"]) hit(p, "meeting-present");
  for (const p of ["extract meeting points", "meeting points extract karo", "meeting ke points nikalo", "meeting khatam karo aur points nikalo", "give me the key points", "read the meeting notes", "میٹنگ کے پوائنٹس نکالو"]) hit(p, "meeting-extract");
  // the older meeting commands keep their own meaning
  hit("start meeting", "meeting-start"); hit("stop meeting", "meeting-stop"); hit("show meeting notes", "meeting-notes"); hit("mere notes dikhao", "note-list");
  const said = [], seen = [];
  const meetings = { present() { seen.push("present"); return Promise.resolve(true); }, extract() { seen.push("extract"); return Promise.resolve(true); }, state: () => "recording" };
  const c = { meetings, say: (t, o) => { said.push([t, o]); return Promise.resolve(); } };
  await A.match("present mode", { online: false }).run(c);
  assert.deepStrictEqual(seen, ["present"]);
  assert.match(said.pop()[0], /Present mode on/);
  await A.match("meeting points extract karo", { online: false }).run(c);
  assert.deepStrictEqual(seen, ["present", "extract"]);
  assert.match(said.pop()[0], /Ending the meeting/);
  const none = { meetings: { extract: () => Promise.resolve(false), state: () => "idle" }, say: (t) => { said.push(t); return Promise.resolve(); } };
  await A.match("extract meeting points", { online: false }).run(none);
  assert.match(said.pop(), /no meeting to take points from/);
});

test("language switching works for every supported language, in English, Roman Urdu and native script", async () => {
  const want = [["switch to spanish", "es-ES", "Spanish"], ["switch to french", "fr-FR", "French"], ["arabic mein baat karo", "ar-SA", "Arabic"], ["set language to japanese", "ja-JP", "Japanese"],
    ["switch to 日本語", "ja-JP", "Japanese"], ["change language to german", "de-DE", "German"], ["switch to chinese", "zh-CN", "Chinese"], ["switch to korean", "ko-KR", "Korean"],
    ["switch to turkish", "tr-TR", "Turkish"], ["switch to portuguese", "pt-BR", "Portuguese"], ["urdu", "ur-PK", "Urdu"], ["hindi", "hi-IN", "Hindi"], ["انگریزی", "en-US", "English"]];
  for (const [phrase, code, name] of want) {
    const m = A.match(phrase, { online: false });
    assert.strictEqual(m && m.name, "language", phrase);
    let got = null, said = "";
    await m.run({ setLang: (c) => { got = c; }, say: (t) => { said = t; return t; } });
    assert.strictEqual(got, code, phrase);
    assert.match(said, new RegExp(name), phrase);
  }
  // a bare foreign word is just a word for the AI (only urdu / hindi / english switch on their own)
  for (const t of ["french", "spanish", "german", "chinese", "arabic"]) assert.strictEqual(A.match(t, { online: false }), null, t);
});

test("the old assistant name is no longer stripped as a wake prefix, Aegis still is", () => {
  assert.strictEqual(A.norm("Aegis, open youtube"), "open youtube");
  assert.strictEqual(A.norm("hey aegis what time is it"), "what time is it");
  assert.notStrictEqual(A.norm("jarvis open youtube"), "open youtube");
});

test("every language the commands can switch to exists in the language dropdown", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "commands.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const codes = [...src.match(/const LANG_NAME = \{([^}]*)\}/)[1].matchAll(/"([a-z]{2}-[A-Z]{2})"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 20);
  for (const c of codes) assert.ok(html.includes(`<option value="${c}">`), "missing option " + c);
});
