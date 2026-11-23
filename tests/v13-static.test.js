"use strict";
// v13 wiring checks that need no browser.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("greeting follows up on what they told us, says it missed them and celebrates a closer bond", () => {
  const js = read("app.js");
  assert.match(js, /greetOnce\(m\.brief, m\.bond\)/);
  for (const piece of ["I missed you", "b.callback", "We have grown closer", "aegis_bond_level"]) assert.ok(js.includes(piece), piece);
});

test("feeling strength reaches the voice", () => {
  assert.match(read("app.js"), /window\.AegisFeel = \{ intensity:/);
  assert.match(read("voice.js"), /intensity: \(window\.AegisFeel/);
});

test("memory panel shows when and how it was felt", () => {
  assert.match(read("app.js"), /f\.mood_level >= 2 \? "felt " \+ f\.mood/);
});
