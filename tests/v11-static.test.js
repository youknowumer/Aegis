"use strict";
// v11 wiring checks that need no browser: every id account.js uses exists, the file is served and loaded, slash commands exist.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("account.js: every element id it uses is in app.html", () => {
  const js = read("account.js"), html = read("app.html");
  const ids = [...js.matchAll(/\$\("([a-z0-9-]+)"\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 8);
  for (const id of new Set(ids)) assert.ok(html.includes(`id="${id}"`), "missing #" + id);
});

test("account.js is loaded by app.html and served by the server", () => {
  assert.ok(read("app.html").includes('<script src="account.js"></script>'));
  assert.match(read("server/app/settings.py"), /"account\.js"/);
});

test("every script app.html loads is in the server's served-files list", () => {
  const served = new Set([...read("server/app/settings.py").match(/WEB_FILES = \(([\s\S]*?)\n\)/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  for (const m of read("app.html").matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)) assert.ok(served.has(m[1]), m[1] + " is not served");
});

test("app.js hands account.js what it needs", () => {
  const js = read("app.js");
  for (const k of ["getToken", "setToken", "logout"]) assert.ok(new RegExp(k + "[:(]").test(js.slice(js.indexOf("window.AegisApp ="))), k);
});

test("new slash commands exist", () => {
  const js = read("features.js");
  for (const c of ["/spent", "/spending", "/habits", "/habit", "/prayer", "/search"]) assert.ok(js.includes(`c: "${c}"`), c);
});

test("portrait phones are no longer blocked by the rotate wall", () => {
  assert.match(read("style.css"), /body\.want-rotate:not\(\.no-rotate\) \.rotate-hint/);
});
