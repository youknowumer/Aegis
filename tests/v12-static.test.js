"use strict";
// v12 wiring checks that need no browser.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("new slash commands exist", () => {
  const js = read("features.js");
  for (const c of ["/review", "/research", "/free", "/status", "/pc"]) assert.ok(js.includes(`c: "${c}"`), c);
});

test("app.js shows proactive alerts and greets once per session", () => {
  const js = read("app.js");
  assert.match(js, /case "alert": alertUser\(m\.text\)/);
  assert.match(js, /greetOnce\(m\.brief, m\.bond\)/);
  assert.match(js, /aegis_greeted/);
});

test("desktop app packages and tests the new PC tools", () => {
  const pkg = JSON.parse(read("desktop/package.json"));
  assert.ok(pkg.build.files.includes("pcpro.js"));
  assert.match(pkg.scripts.test, /pcpro\.test\.js/);
  assert.match(read("desktop/tools.js"), /require\("\.\/pcpro"\)/);
});

test("every desktop tool the server offers exists in the desktop app", () => {
  const py = read("server/app/tools.py");
  const names = [...py.matchAll(/Tool\("([a-z_]+)",[^\n]*?"device"/g)].map((m) => m[1]);
  assert.ok(names.length > 40);
  const impl = [read("desktop/tools.js"), read("desktop/browser.js"), read("desktop/outlook.js"), read("desktop/pcpro.js")].join("\n");
  for (const n of names) assert.ok(new RegExp(`(async\\s+)?${n}\\s*[(:]`).test(impl), "desktop is missing " + n);
});
