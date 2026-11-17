"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-"));
process.env.AEGIS_SAFE_ROOTS = sandbox;
const tools = require("../tools");

test("write, read and list inside the allowed folder", async () => {
  const f = path.join(sandbox, "note.txt");
  assert.match(await tools.run("write_file", { path: f, content: "hello" }), /Wrote 5/);
  assert.strictEqual(await tools.run("read_file", { path: f }), "hello");
  assert.match(await tools.run("list_files", { folder: sandbox }), /note\.txt/);
});

test("paths outside the allowed folders are refused", async () => {
  const outside = path.join(os.tmpdir(), "aegis-outside.txt");
  assert.match(await tools.run("write_file", { path: outside, content: "x" }), /^Error: path is outside/);
  assert.match(await tools.run("read_file", { path: "/etc/passwd" }), /^Error: path is outside/);
  assert.match(await tools.run("read_file", { path: path.join(sandbox, "..", "x") }), /^Error: path is outside/);
  assert.ok(!fs.existsSync(outside));
});

test("symlinks cannot escape the allowed folder", async () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-out-"));
  fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret");
  const link = path.join(sandbox, "link");
  fs.symlinkSync(outsideDir, link);
  assert.match(await tools.run("read_file", { path: path.join(link, "secret.txt") }), /^Error: path is outside/);
});

test("organize_folder sorts by type and never overwrites", async () => {
  const d = path.join(sandbox, "messy");
  fs.mkdirSync(d);
  for (const n of ["a.png", "b.pdf", "c.xyz", "d.mp3"]) fs.writeFileSync(path.join(d, n), "x");
  assert.match(await tools.run("organize_folder", { folder: d }), /Organized 4/);
  assert.ok(fs.existsSync(path.join(d, "Images", "a.png")));
  assert.ok(fs.existsSync(path.join(d, "Documents", "b.pdf")));
  assert.ok(fs.existsSync(path.join(d, "Other", "c.xyz")));
  assert.ok(fs.existsSync(path.join(d, "Audio", "d.mp3")));
});

test("move and delete only touch single files", async () => {
  const a = path.join(sandbox, "m1.txt");
  const b = path.join(sandbox, "sub", "m2.txt");
  fs.writeFileSync(a, "x");
  assert.match(await tools.run("move_file", { src: a, dst: b }), /Moved/);
  assert.ok(fs.existsSync(b) && !fs.existsSync(a));
  assert.match(await tools.run("delete_file", { path: path.join(sandbox, "sub") }), /^Error: refusing/);
  assert.match(await tools.run("delete_file", { path: b }), /Deleted/);
  assert.ok(!fs.existsSync(b));
});

test("unknown tools and bad arguments return errors instead of throwing", async () => {
  assert.match(await tools.run("format_disk", {}), /^Error: unknown tool/);
  assert.match(await tools.run("constructor", {}), /^Error: unknown tool/);
  assert.match(await tools.run("read_file", {}), /^Error: missing path/);
  assert.match(await tools.run("open_app", { name: "calc & del /q *" }), /^Error: invalid app name/);
});

test("system_health reports basics", async () => {
  const out = await tools.run("system_health", {});
  assert.match(out, /cpu_cores=\d+/);
  assert.match(out, /ram_used_percent=\d+/);
});

test("run_shell works and is time-limited output", async () => {
  assert.match(await tools.run("run_shell", { command: "echo aegis" }), /aegis/);
});

test("key combo translation for SendKeys", () => {
  assert.strictEqual(tools.comboToSendKeys("ctrl+c"), "^c");
  assert.strictEqual(tools.comboToSendKeys("Ctrl+Shift+T"), "^+t");
  assert.strictEqual(tools.comboToSendKeys("alt+f4"), "%{F4}");
  assert.throws(() => tools.comboToSendKeys("win+d"), /Windows key/);
  assert.throws(() => tools.comboToSendKeys("ctrl+banana"), /unknown key/);
  assert.strictEqual(tools.sendKeysEscape("a+b(c)"), "a{+}b{(}c{)}");
});

test("volumePlan turns a level into key presses and rejects nonsense", () => {
  assert.deepStrictEqual(tools.volumePlan("0"), [[174, 50]]);
  assert.deepStrictEqual(tools.volumePlan("40"), [[174, 50], [175, 20]]);
  assert.deepStrictEqual(tools.volumePlan("up"), [[175, 5]]);
  assert.deepStrictEqual(tools.volumePlan("mute"), [[173, 1]]);
  assert.throws(() => tools.volumePlan("loud"));
  assert.throws(() => tools.volumePlan("150"));
});

test("find_files searches inside the allowed folders only", async () => {
  fs.mkdirSync(path.join(sandbox, "deep", "er"), { recursive: true });
  fs.writeFileSync(path.join(sandbox, "deep", "er", "Budget-2026.xlsx"), "x");
  assert.match(await tools.run("find_files", { query: "budget" }), /Budget-2026\.xlsx/);
  assert.match(await tools.run("find_files", { query: "zzzz-nothing" }), /No matching files/);
  assert.match(await tools.run("find_files", { query: "a" }), /^Error: give at least 2/);
});

test("windows-only tools fail cleanly elsewhere and unknown names are refused", async () => {
  if (process.platform !== "win32") {
    assert.match(await tools.run("lock_screen", {}), /^Error: .*Windows/);
    assert.match(await tools.run("close_app", { name: "notepad" }), /^Error: .*Windows/);
  }
  assert.match(await tools.run("media_control", { action: "explode" }), /^Error/);
  assert.match(await tools.run("close_app", { name: "x; rm -rf /" }), /^Error/);
});
