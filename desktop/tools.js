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
  const custom = process.env.AEGIS_SAFE_ROOTS; // used by tests: replaces everything
  if (custom) return custom.split(path.delimiter).filter(Boolean).map((r) => path.resolve(r));
  const names = ["Documents", "Desktop", "Downloads"];
  // Windows often redirects these folders into OneDrive, so include those locations too.
  const bases = [HOME, process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean);
  const list = [];
  for (const b of bases) for (const n of names) list.push(path.join(b, n));
  // Extra folders the user chose themselves: {"safeRoots": ["D:\\Work"]} in the app's config.json, passed in by main.js.
  for (const extra of (process.env.AEGIS_EXTRA_ROOTS || "").split(path.delimiter)) if (extra.trim()) list.push(extra.trim());
  const seen = new Set();
  return list.map((r) => path.resolve(r)).filter((r) => (seen.has(norm(r)) ? false : seen.add(norm(r))));
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

function insideRoots(full) {
  for (const root of safeRoots()) {
    const r = norm(realish(root));
    const f = norm(full);
    if (f === r || f.startsWith(r + path.sep)) return true;
  }
  return false;
}

function safePath(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("missing path");
  let p = input.trim().replace(/^~(?=$|[\\/])/, HOME);
  if (!path.isAbsolute(p)) {
    // A bare name like "report.docx": use the first allowed folder that really has it, else the first folder.
    const roots = safeRoots();
    const hit = roots.map((r) => path.join(r, p)).find((c) => fs.existsSync(c));
    p = hit || path.join(roots[0] || path.join(HOME, "Documents"), p);
  }
  const full = realish(path.resolve(p));
  if (insideRoots(full)) return full;
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


// ---- volume / media keys (Windows): WScript.Shell can press the hardware keys ----
const MEDIA_KEYS = { play_pause: 179, playpause: 179, play: 179, pause: 179, next: 176, previous: 177, prev: 177, stop: 178 };
function wscriptKeys(codes) {
  // codes: array of [virtualKeyChar, repeat]
  const body = codes.map(([c, n]) => `1..${n} | ForEach-Object { $w.SendKeys([char]${c}) }`).join("; ");
  return run("powershell", ["-NoProfile", "-NonInteractive", "-Command", `$w = New-Object -ComObject WScript.Shell; ${body}`]);
}
// Each volume key press moves the level by 2%. Returns the key presses needed to reach `level`.
function volumePlan(level) {
  const v = String(level).trim().toLowerCase();
  if (v === "mute" || v === "unmute") return [[173, 1]]; // Windows only exposes a mute TOGGLE key
  if (v === "up") return [[175, 5]];
  if (v === "down") return [[174, 5]];
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("volume must be 0-100, mute, up or down");
  const steps = Math.round(n / 2);
  return steps === 0 ? [[174, 50]] : [[174, 50], [175, steps]];
}

function findInRoots(query, limit = 40) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) throw new Error("give at least 2 characters to search for");
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(q)) out.push((e.isDirectory() ? "[DIR] " : "") + full);
      if (e.isDirectory()) walk(full, depth + 1);
    }
  };
  for (const r of safeRoots()) walk(r, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Documents: read Word / Excel / PowerPoint / PDF / text without any Office installation.
// ---------------------------------------------------------------------------------------------
const net = require("net");
const AdmZip = require("adm-zip");

const TEXT_EXT = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".log", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".py", ".java", ".c", ".cpp", ".cs", ".sql", ".yml", ".yaml", ".ini", ".cfg", ".conf", ".bat", ".ps1", ".sh", ".env", ".toml"]);
const DOC_EXT = /\.(docx|xlsx|pptx|pdf)$/i;
const PAGE_CHARS = 8000;
const MAX_DOC_BYTES = 25 * 1024 * 1024;

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}
const stripTags = (xml) => decodeXml(xml.replace(/<[^>]+>/g, ""));

function zipPart(zip, name) {
  const e = zip.getEntry(name);
  if (!e) return null;
  if (e.header.size > 50_000_000) throw new Error("that part of the document is too large to read"); // zip-bomb guard
  return e.getData().toString("utf8");
}

function docxText(buf) {
  const xml = zipPart(new AdmZip(buf), "word/document.xml");
  if (xml == null) throw new Error("this is not a valid .docx file");
  // Table cells contain their own paragraphs: flatten each cell to one line, then separate cells by tabs and rows by newlines.
  const flat = xml.replace(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g, (_, inner) => inner.replace(/<\/w:p>/g, " ") + "\t");
  const body = flat.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<\/w:tr>/g, "\n");
  return stripTags(body).replace(/ +\t/g, "\t").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function xlsxText(buf) {
  const zip = new AdmZip(buf);
  const wb = zipPart(zip, "xl/workbook.xml");
  if (wb == null) throw new Error("this is not a valid .xlsx file");
  const shared = [];
  const ss = zipPart(zip, "xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(stripTags(m[1]));
  const names = [...wb.matchAll(/<sheet\b[^>]*?\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  const num = (n) => Number(n.match(/(\d+)\.xml$/)[1]);
  const files = zip.getEntries().map((e) => e.entryName).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const out = [];
  files.forEach((f, i) => {
    out.push(`## Sheet: ${names[i] || "Sheet" + (i + 1)}`);
    let rows = 0;
    for (const r of zipPart(zip, f).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (++rows > 2000) { out.push("[...more rows not shown]"); break; }
      const cells = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] || "";
        const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
        const type = (attrs.match(/\bt="([^"]*)"/) || [])[1];
        const v = inner.match(/<v>([\s\S]+?)<\/v>/); // an empty <v></v> (formula not yet calculated) counts as no value
        let val = "";
        if (type === "s" && v) val = shared[Number(v[1])] ?? "";
        else if (type === "inlineStr") val = stripTags((inner.match(/<is>([\s\S]*?)<\/is>/) || [, ""])[1]);
        else if (v) val = decodeXml(v[1]);
        else {
          const f = inner.match(/<f\b[^>]*>([\s\S]*?)<\/f>/); // formula never calculated by Excel: show the formula itself
          if (f) val = "=" + decodeXml(f[1]);
        }
        const idx = ref ? colIndex(ref) : cells.length;
        while (cells.length < idx) cells.push("");
        cells[idx] = val.replace(/[\t\r\n]+/g, " ");
      }
      out.push(cells.join("\t"));
    }
  });
  if (!files.length) throw new Error("this workbook has no sheets");
  return out.join("\n");
}

function pptxText(buf) {
  const zip = new AdmZip(buf);
  const num = (n) => Number(n.match(/(\d+)\.xml$/)[1]);
  const slides = zip.getEntries().map((e) => e.entryName).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  if (!slides.length) throw new Error("this is not a valid .pptx file");
  return slides.map((f) => `## Slide ${num(f)}\n` + stripTags(zipPart(zip, f).replace(/<\/a:p>/g, "\n")).replace(/\n{2,}/g, "\n").trim()).join("\n\n");
}

async function pdfText(buf) {
  const pdfParse = require("pdf-parse/lib/pdf-parse.js"); // not the package root: its index runs a debug self-test
  // pdf.js 1.x mis-reads Node Buffers that sit in Node's shared pool (it ignores byteOffset): hand it a plain copy.
  const data = await pdfParse(new Uint8Array(buf));
  const t = (data.text || "").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) throw new Error("this PDF has no readable text (it may be a scan)");
  return `[PDF, ${data.numpages} pages]\n` + t;
}

function paginate(text, page) {
  const total = Math.max(1, Math.ceil(text.length / PAGE_CHARS));
  const n = Math.min(Math.max(1, Math.floor(Number(page) || 1)), total);
  const slice = text.slice((n - 1) * PAGE_CHARS, n * PAGE_CHARS);
  if (total === 1) return slice;
  return `[page ${n} of ${total}${n < total ? `; ask for page ${n + 1} to continue` : ""}]\n${slice}`;
}

async function documentText(p) {
  const st = await fs.promises.stat(p);
  if (!st.isFile()) throw new Error("not a file");
  if (st.size > MAX_DOC_BYTES) throw new Error("file is too large to read (25 MB limit)");
  const ext = path.extname(p).toLowerCase();
  const buf = await fs.promises.readFile(p);
  if (ext === ".docx") return docxText(buf);
  if (ext === ".xlsx") return xlsxText(buf);
  if (ext === ".pptx") return pptxText(buf);
  if (ext === ".pdf") return pdfText(buf);
  if (buf.includes(0)) throw new Error(`cannot read ${ext || "this"} files as text (supported: docx, xlsx, pptx, pdf and plain text)`);
  return buf.toString("utf8");
}

// Search INSIDE text files. Bounded in depth, file count, file size and result count.
function searchInFiles(query, folder, limit = 50) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) throw new Error("give at least 2 characters to search for");
  const roots = folder ? [safePath(folder)] : safeRoots();
  const out = [];
  let scanned = 0;
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 5 || scanned > 3000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit || scanned > 3000) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (!e.isFile() || !TEXT_EXT.has(path.extname(e.name).toLowerCase())) continue;
      scanned++;
      let text;
      try {
        if (fs.statSync(full).size > 2_000_000) continue;
        text = fs.readFileSync(full, "utf8");
      } catch { continue; }
      if (text.includes("\u0000")) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && out.length < limit; i++) {
        if (lines[i].toLowerCase().includes(q)) out.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
      }
    }
  };
  for (const r of roots) walk(r, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Email drafts: a mailto: link opens the user's own mail app with everything filled in.
// ---------------------------------------------------------------------------------------------
const ADDR_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function buildMailto({ to, cc, subject, body }) {
  const clean = (v, field) => {
    v = String(v || "").trim();
    if (/[\r\n\0]/.test(v)) throw new Error(`the ${field} contains a line break`);
    return v;
  };
  const addrs = (v, field) =>
    clean(v, field).split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((a) => {
      const m = a.match(/<([^>]+)>$/);
      const addr = m ? m[1] : a;
      if (!ADDR_RE.test(addr)) throw new Error(`'${a}' is not a valid email address`);
      return addr;
    });
  const t = addrs(to, "to address");
  if (!t.length) throw new Error("who should the email go to?");
  if (t.length > 10) throw new Error("at most 10 recipients");
  const c = addrs(cc, "cc address");
  const params = [];
  if (c.length) params.push("cc=" + c.join(","));
  const subj = clean(subject, "subject").slice(0, 250);
  if (subj) params.push("subject=" + encodeURIComponent(subj));
  const text = String(body || "").replace(/\r?\n/g, "\r\n");
  let url = "mailto:" + t.map((a) => a.replace(/%/g, "%25")).join(",") + (params.length ? "?" + params.join("&") : "");
  let bodyDropped = false;
  if (text) {
    const withBody = url + (params.length ? "&" : "?") + "body=" + encodeURIComponent(text);
    if (withBody.length <= 1900) url = withBody; // Windows refuses much longer mailto links
    else bodyDropped = true;
  }
  return { url, bodyDropped, body: String(body || ""), to: t };
}

// ---------------------------------------------------------------------------------------------
// Downloads: https only, public hosts only (no localhost / LAN / cloud metadata), size-limited, never overwrites.
// ---------------------------------------------------------------------------------------------
const MAX_DOWNLOAD = 50 * 1024 * 1024;
const BLOCKED_DOWNLOAD_EXT = /\.(exe|bat|cmd|ps1|psm1|vbs|vbe|msi|msp|scr|com|lnk|js|jse|jar|dll|reg|hta|wsf|cpl)$/i;

function isPublicIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    return true;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    if (x === "::" || x === "::1" || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || /^f[cd]/.test(x)) return false;
    return true;
  }
  return false;
}

function sanitizeFilename(name) {
  return path.basename(String(name || "").replace(/\\/g, "/")).replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim().replace(/^\.+/, "").slice(0, 120);
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let target = path.join(dir, name);
  for (let i = 1; fs.existsSync(target) && i < 1000; i++) target = path.join(dir, `${base} (${i})${ext}`);
  return target;
}

function downloadsDir() {
  const roots = safeRoots();
  return roots.find((r) => path.basename(r).toLowerCase() === "downloads") || roots[0];
}

function defaultRequest(url, ip) {
  return new Promise((resolve, reject) => {
    const req = require("https").request(url, {
      method: "GET",
      timeout: 30000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Aegis/2.0)" },
      // Connect to the exact address we already checked, so DNS cannot change its answer between the check and the download.
      lookup: (_h, opts, cb) => (opts && opts.all ? cb(null, [{ address: ip, family: net.isIP(ip) }]) : cb(null, ip, net.isIP(ip))),
    }, (res) => resolve({ status: res.statusCode, headers: res.headers, stream: res }));
    req.on("timeout", () => req.destroy(new Error("the server took too long to answer")));
    req.on("error", reject);
    req.end();
  });
}

async function downloadFile(url, filename, deps = {}) {
  const lookup = deps.lookup || ((h) => require("dns").promises.lookup(h, { all: true }));
  const request = deps.request || defaultRequest;
  const dir = deps.dir || downloadsDir();
  let current = new URL(String(url || "").trim()); // throws on garbage
  let res;
  for (let hop = 0; ; hop++) {
    if (current.protocol !== "https:") throw new Error("only https links are allowed");
    if (current.username || current.password) throw new Error("links with embedded logins are not allowed");
    const host = current.hostname.replace(/^\[|\]$/g, "");
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host);
    if (!addrs || !addrs.length || !addrs.every((a) => isPublicIp(a.address))) throw new Error("that address is not a public website");
    res = await request(current, addrs[0].address);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      res.stream.resume();
      if (hop >= 3) throw new Error("too many redirects");
      current = new URL(res.headers.location, current);
      continue;
    }
    break;
  }
  if (res.status !== 200) { res.stream.resume(); throw new Error(`the site answered with HTTP ${res.status}`); }
  const declared = Number(res.headers["content-length"] || 0);
  if (declared > MAX_DOWNLOAD) { res.stream.resume(); throw new Error("the file is larger than 50 MB"); }
  const cd = String(res.headers["content-disposition"] || "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  let name = sanitizeFilename(filename) || sanitizeFilename(cd ? decodeURIComponent(cd[1]) : "") || sanitizeFilename(decodeURIComponent(current.pathname.split("/").pop() || "")) || "download";
  if (BLOCKED_DOWNLOAD_EXT.test(name)) { res.stream.resume(); throw new Error("refusing to download programs or scripts"); }
  await fs.promises.mkdir(dir, { recursive: true });
  const target = uniquePath(dir, name);
  let size = 0;
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(target, { flags: "wx" });
      res.stream.on("data", (c) => { size += c.length; if (size > MAX_DOWNLOAD) res.stream.destroy(new Error("the file is larger than 50 MB")); });
      res.stream.on("error", (e) => { out.destroy(); reject(e); });
      res.stream.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
    });
  } catch (e) {
    try { fs.unlinkSync(target); } catch {}
    throw e;
  }
  return { path: target, size };
}

// Friendly names people actually say -> what Windows `start` understands.
const APP_ALIASES = {
  word: "winword", "ms word": "winword", excel: "excel", powerpoint: "powerpnt", "power point": "powerpnt", outlook: "outlook",
  chrome: "chrome", "google chrome": "chrome", edge: "msedge", "microsoft edge": "msedge", firefox: "firefox",
  vscode: "code", "vs code": "code", "visual studio code": "code", code: "code", notepad: "notepad", calculator: "calc", calc: "calc",
  paint: "mspaint", explorer: "explorer", "file explorer": "explorer", "task manager": "taskmgr", settings: "ms-settings:",
  terminal: "wt", cmd: "cmd", powershell: "powershell", teams: "msteams:", spotify: "spotify", whatsapp: "whatsapp:",
  "power bi": "pbidesktop", powerbi: "pbidesktop", snipping: "snippingtool", "snipping tool": "snippingtool",
};
function resolveAppName(name) {
  const n = String(name || "").trim();
  return APP_ALIASES[n.toLowerCase()] || n;
}

const impl = {
  async open_app({ name }) {
    if (typeof name !== "string" || !/^[\w .+()-]{1,60}$/.test(name.trim())) {
      throw new Error("invalid app name");
    }
    if (!IS_WIN) throw new Error("open_app is only supported on Windows");
    const target = resolveAppName(name);
    const child = spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore", windowsHide: true });
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

  async browser_search({ query }) {
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
    if (DOC_EXT.test(p)) return paginate(await documentText(p), 1); // Word / Excel / PowerPoint / PDF are not plain text
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


  async open_file({ path: file }) {
    const { shell } = require("electron");
    const p = safePath(file);
    const st = await fs.promises.stat(p);
    if (!st.isFile()) throw new Error("not a file");
    if (/\.(exe|bat|cmd|ps1|vbs|msi|scr|com|lnk|js|jar)$/i.test(p)) throw new Error("refusing to launch programs or scripts this way");
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    return `Opened ${p}`;
  },

  async find_files({ query }) {
    const hits = findInRoots(query);
    return hits.length ? hits.join("\n") : "No matching files in Documents, Desktop or Downloads.";
  },

  async clipboard_read() {
    const { clipboard } = require("electron");
    const t = clipboard.readText();
    return t ? t.slice(0, 4000) : "(the clipboard has no text)";
  },

  async clipboard_write({ text }) {
    const { clipboard } = require("electron");
    const t = String(text ?? "");
    if (!t || t.length > 20000) throw new Error("text must be 1-20000 characters");
    clipboard.writeText(t);
    return `Copied ${t.length} characters to the clipboard`;
  },

  async set_volume({ level }) {
    if (!IS_WIN) throw new Error("volume control is only supported on Windows");
    const plan = volumePlan(level);
    await wscriptKeys(plan);
    const v = String(level).toLowerCase();
    return v === "mute" || v === "unmute" ? "Toggled mute" : /^\d/.test(v) ? `Volume set to about ${Math.round(Number(v) / 2) * 2}%` : `Volume ${v}`;
  },

  async media_control({ action }) {
    if (!IS_WIN) throw new Error("media keys are only supported on Windows");
    const code = MEDIA_KEYS[String(action || "").toLowerCase().replace(/[\s-]+/g, "_")];
    if (!code) throw new Error("action must be play_pause, next, previous or stop");
    await wscriptKeys([[code, 1]]);
    return `Sent media key: ${action}`;
  },

  async notify({ title, message }) {
    const { Notification } = require("electron");
    const body = String(message ?? "").slice(0, 300);
    if (!body) throw new Error("empty message");
    new Notification({ title: String(title || "Aegis").slice(0, 80), body }).show();
    return "Notification shown";
  },

  async running_apps() {
    if (!IS_WIN) throw new Error("listing windows is only supported on Windows");
    const out = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + ' | ' + $_.MainWindowTitle }"]);
    return out.split(/\r?\n/).slice(0, 40).join("\n") || "(no open windows)";
  },

  async close_app({ name }) {
    if (!IS_WIN) throw new Error("closing apps is only supported on Windows");
    const n = String(name || "").trim().replace(/\.exe$/i, "");
    if (!/^[\w .+()-]{1,60}$/.test(n)) throw new Error("invalid app name");
    if (/^(explorer|csrss|winlogon|services|lsass|svchost|system|wininit|dwm)$/i.test(n)) throw new Error("that is a protected system process");
    await run("taskkill", ["/IM", `${n}.exe`]); // no /F: asks the app to close politely so unsaved work can prompt
    return `Asked ${n} to close`;
  },

  async lock_screen() {
    if (!IS_WIN) throw new Error("locking is only supported on Windows");
    await run("rundll32.exe", ["user32.dll,LockWorkStation"]);
    return "Screen locked";
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
  async compose_email(args) {
    const { shell, clipboard } = require("electron");
    const m = buildMailto(args || {});
    if (m.bodyDropped) clipboard.writeText(m.body);
    await shell.openExternal(m.url);
    return m.bodyDropped
      ? `Opened a draft to ${m.to.join(", ")}. The message was too long to pre-fill, so it is on your clipboard: press Ctrl+V in the mail window, review it and press Send.`
      : `Opened a draft email to ${m.to.join(", ")} in your mail app. Review it and press Send; it has not been sent yet.`;
  },

  async open_folder({ path: target }) {
    const { shell } = require("electron");
    const p = safePath(target);
    const st = await fs.promises.stat(p);
    if (st.isDirectory()) {
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
    } else {
      shell.showItemInFolder(p);
    }
    return `Showing ${p}`;
  },

  async make_folder({ path: target }) {
    const p = safePath(target);
    await fs.promises.mkdir(p, { recursive: true });
    return `Folder ready: ${p}`;
  },

  async copy_file({ src, dst }) {
    const s = safePath(src);
    const d = safePath(dst);
    if (!(await fs.promises.stat(s)).isFile()) throw new Error("only single files can be copied");
    await fs.promises.mkdir(path.dirname(d), { recursive: true });
    await fs.promises.copyFile(s, d, fs.constants.COPYFILE_EXCL); // never overwrites
    return `Copied ${s} -> ${d}`;
  },

  async append_file({ path: file, content }) {
    const p = safePath(file);
    const text = String(content ?? "");
    if (!text || text.length > 20000) throw new Error("content must be 1-20000 characters");
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.appendFile(p, text, "utf8");
    return `Added ${text.length} characters to ${p}`;
  },

  async file_info({ path: target }) {
    const p = safePath(target);
    const st = await fs.promises.stat(p);
    const kb = (st.size / 1024).toFixed(st.size > 1048576 ? 0 : 1);
    if (st.isDirectory()) return `Folder ${p}, ${(await fs.promises.readdir(p)).length} items, modified ${st.mtime.toISOString()}`;
    return `File ${p}, ${kb} KB, type ${path.extname(p) || "none"}, modified ${st.mtime.toISOString()}`;
  },

  async search_in_files({ query, folder }) {
    const hits = searchInFiles(query, folder);
    return hits.length ? hits.join("\n") : "No text file in Documents, Desktop or Downloads contains that.";
  },

  async read_document({ path: file, page }) {
    return paginate(await documentText(safePath(file)), page);
  },

  async download_file({ url, filename }) {
    const r = await downloadFile(url, filename);
    return `Downloaded ${(r.size / 1024).toFixed(0)} KB to ${r.path}`;
  },
};

// Chrome control (tabs, navigation, reading, clicking, typing, screenshots) lives in browser.js; its tools are chrome_*
Object.assign(impl, require("./browser").tools);

async function runTool(name, args) {
  if (!Object.prototype.hasOwnProperty.call(impl, name)) return `Error: unknown tool ${name}`;
  try {
    return String(await impl[name](args && typeof args === "object" ? args : {}));
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

module.exports = {
  run: runTool, safePath, comboToSendKeys, sendKeysEscape, volumePlan, findInRoots, MEDIA_KEYS,
  safeRoots, resolveAppName, buildMailto, searchInFiles, paginate, documentText, docxText, xlsxText, pptxText,
  isPublicIp, sanitizeFilename, downloadFile,
};
