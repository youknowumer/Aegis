"use strict";
const { app, BrowserWindow, ipcMain, safeStorage, shell, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const tools = require("./tools");

// ------------------------------------------------------------------ config
// By default Aegis starts its own server inside the app (see local-server.js): nothing to deploy, works right after install.
// To use a server you host yourself instead, set the AEGIS_SERVER env var or put {"serverUrl": "https://aegis.example.com"}
// in <userData>/config.json.
const { LocalServer } = require("./local-server");

function userFile(name) { return path.join(app.getPath("userData"), name); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } }

// Extra folders Aegis may use besides Documents / Desktop / Downloads (and their OneDrive twins):
// put {"safeRoots": ["D:\\Work", "E:\\Odoo exports"]} in <userData>/config.json. Read once at start-up.
{
  const extra = readJson(userFile("config.json")).safeRoots;
  if (Array.isArray(extra)) {
    const clean = extra.filter((r) => typeof r === "string" && path.isAbsolute(r) && r.length > 3); // never "C:\\" or "/" itself
    if (clean.length) process.env.AEGIS_EXTRA_ROOTS = clean.join(path.delimiter);
  }
}

const REMOTE_URL = (process.env.AEGIS_SERVER || readJson(userFile("config.json")).serverUrl || "").replace(/\/+$/, "");
let SERVER_URL = REMOTE_URL;   // set to the local server's address once it is up (when REMOTE_URL is empty)
let SERVER_ORIGIN = REMOTE_URL ? new URL(REMOTE_URL).origin : "";
let APP_URL = REMOTE_URL ? REMOTE_URL + "/app.html" : ""; // the desktop app opens the app screen, not the marketing page
let localServer = null;

// The secret that signs logins to the local server is kept encrypted by the OS, like the session token below.
function loadSecret() {
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(fs.readFileSync(userFile("server-secret.bin"))) : null; } catch { return null; }
}
function saveSecret(secret) {
  try { if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(userFile("server-secret.bin"), safeStorage.encryptString(secret)); } catch {}
}

async function ensureServer() {
  if (REMOTE_URL) return SERVER_URL;
  if (!localServer) localServer = new LocalServer({ dataDir: app.getPath("userData"), loadSecret, saveSecret });
  const url = await localServer.start();
  SERVER_URL = url;
  SERVER_ORIGIN = new URL(url).origin;
  APP_URL = url + "/app.html";
  return url;
}

// ------------------------------------------------------------------ token storage (encrypted by the OS)
function saveToken(token) {
  const f = userFile("session.bin");
  try {
    if (!token) return fs.rmSync(f, { force: true });
    if (!safeStorage.isEncryptionAvailable()) return; // never store the token in plain text
    fs.writeFileSync(f, safeStorage.encryptString(token));
  } catch {}
}
function loadToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(userFile("session.bin")));
  } catch { return null; }
}

// ------------------------------------------------------------------ device connection (PC control)
let ws = null;
let token = null;
let retry = 0;
let reconnectTimer = null;

function connectDevice() {
  if (!token || ws) return;
  const socket = new WebSocket(SERVER_URL.replace(/^http/i, "ws") + "/ws");
  ws = socket;

  socket.on("open", () => {
    retry = 0;
    socket.send(JSON.stringify({ type: "auth", token, role: "device" }));
  });

  socket.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== "tool_request") return;
    const result = await tools.run(msg.name, msg.args);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "tool_result", id: msg.id, result }));
    }
  });

  socket.on("close", (code) => {
    if (ws === socket) ws = null;
    if (code === 4401) { token = null; saveToken(null); return; } // token no longer valid
    if (code === 4000) return; // replaced by another desktop session
    if (!token) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectDevice, Math.min(30000, 1000 * 2 ** retry++));
  });
  socket.on("error", () => {}); // "close" handles reconnects
}

function setToken(t) {
  token = t || null;
  saveToken(token);
  if (!token) {
    clearTimeout(reconnectTimer);
    if (ws) { const s = ws; ws = null; s.close(); }
    return;
  }
  if (ws) { const s = ws; ws = null; s.removeAllListeners("close"); s.close(); }
  retry = 0;
  connectDevice();
}

// Only the Aegis web page itself may hand us a token.
ipcMain.handle("aegis:set-token", (event, t) => {
  let origin = "";
  try { origin = new URL(event.senderFrame.url).origin; } catch {}
  if (!SERVER_ORIGIN || origin !== SERVER_ORIGIN) return false;
  if (t !== null && (typeof t !== "string" || t.length > 4096)) return false;
  setToken(t);
  return true;
});

// ------------------------------------------------------------------ window
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: "#070b12",
    title: "Aegis",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);

  const openExternally = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { openExternally(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== SERVER_ORIGIN && !url.startsWith("file:")) { e.preventDefault(); openExternally(url); }
  });
  win.webContents.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, "offline.html"), { query: { server: SERVER_URL, error: "" } });
  });

  win.on("closed", () => { win = null; });
  launch();
}

// Splash screen while the server starts (a few seconds), then the app. A failure shows the "can't start" page with the reason.
async function launch() {
  if (!win) return;
  win.loadFile(path.join(__dirname, "splash.html")).catch(() => {});
  try {
    await ensureServer();
    if (win) win.loadURL(APP_URL);
  } catch (e) {
    if (win) win.loadFile(path.join(__dirname, "offline.html"), { query: { server: REMOTE_URL || "", error: String(e.message || e).slice(0, 400) } });
  }
}

ipcMain.handle("aegis:retry", async () => {
  if (!win) return;
  try { await ensureServer(); win.loadURL(APP_URL); } catch {}
});

// "play <song> on YouTube" typed or spoken in the app: start it in Chrome right away. Only the Aegis page itself may ask.
ipcMain.handle("aegis:play-youtube", async (event, query) => {
  let origin = "";
  try { origin = new URL(event.senderFrame.url).origin; } catch {}
  if (!SERVER_ORIGIN || origin !== SERVER_ORIGIN) return { ok: false, message: "not allowed" };
  if (typeof query !== "string" || !query.trim() || query.length > 200) return { ok: false, message: "I did not catch the song name." };
  const out = await tools.run("chrome_youtube_play", { query });
  return { ok: /^Playing /.test(out), message: out.replace(/^Error: /, "") };
});

// ------------------------------------------------------------------ lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    // Meeting "present mode": let the Aegis page capture the PC's own audio (what Meet / Zoom / Teams / any app plays) without a picker.
    // Windows supports system-audio loopback; elsewhere the page falls back to the microphone. Only the Aegis page itself may ask.
    try {
      const { session, desktopCapturer } = require("electron");
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        let origin = "";
        try { origin = new URL(request.frame.url).origin; } catch {}
        if (!SERVER_ORIGIN || origin !== SERVER_ORIGIN) return callback({});
        desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
          if (!sources.length) return callback({});
          const grant = { video: sources[0] };
          if (process.platform === "win32") grant.audio = "loopback";
          callback(grant);
        }).catch(() => callback({}));
      }, { useSystemPicker: false });
    } catch {}
    token = loadToken();
    createWindow();
    if (token) ensureServer().then(connectDevice).catch(() => {});
  });
  app.on("will-quit", () => { if (localServer) localServer.stop(); });
  app.on("window-all-closed", () => app.quit());
}
