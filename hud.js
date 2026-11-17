// HUD widgets: date/time, live system gauges, weather. Everything reads real browser data; no keys needed.
// Weather uses Open-Meteo (free, no account). Location is only requested when you press the button.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  const bar = (id, pct) => { const el = $(id); if (el) el.style.width = Math.max(0, Math.min(100, pct)) + "%"; };
  const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const started = Date.now();

  // ---------------------------------------------------------------- clock
  function clock() {
    const d = new Date();
    txt("hud-day", pad(d.getDate()));
    txt("hud-month", d.toLocaleDateString([], { month: "long" }).toUpperCase());
    txt("hud-weekday", d.toLocaleDateString([], { weekday: "long" }).toUpperCase());
    txt("hud-time", pad(d.getHours()) + ":" + pad(d.getMinutes()));
    txt("hud-sec", pad(d.getSeconds()));
    const up = Math.floor((Date.now() - started) / 1000);
    txt("v-up", pad(Math.floor(up / 3600)) + ":" + pad(Math.floor(up / 60) % 60) + ":" + pad(up % 60));
  }
  function weekStrip() {
    const el = $("hud-week");
    if (!el) return;
    const now = new Date(), mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    el.textContent = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon); d.setDate(mon.getDate() + i);
      const c = document.createElement("span");
      c.innerHTML = "<small></small><b></b>";
      c.firstChild.textContent = d.toLocaleDateString([], { weekday: "narrow" });
      c.lastChild.textContent = d.getDate();
      if (d.toDateString() === now.toDateString()) c.className = "today";
      el.appendChild(c);
    }
  }

  // ---------------------------------------------------------------- system gauges
  let frames = 0, lastFps = performance.now();
  function fpsLoop(now) {
    frames++;
    if (now - lastFps >= 1000) { txt("sys-fps", Math.round((frames * 1000) / (now - lastFps)) + " fps"); frames = 0; lastFps = now; }
    requestAnimationFrame(fpsLoop);
  }

  async function battery() {
    if (!navigator.getBattery) { txt("v-bat", "n/a"); return; }
    try {
      const b = await navigator.getBattery();
      const show = () => { bar("g-bat", b.level * 100); txt("v-bat", Math.round(b.level * 100) + "%" + (b.charging ? " +" : "")); };
      show(); b.addEventListener("levelchange", show); b.addEventListener("chargingchange", show);
    } catch { txt("v-bat", "n/a"); }
  }

  function network() {
    const c = navigator.connection || navigator.mozConnection;
    if (!navigator.onLine) { bar("g-net", 0); txt("v-net", "offline"); return; }
    if (c && c.downlink) { bar("g-net", (c.downlink / 20) * 100); txt("v-net", c.downlink + " Mb/s"); }
    else { bar("g-net", 100); txt("v-net", "online"); }
  }

  function memory() {
    const pm = performance.memory;
    if (pm && pm.jsHeapSizeLimit) {
      bar("g-mem", (pm.usedJSHeapSize / pm.jsHeapSizeLimit) * 100);
      txt("v-mem", Math.round(pm.usedJSHeapSize / 1048576) + " MB");
    } else if (navigator.deviceMemory) { bar("g-mem", 100); txt("v-mem", navigator.deviceMemory + " GB"); }
    else txt("v-mem", "n/a");
  }

  async function latency() {
    const base = String((window.AEGIS_CONFIG || {}).API_BASE || "").replace(/\/+$/, "");
    if (/YOUR-AEGIS-SERVER/i.test(base)) { txt("v-lat", "no server"); bar("g-lat", 0); return; }
    const t = performance.now();
    try {
      const r = await fetch(base + "/healthz", { cache: "no-store" });
      if (!r.ok) throw 0;
      const ms = Math.round(performance.now() - t);
      bar("g-lat", 100 - Math.min(100, ms / 8)); txt("v-lat", ms + " ms");
    } catch { bar("g-lat", 0); txt("v-lat", "down"); }
  }

  // ---------------------------------------------------------------- weather
  const WX = [[0, "Clear"], [1, "Mostly clear"], [2, "Partly cloudy"], [3, "Overcast"], [45, "Fog"], [48, "Fog"],
    [51, "Light drizzle"], [53, "Drizzle"], [55, "Heavy drizzle"], [61, "Light rain"], [63, "Rain"], [65, "Heavy rain"],
    [71, "Light snow"], [73, "Snow"], [75, "Heavy snow"], [80, "Showers"], [81, "Showers"], [82, "Heavy showers"],
    [95, "Thunderstorm"], [96, "Thunderstorm"], [99, "Thunderstorm"]];
  const wxName = (c) => (WX.slice().reverse().find((x) => c >= x[0]) || [0, "--"])[1];
  const LOC_KEY = "aegis_wx_loc";

  let lastWx = "";
  async function loadWeather(loc) {
    try {
      const u = "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
        "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=auto";
      const r = await fetch(u);
      if (!r.ok) throw 0;
      const d = await r.json();
      const c = d.current;
      txt("wx-place", loc.name || "");
      txt("wx-t", Math.round(c.temperature_2m));
      txt("wx-desc", wxName(c.weather_code));
      txt("wx-extra", "Humidity " + c.relative_humidity_2m + "%  |  Wind " + Math.round(c.wind_speed_10m) + " km/h");
      const box = $("wx-days"); box.textContent = "";
      d.daily.time.slice(1).forEach((t, i) => {
        const row = document.createElement("div");
        const n = document.createElement("span"), w = document.createElement("span"), m = document.createElement("b");
        n.textContent = new Date(t + "T12:00").toLocaleDateString([], { weekday: "short" });
        w.textContent = wxName(d.daily.weather_code[i + 1]); w.className = "muted";
        m.textContent = Math.round(d.daily.temperature_2m_max[i + 1]) + "° / " + Math.round(d.daily.temperature_2m_min[i + 1]) + "°";
        row.append(n, w, m); box.appendChild(row);
      });
      lastWx = (loc.name || "Your location") + ": " + Math.round(c.temperature_2m) + " degrees, " + wxName(c.weather_code).toLowerCase() +
        ", humidity " + c.relative_humidity_2m + " percent, wind " + Math.round(c.wind_speed_10m) + " kilometres per hour. Tomorrow " +
        wxName(d.daily.weather_code[1]).toLowerCase() + ", " + Math.round(d.daily.temperature_2m_max[1]) + " degrees at most.";
      $("wx-setup").classList.add("hidden");
      ["wx-now", "wx-days", "wx-change"].forEach((id) => $(id).classList.remove("hidden"));
      return true;
    } catch { txt("wx-place", "weather unavailable"); return false; }
  }

  async function setLoc(loc) { const ok = await loadWeather(loc); if (ok) store.set(LOC_KEY, JSON.stringify(loc)); return ok; }

  // ---------------------------------------------------------------- public API for voice commands
  async function geocode(q) {
    const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + encodeURIComponent(q));
    const d = await r.json();
    if (!d.results || !d.results.length) return null;
    const g = d.results[0];
    return { lat: g.latitude, lon: g.longitude, name: g.name + (g.country_code ? ", " + g.country_code : "") };
  }
  window.AegisHUD = {
    async setCity(city) {
      try {
        const loc = await geocode(city);
        if (!loc) return "I couldn't find a place called " + city + ".";
        return (await setLoc(loc)) ? lastWx : "The weather service isn't reachable right now.";
      } catch { return "The weather service isn't reachable right now."; }
    },
    weatherSummary() { return lastWx || "Tell me a city, for example: weather in Lahore. Or press Use my location in the weather panel."; },
    statusLine() {
      const parts = [];
      const bat = $("v-bat").textContent, net = $("v-net").textContent, mem = $("v-mem").textContent, lat = $("v-lat").textContent;
      if (bat && bat !== "--" && bat !== "n/a") parts.push("battery " + bat.replace("+", "and charging"));
      parts.push("network " + (net === "offline" ? "offline" : net));
      if (mem && mem !== "--" && mem !== "n/a") parts.push("browser memory " + mem);
      if (lat && lat !== "--" && lat !== "no server") parts.push("server latency " + lat);
      parts.push($("v-cpu").textContent);
      return "All systems nominal. " + parts.join(", ") + ".";
    },
  };

  // ---------------------------------------------------------------- 3D pointer parallax
  const appEl = $("app");
  const fine = window.matchMedia && matchMedia("(pointer: fine)").matches;
  const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (appEl && fine && !still) {
    let raf = 0, mx = 0, my = 0;
    window.addEventListener("pointermove", (e) => {
      mx = (e.clientX / innerWidth) * 2 - 1; my = (e.clientY / innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; appEl.style.setProperty("--mx", mx.toFixed(3)); appEl.style.setProperty("--my", my.toFixed(3)); });
    }, { passive: true });
  }

  function initWeather() {
    const saved = store.get(LOC_KEY);
    if (saved) { try { loadWeather(JSON.parse(saved)); } catch {} }
    $("wx-geo").addEventListener("click", () => {
      if (!navigator.geolocation) return txt("wx-place", "not supported");
      txt("wx-place", "locating...");
      navigator.geolocation.getCurrentPosition(
        (p) => setLoc({ lat: p.coords.latitude.toFixed(3), lon: p.coords.longitude.toFixed(3), name: "Your location" }),
        () => txt("wx-place", "permission denied: type a city"),
        { timeout: 10000 }
      );
    });
    $("wx-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = $("wx-city").value.trim();
      if (!q) return;
      txt("wx-place", "searching...");
      try {
        const loc = await geocode(q);
        if (!loc) return txt("wx-place", "city not found");
        setLoc(loc);
      } catch { txt("wx-place", "search failed"); }
    });
    $("wx-change").addEventListener("click", () => {
      store.set(LOC_KEY, null);
      $("wx-setup").classList.remove("hidden");
      ["wx-now", "wx-days", "wx-change"].forEach((id) => $(id).classList.add("hidden"));
      txt("wx-place", "");
    });
  }

  // ---------------------------------------------------------------- boot
  txt("v-cpu", navigator.hardwareConcurrency ? navigator.hardwareConcurrency + " cores" : "n/a");
  bar("g-cpu", navigator.hardwareConcurrency ? Math.min(100, (navigator.hardwareConcurrency / 16) * 100) : 0);
  weekStrip(); clock(); setInterval(clock, 1000); setInterval(weekStrip, 3600000);
  battery(); network(); memory(); latency();
  window.addEventListener("online", network); window.addEventListener("offline", network);
  const c = navigator.connection; if (c && c.addEventListener) c.addEventListener("change", network);
  setInterval(memory, 3000); setInterval(latency, 30000);
  requestAnimationFrame(fpsLoop);
  initWeather();
})();
