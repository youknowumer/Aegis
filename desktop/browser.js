"use strict";
/**
 * Chrome control for Aegis: drive a real Chrome window (tabs, navigation, reading, clicking, typing, scrolling, screenshots)
 * through the Chrome DevTools Protocol. No extension and no extra npm package besides `ws`.
 *
 * How it connects
 *   Aegis starts (or re-uses) its own Chrome with --remote-debugging-port on 127.0.0.1 and a dedicated profile folder
 *   (%LOCALAPPDATA%\Aegis\chrome-profile on Windows, ~/.aegis/chrome-profile elsewhere). Chrome (v136+) refuses a debugging port on
 *   your everyday profile, so Aegis uses its own: sign in to the sites you want it to use ONCE and they stay signed in.
 *
 * Safety
 *   - only http(s) pages (plus chrome://history, downloads, version) can be opened; file:, javascript:, data: are refused
 *   - password fields are never typed into: the user types passwords themselves
 *   - clicks / keys that look like buying, sending, deleting, posting or accepting need the user's approval (`approved: true`,
 *     which the server turns into an approval dialog); running your own JavaScript always needs approval
 *   - the debugging port only listens on 127.0.0.1
 *
 * Tools (all `chrome_*`): tabs, open, go, nav, switch, close, read, elements, click, type, key, scroll, find, wait, screenshot, eval
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOST = "127.0.0.1";
const port = () => Number(process.env.AEGIS_CHROME_PORT) || 9333;

// ------------------------------------------------------------------ finding and starting Chrome
function chromePath() {
  const env = process.env.AEGIS_CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const pf = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const list = IS_WIN
    ? pf.map((b) => path.join(b, "Google", "Chrome", "Application", "chrome.exe")).concat(pf.map((b) => path.join(b, "Microsoft", "Edge", "Application", "msedge.exe")))
    : IS_MAC
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge"];
  return list.find((p) => fs.existsSync(p)) || null;
}

function profileDir() {
  if (process.env.AEGIS_CHROME_PROFILE) return process.env.AEGIS_CHROME_PROFILE;
  const base = IS_WIN ? (process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")) : path.join(os.homedir(), ".aegis");
  return path.join(base, IS_WIN ? "Aegis" : "", "chrome-profile");
}

function httpJson(method, p, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: port(), path: p, method, timeout }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; if (body.length > 5e6) req.destroy(new Error("response too large")); });
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`Chrome answered HTTP ${res.statusCode}`));
        try { resolve(body ? JSON.parse(body) : {}); } catch { resolve(body); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

let launching = null;
async function ensureChrome() {
  try { await httpJson("GET", "/json/version"); return; } catch {}
  if (launching) return launching;
  launching = (async () => {
    const exe = chromePath();
    if (!exe) throw new Error("Google Chrome was not found. Install Chrome (or set AEGIS_CHROME_PATH).");
    const dir = profileDir();
    fs.mkdirSync(dir, { recursive: true });
    const args = [
      `--remote-debugging-port=${port()}`, `--remote-debugging-address=${HOST}`, `--user-data-dir=${dir}`,
      "--no-first-run", "--no-default-browser-check", "--disable-features=Translate", "--restore-last-session", "--autoplay-policy=no-user-gesture-required",
    ];
    if (process.env.AEGIS_CHROME_HEADLESS === "1") args.push("--headless=new");
    if (process.env.AEGIS_CHROME_ARGS) args.push(...process.env.AEGIS_CHROME_ARGS.split(/\s+/).filter(Boolean));
    args.push("about:blank");
    const child = spawn(exe, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      try { await httpJson("GET", "/json/version"); return; } catch {}
      await sleep(250);
    }
    throw new Error("Chrome did not start in time. Close any Chrome that was started by Aegis and try again.");
  })();
  try { await launching; } finally { launching = null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ a DevTools connection to one tab
class Conn {
  constructor(target) {
    this.target = target;
    this.id = 0;
    this.pending = new Map();
    this.dialogs = [];
    this.closed = false;
  }
  async open() {
    const WebSocket = require("ws");
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once("open", res); this.ws.once("error", rej); });
    this.ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message || "DevTools error")) : res(m.result || {});
      } else if (m.method === "Page.javascriptDialogOpening") {
        const p = m.params || {};
        this.dialogs.push(`${p.type}: ${String(p.message || "").slice(0, 200)}`);
        // alerts and "leave page?" prompts are accepted so the tab never freezes; confirm / prompt are declined (the user decides)
        const accept = p.type === "alert" || p.type === "beforeunload";
        this.send("Page.handleJavaScriptDialog", { accept }).catch(() => {});
      }
    });
    this.ws.on("close", () => { this.closed = true; for (const { rej } of this.pending.values()) rej(new Error("the tab was closed")); this.pending.clear(); });
    await this.send("Page.enable").catch(() => {});
    await this.send("Runtime.enable").catch(() => {});
  }
  send(method, params = {}, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error("the tab was closed"));
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  // run a function in the page, JSON in / JSON out
  async run(fn, ...args) {
    const expr = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || "script error");
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch {} }
}

const conns = new Map();   // targetId -> Conn
let activeId = null;

async function pages() {
  await ensureChrome();
  const all = await httpJson("GET", "/json/list");
  return (Array.isArray(all) ? all : []).filter((t) => t.type === "page" && !/^devtools:/.test(t.url));
}
async function resolveTab(spec) {
  const list = await pages();
  if (!list.length) {
    const t = await httpJson("PUT", "/json/new?about:blank");
    return t;
  }
  if (spec != null && spec !== "") {
    const n = Number(spec);
    if (Number.isInteger(n) && String(spec).trim() === String(n)) { if (n < 1 || n > list.length) throw new Error(`there is no tab ${n}; there are ${list.length}`); return list[n - 1]; }
    const q = String(spec).toLowerCase();
    const hit = list.find((t) => (t.title || "").toLowerCase().includes(q) || (t.url || "").toLowerCase().includes(q));
    if (!hit) throw new Error(`no tab matches "${spec}"`);
    return hit;
  }
  return list.find((t) => t.id === activeId) || list[0];
}
async function connect(t) {
  let c = conns.get(t.id);
  if (!c || c.closed) {
    c = new Conn(t);
    await c.open();
    conns.set(t.id, c);
    c.ws.on("close", () => { if (conns.get(t.id) === c) conns.delete(t.id); });
  }
  c.target = t;
  return c;
}
async function conn(spec) {
  const t = await resolveTab(spec);
  const c = await connect(t);
  if ((spec != null && spec !== "") || !activeId) activeId = t.id;
  return c;
}

// ------------------------------------------------------------------ safety rules
const SENSITIVE = /\b(buy|buy now|purchase|pay|pay now|payment|checkout|check out|place (?:your )?order|order now|complete (?:order|purchase)|subscribe|upgrade|donate|delete|remove|erase|discard|confirm|submit|send|post|publish|tweet|reply|share|transfer|withdraw|deposit|sign out|log out|logout|unsubscribe|cancel (?:order|subscription|booking)|deactivate|close account|accept|agree|authorize|grant|install|download|apply now|book now|reserve|invite|follow|block|report)\b/i;
function allowedUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) throw new Error("missing url");
  if (/^(?:javascript|data|file|blob|vbscript|view-source|chrome-extension|ftp):/i.test(u)) throw new Error("only http(s) pages can be opened");
  if (/^chrome:\/\//i.test(u)) {
    if (/^chrome:\/\/(?:history|downloads|version)\/?(?:[?#].*)?$/i.test(u)) return u;
    throw new Error("that Chrome page is not available to Aegis");
  }
  if (u === "about:blank") return u;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("only http(s) pages can be opened");
  return parsed.toString();
}

// ------------------------------------------------------------------ helpers that run inside the page
function pageMarkElements(filter) {
  const old = document.querySelectorAll("[data-aegis-i]");
  old.forEach((e) => e.removeAttribute("data-aegis-i"));
  const sel = "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],[contenteditable=''],[contenteditable=true],[onclick],[tabindex]:not([tabindex='-1'])";
  const seen = new Set(), items = [];
  const vh = window.innerHeight, vw = window.innerWidth;
  const f = String(filter || "").toLowerCase();
  for (const el of document.querySelectorAll(sel)) {
    if (seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
    if (el.type === "hidden") continue;
    const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const label = el.labels && el.labels[0] ? el.labels[0].innerText.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    const kind = el.tagName === "A" ? "link" : el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "INPUT" ? ("input:" + (el.type || "text")) : (el.getAttribute("role") || el.tagName.toLowerCase());
    const d = { kind, text: text || label || el.placeholder || el.name || "", y: r.top };
    if (label && label !== d.text) d.label = label;
    if (el.placeholder) d.placeholder = el.placeholder.slice(0, 50);
    if (el.tagName === "A") d.href = (el.href || "").slice(0, 100);
    if (el.type === "checkbox" || el.type === "radio") d.checked = !!el.checked;
    if (el.tagName === "SELECT") d.options = Array.from(el.options).slice(0, 12).map((o) => o.text.trim().slice(0, 30));
    if (["INPUT", "TEXTAREA"].includes(el.tagName) && el.value && el.type !== "password") d.value = String(el.value).slice(0, 40);
    if (el.disabled) d.disabled = true;
    d.inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    if (f && !(d.text + " " + (d.label || "") + " " + (d.placeholder || "") + " " + (d.href || "")).toLowerCase().includes(f)) continue;
    items.push({ el, d });
    if (items.length >= 400) break;
  }
  items.sort((a, b) => (b.d.inView - a.d.inView) || (a.d.y - b.d.y));
  return items.slice(0, 120).map((x, i) => { x.el.setAttribute("data-aegis-i", String(i + 1)); const { y, ...rest } = x.d; return { i: i + 1, ...rest }; });
}

const pageMedia = async (action, value) => {
      const vs = Array.from(document.querySelectorAll("video,audio"));
      const v = vs.find((x) => !x.paused) || vs.sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight))[0];
      const a = String(action || "").toLowerCase(), val = String(value || "").toLowerCase();
      const click = (sel) => { const b = document.querySelector(sel); if (b) { b.click(); return true; } return false; };
      if (a === "next") return click(".ytp-next-button") ? { msg: "Next video." } : { error: "there is no next-video button here" };
      if (a === "captions") return click(".ytp-subtitles-button") ? { msg: "Toggled captions." } : { error: "this player has no captions button" };
      if (!v) return { error: "there is no video or audio on this page" };
      if (a === "play") { try { await v.play(); } catch (e) { return { error: "the browser blocked playback until you press play once" }; } return { msg: "Playing." }; }
      if (a === "pause") { v.pause(); return { msg: "Paused." }; }
      if (a === "mute") { v.muted = true; return { msg: "Muted." }; }
      if (a === "unmute") { v.muted = false; return { msg: "Unmuted." }; }
      if (a === "seek") { const s = parseFloat(val); if (!isFinite(s)) return { error: "seek needs a number of seconds" }; v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + s)); return { msg: (s >= 0 ? "Skipped ahead " : "Went back ") + Math.abs(Math.round(s)) + " seconds." }; }
      if (a === "speed") { const s = parseFloat(val); if (!isFinite(s)) return { error: "speed needs a number like 1.5" }; v.playbackRate = Math.max(0.25, Math.min(4, s)); return { msg: "Speed " + v.playbackRate + "x." }; }
      if (a === "volume") {
        if (val === "up") v.volume = Math.min(1, v.volume + 0.15);
        else if (val === "down") v.volume = Math.max(0, v.volume - 0.15);
        else { const n = parseFloat(val); if (!isFinite(n)) return { error: "volume needs up, down or a number 0-100" }; v.volume = Math.max(0, Math.min(1, n / 100)); }
        v.muted = false;
        return { msg: "Volume " + Math.round(v.volume * 100) + " percent." };
      }
      if (a === "fullscreen") {
        try { if (document.fullscreenElement) await document.exitFullscreen(); else await (v.closest(".html5-video-player") || v).requestFullscreen(); return { msg: "Toggled fullscreen." }; }
        catch (e) { return { error: "the browser only allows fullscreen from a real key press: press F in the video" }; }
      }
      return { error: "unknown media action " + a };
    };

const pageBadges = (on) => {
      document.querySelectorAll("[data-aegis-badges]").forEach((e) => e.remove());
      if (!on) return 0;
      const box = document.createElement("div");
      box.setAttribute("data-aegis-badges", "1");
      box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
      let n = 0;
      document.querySelectorAll("[data-aegis-i]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
        const b = document.createElement("span");
        b.textContent = el.getAttribute("data-aegis-i");
        b.style.cssText = `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top)}px;background:#f59e0b;color:#111;font:700 11px/1 system-ui;padding:2px 5px;border-radius:6px;box-shadow:0 1px 4px #0008`;
        box.appendChild(b); n++;
      });
      document.documentElement.appendChild(box);
      return n;
    };

function pageResolve(q) {
  // q = { index, selector, text, label } -> marks the element, scrolls it into view, returns its description and centre
  let el = null;
  if (q.index != null) el = document.querySelector(`[data-aegis-i="${Number(q.index)}"]`);
  else if (!q.selector && !q.text) {
    const ae = document.activeElement;
    el = ae && ae !== document.body && (/^(INPUT|TEXTAREA)$/.test(ae.tagName) || ae.isContentEditable) ? ae
      : Array.from(document.querySelectorAll("input[type=search],input[type=text],input:not([type]),textarea,[contenteditable=true]")).find((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== "hidden"; }) || null;
  }
  else if (q.selector) { try { el = document.querySelector(q.selector); } catch { return { error: "that CSS selector is not valid" }; } }
  else if (q.text) {
    const t = String(q.text).toLowerCase();
    const cands = Array.from(document.querySelectorAll("a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],h1,h2,h3,li,span,div,p")).filter((e) => {
      const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
      const own = (e.innerText || e.value || e.getAttribute("aria-label") || e.placeholder || e.title || "").replace(/\s+/g, " ").trim().toLowerCase();
      return own && own.includes(t) && own.length <= t.length + 40;
    });
    const rank = (e) => (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(e.tagName) || e.getAttribute("role") ? 0 : 1) * 1000 + (e.innerText || e.value || "").length;
    cands.sort((a, b) => rank(a) - rank(b));
    el = cands[0] || null;
  }
  if (!el) return { error: "I couldn't find that element. Call chrome_elements to see what is on the page (the numbers change after the page changes)." };
  if (el.tagName === "LABEL" && el.control) el = el.control;
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  document.querySelectorAll("[data-aegis-target]").forEach((e) => e.removeAttribute("data-aegis-target"));
  el.setAttribute("data-aegis-target", "1");
  const label = (el.innerText || el.value || el.getAttribute("aria-label") || el.title || el.placeholder || el.name || el.tagName).replace(/\s+/g, " ").trim().slice(0, 80);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName, type: el.type || "", label, href: el.href || "", form: el.form ? (el.form.action || "") : "", disabled: !!el.disabled, editable: el.isContentEditable };
}

function pageFocusAndClear(clear) {
  const el = document.querySelector("[data-aegis-target]");
  if (!el) return { error: "element lost" };
  el.focus();
  if (clear) {
    if (typeof el.select === "function" && /^(INPUT|TEXTAREA)$/.test(el.tagName)) el.select();
    else if (el.isContentEditable) { const s = getSelection(), r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); }
  }
  return { ok: true };
}

function pageSetSelect(value) {
  const el = document.querySelector("[data-aegis-target]");
  if (!el || el.tagName !== "SELECT") return { error: "not a dropdown" };
  const v = String(value).toLowerCase();
  const o = Array.from(el.options).find((x) => x.text.trim().toLowerCase() === v || x.value.toLowerCase() === v) || Array.from(el.options).find((x) => x.text.toLowerCase().includes(v));
  if (!o) return { error: "no option matches. Options: " + Array.from(el.options).slice(0, 15).map((x) => x.text.trim()).join(" | ") };
  el.value = o.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, chose: o.text.trim() };
}

function pageText() {
  const t = (document.body && document.body.innerText) || "";
  return { title: document.title, url: location.href, text: t.replace(/\n{3,}/g, "\n\n").trim() };
}

// ------------------------------------------------------------------ input
async function mouseClick(c, x, y, count = 1) {
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: count });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: count });
}

const KEYS = {
  enter: ["Enter", "Enter", 13, "\r"], tab: ["Tab", "Tab", 9], escape: ["Escape", "Escape", 27], esc: ["Escape", "Escape", 27],
  backspace: ["Backspace", "Backspace", 8], delete: ["Delete", "Delete", 46], space: [" ", "Space", 32, " "],
  up: ["ArrowUp", "ArrowUp", 38], down: ["ArrowDown", "ArrowDown", 40], left: ["ArrowLeft", "ArrowLeft", 37], right: ["ArrowRight", "ArrowRight", 39],
  arrowup: ["ArrowUp", "ArrowUp", 38], arrowdown: ["ArrowDown", "ArrowDown", 40], arrowleft: ["ArrowLeft", "ArrowLeft", 37], arrowright: ["ArrowRight", "ArrowRight", 39],
  pageup: ["PageUp", "PageUp", 33], pagedown: ["PageDown", "PageDown", 34], home: ["Home", "Home", 36], end: ["End", "End", 35],
};
function parseKeys(combo) {
  const parts = String(combo || "").toLowerCase().split("+").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("no key given");
  let mods = 0;
  const main = parts.pop();
  for (const p of parts) {
    if (p === "alt") mods |= 1; else if (p === "ctrl" || p === "control") mods |= 2; else if (p === "meta" || p === "cmd" || p === "win") mods |= 4; else if (p === "shift") mods |= 8;
    else throw new Error(`unknown modifier "${p}"`);
  }
  let def = KEYS[main];
  if (!def) {
    if (/^f([1-9]|1[0-2])$/.test(main)) def = ["F" + main.slice(1), "F" + main.slice(1), 111 + Number(main.slice(1))];
    else if (main.length === 1) def = [mods & 8 ? main.toUpperCase() : main, /[a-z]/.test(main) ? "Key" + main.toUpperCase() : /\d/.test(main) ? "Digit" + main : "", main.toUpperCase().charCodeAt(0), main];
    else throw new Error(`unknown key "${main}"`);
  }
  return { mods, key: def[0], code: def[1], vk: def[2], text: def[3] };
}
async function pressKey(c, combo) {
  const k = parseKeys(combo);
  const printable = k.text && !(k.mods & (1 | 2 | 4));
  const base = { modifiers: k.mods, key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await c.send("Input.dispatchKeyEvent", printable ? { ...base, type: "keyDown", text: k.text } : { ...base, type: "rawKeyDown" });
  await c.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

async function waitLoaded(c, ms = 20000) {
  const t0 = Date.now();
  await sleep(150);
  while (Date.now() - t0 < ms) {
    try { if ((await c.run(() => document.readyState)) === "complete") return true; } catch {}
    await sleep(200);
  }
  return false;
}

const trim = (s, n) => (s.length > n ? s.slice(0, n) + "\n...(cut)" : s);
const note = (c) => { const d = c.dialogs.splice(0); return d.length ? `\n(Page dialog handled: ${d.join("; ")})` : ""; };
const need = (what) => `NEEDS_APPROVAL: ${what} Ask the user, then call this tool again with approved=true (the user will get an approval prompt).`;

async function describeTab(c) {
  const p = await c.run(() => ({ t: document.title, u: location.href }));
  return `${p.t || "(untitled)"} — ${p.u}`;
}

// ------------------------------------------------------------------ YouTube helpers
function youtubeSearchUrl(query) {
  const q = String(query || "").replace(/\s+/g, " ").trim();
  if (!q) throw new Error("say which song or video to play");
  if (q.length > 200) throw new Error("that search is too long");
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
}
// first real video of a results list; ads, Shorts, channels and playlists have no plain /watch?v= link
function pickYoutubeResult(list) {
  for (const r of Array.isArray(list) ? list : []) {
    if (r && typeof r.href === "string" && /^\/watch\?v=[\w-]{6,20}(?:&|$)/.test(r.href)) return { title: String(r.title || "").trim(), url: "https://www.youtube.com" + r.href };
  }
  return null;
}
function pageYoutubeResults() {
  const out = [];
  for (const a of document.querySelectorAll("ytd-video-renderer a#video-title")) {
    if (a.closest("ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer")) continue;
    out.push({ href: a.getAttribute("href") || "", title: a.getAttribute("title") || a.textContent || "" });
    if (out.length >= 8) break;
  }
  return { host: location.hostname, results: out };
}
function pagePlayVideo() {
  const v = document.querySelector("video");
  if (!v) return null;
  if (v.paused) { try { v.play(); } catch (e) {} }
  return { paused: v.paused, ad: !!document.querySelector(".ad-showing"), title: document.title.replace(/ - YouTube$/, "") };
}

// ------------------------------------------------------------------ the tools
const tools = {
  async chrome_tabs() {
    const list = await pages();
    if (!list.length) return "Chrome is open with no tabs.";
    const cur = list.find((t) => t.id === activeId) || list[0];
    return list.map((t, i) => `${i + 1}${t.id === cur.id ? "*" : " "} ${(t.title || "(untitled)").slice(0, 70)} — ${(t.url || "").slice(0, 100)}`).join("\n") + "\n(* = the tab Aegis is working in)";
  },

  async chrome_open({ url }) {
    const u = allowedUrl(url);
    await ensureChrome();
    const t = await httpJson("PUT", "/json/new?" + u, 10000);
    activeId = t.id;
    const c = await connect(t);
    await waitLoaded(c);
    return `Opened in a new tab: ${await describeTab(c)}`;
  },

  async chrome_go({ url, tab }) {
    const u = allowedUrl(url);
    const c = await conn(tab);
    const r = await c.send("Page.navigate", { url: u });
    if (r.errorText) throw new Error(`could not load the page (${r.errorText})`);
    await waitLoaded(c);
    return `Now at: ${await describeTab(c)}${note(c)}`;
  },

  async chrome_nav({ action, tab }) {
    const a = String(action || "").toLowerCase();
    const c = await conn(tab);
    if (a === "reload" || a === "refresh") await c.send("Page.reload");
    else if (a === "back" || a === "forward") {
      const h = await c.send("Page.getNavigationHistory");
      const i = h.currentIndex + (a === "back" ? -1 : 1);
      if (i < 0 || i >= h.entries.length) return `There is no page to go ${a} to.`;
      await c.send("Page.navigateToHistoryEntry", { entryId: h.entries[i].id });
    } else throw new Error("action must be back, forward or reload");
    await waitLoaded(c);
    return `${a}: ${await describeTab(c)}${note(c)}`;
  },

  async chrome_switch({ tab }) {
    const t = await resolveTab(tab);
    activeId = t.id;
    await httpJson("GET", "/json/activate/" + t.id).catch(() => {});
    return `Switched to: ${t.title || "(untitled)"} — ${t.url}`;
  },

  async chrome_close({ tab }) {
    const t = await resolveTab(tab);
    const c = conns.get(t.id); if (c) c.close();
    conns.delete(t.id);
    await httpJson("GET", "/json/close/" + t.id);
    if (activeId === t.id) activeId = null;
    for (let i = 0; i < 20 && (await pages()).some((p) => p.id === t.id); i++) await sleep(100);   // Chrome closes tabs asynchronously
    return `Closed: ${t.title || t.url}`;
  },

  async chrome_read({ page, tab }) {
    const c = await conn(tab);
    const p = await c.run(pageText);
    const size = 8000, total = Math.max(1, Math.ceil(p.text.length / size)), n = Math.min(total, Math.max(1, Number(page) || 1));
    return `${p.title}\n${p.url}\n(page ${n} of ${total})\n\n${p.text.slice((n - 1) * size, n * size) || "(the page has no readable text)"}${note(c)}`;
  },

  async chrome_elements({ filter, tab, badges, hide }) {
    const c = await conn(tab);
    if (hide) { await c.run(pageBadges, false); return "Numbers hidden."; }
    const els = await c.run(pageMarkElements, filter || "");
    if (badges) await c.run(pageBadges, true);
    if (!els.length) return "No clickable or editable elements found" + (filter ? ` matching "${filter}"` : "") + ". Try chrome_read or scroll.";
    const line = (e) => `${e.i} [${e.kind}${e.disabled ? ", disabled" : ""}${e.checked != null ? (e.checked ? ", checked" : ", unchecked") : ""}${e.inView ? "" : ", off-screen"}] ${e.text}` +
      (e.label ? ` (label: ${e.label})` : "") + (e.placeholder ? ` (placeholder: ${e.placeholder})` : "") + (e.value ? ` = "${e.value}"` : "") + (e.options ? ` {${e.options.join(" | ")}}` : "") + (e.href ? ` → ${e.href}` : "");
    return `${await describeTab(c)}\n` + els.map(line).join("\n") + "\n(Use these numbers with chrome_click / chrome_type. They are only valid until the page changes.)";
  },

  async chrome_click({ index, selector, text, approved, double, tab }) {
    const c = await conn(tab);
    const t = await c.run(pageResolve, { index, selector, text });
    if (t.error) throw new Error(t.error);
    if (t.disabled) throw new Error(`"${t.label}" is disabled`);
    if (!approved && (SENSITIVE.test(t.label) || (t.type === "submit" && SENSITIVE.test(t.label + " " + t.form)))) {
      return need(`Clicking "${t.label}" looks like it could buy, send, post, delete or accept something.`);
    }
    await mouseClick(c, t.x, t.y, double ? 2 : 1);
    await sleep(350);
    await waitLoaded(c, 8000);
    return `Clicked "${t.label}". Now: ${await describeTab(c)}${note(c)}`;
  },

  // Type into a field. Point at it with index (from chrome_elements), selector, or field (its label / placeholder / nearby caption).
  async chrome_type({ text, index, selector, field, clear, submit, tab }) {
    const c = await conn(tab);
    const typed = String(text ?? "");
    const t = await c.run(pageResolve, { index, selector, text: field });
    if (t.error) throw new Error(t.error);
    if (t.type === "password") throw new Error("I never type into password fields. Please type the password yourself, then tell me to continue.");
    if (t.tag === "SELECT") {
      const r = await c.run(pageSetSelect, typed);
      if (r.error) throw new Error(r.error);
      return `Chose "${r.chose}" in the dropdown "${t.label}".`;
    }
    if (t.tag === "INPUT" && /^(checkbox|radio|button|submit|file|image|reset)$/.test(t.type)) throw new Error(`that is a ${t.type}, not a text field. Use chrome_click.`);
    if (!/^(INPUT|TEXTAREA)$/.test(t.tag) && !t.editable) throw new Error(`"${t.label}" is not something I can type into`);
    if (!typed && !submit) throw new Error("nothing to type");
    await c.run(pageFocusAndClear, clear !== false);
    if (typed) await c.send("Input.insertText", { text: typed });
    if (submit) { await pressKey(c, "enter"); await sleep(400); await waitLoaded(c, 8000); }
    return `Typed ${typed.length} characters into "${t.label}"${submit ? " and pressed Enter. Now: " + (await describeTab(c)) : "."}${note(c)}`;
  },

  async chrome_key({ keys, approved, tab }) {
    const c = await conn(tab);
    if (/(?:ctrl|cmd|meta|control)\s*\+\s*enter/i.test(keys || "") && !approved) return need(`${keys} usually sends or submits what is on the page.`);
    await pressKey(c, keys);
    await sleep(200);
    return `Pressed ${keys}.${note(c)}`;
  },

  async chrome_scroll({ direction, amount, tab }) {
    const c = await conn(tab);
    const d = String(direction || "down").toLowerCase();
    const r = await c.run((dir, pages) => {
      const h = window.innerHeight * 0.85;
      if (dir === "top") window.scrollTo(0, 0);
      else if (dir === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
      else window.scrollBy(0, (dir === "up" ? -1 : 1) * h * pages);
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return { pct: Math.round((window.scrollY / max) * 100), atEnd: window.scrollY >= max - 2 };
    }, d, Math.max(0.1, Math.min(10, Number(amount) || 1)));
    await sleep(250);
    return `Scrolled ${d}: now ${r.pct}% down the page${r.atEnd ? " (the end)" : ""}.`;
  },

  async chrome_find({ text, tab }) {
    if (!String(text || "").trim()) throw new Error("nothing to search for");
    const c = await conn(tab);
    const r = await c.run((q) => {
      const body = document.body.innerText, low = body.toLowerCase(), n = q.toLowerCase();
      const out = []; let i = 0, count = 0;
      while ((i = low.indexOf(n, i)) !== -1) { count++; if (out.length < 8) out.push(body.slice(Math.max(0, i - 60), i + n.length + 80).replace(/\s+/g, " ")); i += n.length; }
      return { count, out };
    }, String(text));
    return r.count ? `Found ${r.count} match${r.count > 1 ? "es" : ""}:\n` + r.out.map((s, i) => `${i + 1}. …${s}…`).join("\n") : `"${text}" is not on this page.`;
  },

  async chrome_wait({ ms, text, selector, tab }) {
    const c = await conn(tab);
    if (!text && !selector) { const n = Math.max(0, Math.min(30000, Number(ms) || 1000)); await sleep(n); return `Waited ${n} ms.`; }
    const limit = Math.max(1000, Math.min(30000, Number(ms) || 15000)), t0 = Date.now();
    while (Date.now() - t0 < limit) {
      const ok = await c.run((t, s) => { try { return !!((s && document.querySelector(s)) || (t && document.body.innerText.toLowerCase().includes(String(t).toLowerCase()))); } catch { return false; } }, text || "", selector || "");
      if (ok) return `It appeared after ${Math.round((Date.now() - t0) / 100) / 10} s.`;
      await sleep(300);
    }
    return `Still not there after ${Math.round(limit / 1000)} s.`;
  },

  async chrome_screenshot({ full_page, tab }) {
    const c = await conn(tab);
    const r = await c.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!full_page, fromSurface: true }, 45000);
    const dir = process.env.AEGIS_SHOT_DIR || path.join(os.homedir(), "Pictures");
    await fs.promises.mkdir(dir, { recursive: true });
    const out = path.join(dir, `aegis_chrome_${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    await fs.promises.writeFile(out, Buffer.from(r.data, "base64"));
    return `Screenshot of "${await describeTab(c)}" saved to ${out}`;
  },

  async chrome_youtube_play({ query }) {
    const searchUrl = youtubeSearchUrl(query);
    const list = await pages();
    let t = list.find((p) => /^https?:\/\/(?:www\.)?youtube\.com\//i.test(p.url || ""));   // reuse the YouTube tab: no pile of tabs
    if (!t) t = await httpJson("PUT", "/json/new?about:blank", 10000);
    activeId = t.id;
    const c = await connect(t);
    await httpJson("GET", "/json/activate/" + t.id).catch(() => {});
    const go = async (url) => {
      const r = await c.send("Page.navigate", { url });
      if (r.errorText) throw new Error(`could not reach YouTube (${r.errorText})`);
      await waitLoaded(c);
    };
    await go(searchUrl);
    let found = null;
    for (let i = 0; i < 40 && !found; i++) {
      const r = await c.run(pageYoutubeResults);
      if (/^consent\./.test(r.host)) return "YouTube is showing its cookie notice in the Aegis Chrome window. Click Accept or Reject there once, then ask me again.";
      found = pickYoutubeResult(r.results);
      if (!found) await sleep(300);
    }
    if (!found) return `YouTube showed no playable video for "${String(query).trim()}". Try different words.`;
    await go(found.url);
    let state = null;
    for (let i = 0; i < 40 && !state; i++) {
      state = await c.run(pagePlayVideo);
      if (!state) await sleep(250);
    }
    if (!state) return `Opened "${found.title}" (${found.url}) but the video player did not appear. Press play in the Chrome window.`;
    await sleep(1200);
    state = (await c.run(pagePlayVideo)) || state;
    return state.paused
      ? `Opened "${found.title}" on YouTube (${found.url}) but it is paused: the browser blocked autoplay. Press play in the Chrome window.`
      : `Playing "${found.title}" on YouTube.${state.ad ? " An ad is playing first; the song starts right after it." : ""}`;
  },

  async chrome_media({ action, value, tab }) {
    const c = await conn(tab);
    const r = await c.run(pageMedia, String(action || ""), String(value ?? ""));
    if (r && r.error) throw new Error(r.error);
    return (r && r.msg) || "Done.";
  },

  async chrome_eval({ js, tab }) {
    if (!String(js || "").trim()) throw new Error("no JavaScript given");
    const c = await conn(tab);
    const r = await c.send("Runtime.evaluate", { expression: String(js), returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || "script error");
    const v = r.result && r.result.value !== undefined ? r.result.value : r.result && r.result.description;
    return trim(typeof v === "string" ? v : JSON.stringify(v), 4000) || "(no value)";
  },
};

function shutdown() { for (const c of conns.values()) c.close(); conns.clear(); activeId = null; }

module.exports = { tools, allowedUrl, parseKeys, chromePath, profileDir, shutdown, SENSITIVE, youtubeSearchUrl, pickYoutubeResult, _port: port };
