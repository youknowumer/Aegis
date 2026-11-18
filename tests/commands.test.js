const test=require('node:test'),assert=require('node:assert'),vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={window:{},document:{},navigator:{},localStorage:{getItem(){return null},setItem(){}},console};
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
// should go to AI (null)
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
