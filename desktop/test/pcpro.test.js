"use strict";
const test = require("node:test");
const assert = require("node:assert");
const p = require("../pcpro");

test("window actions map to key plans and unknown ones are refused", () => {
  assert.deepStrictEqual(p.windowPlan("snap left"), { action: "snap_left", win: "{LEFT}" });
  assert.strictEqual(p.windowPlan("show-desktop").win, "d");
  assert.strictEqual(p.windowPlan("close_window").plain, "%{F4}");
  assert.throws(() => p.windowPlan("format_disk"), /action must be one of/);
  assert.throws(() => p.windowPlan("__proto__"), /action must be one of/);
});

test("win-key script presses and releases in the right order", () => {
  const s = p.winKeyScript(p.windowPlan("new_desktop"));
  const downs = [...s.matchAll(/keybd_event\((\d+),0,0,0\)/g)].map((m) => +m[1]);
  const ups = [...s.matchAll(/keybd_event\((\d+),0,2,0\)/g)].map((m) => +m[1]);
  assert.deepStrictEqual(downs, [0x5b, 0x11, 0x44]); // Win, Ctrl, D
  assert.deepStrictEqual(ups, [0x44, 0x11, 0x5b]);   // released in reverse
});

test("brightness is validated", () => {
  assert.match(p.brightnessScript(40.4), /WmiSetBrightness\(1,40\)/);
  assert.throws(() => p.brightnessScript(101), /0-100/);
  assert.throws(() => p.brightnessScript("x; calc"), /0-100/);
});

test("power plans: restart and shutdown always wait 60 s, cancel exists, junk refused", () => {
  assert.deepStrictEqual(p.powerPlan("shutdown").args, ["/s", "/t", "60"]);
  assert.deepStrictEqual(p.powerPlan("restart").args, ["/r", "/t", "60"]);
  assert.deepStrictEqual(p.powerPlan("cancel").args, ["/a"]);
  assert.throws(() => p.powerPlan("format"), /action must be/);
});

test("process list and battery parsers", () => {
  const csv = '"Name","WS"\r\n"chrome","524288000"\r\n"Code","209715200"\r\n';
  assert.deepStrictEqual(p.parseTopProcesses(csv), ["chrome 500 MB", "Code 200 MB"]);
  assert.strictEqual(p.parseBattery("87,2"), "87%, charging");
  assert.strictEqual(p.parseBattery("55,1"), "55%, on battery");
  assert.match(p.parseBattery(""), /no battery/);
});

test("cpu load from two samples", () => {
  const mk = (idle, busy) => [{ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } }];
  assert.strictEqual(p.cpuLoadPercent(mk(100, 100), mk(150, 150)), 50);
  assert.strictEqual(p.cpuLoadPercent(mk(0, 0), mk(0, 0)), 0);
});

test("tools are registered in tools.js (non-Windows gives a clear error, not a crash)", async () => {
  const tools = require("../tools");
  for (const n of ["window_control", "set_brightness", "power_action"]) {
    const out = await tools.run(n, { action: "sleep", level: 50 });
    assert.match(out, /^Error: .*(only supported on Windows)/);
  }
  assert.match(await tools.run("system_report", {}), /CPU:/);
});
