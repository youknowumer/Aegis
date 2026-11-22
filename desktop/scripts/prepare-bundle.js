"use strict";
/**
 * Assembles everything the installer ships, into desktop/build/ :
 *
 *   build/runtime/python/         Windows Python (python-build-standalone, includes the VC++ runtime DLLs)
 *   build/runtime/site-packages/  the server's libraries, as Windows wheels
 *   build/server/app/             the Aegis server
 *   build/web/                    the website files the server serves
 *
 * Works on Windows, macOS and Linux (the Windows packages are fetched as Windows wheels, so it cross-builds).
 * Needs: Node 18+, a Python 3.9+ with pip (only to download wheels), `tar` (Windows 10+ has it), internet access to
 * github.com and pypi.org.   Run:  npm run bundle
 *
 * Env: PBS_TAG / PY_VERSION to pick another Python build, AEGIS_BUNDLE_PIP to name the pip's python.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const PBS_TAG = process.env.PBS_TAG || "20261110";
const PY_VERSION = process.env.PY_VERSION || "3.12.16";
const PY_MINOR = PY_VERSION.split(".").slice(0, 2).join("");          // "312"
const ASSET = `cpython-${PY_VERSION}+${PBS_TAG}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`;
const PYTHON_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${ASSET}`;

const DESKTOP = path.resolve(__dirname, "..");
const REPO = path.resolve(DESKTOP, "..");
const BUILD = path.join(DESKTOP, "build");
const CACHE = path.join(BUILD, ".cache");

const log = (m) => console.log("[bundle] " + m);
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

function download(url, dest, redirects = 6) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "aegis-bundle" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (!redirects) return reject(new Error("too many redirects"));
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`download failed (${res.statusCode}): ${url}`)); }
      const tmp = dest + ".part";
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on("finish", () => out.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      out.on("error", reject);
    }).on("error", reject);
  });
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed (exit ${r.status})`);
}

function copyDir(src, dest, skip = () => false) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d, skip); else fs.copyFileSync(s, d);
  }
}

function hostPython() {
  const names = [process.env.AEGIS_BUNDLE_PIP, "python3", "python", "py"].filter(Boolean);
  for (const n of names) {
    const r = spawnSync(n, ["-c", "import pip, sys; print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8" });
    if (r.status === 0) return { cmd: n, version: r.stdout.trim() };
  }
  throw new Error("Python with pip was not found (needed only to download the server's Windows packages).");
}

function dirSize(p) {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size;
  }
  return n;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });

  // 1. website files (the exact list the server serves)
  const settings = fs.readFileSync(path.join(REPO, "server", "app", "settings.py"), "utf8");
  const block = /WEB_FILES\s*=\s*\(([\s\S]*?)\)/.exec(settings);
  if (!block) throw new Error("WEB_FILES not found in server/app/settings.py");
  const files = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  rm(path.join(BUILD, "web"));
  fs.mkdirSync(path.join(BUILD, "web"), { recursive: true });
  for (const f of files) {
    if (!fs.existsSync(path.join(REPO, f))) throw new Error("web file missing: " + f);
    fs.copyFileSync(path.join(REPO, f), path.join(BUILD, "web", f));
  }
  log(`web: ${files.length} files`);

  // 2. the server
  rm(path.join(BUILD, "server"));
  copyDir(path.join(REPO, "server", "app"), path.join(BUILD, "server", "app"), (n) => n === "__pycache__" || n === "tests" || n.endsWith(".pyc"));
  log("server: copied");

  // 3. Python for Windows
  const tarball = path.join(CACHE, ASSET);
  if (!fs.existsSync(tarball)) { log("downloading Python " + PY_VERSION + " for Windows (~22 MB)"); await download(PYTHON_URL, tarball); }
  else log("Python archive cached");
  rm(path.join(BUILD, "runtime"));
  fs.mkdirSync(path.join(BUILD, "runtime"), { recursive: true });
  run("tar", ["-xzf", tarball, "-C", path.join(BUILD, "runtime")]);
  const py = path.join(BUILD, "runtime", "python");
  if (!fs.existsSync(path.join(py, "python.exe"))) throw new Error("python.exe missing after extracting the archive");
  // things the server never uses: tests, IDLE, Tk, pip (the libraries are installed below, from outside the app)
  for (const junk of ["Lib/test", "Lib/idlelib", "Lib/turtledemo", "Lib/lib2to3", "Lib/tkinter", "Lib/ensurepip", "Lib/site-packages",
    "DLLs/_tkinter.pyd", "DLLs/tcl86t.dll", "DLLs/tk86t.dll", "tcl", "include", "libs", "Scripts"]) rm(path.join(py, junk));
  log("python: unpacked and trimmed");

  // 4. the server's libraries, as Windows wheels
  const host = hostPython();
  const sp = path.join(BUILD, "runtime", "site-packages");
  run(host.cmd, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--target", sp,
    "--platform", "win_amd64", "--python-version", PY_VERSION.split(".").slice(0, 2).join("."), "--implementation", "cp", "--abi", "cp" + PY_MINOR,
    "--only-binary=:all:", "--no-compile", "-r", path.join(__dirname, "win-requirements.txt")]);
  for (const junk of ["bin"]) rm(path.join(sp, junk));
  log("site-packages: installed");

  // 5. byte-compile so the first start is quick (only when the host Python is the same minor version: the .pyc format must match)
  if (host.version.replace(".", "") === PY_MINOR) {
    spawnSync(host.cmd, ["-m", "compileall", "-q", "-j", "0", sp, path.join(BUILD, "server")], { stdio: "ignore" });
    log("byte-compiled");
  } else log(`skipped byte-compile (host Python ${host.version} differs from ${PY_VERSION.slice(0, 4)})`);

  // 6. sanity checks: fail the build here, not on the user's laptop
  const must = [
    ["runtime/python/python.exe"], ["runtime/python/python312.dll".replace("312", PY_MINOR)], ["runtime/python/vcruntime140.dll"],
    ["runtime/site-packages/uvicorn/__init__.py"], ["runtime/site-packages/fastapi/__init__.py"], ["runtime/site-packages/websockets/__init__.py"],
    ["runtime/site-packages/jwt/__init__.py"], ["runtime/site-packages/anthropic/__init__.py"], ["runtime/site-packages/tzdata/__init__.py"],
    ["server/app/main.py"], ["web/app.html"], ["web/app.js"],
  ];
  const missing = must.filter(([f]) => !fs.existsSync(path.join(BUILD, f))).map(([f]) => f);
  if (missing.length) throw new Error("bundle is incomplete, missing: " + missing.join(", "));
  const pyds = fs.readdirSync(path.join(sp, "pydantic_core")).filter((f) => f.endsWith(".pyd"));
  if (!pyds.length) throw new Error("pydantic_core has no Windows .pyd (wrong wheel platform)");

  log(`done: ${(dirSize(BUILD) / 1048576 - fs.statSync(tarball).size / 1048576).toFixed(0)} MB in build/`);
}

main().catch((e) => { console.error("[bundle] FAILED: " + e.message); process.exit(1); });
