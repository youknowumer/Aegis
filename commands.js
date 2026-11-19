// Aegis instant commands: run in the browser, answer in milliseconds, work offline and never use your daily AI quota.
// Typed or spoken, in English, Roman Urdu, Urdu script or Hindi. Anything not matched here goes to the AI.
//
//   AegisCommands.match(text) -> { name, run(ctx) } | null
//
// ctx (provided by app.js): say(text), online, lang, setLang(code), setVoiceMode(on), setSpeak(on), stopSpeaking(),
// clearChat(), lastReply(), repeatLast(), setTheme(name), toggleFocus(on?), hud, open(url)
(() => {
  "use strict";

  // ------------------------------------------------------------------ helpers
  const DIGITS = { "۰": 0, "۱": 1, "۲": 2, "۳": 3, "۴": 4, "۵": 5, "۶": 6, "۷": 7, "۸": 8, "۹": 9,
    "٠": 0, "١": 1, "٢": 2, "٣": 3, "٤": 4, "٥": 5, "٦": 6, "٧": 7, "٨": 8, "٩": 9 };
  const WORD_NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, half: 0.5,
    aik: 1, ek: 1, do: 2, teen: 3, char: 4, panch: 5, paanch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, pandrah: 15, bees: 20, tees: 30, chalis: 40, pachas: 50,
    "ایک": 1, "دو": 2, "تین": 3, "چار": 4, "پانچ": 5, "دس": 10, "پندرہ": 15, "بیس": 20, "تیس": 30 };

  function norm(text) {
    let t = String(text || "").replace(/[۰-۹٠-٩]/g, (c) => DIGITS[c]);
    t = t.toLowerCase().replace(/[“”"]/g, "").replace(/[?!؟.,;]+$/g, "").replace(/\s+/g, " ").trim();
    t = t.replace(/^(?:please|plz|pls|can you|could you|will you|aegis|jarvis|hey aegis|hey jarvis)[ ,]+/g, "");
    t = t.replace(/[ ,]+(?:please|plz|pls|thanks|thank you|shukriya)$/g, "");
    return t.trim();
  }
  const wordsToDigits = (t) => t.replace(/\b[a-z؀-ۿ]+\b/g, (w) => (w in WORD_NUM ? String(WORD_NUM[w]) : w));
  const rx = (s) => new RegExp(s, "i");
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const enc = encodeURIComponent;

  // ------------------------------------------------------------------ sites
  const SITES = {
    youtube: ["https://www.youtube.com", "youtube", "یوٹیوب", "यूट्यूब"],
    google: ["https://www.google.com", "google", "گوگل", "गूगल"],
    gmail: ["https://mail.google.com", "gmail", "mail", "email", "جی میل", "ईमेल"],
    whatsapp: ["https://web.whatsapp.com", "whatsapp", "whats app", "واٹس ایپ", "व्हाट्सएप"],
    github: ["https://github.com", "github", "git hub"],
    maps: ["https://maps.google.com", "maps", "google maps", "map", "نقشہ"],
    facebook: ["https://www.facebook.com", "facebook", "fb", "فیس بک"],
    instagram: ["https://www.instagram.com", "instagram", "insta", "انسٹاگرام"],
    twitter: ["https://x.com", "twitter", "x", "x.com"],
    linkedin: ["https://www.linkedin.com", "linkedin"],
    netflix: ["https://www.netflix.com", "netflix"],
    spotify: ["https://open.spotify.com", "spotify"],
    drive: ["https://drive.google.com", "drive", "google drive"],
    docs: ["https://docs.google.com", "docs", "google docs"],
    sheets: ["https://sheets.google.com", "sheets", "google sheets"],
    calendar: ["https://calendar.google.com", "calendar", "google calendar"],
    meet: ["https://meet.google.com", "meet", "google meet"],
    claude: ["https://claude.ai", "claude"],
    chatgpt: ["https://chatgpt.com", "chatgpt"],
    news: ["https://news.google.com", "news", "خبریں", "समाचार"],
    wikipedia: ["https://www.wikipedia.org", "wikipedia", "wiki"],
    reddit: ["https://www.reddit.com", "reddit"],
    telegram: ["https://web.telegram.org", "telegram"],
    translate: ["https://translate.google.com", "translate", "google translate"],
    amazon: ["https://www.amazon.com", "amazon"],
    daraz: ["https://www.daraz.pk", "daraz"],
    tiktok: ["https://www.tiktok.com", "tiktok", "tik tok"],
  };
  function findSite(name) {
    const n = name.replace(/^(?:the|my|a)\s+/, "").replace(/\s+(?:website|site|app|page)$/, "").trim();
    for (const [, v] of Object.entries(SITES)) if (v.slice(1).includes(n)) return v[0];
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(n)) return "https://" + n;
    return null;
  }
  const SEARCH = {
    google: (q) => "https://www.google.com/search?q=" + enc(q),
    youtube: (q) => "https://www.youtube.com/results?search_query=" + enc(q),
    wikipedia: (q) => "https://en.wikipedia.org/w/index.php?search=" + enc(q),
    maps: (q) => "https://www.google.com/maps/search/" + enc(q),
    amazon: (q) => "https://www.amazon.com/s?k=" + enc(q),
    images: (q) => "https://www.google.com/search?tbm=isch&q=" + enc(q),
    news: (q) => "https://news.google.com/search?q=" + enc(q),
    daraz: (q) => "https://www.daraz.pk/catalog/?q=" + enc(q),
  };
  const SITE_ALIAS = { "google maps": "maps", map: "maps", yt: "youtube", wiki: "wikipedia", gmaps: "maps", pictures: "images", photos: "images", image: "images" };
  const siteKey = (s) => { s = (s || "").trim(); return SITE_ALIAS[s] || (SEARCH[s] ? s : null); };

  // ------------------------------------------------------------------ safe math (no eval)
  function calc(src) {
    let s = src.toLowerCase();
    s = s.replace(/(\d)\s*,\s*(?=\d{3}\b)/g, "$1")
      .replace(/\bplus\b/g, "+").replace(/\bminus\b/g, "-").replace(/\b(?:times|multiplied by|into|x)\b/g, "*").replace(/×/g, "*")
      .replace(/\b(?:divided by|over|by)\b/g, "/").replace(/÷/g, "/").replace(/\bto the power of\b|\^/g, "**")
      .replace(/\bmod\b/g, "%");
    s = s.replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*(\d+(?:\.\d+)?)/g, "($1/100*$2)");
    s = s.replace(/\bsquare root of\s*(\d+(?:\.\d+)?)/g, "sqrt($1)").replace(/\bsqrt\s*(\d+(?:\.\d+)?)/g, "sqrt($1)");
    s = s.replace(/\bsquared\b/g, "**2").replace(/\bcubed\b/g, "**3");
    if (!/^[0-9+\-*/%().\s a-z]*$/.test(s) || !/\d/.test(s)) return null;
    // tokenise
    const toks = s.match(/\*\*|\d+(?:\.\d+)?|[a-z]+|[-+*/%()]/g);
    if (!toks || toks.join("").length < s.replace(/\s/g, "").length) return null;
    let i = 0;
    const FN = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round };
    const peek = () => toks[i];
    function expr() { let v = term(); while (peek() === "+" || peek() === "-") { const o = toks[i++]; const r = term(); v = o === "+" ? v + r : v - r; } return v; }
    function term() { let v = pow(); while (peek() === "*" || peek() === "/" || peek() === "%") { const o = toks[i++]; const r = pow(); v = o === "*" ? v * r : o === "/" ? v / r : v % r; } return v; }
    function pow() { const b = unary(); if (peek() === "**") { i++; const e = pow(); return Math.pow(b, e); } return b; }
    function unary() { if (peek() === "-") { i++; return -unary(); } if (peek() === "+") { i++; return unary(); } return atom(); }
    function atom() {
      const t = toks[i++];
      if (t === undefined) throw 0;
      if (t === "(") { const v = expr(); if (toks[i++] !== ")") throw 0; return v; }
      if (/^\d/.test(t)) return parseFloat(t);
      if (t === "pi") return Math.PI;
      if (FN[t]) { if (toks[i++] !== "(") throw 0; const v = expr(); if (toks[i++] !== ")") throw 0; return FN[t](v); }
      throw 0;
    }
    try {
      const v = expr();
      if (i !== toks.length || !isFinite(v)) return null;
      return Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(4) : String(+v.toFixed(8));
    } catch { return null; }
  }

  // ------------------------------------------------------------------ units
  const UNITS = [
    [/^(?:km|kilometers?|kilometres?)$/, "km", "length", 1000], [/^(?:mi|miles?)$/, "miles", "length", 1609.344],
    [/^(?:m|meters?|metres?)$/, "m", "length", 1], [/^(?:ft|feet|foot)$/, "feet", "length", 0.3048],
    [/^(?:cm|centimeters?|centimetres?)$/, "cm", "length", 0.01], [/^(?:in|inch|inches)$/, "inches", "length", 0.0254],
    [/^(?:kg|kilos?|kilograms?)$/, "kg", "mass", 1], [/^(?:lb|lbs|pounds?)$/, "pounds", "mass", 0.45359237],
    [/^(?:g|grams?)$/, "grams", "mass", 0.001], [/^(?:oz|ounces?)$/, "ounces", "mass", 0.0283495],
    [/^(?:l|liters?|litres?)$/, "litres", "vol", 1], [/^(?:ml|milliliters?)$/, "ml", "vol", 0.001], [/^(?:gal|gallons?)$/, "gallons", "vol", 3.78541],
    [/^(?:c|celsius|centigrade)$/, "°C", "temp", 0], [/^(?:f|fahrenheit)$/, "°F", "temp", 0],
  ];
  const unit = (s) => UNITS.find((u) => u[0].test(s));
  function convert(n, from, to) {
    const a = unit(from), b = unit(to);
    if (!a || !b || a[2] !== b[2]) return null;
    let v;
    if (a[2] === "temp") v = a[1] === b[1] ? n : a[1] === "°C" ? (n * 9) / 5 + 32 : ((n - 32) * 5) / 9;
    else v = (n * a[3]) / b[3];
    return `${n} ${a[1]} is ${+v.toFixed(2)} ${b[1]}.`;
  }

  // ------------------------------------------------------------------ time zones
  const ZONES = { london: "Europe/London", paris: "Europe/Paris", berlin: "Europe/Berlin", dubai: "Asia/Dubai", karachi: "Asia/Karachi", lahore: "Asia/Karachi",
    islamabad: "Asia/Karachi", delhi: "Asia/Kolkata", mumbai: "Asia/Kolkata", india: "Asia/Kolkata", dhaka: "Asia/Dhaka", tokyo: "Asia/Tokyo", beijing: "Asia/Shanghai",
    china: "Asia/Shanghai", singapore: "Asia/Singapore", sydney: "Australia/Sydney", "new york": "America/New_York", nyc: "America/New_York", chicago: "America/Chicago",
    "los angeles": "America/Los_Angeles", toronto: "America/Toronto", riyadh: "Asia/Riyadh", makkah: "Asia/Riyadh", mecca: "Asia/Riyadh", istanbul: "Europe/Istanbul",
    cairo: "Africa/Cairo", moscow: "Europe/Moscow", doha: "Asia/Qatar", kabul: "Asia/Kabul", tehran: "Asia/Tehran" };

  // ------------------------------------------------------------------ timers
  const timers = [];
  let timerId = 0;
  function parseDuration(t) {
    const s = wordsToDigits(t);
    let ms = 0, found = false;
    const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|min|m|seconds?|secs?|sec|s|منٹ|گھنٹ[ےا]?|سیکنڈ|ghante|ghanta|ghantay|minat|minute)\b/g;
    let m;
    while ((m = re.exec(s))) {
      const n = parseFloat(m[1]), u = m[2];
      found = true;
      if (/^(h|hr|hrs|hour|hours|ghant|گھنٹ)/.test(u)) ms += n * 3600000;
      else if (/^(m|min|mins|minute|minutes|minat|منٹ)/.test(u)) ms += n * 60000;
      else ms += n * 1000;
    }
    if (!found) {
      const half = /\bhalf an? hour\b|\badha ghanta\b/.test(s);
      if (half) return 1800000;
      const q = /\bquarter hour\b/.test(s);
      if (q) return 900000;
      return 0;
    }
    return ms;
  }
  const fmtDur = (ms) => {
    const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = [];
    if (h) p.push(h + (h === 1 ? " hour" : " hours"));
    if (m) p.push(m + (m === 1 ? " minute" : " minutes"));
    if (x && !h) p.push(x + (x === 1 ? " second" : " seconds"));
    return p.join(" ") || "0 seconds";
  };

  // ------------------------------------------------------------------ notes
  const NOTES_KEY = "aegis_notes";
  const notes = {
    get() { try { return JSON.parse(localStorage.getItem(NOTES_KEY) || "[]"); } catch { return []; } },
    set(v) { try { localStorage.setItem(NOTES_KEY, JSON.stringify(v.slice(-100))); } catch {} },
  };

  // ------------------------------------------------------------------ command table
  const THEMES = ["cyan", "blue", "green", "red", "amber", "purple", "pink"];
  const LANGS = { english: "en-US", urdu: "ur-PK", hindi: "hi-IN", "اردو": "ur-PK", "हिन्दी": "hi-IN", "انگلش": "en-US", "انگریزی": "en-US" };
  const LANG_NAME = { "en-US": "English", "ur-PK": "Urdu", "hi-IN": "Hindi" };
  const HELP =
    "Here is what I can do instantly, by voice or text:\n" +
    "- Open sites: \"open YouTube\", \"youtube kholo\", \"open github.com\"\n" +
    "- Search: \"google quantum computing\", \"play Coke Studio on YouTube\", \"search biryani on maps\"\n" +
    "- Time: \"what time is it\", \"time in Tokyo\", \"today's date\"\n" +
    "- Math and units: \"calculate 15% of 2400\", \"convert 10 km to miles\"\n" +
    "- Timers: \"set a timer for 10 minutes\", \"how much time is left\", \"cancel timer\"\n" +
    "- Notes: \"take a note buy milk\", \"show my notes\", \"clear notes\"\n" +
    "- Weather: \"weather\", \"weather in Lahore\"\n" +
    "- Device status: \"system status\", \"battery\"\n" +
    "- Control me: \"voice mode on\", \"be quiet\", \"switch to Urdu\", \"change theme to red\", \"focus mode\", \"full screen\", \"repeat that\"\n" +
    "- Fun: \"flip a coin\", \"roll a dice\", \"random number between 1 and 100\"\n" +
    "- Voice: \"change voice to British male\", \"use Siri voice\", \"next voice\", \"speak faster\", \"deeper voice\", \"louder\", \"what voices do you have\", \"say hello world\"\n" +
    "- Tabs: \"show memory tab\", \"open the activity panel\", \"show voice tab\" (or Alt+1 to Alt+7)\n" +
    "- Tools: \"start stopwatch\" / \"lap\" / \"stop stopwatch\", \"generate a password\", \"days until Christmas\", \"copy that\"\n" +
    "- Roman Urdu works too: \"youtube kholo\", \"mausam batao\", \"5 minute ka timer lagao\", \"date batao\", \"note karo doodh lana hai\"\n" +
    "Everything else, ask me normally: questions, advice, writing, coding, translation, anything.";

  const C = [];
  const add = (name, test, run, opts) => C.push({ name, test, run, offlineOnly: !!(opts && opts.offlineOnly) });

  // ---- stop / quiet (must always work)
  add("stop", (t) => /^(?:stop|stop talking|stop speaking|stop it|bolna band (?:karo|kar do)|enough|that's enough|bas|bas karo|ruko|ruk ja(?:o)?|\u0628\u0633|\u0631\u06a9\u0648|\u0930\u0941\u0915\u094b)$/.test(t),
    (m, c) => { c.stopSpeaking(); return null; });
  add("mute", (t) => /^(?:mute|mute yourself|be quiet|quiet|silence|shut up|chup|chup ho ja(?:o)?|chup kar(?:o)?|khamosh|\u0686\u067e|\u062e\u0627\u0645\u0648\u0634|\u091a\u0941\u092a)$/.test(t),
    (m, c) => { c.stopSpeaking(); c.setSpeak(false); return c.say("Muted. Say unmute to hear me again.", { silent: true }); });
  add("unmute", (t) => /^(?:unmute|unmute yourself|speak|talk to me|read aloud|read (?:replies|it) aloud|bolo|bol(?:o| do)|awaz on|\u0628\u0648\u0644\u0648|\u0622\u0648\u0627\u0632 \u0622\u0646)$/.test(t),
    (m, c) => { c.setSpeak(true); return c.say("Voice replies are on."); });

  // ---- help
  add("help", (t) => /^(?:help|help me|what can you do|what do you do|commands|list commands|voice commands|show commands|your features|features|capabilities|madad|madad karo|kya kar sakte ho|tum kya kar sakte ho|مدد|آپ کیا کر سکتے ہیں|मदद)$/.test(t),
    (m, c) => c.say(HELP, { speak: "I can open sites, search, tell the time, calculate, convert units, set timers, take notes, show weather, and control myself. Anything else, just ask me. The full list is on screen." }));

  // ---- repeat / copy
  add("repeat", (t) => /^(?:repeat(?: that)?|say (?:that )?again|what did you say|dobara bolo|phir se bolo|dobara|دوبارہ بولو|दोबारा बोलो)$/.test(t),
    (m, c) => { const r = c.lastReply(); if (!r) return c.say("I haven't said anything yet."); c.setSpeak(true); return c.repeatLast(); });
  add("copy", (t) => /^(?:copy (?:that|it|the (?:reply|answer))|copy last (?:reply|answer))$/.test(t),
    async (m, c) => {
      const r = c.lastReply();
      if (!r) return c.say("There is nothing to copy yet.");
      try { await navigator.clipboard.writeText(r); return c.say("Copied to your clipboard."); } catch { return c.say("Your browser blocked copying."); }
    });


  // ---- sidebar tabs ("show memory tab", "open the activity panel")
  const TAB_WORDS = { plan: "plan", tasks: "plan", task: "plan", reminders: "plan", focus: "focus", timer: "focus", scratchpad: "focus", memory: "memory", memories: "memory", activity: "activity", status: "status", usage: "status", device: "status", weather: "world", world: "world", shortcuts: "world", voice: "voice", voices: "voice" };
  add("show-tab", (t) => { const m = t.match(/^(?:show|open|go to|switch to|view)(?: me)?(?: the| my)? (plan|tasks?|reminders|focus|timer|scratchpad|memory|memories|activity|status|usage|device|weather|world|shortcuts|voices?) (?:tab|panel|section)$/); return m ? { id: TAB_WORDS[m[1]] } : null; },
    (m, c) => (c.tabs && c.tabs.show(m.id, { focus: false }) ? c.say("Showing the " + m.id + " tab.", { speak: "Done." }) : c.say("I can't switch tabs on this screen.")));

  // ---- voice personality (Siri-style personas live in voice.js)
  const VOICE_WORD = "(?:voice|awaaz|awaz|آواز)";
  add("voice-tune", (t) => {
    if (/^(?:speak|talk|bolo|bol|baat karo)\s+(?:a (?:bit|little) )?(faster|quicker|slower|slowly|tez|dheere|dhire|aahista)(?: please)?$/.test(t)) return { k: "rate", d: /fast|quick|tez/.test(t) ? 1 : -1 };
    if (/^(?:faster|slower|speed up|slow down|tez bolo|dheere bolo)$/.test(t)) return { k: "rate", d: /faster|speed up|tez/.test(t) ? 1 : -1 };
    if (/^(?:louder|volume up|speak louder|awaaz (?:tez|zyada|barhao)|quieter|softer|volume down|speak softer|awaaz (?:kam|halki))$/.test(t)) return { k: "volume", d: /louder|up|tez|zyada|barhao/.test(t) ? 1 : -1 };
    if (/^(?:(?:a )?(deeper|lower|higher)|(?:make )?(?:your )?(?:voice )?(deeper|lower|higher)|(?:pitch) (up|down)|(?:speak|talk) (?:in a )?(deeper|higher)|(?:deeper|lower|higher) (?:voice|pitch))(?: voice| pitch)?$/.test(t)) return { k: "pitch", d: /higher|up/.test(t) ? 1 : -1 };
    if (/^(?:reset|default|normal) (?:the )?(?:voice|voice settings|speech)(?: settings)?$/.test(t)) return { k: "reset", d: 0 };
    return null;
  }, (m, c) => {
    const V = c.voice;
    if (!V) return c.say("Voice tuning isn't available in this browser.");
    if (m.k === "reset") { V.reset(); return c.say("Voice settings are back to normal."); }
    const cur = V.tune({});
    if (m.k === "rate") { const r = V.tune({ rate: cur.rate + m.d * 0.15 }).rate; return c.say(m.d > 0 ? (r >= 1.4 ? "That's my fastest." : "Speaking faster.") : (r <= 0.8 ? "That's my slowest." : "Speaking slower.")); }
    if (m.k === "volume") { const v = V.tune({ volume: cur.volume + m.d * 0.25 }).volume; return c.say(m.d > 0 ? (v >= 1 ? "That's full volume." : "Louder.") : "Softer."); }
    V.tune({ pitch: cur.pitch + m.d * 0.12 });
    return c.say(m.d > 0 ? "A higher voice." : "A deeper voice.");
  });
  add("voice-list", (t) => /^(?:(?:what|which|list|show)(?: me)?(?: all)?(?: the)? voices?(?: do you have| are there| can you (?:use|do))?|list (?:all )?(?:the )?voices|how many voices(?: do you have)?|voices|(?:kaun si|konsi) (?:awaaz|voices?) (?:hain|hai))$/.test(t),
    (m, c) => {
      const V = c.voice;
      if (!V) return c.say("Voice personalities aren't available in this browser.");
      const names = V.list().map((p) => p.name.replace("-style", ""));
      return c.say("I have " + names.length + " voice personalities: " + names.join(", ") + ". Say \"change voice to\" and a name, an accent, or male or female. Right now I'm " + V.describe() + ".");
    });
  add("voice-set", (t) => {
    if (/^(?:change|switch|next|another|different|new)(?: to)? (?:the |your )?(?:voice|persona|personality)$/.test(t)) return null; // handled by voice-next
    let m = t.match(new RegExp("^(?:change|switch|set|use|try|give me|talk (?:to me )?(?:in|with|like)|speak (?:in|with|like)|sound like|bolo|ab)\\s+(?:to |your |the |a |an |my |me )*(.*?)\\s*(?:" + VOICE_WORD + "|accent|style|voice|tone)?(?: please)?$"));
    if (m && /\b(?:voice|accent|awaaz|siri|male|female|man|woman|british|american|australian|indian|robot|deep)\b/.test(t) && !/\b(?:mode|language|theme|urdu|hindi|english)\b/.test(t)) return { q: t };
    if (/^(?:use|enable|switch to|change to) (?:the )?(?:siri|apple)(?: voice| style)?$/.test(t)) return { q: "siri" };
    if (/^(?:(?:a )?(?:british|american|australian|indian|male|female|deep|robotic?) (?:male |female )?(?:voice|accent))$/.test(t)) return { q: t };
    return null;
  }, (m, c) => {
    const V = c.voice;
    if (!V) return c.say("Voice personalities aren't available in this browser.");
    const p = V.find(m.q);
    if (!p) return c.say("I couldn't match that voice. Try \"British male\", \"Australian female\", \"deep voice\", or a name like Aria or Oliver.");
    V.set(p.id);
    V.preview(p.id);
    return null; // the preview line is the confirmation, spoken in the new voice
  });
  add("voice-next", (t) => /^(?:(?:change|switch|next|another|different|new) (?:your )?(?:voice|persona|personality)|(?:change|switch) (?:the )?voice|awaaz badlo|voice badlo|آواز بدلو)$/.test(t),
    (m, c) => {
      const V = c.voice;
      if (!V) return c.say("Voice personalities aren't available in this browser.");
      const p = V.cycle(1);
      V.preview(p.id);
      return null;
    });
  add("say", (t) => { const m = t.match(/^(?:say|speak|repeat after me|bolo|kaho)\s+["']?(.{1,140}?)["']?$/); return m && !/^(?:it|that|again|louder|softer|faster|slower)\b/.test(m[1]) ? { text: m[1] } : null; },
    (m, c) => c.say(cap(m.text) + (/[.!?]$/.test(m.text) ? "" : ".")));

  // ---- stopwatch (counts in the browser; survives chat clears, not page reloads)
  const SW = { start: 0, laps: [], run: false, acc: 0 };
  const swNow = () => SW.acc + (SW.run ? Date.now() - SW.start : 0);
  const fmt = (ms) => { const s = ms / 1000, m = Math.floor(s / 60); return (m ? m + " minute" + (m === 1 ? "" : "s") + " " : "") + (s - m * 60).toFixed(1) + " seconds"; };
  add("stopwatch", (t) => {
    if (/^(?:start|begin|run) (?:the |a )?stop ?watch$|^stop ?watch(?: start)?$/.test(t)) return { a: "start" };
    if (/^(?:stop|pause|end) (?:the )?stop ?watch$|^stop ?watch (?:stop|pause)$/.test(t)) return { a: "stop" };
    if (/^(?:reset|clear) (?:the )?stop ?watch$/.test(t)) return { a: "reset" };
    if (/^(?:lap|split|mark a lap)$|^stop ?watch lap$/.test(t)) return { a: "lap" };
    if (/^(?:stop ?watch )?(?:time|status|check)(?: stop ?watch)?$/.test(t) && /stop ?watch/.test(t)) return { a: "check" };
    return null;
  }, (m, c) => {
    if (m.a === "start") { if (SW.run) return c.say("The stopwatch is already running: " + fmt(swNow()) + "."); SW.start = Date.now(); SW.run = true; return c.say(SW.acc ? "Resumed." : "Stopwatch started."); }
    if (m.a === "stop") { if (!SW.run) return c.say(SW.acc ? "It's paused at " + fmt(SW.acc) + "." : "The stopwatch isn't running."); SW.acc = swNow(); SW.run = false; return c.say("Stopped at " + fmt(SW.acc) + (SW.laps.length ? ", with " + SW.laps.length + " lap" + (SW.laps.length === 1 ? "" : "s") + "." : ".")); }
    if (m.a === "reset") { SW.acc = 0; SW.run = false; SW.laps = []; return c.say("Stopwatch reset."); }
    if (m.a === "lap") { if (!SW.run) return c.say("Start the stopwatch first."); const now = swNow(), prev = SW.laps.length ? SW.laps[SW.laps.length - 1] : 0; SW.laps.push(now); return c.say("Lap " + SW.laps.length + ": " + fmt(now - prev) + ". Total " + fmt(now) + "."); }
    return c.say(SW.run || SW.acc ? "Stopwatch: " + fmt(swNow()) + (SW.run ? " and running." : ", paused.") : "The stopwatch isn't running.");
  });

  // ---- password generator (crypto-random, never leaves the device)
  function makePassword(n) {
    const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_=+?"];
    const all = sets.join(""), rnd = (k) => { const a = new Uint32Array(1); const lim = Math.floor(4294967296 / k) * k; let v; do { crypto.getRandomValues(a); v = a[0]; } while (v >= lim); return v % k; };
    const out = sets.map((x) => x[rnd(x.length)]);
    while (out.length < n) out.push(all[rnd(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join("");
  }
  add("password", (t) => { const m = t.match(/^(?:generate|make|create|give me|suggest)?\s*(?:a |an )?(?:strong |secure |random )?(?:new )?password(?: (?:of|with|for) (\d{1,2})(?: characters| chars| letters)?)?$|^password (\d{1,2})$/); return m ? { n: Math.max(8, Math.min(64, +(m[1] || m[2] || 16))) } : null; },
    (m, c) => {
      if (!(window.crypto && crypto.getRandomValues)) return c.say("This browser can't generate secure random numbers.");
      const pw = makePassword(m.n);
      c.copy && c.copy(pw);
      return c.say("Here is a " + m.n + "-character password: " + pw + "\nIt's copied to your clipboard and never leaves this device.", { speak: "I made a " + m.n + " character password and copied it. I won't read it out loud." });
    });

  // ---- days until / since a date
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  function parseDate(s) {
    s = s.trim().replace(/(\d)(?:st|nd|rd|th)\b/g, "$1");
    const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fixed = { christmas: [11, 25], "new year": [0, 1], "new years": [0, 1], "new year's": [0, 1], "independence day": [7, 14], "pakistan day": [2, 23], valentines: [1, 14], "valentine's day": [1, 14], halloween: [9, 31] };
    let m, d = null, y = null;
    if (fixed[s]) { d = new Date(today.getFullYear(), fixed[s][0], fixed[s][1]); if (d < today) d.setFullYear(d.getFullYear() + 1); return d; }
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/)) && MONTHS.findIndex((x) => x.startsWith(m[2].slice(0, 3))) >= 0) { d = new Date(m[3] ? +m[3] : today.getFullYear(), MONTHS.findIndex((x) => x.startsWith(m[2].slice(0, 3))), +m[1]); y = m[3]; }
    else if ((m = s.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)) && MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3))) >= 0) { d = new Date(m[3] ? +m[3] : today.getFullYear(), MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3))), +m[2]); y = m[3]; }
    if (d && !y && d < today) d.setFullYear(d.getFullYear() + 1);
    return d && !isNaN(d) ? d : null;
  }
  add("days-until", (t) => { const m = t.match(/^(?:how many days (?:are there |is it |left )?(?:until|till|to|before)|days (?:until|till|to|before|left (?:until|till|to|for)))\s+(.+)$/); return m && parseDate(m[1]) ? { when: m[1] } : null; },
    (m, c) => {
      const d = parseDate(m.when), now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const n = Math.round((d - today) / 86400000);
      const label = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      if (n === 0) return c.say("That's today.");
      return c.say(n > 0 ? n + " day" + (n === 1 ? "" : "s") + " to go until " + label + "." : Math.abs(n) + " day" + (n === -1 ? "" : "s") + " ago: " + label + ".");
    });

  // ---- copy the last answer
  add("copy", (t) => /^(?:copy (?:that|this|it|the (?:last )?(?:answer|reply|response))|copy last (?:answer|reply|response))$/.test(t),
    (m, c) => {
      const text = c.lastReply();
      if (!text) return c.say("There's nothing to copy yet.");
      return Promise.resolve(c.copy ? c.copy(text) : false).then((ok) => c.say(ok ? "Copied to your clipboard." : "Your browser blocked copying. Use the copy button on the message.", { speak: ok ? "Copied." : undefined }));
    });

  // ---- voice mode / language / theme / UI
  add("voice-mode", (t) => /^(?:(?:turn |switch )?(?:on |off )?voice mode(?: on| off)?|(?:start|stop|enable|disable|exit) voice mode|voice mode (?:chalu|band) karo|hands[- ]free(?: mode)?(?: on| off)?)$/.test(t),
    (m, c) => {
      const t = m.t;
      const off = /\boff\b|\bstop\b|\bdisable\b|\bexit\b|\bband\b/.test(t);
      c.setVoiceMode(!off);
      return c.say(off ? "Voice mode off." : "Voice mode on. Just talk to me.");
    });
  add("talk", (t) => /^(?:baat karo|baatein karo|mujh se baat karo|talk to me|let's talk|lets talk|بات کرو|بات چیت کرو|बात करो)$/.test(t),
    (m, c) => { c.setVoiceMode(true); return c.say("I'm listening."); });
  add("language", (t) => /^(?:switch|change|set)?\s*(?:language )?(?:to )?(english|urdu|hindi|اردو|हिन्दी|انگلش|انگریزی)(?: mein| me| mai| میں)?(?: baat karo| bolo| bol| language| speak| mode| میں بات کرو)?$/.test(t) && /(?:switch|change|set|language|baat|bolo|speak|mode|mein|me |mai|میں|^urdu$|^hindi$|^english$)/.test(t),
    (m, c) => {
      const k = Object.keys(LANGS).find((x) => m.t.includes(x));
      const code = LANGS[k];
      c.setLang(code);
      return c.say("Okay, I will listen in " + LANG_NAME[code] + ".");
    });
  add("theme", (t) => /\b(?:theme|colou?r|accent)\b/.test(t) && THEMES.some((x) => t.includes(x)) || /^(?:go |turn )?(?:cyan|blue|green|red|amber|purple|pink) (?:mode|theme)$/.test(t),
    (m, c) => { const k = THEMES.find((x) => m.t.includes(x)); c.setTheme(k); return c.say(cap(k) + " theme applied."); });
  add("focus", (t) => /^(?:focus mode (?:on|off|chalu karo|band karo)|focus (?:on|off)|focus mode|(?:enter|exit|leave|toggle) focus(?: mode)?|hide panels|show panels|hide (?:the )?sidebars?|show (?:the )?sidebars?|minimal mode|clean mode)$/.test(t),
    (m, c) => { const on = /\b(?:off|band)\b/.test(m.t) || /^(?:exit|leave|show)/.test(m.t) ? false : /^(?:focus|enter|hide|minimal|clean)/.test(m.t) ? true : undefined; const v = c.toggleFocus(on); return c.say(v ? "Focus mode on." : "Panels are back."); });
  add("fullscreen", (t) => /^(?:full ?screen|go full ?screen|enter full ?screen|exit full ?screen|leave full ?screen|fullscreen off)$/.test(t),
    async (m, c) => {
      try {
        if (/exit|leave|off/.test(m.t)) { if (document.fullscreenElement) await document.exitFullscreen(); return c.say("Exited full screen."); }
        await document.documentElement.requestFullscreen(); return c.say("Full screen.");
      } catch { return c.say("Your browser blocked full screen."); }
    });
  add("clear", (t) => /^(?:clear(?: the)? (?:chat|conversation|screen)|new (?:chat|conversation)|start over|reset(?: chat)?|chat clear karo|chat (?:saaf|saf|clear|delete) (?:karo|kar do)|naya chat)$/.test(t),
    (m, c) => { c.clearChat(); return null; });

  // ---- time & date
  add("date", (t) => /^(?:(?:aaj (?:ki )?)?(?:date|tareekh|tarikh)(?: kya (?:hai|he))?(?: (?:batao|bata do))?|aaj (?:kya |kon ?sa |kaun sa )?din (?:hai|he)|what(?:'s| is)? (?:the )?(?:date|day)(?: is it)?(?: today)?|(?:today'?s|todays) date|what day is it|which day is it|date|day|aaj (?:kya )?(?:tareekh|tarikh|date|din) (?:hai|he)|aaj kon sa din hai|aaj ki tareekh|آج کی تاریخ|آج کون سا دن)$/.test(t),
    (m, c) => c.say("Today is " + new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + "."));
  add("time", (t) => /^(?:what(?:'s| is)? (?:the )?(?:current )?time(?: is it| now)?(?: right now)?|what time is it(?: now)?|(?:current )?time(?: now)?|tell me the time|time (?:kya|kitna) (?:hai|hua hai|hua)|abhi (?:kya )?(?:time|waqt) (?:hai|hua hai)|(?:abhi )?(?:time|waqt) (?:batao|bata do)|(?:abhi )?(?:time|waqt) kya (?:hai|he|hua hai)|kitne baje hain?|ٹائم کیا ہوا ہے|ٹائم کیا ہے|ابھی کیا وقت ہوا ہے|कितने बजे हैं|समय क्या हुआ है)$/.test(t),
    (m, c) => c.say("It is " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "."));
  add("zone-time", (t) => /^(?:what(?:'s| is)? (?:the )?)?(?:current )?time (?:in|at) ([a-z ]+?)(?: right now| now| today)?$/.test(t),
    (m, c) => {
      const city = (m.t.match(/time (?:in|at) ([a-z ]+?)(?: right now| now| today)?$/) || [])[1];
      const tz = ZONES[city];
      if (!tz) return c.say("I don't know that city's time zone yet. Try a major city like London, Dubai or Tokyo.");
      const now = new Date().toLocaleTimeString([], { timeZone: tz, hour: "numeric", minute: "2-digit", weekday: "short" });
      return c.say("In " + cap(city) + " it is " + now + ".");
    });

  // ---- open sites
  const OPEN_PRE = "(?:open|launch|go to|goto|visit|take me to|start|show me|kholo|khol do|khol|chalao|kholen|کھولو|کھول دو|खोलो)";
  const OPEN_POST = "(?:kholo|khol do|khol|chalao|open karo|open kar do|kholiye|kholen|کھولو|کھول دو|کھولیں|खोलो|खोल दो)";
  function openTarget(t) {
    let m = t.match(rx("^" + OPEN_PRE + "\\s+(.+)$"));
    if (!m) m = t.match(rx("^(.+?)\\s+" + OPEN_POST + "$"));
    return m ? m[1].replace(/\s+(?:for me|ko|pe|par)$/, "").trim() : null;
  }
  add("open", (t) => { const n = openTarget(t); return n && findSite(n) ? { name: n } : null; },
    (m, c) => {
      const url = findSite(m.name);
      c.open(url);
      return c.say("Opening " + m.name.replace(/^(?:the|my|a)\s+/, "") + ".");
    });

  // ---- search
  add("search", (t) => {
    let m = t.match(/^(?:search|find|look up|lookup)(?: for)? (.+?) (?:on|in|at) (google|youtube|wikipedia|maps|google maps|amazon|images|google images|news|daraz|yt|wiki)$/);
    if (m) return { q: m[1], site: siteKey(m[2].replace("google images", "images")) };
    m = t.match(/^(?:search|google|bing)(?: for)? (.+)$/);
    if (m && /^google /.test(t)) return { q: m[1], site: "google" };
    m = t.match(/^(?:youtube|yt) (?:search|for) (.+)$/);
    if (m) return { q: m[1], site: "youtube" };
    m = t.match(/^(?:play|watch) (.+?)(?: on (?:youtube|yt))?$/);
    if (m && !/\b(?:spotify|netflix)\b/.test(t)) return { q: m[1], site: "youtube" };
    m = t.match(/^(.+?) (?:chalao|chala do|laga do|lagao|bajao|baja do)$/);
    if (m && !/\b(?:timer|alarm|voice|mode|stopwatch|focus)\b/.test(m[1])) return { q: m[1], site: "youtube" };
    m = t.match(/^(?:play|watch) (.+) (?:on youtube|youtube par|youtube pe)$/);
    if (m) return { q: m[1], site: "youtube" };
    m = t.match(/^(.+?) (?:google karo|google kar do|google search karo|search karo|search kar do|dhoondo|dhundo|سرچ کرو|گوگل کرو)$/);
    if (m) return { q: m[1], site: "google" };
    m = t.match(/^(?:directions?|route|rasta|raasta)(?: from)? (.+?) (?:to|se) (.+)$/) || t.match(/^(.+?) (?:to|se) (.+?) (?:directions?|ka rasta|ka raasta|ka route|tak ka rasta)$/);
    if (m) return { q: m[1] + " to " + m[2], site: "maps", dir: true };
    m = t.match(/^(?:directions? to|navigate to|route to|how (?:do i|to) get to|map of) (.+)$/);
    if (m) return { q: m[1], site: "maps", dir: /direction|navigate|route|get to/.test(t) };
    return null;
  }, (m, c) => {
    const q = m.q.trim();
    if (!q) return c.say("What should I search for?");
    c.open(SEARCH[m.site](q));
    return c.say((m.site === "maps" ? "Showing " : "Searching ") + (m.site === "google" ? "Google" : cap(m.site)) + " for " + q + ".");
  });

  // ---- timers
  add("timer-cancel", (t) => /^(?:cancel|stop|clear|delete|remove|turn off|band karo|ruk ja(?:o)?)(?: (?:the|my|all))?(?: timers?| alarms?| reminders?)$|^(?:timer|alarm) (?:cancel|band|stop)(?: karo| kar do)?$/.test(t),
    (m, c) => {
      if (!timers.length) return c.say("No timers are running.");
      const n = timers.length;
      timers.splice(0).forEach((x) => clearTimeout(x.h));
      return c.say(n === 1 ? "Timer cancelled." : n + " timers cancelled.");
    });
  add("timer-left", (t) => /^(?:how much time(?: is)? (?:is )?left|time left|how long (?:is )?left|(?:timer|alarm) (?:status|left)|kitna (?:time|waqt) (?:reh gaya|baqi hai|bacha hai))$/.test(t),
    (m, c) => {
      if (!timers.length) return c.say("No timers are running.");
      return c.say(timers.map((x) => fmtDur(x.end - Date.now()) + " left" + (x.label ? " for " + x.label : "")).join(". ") + ".");
    });
  add("timer-set", (t) => {
    if (!/\b(?:timer|alarm|remind|reminder|countdown|stopwatch)\b|(?:ka|ki|ke liye) (?:timer|alarm)|ٹائمر|الارم/.test(t)) return null;
    const ms = parseDuration(t);
    if (!ms || ms > 86400000) return ms > 86400000 ? { err: "I can set timers up to 24 hours." } : null;
    const lab = (t.match(/(?:to|for the|about|ke liye)\s+(?!\d)(.+)$/) || [])[1] || "";
    return { ms, label: /remind/.test(t) ? lab.replace(/^(?:to\s+)/, "") : "" };
  }, (m, c) => {
    if (m.err) return c.say(m.err);
    const id = ++timerId;
    const x = { id, end: Date.now() + m.ms, label: m.label };
    x.h = setTimeout(() => {
      const i = timers.indexOf(x);
      if (i >= 0) timers.splice(i, 1);
      c.alert(x.label ? "Reminder: " + x.label : "Your " + fmtDur(m.ms) + " timer is done.");
    }, m.ms);
    timers.push(x);
    return c.say("Timer set for " + fmtDur(m.ms) + (m.label ? ", I'll remind you " + m.label : "") + ".");
  });

  // ---- notes
  add("note-add", (t) => { const m = t.match(/^(?:take|make|write|add|save|jot)(?: down)? (?:a )?note(?: that| to| of)?[: ]+(.+)$/) || t.match(/^note(?: karo| kar lo)?[: ]+(.+)$/) || t.match(/^(.+?) (?:note karo|note kar lo|note kar do|نوٹ کرو)$/); return m ? { text: m[1] } : null; },
    (m, c) => { const n = notes.get(); n.push({ t: Date.now(), text: m.text }); notes.set(n); return c.say("Noted: " + m.text); });
  add("note-list", (t) => /^(?:show|read|list|what are|open)?\s*(?:me )?(?:my )?(?:all )?notes$/.test(t) || /^(?:mere |meri )?notes? (?:dikhao|dikha do|batao|sunao|parho)$/.test(t),
    (m, c) => {
      const n = notes.get();
      if (!n.length) return c.say("You have no notes yet.");
      return c.say("Your notes:\n" + n.map((x, i) => `${i + 1}. ${x.text}`).join("\n"), { speak: n.slice(-3).map((x) => x.text).join(". ") });
    });
  add("note-clear", (t) => /^(?:clear|delete|erase|remove) (?:all )?(?:my )?notes$/.test(t), (m, c) => { notes.set([]); return c.say("All notes cleared."); });

  // ---- weather & device status
  add("weather", (t) => /^(?:what(?:'s| is) the )?(?:weather|temperature|mausam|موسم|मौसम)(?: (?:like|today|now|right now|kaisa hai|kaisa|kya hai|batao|bata do|dikhao))?$/.test(t) ||
    /^(?:what(?:'s| is) the )?(?:weather|temperature) (?:in|at|for) .+$/.test(t) || /^(.+?) (?:ka|ki) (?:mausam|weather)(?: kaisa hai| kya hai)?$/.test(t),
    async (m, c) => {
      const city = (m.t.match(/(?:in|at|for) ([a-z ,]+?)(?: today| now)?$/) || m.t.match(/^(.+?) (?:ka|ki) (?:mausam|weather)/) || [])[1];
      if (!c.hud) return c.say("The weather widget isn't available here.");
      if (city) return c.say(await c.hud.setCity(city.trim()));
      return c.say(c.hud.weatherSummary());
    }, { offlineOnly: false });
  add("status", (t) => /^(?:system|device|pc|computer)? ?status|^(?:how(?:'s| is) (?:my )?(?:battery|network|internet|connection|system|device|computer|pc))|^battery (?:kitni|kitna|kya) (?:hai|he)|^(?:battery|network|internet speed|system health|battery level|check (?:my )?(?:battery|system|status))$/.test(t),
    (m, c) => c.say(c.hud ? c.hud.statusLine() : "No device data available."));

  // ---- fun
  add("coin", (t) => /^(?:flip|toss) a coin$|^(?:coin|sikka) (?:flip|toss|uchalo)$|^heads or tails$/.test(t), (m, c) => c.say(pick(["Heads.", "Tails."])));
  add("dice", (t) => /^(?:roll|throw) (?:a |the )?(?:dice|die)$|^dice$/.test(t), (m, c) => c.say("You rolled a " + (1 + Math.floor(Math.random() * 6)) + "."));
  add("random", (t) => /^(?:pick |give me )?(?:a )?random number(?: between (\d+) (?:and|to) (\d+))?$/.test(t) || /^random (\d+) (?:to|and) (\d+)$/.test(t),
    (m, c) => {
      const g = m.t.match(/(\d+)\D+(\d+)/);
      const lo = g ? Math.min(+g[1], +g[2]) : 1, hi = g ? Math.max(+g[1], +g[2]) : 100;
      return c.say("Your number is " + (lo + Math.floor(Math.random() * (hi - lo + 1))) + ".");
    });

  // ---- units & math
  add("convert", (t) => { const m = t.match(/^(?:convert )?(-?\d+(?:\.\d+)?)\s*([a-z°]+)\s+(?:to|in|into)\s+([a-z°]+)$/); return m && convert(+m[1], m[2], m[3]) ? { n: +m[1], a: m[2], b: m[3] } : null; },
    (m, c) => c.say(convert(m.n, m.a, m.b)));
  add("math", (t) => {
    let e = t.replace(/^(?:calculate|calc|compute|solve|evaluate|what(?:'s| is)|whats|how much is|hisab|hisaab|حساب)\s+/, "").replace(/\s*(?:equals?|kitna hota hai|kitne hote hain|=)\s*\??$/, "");
    e = e.replace(/^(\d+(?:\.\d+)?) ka (\d+(?:\.\d+)?) ?(?:percent|%)$/, "$2% of $1");
    e = wordsToDigits(e);
    if (!/[+\-*/%^x×÷]|\b(?:plus|minus|times|divided|percent|squared|cubed|sqrt|square root|multiplied|into|over|power|mod)\b/.test(e)) return null;
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(e)) return null; // looks like a date
    const v = calc(e);
    return v === null ? null : { e, v };
  }, (m, c) => c.say(m.v));

  // ---- friendly one-liners, only when there is no AI server (otherwise the AI answers in character)
  add("hello", (t) => /^(?:hi|hello|hey|salam|salaam|assalam o alaikum|assalamu alaikum|as-salamu alaykum|namaste|good morning|good evening|سلام|السلام علیکم|नमस्ते)$/.test(t),
    (m, c) => c.say(pick(["Hello! How can I help?", "Hi there. What do you need?", "At your service."])), { offlineOnly: true });
  add("thanks", (t) => /^(?:thanks|thank you|thank u|shukriya|shukria|شکریہ|धन्यवाद)$/.test(t),
    (m, c) => c.say(pick(["Anytime.", "My pleasure.", "Happy to help."])), { offlineOnly: true });
  add("howru", (t) => /^(?:how are you(?: doing)?|how's it going|kaise ho|kese ho|kaisay ho|aap kaise hain|kya haal hai|kya hal hai|کیسے ہو|آپ کیسے ہیں|कैसे हो)$/.test(t),
    (m, c) => c.say(pick(["Running smoothly, thanks for asking. What can I do for you?", "All systems fine. How can I help?"])), { offlineOnly: true });
  add("who", (t) => /^(?:who are you|what(?:'s| is) your name|tum kaun ho|aap kaun hain|آپ کون ہیں)$/.test(t),
    (m, c) => c.say("I'm Aegis, your personal AI assistant."), { offlineOnly: true });

  // ------------------------------------------------------------------ public API
  function match(text, opts) {
    const raw = String(text || "").trim();
    if (!raw || raw.length > 200) return null;
    const t = norm(raw);
    if (!t) return null;
    const online = !!(opts && opts.online);
    for (const cmd of C) {
      if (cmd.offlineOnly && online) continue;
      let r;
      try { r = cmd.test(t); } catch { r = null; }
      if (!r) continue;
      const m = Object.assign({ t }, typeof r === "object" ? r : {});
      return { name: cmd.name, run: (ctx) => Promise.resolve(cmd.run(m, ctx)) };
    }
    return null;
  }

  window.AegisCommands = { match, norm, calc, convert, parseDuration, HELP, THEMES };
})();
