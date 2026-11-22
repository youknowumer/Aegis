"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const ls = require("../local-server");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "aegis-ls-test-"));
const hostPython = () => {
  for (const c of [process.env.AEGIS_PYTHON, process.env.VIRTUAL_ENV && path.join(process.env.VIRTUAL_ENV, "bin", "python"), "python3", "python"].filter(Boolean)) {
    if (spawnSync(c, ["-c", "import uvicorn, fastapi, jwt, anthropic"]).status === 0) return c;
  }
  return null;
};

test("layout: with no bundle it falls back to the repo and the developer's Python", () => {
  const L = ls.layout({ AEGIS_PYTHON: "mypy" }, undefined);
  if (L.bundled) return;   // a bundle for this OS exists next to the sources: nothing to check
  assert.equal(L.python, "mypy");
  assert.ok(fs.existsSync(path.join(L.serverDir, "app", "main.py")));
  assert.ok(fs.existsSync(path.join(L.webDir, "app.html")));
});

test("layout: a complete bundle in resources is used", () => {
  const root = tmp();
  const py = path.join(root, "runtime", "python", process.platform === "win32" ? "python.exe" : path.join("bin", "python3"));
  fs.mkdirSync(path.dirname(py), { recursive: true }); fs.writeFileSync(py, "");
  fs.mkdirSync(path.join(root, "server", "app"), { recursive: true }); fs.writeFileSync(path.join(root, "server", "app", "main.py"), "");
  fs.mkdirSync(path.join(root, "web"), { recursive: true }); fs.writeFileSync(path.join(root, "web", "app.html"), "");
  const L = ls.layout({}, root);
  assert.equal(L.bundled, true);
  assert.equal(L.python, py);
  assert.equal(L.sitePackages, path.join(root, "runtime", "site-packages"));
});

test("pickPort skips a busy port", async () => {
  const busy = net.createServer();
  await new Promise((r) => busy.listen(ls.DEFAULT_PORT + 40, "127.0.0.1", r));
  try { assert.notEqual(await ls.pickPort(ls.DEFAULT_PORT + 40), ls.DEFAULT_PORT + 40); }
  finally { busy.close(); }
});

test("the server starts, serves the app, keeps its data in dataDir and stops", { skip: !hostPython() && "no Python with the server libraries" }, async () => {
  const dir = tmp();
  const s = new ls.LocalServer({ dataDir: dir, layout: ls.layout({ AEGIS_PYTHON: hostPython() }, undefined), loadSecret: () => "s".repeat(64) });
  const url = await s.start();
  try {
    const status = await new Promise((resolve) => http.get(url + "/app.html", (res) => { res.resume(); resolve(res.statusCode); }));
    assert.equal(status, 200);
    assert.ok(fs.existsSync(path.join(dir, "aegis.db")), "database goes to the data folder");
    assert.ok(fs.existsSync(path.join(dir, "logs", "server.log")));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "local-server.json"), "utf8")).port, s.port);
  } finally { s.stop(); }
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(await ls.healthy(s.port, 500), false);
});
