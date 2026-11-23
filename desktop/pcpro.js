"use strict";
/**
 * v12 deeper PC awareness and control: system_report, window_control, set_brightness, power_action, network_check.
 * Windows-only where it needs Windows. The pure parts (key plans, scripts, parsers) are exported so tests can check them
 * without touching a real machine.
 */
const os = require("os");
const { execFile } = require("child_process");

const IS_WIN = process.platform === "win32";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 25000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim().slice(0, 500)));
      else resolve(stdout.toString().trim());
    });
  });
}
const ps = (script) => run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);

// ---- window control: SendKeys sequences (^ ctrl, % alt, + shift) and one Win-key combo through a tiny C# helper
const WINDOW_KEYS = {
  minimize: { win: "{DOWN}" },              // Win+Down (restores a maximized window first, then minimizes)
  maximize: { win: "{UP}" },
  restore: { win: "{DOWN}" },
  snap_left: { win: "{LEFT}" },
  snap_right: { win: "{RIGHT}" },
  show_desktop: { win: "d" },
  minimize_all: { win: "m" },
  task_view: { win: "{TAB}" },
  new_desktop: { winCtrl: "d" },
  next_desktop: { winCtrl: "{RIGHT}" },
  previous_desktop: { winCtrl: "{LEFT}" },
  screenshot_tool: { winShift: "s" },
  next_window: { plain: "%{ESC}" },
  close_window: { plain: "%{F4}" },
};

function windowPlan(action) {
  const a = String(action || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  const p = Object.prototype.hasOwnProperty.call(WINDOW_KEYS, a) ? WINDOW_KEYS[a] : null;
  if (!p) throw new Error("action must be one of: " + Object.keys(WINDOW_KEYS).join(", "));
  return { action: a, ...p };
}

// Windows has no SendKeys for the Win key, so press it through user32 keybd_event.
function winKeyScript(plan) {
  const vk = { "{DOWN}": 0x28, "{UP}": 0x26, "{LEFT}": 0x25, "{RIGHT}": 0x27, "{TAB}": 0x09 };
  const code = (k) => (vk[k] !== undefined ? vk[k] : k.toUpperCase().charCodeAt(0));
  const mods = plan.win !== undefined ? [] : plan.winCtrl !== undefined ? [0x11] : [0x10];
  const key = code(plan.win !== undefined ? plan.win : plan.winCtrl !== undefined ? plan.winCtrl : plan.winShift);
  const down = [0x5b, ...mods, key], up = [key, ...mods.slice().reverse(), 0x5b];
  return (
    "Add-Type -Namespace W -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, int e);';" +
    down.map((c) => `[W.K]::keybd_event(${c},0,0,0);`).join("") +
    up.map((c) => `[W.K]::keybd_event(${c},0,2,0);`).join("")
  );
}

// ---- brightness
function brightnessScript(level) {
  const n = Number(level);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("brightness must be 0-100");
  return `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${Math.round(n)})`;
}

// ---- power
function powerPlan(action) {
  const a = String(action || "").toLowerCase().trim();
  switch (a) {
    case "sleep": return { cmd: "rundll32.exe", args: ["powrprof.dll,SetSuspendState", "0,1,0"], say: "Putting the PC to sleep" };
    case "hibernate": return { cmd: "shutdown", args: ["/h"], say: "Hibernating" };
    case "restart": return { cmd: "shutdown", args: ["/r", "/t", "60"], say: "Restarting in 60 seconds. Say cancel to stop it" };
    case "shutdown": return { cmd: "shutdown", args: ["/s", "/t", "60"], say: "Shutting down in 60 seconds. Say cancel to stop it" };
    case "cancel": return { cmd: "shutdown", args: ["/a"], say: "Pending shutdown cancelled" };
    default: throw new Error("action must be sleep, hibernate, restart, shutdown or cancel");
  }
}

// ---- parsers
function parseTopProcesses(csvText, n = 5) {
  // `Get-Process | Sort WS -desc | select -first N Name,WS | ConvertTo-Csv`
  const rows = [];
  for (const line of String(csvText || "").split(/\r?\n/).slice(1)) {
    const m = line.match(/^"([^"]+)","?(\d+)"?/);
    if (m) rows.push(`${m[1]} ${(Number(m[2]) / 1048576).toFixed(0)} MB`);
    if (rows.length >= n) break;
  }
  return rows;
}

function parseBattery(text) {
  const m = String(text || "").trim().match(/^(\d+)\s*,\s*(\d+)/);
  if (!m) return "no battery (desktop PC or unknown)";
  const pct = Number(m[1]);
  const status = Number(m[2]);
  const charging = status === 2 || (status >= 6 && status <= 9);
  return `${pct}%${charging ? ", charging" : ", on battery"}`;
}

function cpuLoadPercent(before, after) {
  let idle = 0, total = 0;
  for (let i = 0; i < after.length; i++) {
    const a = after[i].times, b = (before[i] || after[i]).times;
    const di = a.idle - b.idle;
    const dt = a.user + a.nice + a.sys + a.idle + a.irq - (b.user + b.nice + b.sys + b.idle + b.irq);
    idle += di; total += dt;
  }
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tools = {
  async system_report() {
    const before = os.cpus();
    await sleep(400);
    const after = os.cpus();
    const total = os.totalmem(), free = os.freemem();
    const lines = [
      `CPU: ${after[0] ? after[0].model.trim() : "unknown"}, ${after.length} cores, load about ${cpuLoadPercent(before, after)}%`,
      `Memory: ${Math.round(((total - free) / total) * 100)}% used of ${(total / 1e9).toFixed(1)} GB`,
      `Uptime: ${(os.uptime() / 3600).toFixed(1)} hours`,
    ];
    try {
      const fs = require("fs");
      const s = await fs.promises.statfs(os.homedir());
      lines.push(`Disk: ${((s.bavail * s.bsize) / 1e9).toFixed(0)} GB free of ${((s.blocks * s.bsize) / 1e9).toFixed(0)} GB`);
    } catch {}
    if (IS_WIN) {
      try { lines.push("Battery: " + parseBattery(await ps("$b=Get-CimInstance Win32_Battery; if($b){\"$($b.EstimatedChargeRemaining),$($b.BatteryStatus)\"}"))); } catch {}
      try {
        const top = parseTopProcesses(await ps("Get-Process | Sort-Object WS -Descending | Select-Object -First 5 Name,WS | ConvertTo-Csv -NoTypeInformation"));
        if (top.length) lines.push("Hungriest programs: " + top.join(", "));
      } catch {}
    } else {
      lines.push("Battery and program list: Windows only");
    }
    const nets = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal);
    if (nets.length) lines.push("IP: " + nets.map((i) => i.address).join(", "));
    return lines.join("\n");
  },

  async window_control({ action }) {
    if (!IS_WIN) throw new Error("window control is only supported on Windows");
    const plan = windowPlan(action);
    if (plan.plain) {
      await ps(`$w = New-Object -ComObject WScript.Shell; $w.SendKeys('${plan.plain}')`);
    } else {
      await ps(winKeyScript(plan));
    }
    return `Done: ${plan.action.replace(/_/g, " ")}`;
  },

  async set_brightness({ level }) {
    if (!IS_WIN) throw new Error("brightness is only supported on Windows");
    await ps(brightnessScript(level));
    return `Brightness set to ${Math.round(Number(level))}%`;
  },

  async power_action({ action }) {
    if (!IS_WIN) throw new Error("power actions are only supported on Windows");
    const p = powerPlan(action);
    await run(p.cmd, p.args);
    return p.say;
  },

  async network_check() {
    const lines = [];
    const t0 = Date.now();
    try {
      const { net } = require("electron");
      const r = await Promise.race([net.fetch("https://www.gstatic.com/generate_204"), sleep(6000).then(() => { throw new Error("timeout"); })]);
      lines.push(`Internet: reachable (HTTP ${r.status}), reply in ${Date.now() - t0} ms`);
    } catch (e) {
      lines.push(`Internet: not reachable (${e.message})`);
    }
    if (IS_WIN) {
      try {
        const out = await run("netsh", ["wlan", "show", "interfaces"]);
        const ssid = out.match(/^\s*SSID\s*:\s*(.+)$/m), sig = out.match(/^\s*Signal\s*:\s*(.+)$/m);
        if (ssid) lines.push(`Wi-Fi: ${ssid[1].trim()}${sig ? ", signal " + sig[1].trim() : ""}`);
      } catch {}
    }
    const nets = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal);
    if (nets.length) lines.push("IP: " + nets.map((i) => i.address).join(", "));
    return lines.join("\n");
  },
};

module.exports = { tools, windowPlan, winKeyScript, brightnessScript, powerPlan, parseTopProcesses, parseBattery, cpuLoadPercent, WINDOW_KEYS };
