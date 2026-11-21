"use strict";
// End-to-end test of the Chrome tools against a REAL headless Chrome and a local web page.
// Skipped automatically when no Chrome / Chromium is installed.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-br-"));
process.env.AEGIS_SAFE_ROOTS = tmp;
process.env.AEGIS_CHROME_PORT = String(9400 + Math.floor(Math.random() * 400));
process.env.AEGIS_CHROME_PROFILE = path.join(tmp, "profile");
process.env.AEGIS_SHOT_DIR = path.join(tmp, "shots");
process.env.AEGIS_CHROME_HEADLESS = "1";
process.env.AEGIS_CHROME_ARGS = "--no-sandbox --disable-gpu --disable-dev-shm-usage";
const browser = require("../browser");
const tools = require("../tools");
const exe = browser.chromePath();

const PAGE = `<!doctype html><html><head><title>Aegis Test Shop</title></head><body>
<h1>Test Shop</h1>
<p>Welcome to the shop. The secret word is pineapple.</p>
<a href="/two">Go to page two</a>
<form onsubmit="event.preventDefault(); document.getElementById('out').textContent='searched: '+document.getElementById('q').value">
  <label for="q">Search products</label><input id="q" name="q" placeholder="type here">
  <select id="size"><option>Small</option><option>Large</option></select>
  <input id="pw" type="password" placeholder="Password">
  <button id="go" type="submit">Search</button>
</form>
<button id="count" onclick="this.textContent='clicked '+(++window.n)">Counter</button>
<button id="buy" onclick="document.getElementById('out').textContent='BOUGHT'">Buy now</button>
<div id="out"></div><script>window.n=0;</script>
<div style="height:3000px"></div><p id="bottom">The very bottom</p></body></html>`;

let server, base;
test.before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/two") return res.end("<title>Page Two</title><h1>Second page</h1>");
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { browser.shutdown(); server && server.close(); try { process.kill(-0, 0); } catch {} });

const run = (name, args) => tools.run(name, args || {});

test("URL and key rules (no Chrome needed)", () => {
  assert.strictEqual(browser.allowedUrl("example.com"), "https://example.com/");
  assert.strictEqual(browser.allowedUrl("http://localhost:3000/x"), "http://localhost:3000/x");
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "chrome://settings/passwords", "view-source:https://a.com", "chrome-extension://x/y.html"]) assert.throws(() => browser.allowedUrl(bad), /only http|not available/, bad);
  assert.strictEqual(browser.allowedUrl("chrome://history"), "chrome://history");
  assert.deepStrictEqual({ ...browser.parseKeys("ctrl+shift+t") }, { mods: 10, key: "T", code: "KeyT", vk: 84, text: "t" });
  assert.strictEqual(browser.parseKeys("Enter").vk, 13);
  assert.throws(() => browser.parseKeys("hyper+x"), /unknown modifier/);
  assert.throws(() => browser.parseKeys("blah"), /unknown key/);
  assert.ok(browser.SENSITIVE.test("Place order") && browser.SENSITIVE.test("Send message") && browser.SENSITIVE.test("Delete account"));
  assert.ok(!browser.SENSITIVE.test("Search") && !browser.SENSITIVE.test("Next page") && !browser.SENSITIVE.test("Posts"));
});

test("chrome tools are registered in the desktop tool runner", async () => {
  for (const n of ["chrome_tabs", "chrome_open", "chrome_go", "chrome_nav", "chrome_switch", "chrome_close", "chrome_read", "chrome_elements", "chrome_click", "chrome_type", "chrome_key", "chrome_scroll", "chrome_find", "chrome_wait", "chrome_screenshot", "chrome_eval"]) {
    assert.ok(typeof browser.tools[n] === "function", n);
  }
  assert.match(await run("chrome_go", { url: "file:///etc/passwd" }), /^Error: only http/);
});

test("drive a real Chrome: open, read, find, elements, click, type, select, scroll, tabs, screenshot, eval", { skip: !exe && "Chrome not installed", timeout: 120000 }, async () => {
  let r = await run("chrome_open", { url: base + "/" });
  assert.match(r, /Aegis Test Shop/, r);

  r = await run("chrome_tabs"); assert.match(r, /Aegis Test Shop/); assert.match(r, /\*/);
  r = await run("chrome_read"); assert.match(r, /secret word is pineapple/); assert.match(r, /page 1 of 1/);
  r = await run("chrome_find", { text: "pineapple" }); assert.match(r, /Found 1 match/);
  r = await run("chrome_find", { text: "zzz-not-here" }); assert.match(r, /not on this page/);

  r = await run("chrome_elements");
  const els = r;
  assert.match(r, /\[link\] Go to page two/); assert.match(r, /\[input:text\].*placeholder: type here/); assert.match(r, /\[select\].*\{Small \| Large\}/);
  assert.match(r, /\[button\] Counter/);
  const idx = (re) => Number(els.split("\n").find((l) => re.test(l)).split(" ")[0]);

  // clicking by number, by text and by selector; the page really reacts
  assert.match(await run("chrome_click", { index: idx(/\] Counter/) }), /Clicked "Counter"/);
  assert.match(await run("chrome_read"), /clicked 1/);
  assert.match(await run("chrome_click", { text: "clicked 1" }), /Clicked/);
  assert.match(await run("chrome_read"), /clicked 2/);
  assert.match(await run("chrome_click", { selector: "#count" }), /Clicked/);
  assert.match(await run("chrome_read"), /clicked 3/);

  // typing: by field caption, with submit; dropdown by option text
  r = await run("chrome_type", { field: "Search products", text: "red shoes", submit: true });
  assert.match(r, /Typed 9 characters/, r);
  assert.match(await run("chrome_read"), /searched: red shoes/);
  r = await run("chrome_type", { index: idx(/type here/), text: "second" });
  assert.match(r, /Typed 6/);
  assert.match(await run("chrome_eval", { js: "document.getElementById('q').value" }), /^second$/);   // cleared the old text first
  assert.match(await run("chrome_type", { selector: "#size", text: "Large" }), /Chose "Large"/);
  assert.match(await run("chrome_eval", { js: "document.getElementById('size').value" }), /Large/);

  // passwords are never typed
  assert.match(await run("chrome_type", { selector: "#pw", text: "hunter2" }), /^Error: I never type into password fields/);
  assert.match(await run("chrome_eval", { js: "document.getElementById('pw').value.length" }), /^0$/);

  // sensitive click needs approval first; nothing happened; with approved=true it goes through
  r = await run("chrome_click", { text: "Buy now" });
  assert.match(r, /^NEEDS_APPROVAL: .*Buy now/, r);
  assert.doesNotMatch(await run("chrome_read"), /BOUGHT/);
  assert.match(await run("chrome_click", { text: "Buy now", approved: true }), /Clicked "Buy now"/);
  assert.match(await run("chrome_read"), /BOUGHT/);
  assert.match(await run("chrome_key", { keys: "ctrl+enter" }), /^NEEDS_APPROVAL/);
  assert.match(await run("chrome_key", { keys: "Tab" }), /Pressed Tab/);

  // scroll + wait
  assert.match(await run("chrome_scroll", { direction: "bottom" }), /100% down the page \(the end\)/);
  assert.match(await run("chrome_scroll", { direction: "top" }), /0% down/);
  assert.match(await run("chrome_wait", { text: "pineapple", ms: 3000 }), /appeared/);
  assert.match(await run("chrome_wait", { text: "never-appears", ms: 1000 }), /Still not there/);

  // navigation: link click, back, forward, go, reload
  assert.match(await run("chrome_click", { text: "Go to page two" }), /Page Two/);
  assert.match(await run("chrome_read"), /Second page/);
  assert.match(await run("chrome_nav", { action: "back" }), /Aegis Test Shop/);
  assert.match(await run("chrome_nav", { action: "forward" }), /Page Two/);
  assert.match(await run("chrome_go", { url: base + "/" }), /Aegis Test Shop/);
  assert.match(await run("chrome_nav", { action: "reload" }), /Aegis Test Shop/);

  // tabs: open a second, switch by number and by title, close it
  assert.match(await run("chrome_open", { url: base + "/two" }), /Page Two/);
  r = await run("chrome_tabs"); assert.match(r, /Page Two/); assert.match(r, /Aegis Test Shop/);
  assert.match(await run("chrome_switch", { tab: "Test Shop" }), /Aegis Test Shop/);
  assert.match(await run("chrome_read"), /Test Shop/);
  assert.match(await run("chrome_switch", { tab: "page two" }), /Page Two/);
  assert.match(await run("chrome_close", { tab: "page two" }), /Closed/);
  assert.doesNotMatch(await run("chrome_tabs"), /Page Two/);
  assert.match(await run("chrome_read"), /Test Shop/);                      // falls back to the remaining tab

  // screenshot lands on disk as a real PNG
  r = await run("chrome_screenshot", { full_page: true });
  const file = r.match(/saved to (.+)$/)[1];
  assert.ok(fs.statSync(file).size > 1000 && fs.readFileSync(file).slice(1, 4).toString() === "PNG");

  // errors are friendly, never crashes
  assert.match(await run("chrome_click", { text: "this does not exist" }), /^Error: I couldn't find that element/);
  assert.match(await run("chrome_switch", { tab: "99" }), /^Error: there is no tab 99/);
  assert.match(await run("chrome_nav", { action: "teleport" }), /^Error: action must be/);
  assert.match(await run("chrome_eval", { js: "throw new Error('boom')" }), /^Error: .*boom/);
});

test("JavaScript alerts never freeze the tab", { skip: !exe && "Chrome not installed", timeout: 60000 }, async () => {
  await run("chrome_go", { url: base + "/" });
  await run("chrome_eval", { js: "setTimeout(() => alert('hello from page'), 50); 1" });
  await new Promise((r) => setTimeout(r, 400));
  const r = await run("chrome_read");
  assert.match(r, /Test Shop/);
  assert.match(r, /Page dialog handled: alert: hello from page/);
});
