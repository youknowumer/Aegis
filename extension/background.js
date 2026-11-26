"use strict";
// Aegis Web Hands: keeps one websocket open to your Aegis server and runs the chrome_* tools Aegis asks for in THIS browser.
importScripts("tools.js");

const STATE_KEY = "aegisActiveTab";
const store = { activeId: null };
const hands = AegisWebTools.createTools(chrome, store);

let ws = null;
let retry = 0;
let reconnectTimer = null;
let pingTimer = null;
let status = { state: "off", detail: "Not set up yet." };

function setStatus(state, detail) {
  status = { state, detail };
  try { chrome.action.setBadgeText({ text: state === "on" ? "ON" : state === "error" ? "!" : "" }); } catch (e) {}
  try { chrome.action.setBadgeBackgroundColor({ color: state === "on" ? "#16a34a" : "#dc2626" }); } catch (e) {}
  try { chrome.runtime.sendMessage({ type: "status", status }).catch(() => {}); } catch (e) {}
}

async function config() {
  const c = await chrome.storage.local.get(["server", "token"]);
  return { server: String(c.server || "").replace(/\/+$/, ""), token: String(c.token || "") };
}

async function connect() {
  clearTimeout(reconnectTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const { server, token } = await config();
  if (!server || !token) return setStatus("off", "Paste your connection code in this popup.");
  let url;
  try { url = server.replace(/^http/i, "ws") + "/ws"; new URL(url); } catch (e) { return setStatus("error", "The server address is not valid."); }
  setStatus("connecting", "Connecting to " + server + " ...");
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ type: "auth", token, role: "browser" }));
  sock.onmessage = async (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === "ready") {
      retry = 0;
      setStatus("on", "Connected. Aegis can use this browser.");
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { try { sock.send(JSON.stringify({ type: "ping" })); } catch (e) {} }, 20000); // keeps the service worker awake while connected
    } else if (m.type === "tool_request") {
      const result = await hands.handle(String(m.name || ""), m.args);
      try { sock.send(JSON.stringify({ type: "tool_result", id: m.id, result })); } catch (e) {}
    }
  };
  sock.onclose = (ev) => {
    clearInterval(pingTimer);
    if (ws === sock) ws = null;
    if (ev.code === 4401) return setStatus("error", "The login has expired. Copy a new connection code from Aegis.");
    if (ev.code === 4403) return setStatus("error", "The server refused this browser (origin not allowed).");
    if (ev.code === 4000) return setStatus("off", "Another browser took over the connection.");
    setStatus("connecting", "Connection lost. Retrying ...");
    reconnectTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
  };
  sock.onerror = () => {};
}

function disconnect() {
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  if (ws) { try { ws.close(1000); } catch (e) {} ws = null; }
  setStatus("off", "Disconnected.");
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg && msg.type === "get-status") reply(status);
  else if (msg && msg.type === "connect") { retry = 0; disconnect(); connect().then(() => reply(status)); return true; }
  else if (msg && msg.type === "disconnect") { disconnect(); reply(status); }
});

// the service worker can be stopped by the browser: wake up regularly and reconnect
chrome.alarms.create("aegis-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "aegis-keepalive") connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
