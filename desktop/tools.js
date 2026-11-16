"use strict";
/**
 * PC-control tools. The server's AI asks for these by name; they run here, on the user's machine.
 * Risky ones (write/move/delete/type/shell) are approved by the user in the web UI before they arrive.
 * Defence in depth: file tools are still restricted to Documents/Desktop/Downloads.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, exec, spawn } = require("child_process");

const IS_WIN = process.platform === "win32";
const HOME = os.homedir();

function safeRoots() {
  const custom = process.env.AEGIS_SAFE_ROOTS; // used by tests
  const list = custom
    ? custom.split(path.delimiter)
    : ["Documents", "Desktop", "Downloads"].map((d) => path.join(HOME, d));
  return list.map((r) => path.resolve(r));
}

function norm(p) {
  return IS_WIN ? p.toLowerCase() : p;
}

function realish(p) {
  // realpath of the deepest existing ancestor, so symlinks cannot escape the roots
  let cur = p;
  const tail = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  let base = cur;
  try { base = fs.realpathSync(cur); } catch {}
  return path.join(base, ...tail);
}

function safePath(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("missing path");
  let p = input.trim().replace(/^~(?=$|[\\/])/, HOME);
  if (!path.isAbsolute(p)) p = path.join(HOME, "Documents", p);
  const full = realish(path.resolve(p));
  for (const root of safeRoots()) {
    const r = norm(realish(root));
    const f = norm(full);
    if (f === r || f.startsWith(r + path.sep)) return full;
  }
  throw new Error("path is outside the allowed folders (Documents, Desktop, Downloads)");
}

const GROUPS = {
  Images: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"],
  Documents: [".pdf", ".doc", ".docx", ".txt", ".xls", ".xlsx", ".ppt", ".pptx", ".csv"],
  Videos: [".mp4", ".mkv", ".mov", ".avi"],
  Audio: [".mp3", ".wav", ".flac", ".m4a"],
  Archives: [".zip", ".rar", ".7z", ".tar", ".gz"],
};

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim().slice(0, 500)));
      else resolve(stdout.toString().trim());
    });
  });
}

// SendKeys needs these characters wrapped in braces to be typed literally.
function sendKeysEscape(text) {
  return text.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`);
}
function powershellSendKeys(keys) {
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    `[System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')`;
  return run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

const NAMED_KEYS = {
  enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}", backspace: "{BACKSPACE}",
  delete: "{DELETE}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
  home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}", space: " ",
  f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}", f6: "{F6}",
  f7: "{F7}", f8: "{F8}", f9: "{F9}", f10: "{F10}", f11: "{F11}", f12: "{F12}",
};
function comboToSendKeys(combo) {
  const parts = String(combo).toLowerCase().split("+").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("empty key combination");
  let prefix = "";
  let key = "";
  for (const p of parts) {
    if (p === "ctrl" || p === "control") prefix += "^";
    else if (p === "alt") prefix += "%";
    else if (p === "shift") prefix += "+";
    else if (p === "win" || p === "windows" || p === "cmd") throw new Error("the Windows key is not supported");
    else if (key) throw new Error("only one non-modifier key is allowed");
    else key = NAMED_KEYS[p] || (p.length === 1 ? sendKeysEscape(p) : null);
    if (key === null) throw new Error(`unknown key: ${p}`);
  }
  if (!key) throw new Error("no key given");
  return prefix + key;
}

const impl = {
  async open_app({ name }) {
    if (typeof name !== "string" || !/^[\w .+()-]{1,60}$/.test(name.trim())) {
      throw new Error("invalid app name");
    }
    if (!IS_WIN) throw new Error("open_app is only supported on Windows");
    const child = spawn("cmd", ["/c", "start", "", name.trim()], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return `Opened ${name.trim()}`;
  },

  async open_url({ url }) {
    const { shell } = require("electron");
    let u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const parsed = new URL(u); // throws on garbage
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("only http(s) links are allowed");
    await shell.openExternal(parsed.toString());
    return `Opened ${parsed.toString()}`;
  },

  async web_search({ query }) {
    const { shell } = require("electron");
    if (!String(query || "").trim()) throw new Error("empty query");
    await shell.openExternal("https://www.google.com/search?q=" + encodeURIComponent(query));
    return `Searching the web for: ${query}`;
  },

  async system_health() {
    const cpus = os.cpus();
    const total = os.totalmem();
    const free = os.freemem();
    const info = {
      os: `${os.type()} ${os.release()}`,
      cpu: cpus[0] ? cpus[0].model.trim() : "unknown",
      cpu_cores: cpus.length,
      ram_used_percent: Math.round(((total - free) / total) * 100),
      ram_total_gb: +(total / 1e9).toFixed(1),
      uptime_hours: +(os.uptime() / 3600).toFixed(1),
    };
    try {
      const s = await fs.promises.statfs(HOME);
      info.disk_free_gb = +((s.bavail * s.bsize) / 1e9).toFixed(1);
    } catch {}
    return Object.entries(info).map(([k, v]) => `${k}=${v}`).join(", ");
  },

  async list_files({ folder }) {
    const p = safePath(folder);
    const entries = await fs.promises.readdir(p, { withFileTypes: true });
    entries.sort((a, b) => b.isDirectory() - a.isDirectory() || a.name.localeCompare(b.name));
    return entries.slice(0, 200).map((e) => (e.isDirectory() ? "[DIR] " : "") + e.name).join("\n") || "(empty)";
  },

  async read_file({ path: file }) {
    const p = safePath(file);
    const st = await fs.promises.stat(p);
    if (!st.isFile()) throw new Error("not a file");
    if (st.size > 5_000_000) throw new Error("file is too large to read");
    return (await fs.promises.readFile(p, "utf8")).slice(0, 8000);
  },

  async write_file({ path: file, content }) {
    const p = safePath(file);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, String(content ?? ""), "utf8");
    return `Wrote ${String(content ?? "").length} characters to ${p}`;
  },

  async move_file({ src, dst }) {
    const s = safePath(src);
    const d = safePath(dst);
    await fs.promises.mkdir(path.dirname(d), { recursive: true });
    await fs.promises.rename(s, d);
    return `Moved ${s} -> ${d}`;
  },

  async organize_folder({ folder }) {
    const p = safePath(folder);
    let moved = 0;
    for (const e of await fs.promises.readdir(p, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      const group = Object.keys(GROUPS).find((g) => GROUPS[g].includes(ext)) || "Other";
      const destDir = path.join(p, group);
      await fs.promises.mkdir(destDir, { recursive: true });
      const target = path.join(destDir, e.name);
      if (fs.existsSync(target)) continue; // never overwrite
      await fs.promises.rename(path.join(p, e.name), target);
      moved++;
    }
    return `Organized ${moved} files in ${p}`;
  },

  async delete_file({ path: file }) {
    const p = safePath(file);
    const st = await fs.promises.stat(p);
    if (!st.isFile()) throw new Error("refusing to delete anything but a single file");
    await fs.promises.unlink(p);
    return `Deleted ${p}`;
  },

  async take_screenshot() {
    const { desktopCapturer, screen } = require("electron");
    const { width, height } = screen.getPrimaryDisplay().size;
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
    if (!sources.length) throw new Error("no screen available");
    const dir = path.join(HOME, "Pictures");
    await fs.promises.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = path.join(dir, `aegis_${stamp}.png`);
    await fs.promises.writeFile(out, sources[0].thumbnail.toPNG());
    return `Screenshot saved to ${out}`;
  },

  async type_text({ text }) {
    if (!IS_WIN) throw new Error("typing is only supported on Windows");
    const t = String(text ?? "");
    if (!t || t.length > 2000) throw new Error("text must be 1-2000 characters");
    await powershellSendKeys(sendKeysEscape(t));
    return `Typed ${t.length} characters`;
  },

  async press_keys({ keys }) {
    if (!IS_WIN) throw new Error("key presses are only supported on Windows");
    await powershellSendKeys(comboToSendKeys(keys));
    return `Pressed ${keys}`;
  },

  async run_shell({ command }) {
    const cmd = String(command || "").trim();
    if (!cmd) throw new Error("empty command");
    return new Promise((resolve) => {
      exec(cmd, { timeout: 30000, windowsHide: true, maxBuffer: 1_000_000, cwd: HOME }, (err, stdout, stderr) => {
        const out = `${stdout}${stderr}`.trim().slice(0, 4000);
        resolve(out || (err ? `Error: ${err.message}` : "(no output)"));
      });
    });
  },
};

async function runTool(name, args) {
  if (!Object.prototype.hasOwnProperty.call(impl, name)) return `Error: unknown tool ${name}`;
  try {
    return String(await impl[name](args && typeof args === "object" ? args : {}));
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

module.exports = { run: runTool, safePath, comboToSendKeys, sendKeysEscape };
