"use strict";
/**
 * Starts Aegis's own server inside the installed app, so the app works right after install with no deployment.
 *
 *   installed app :  <install>/resources/runtime/python/python.exe   (bundled Python, nothing to install)
 *                    <install>/resources/runtime/site-packages       (the server's libraries)
 *                    <install>/resources/server/app                  (the server)
 *                    <install>/resources/web                         (the website files it serves)
 *   from source   :  desktop/build/...  if `npm run bundle` was run, else Python from PATH and the repo folders
 *
 * The server listens on 127.0.0.1 only (this PC), on a fixed port so your saved login and settings stay put.
 * Data (accounts, memory, notes) lives in the user's app-data folder and survives updates and uninstalls.
 */
const fs = require("fs");
const net = require("net");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const IS_WIN = process.platform === "win32";
const DEFAULT_PORT = 8765;
const HOST = "127.0.0.1";

// ------------------------------------------------------------------ where everything is
function layout(env = process.env, resourcesPath = process.resourcesPath) {
  const pyName = IS_WIN ? "python.exe" : path.join("bin", "python3");
  const candidates = [];
  if (resourcesPath) candidates.push(resourcesPath);                       // installed app
  candidates.push(path.join(__dirname, "build"));                          // `npm run bundle` output
  for (const root of candidates) {
    const python = path.join(root, "runtime", "python", pyName);
    const serverDir = path.join(root, "server");
    const webDir = path.join(root, "web");
    if (fs.existsSync(python) && fs.existsSync(path.join(serverDir, "app", "main.py")) && fs.existsSync(path.join(webDir, "app.html"))) {
      return { python, serverDir, webDir, sitePackages: path.join(root, "runtime", "site-packages"), bundled: true };
    }
  }
  // running from the repo: use the developer's own Python and the repo folders
  const repo = path.resolve(__dirname, "..");
  return { python: env.AEGIS_PYTHON || (IS_WIN ? "python" : "python3"), serverDir: path.join(repo, "server"), webDir: repo, sitePackages: "", bundled: false };
}

// ------------------------------------------------------------------ small helpers
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, HOST);
  });
}

async function pickPort(preferred) {
  const tried = new Set();
  for (const p of [preferred, DEFAULT_PORT, ...Array.from({ length: 30 }, (_, i) => DEFAULT_PORT + 1 + i)]) {
    if (!p || tried.has(p)) continue;
    tried.add(p);
    if (await portFree(p)) return p;
  }
  throw new Error("No free port found for the Aegis server (tried " + DEFAULT_PORT + "-" + (DEFAULT_PORT + 30) + ").");
}

function healthy(port, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: "/healthz", timeout }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => { try { resolve(JSON.parse(body).ok === true); } catch { resolve(false); } });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } }

// ------------------------------------------------------------------ the server process
class LocalServer {
  /**
   * @param {object} o
   * @param {string} o.dataDir   writable folder for the database, logs and settings (Electron's userData)
   * @param {() => string|null} [o.loadSecret]  returns the stored login-signing secret, if any
   * @param {(s: string) => void} [o.saveSecret]
   */
  constructor(o) {
    this.dataDir = o.dataDir;
    this.loadSecret = o.loadSecret || (() => null);
    this.saveSecret = o.saveSecret || (() => {});
    this.layout = o.layout || layout();
    this.child = null;
    this.port = 0;
    this.quitting = false;
    this.restarts = 0;
    this.logFile = path.join(this.dataDir, "logs", "server.log");
  }

  get url() { return `http://${HOST}:${this.port}`; }

  _secret() {
    let s = this.loadSecret();
    if (!s) { s = crypto.randomBytes(32).toString("hex"); this.saveSecret(s); }
    return s;
  }

  _log() {
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    try { if (fs.statSync(this.logFile).size > 2 * 1024 * 1024) fs.renameSync(this.logFile, this.logFile + ".old"); } catch {}
    return fs.openSync(this.logFile, "a");
  }

  async start() {
    if (this.child && (await healthy(this.port))) return this.url;
    const L = this.layout;
    fs.mkdirSync(this.dataDir, { recursive: true });
    const stateFile = path.join(this.dataDir, "local-server.json");
    this.port = await pickPort(readJson(stateFile).port);
    try { fs.writeFileSync(stateFile, JSON.stringify({ port: this.port })); } catch {}

    const sep = path.delimiter;
    const env = {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONPATH: [L.sitePackages, L.serverDir, process.env.PYTHONPATH].filter(Boolean).join(sep),
      AEGIS_DB: path.join(this.dataDir, "aegis.db"),
      AEGIS_WEB_DIR: L.webDir,
      AEGIS_JWT_SECRET: this._secret(),
      AEGIS_ALLOW_LOCAL_PROVIDERS: "1",   // the server runs on this PC, so a local model (Ollama, LM Studio) is reachable
    };
    const logFd = this._log();
    fs.writeSync(logFd, `\n--- ${new Date().toISOString()} starting on port ${this.port} (${L.bundled ? "bundled" : "dev"} Python: ${L.python})\n`);
    const child = spawn(L.python, ["-m", "uvicorn", "app.main:create_app", "--factory", "--host", HOST, "--port", String(this.port), "--log-level", "warning"], {
      cwd: L.serverDir, env, windowsHide: true, stdio: ["ignore", logFd, logFd],
    });
    this.child = child;
    let spawnError = null;
    child.on("error", (e) => { spawnError = e; });
    child.on("exit", (code) => {
      try { fs.closeSync(logFd); } catch {}
      if (this.child === child) this.child = null;
      if (this.quitting) return;
      // unexpected stop: bring it back a few times, then let the window show its "can't start" page
      if (this.restarts++ < 3) setTimeout(() => { if (!this.quitting && !this.child) this.start().catch(() => {}); }, 1500 * this.restarts);
      else this.lastExit = code;
    });

    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {   // a first start on Windows can be slow while antivirus scans the files
      if (spawnError) throw new Error("Could not start the bundled Python: " + spawnError.message);
      if (!this.child) throw new Error("The Aegis server stopped while starting. Details: " + this.logFile);
      if (await healthy(this.port)) { this.restarts = 0; return this.url; }
      await sleep(250);
    }
    this.stop();
    throw new Error("The Aegis server did not start in 60 seconds. Details: " + this.logFile);
  }

  stop() {
    this.quitting = true;
    const c = this.child;
    this.child = null;
    if (!c || c.exitCode !== null) return;
    try {
      if (IS_WIN) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true });
      else c.kill("SIGTERM");
    } catch {}
  }
}

module.exports = { LocalServer, layout, pickPort, healthy, DEFAULT_PORT };
