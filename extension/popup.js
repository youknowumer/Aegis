"use strict";
const $ = (id) => document.getElementById(id);

// The connection code is base64 of {"s": server address, "t": login token}, made by Aegis (Settings > Browser control).
function parseCode(raw) {
  const txt = String(raw || "").trim();
  if (!txt) throw new Error("Paste the connection code first.");
  let obj;
  try { obj = JSON.parse(atob(txt.replace(/\s+/g, ""))); } catch (e) { throw new Error("That does not look like an Aegis connection code."); }
  if (!obj || typeof obj.s !== "string" || typeof obj.t !== "string" || !/^https?:\/\//i.test(obj.s) || obj.t.length < 20) throw new Error("That connection code is incomplete.");
  return { server: obj.s.replace(/\/+$/, ""), token: obj.t };
}

function show(st) {
  const s = st || { state: "off", detail: "" };
  $("pill").textContent = { on: "Connected", connecting: "Connecting", error: "Problem", off: "Not connected" }[s.state] || s.state;
  $("pill").className = "pill " + s.state;
  $("detail").textContent = s.detail || "";
}

$("save").addEventListener("click", async () => {
  $("err").textContent = "";
  try {
    const cfg = parseCode($("code").value);
    await chrome.storage.local.set(cfg);
    $("code").value = "";
    show(await chrome.runtime.sendMessage({ type: "connect" }));
  } catch (e) { $("err").textContent = e.message; }
});
$("off").addEventListener("click", async () => { await chrome.storage.local.remove(["token"]); show(await chrome.runtime.sendMessage({ type: "disconnect" })); });
chrome.runtime.onMessage.addListener((m) => { if (m && m.type === "status") show(m.status); });
chrome.runtime.sendMessage({ type: "get-status" }).then(show).catch(() => show(null));
