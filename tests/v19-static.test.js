// v19: voice shortcuts, browser mode and the feedback thumbs (static checks, no browser needed)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const read = (f) => fs.readFileSync(__dirname + "/../" + f, "utf8");

test("learning.js is loaded by the app and served by the server", () => {
  assert.match(read("app.html"), /<script src="learning\.js"><\/script>/);
  assert.match(read("server/app/settings.py"), /"learning\.js"/);
});

test("browser mode: page-level commands step aside when a browser is linked", () => {
  const w = read("webctl.js");
  for (const n of ["wc-scroll", "wc-back", "wc-click", "wc-type", "wc-key"]) assert.ok(w.includes(`"${n}"`), n);
  assert.match(w, /REMOTE_NAMES\.has\(e\.name\) && remote\(\)/);
  assert.match(w, /wc-mode-on/);
  assert.match(w, /wc-mode-off/);
});

test("AegisApp exposes the token, API base and send for webctl.js and learning.js", () => {
  const a = read("app.js");
  assert.match(a, /get token\(\) \{ return token; \},\n\s+send:/);
  assert.match(a, /type: "feedback"/);
  assert.match(a, /case "feedback_ok"/);
});

test("extension has the media and badge tools and the focused-field fallback", () => {
  const { createTools, PAGE } = require("../extension/tools.js");
  assert.equal(typeof PAGE.media, "function");
  assert.equal(typeof PAGE.badges, "function");
  const { tools } = createTools({}, {});
  assert.equal(typeof tools.chrome_media, "function");
  assert.match(PAGE.resolve.toString(), /document\.activeElement/);
});
