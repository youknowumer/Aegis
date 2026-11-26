/* Aegis landing UI: the details sheet, the Windows download button and the live release info.
   Classic script (not a module) so the buttons keep working even if the 3D scene cannot load. */
(() => {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const cfg = window.AEGIS_CONFIG || {};
  const url = /^https:\/\//.test(cfg.DOWNLOAD_URL || "") ? cfg.DOWNLOAD_URL : "downloads/Aegis-Setup.exe";
  const repo = /^[\w.-]+\/[\w.-]+$/.test(cfg.GITHUB_REPO || "") ? cfg.GITHUB_REPO : "";
  const toast = $("#toast");
  let missing = false, toastTimer = 0;

  const say = (html, ms) => {
    if (!toast) return;
    toast.innerHTML = html; toast.classList.add("on");
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => toast.classList.remove("on"), ms);
  };

  /* download buttons (pill + sheet) */
  document.querySelectorAll("[data-download]").forEach((a) => {
    a.setAttribute("href", url);
    a.setAttribute("download", "Aegis-Setup.exe");
    a.addEventListener("click", (e) => {
      if (missing) {
        e.preventDefault();
        say("<b>The installer is not uploaded yet.</b> The <a href=\"app.html\">web app</a> works today.", 7000);
        return;
      }
      say("Download started: <b>Aegis-Setup.exe</b>. Open it when it finishes. If SmartScreen appears, choose <b>More info</b>, then <b>Run anyway</b>.", 9000);
    });
  });

  /* release info from GitHub (optional, silent on failure) */
  const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  const put = (id, text) => { const el = document.getElementById(id); if (!el) return; el.textContent = text; const box = el.closest("div"); if (box) box.hidden = false; };
  if (repo) {
    fetch("https://api.github.com/repos/" + repo + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => { if (r.status === 404) { missing = true; return null; } if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then((j) => {
        if (!j) return;
        const a = (j.assets || []).find((x) => /\.exe$/i.test(x.name || ""));
        if (!a) { missing = true; return; }
        put("rel-file", a.name); put("rel-size", fmtSize(a.size));
        if (j.tag_name || j.name) put("rel-ver", j.tag_name || j.name);
        if (j.published_at) { try { put("rel-date", new Date(j.published_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })); } catch (e) { /* ignore */ } }
        const all = document.getElementById("rel-all"); if (all && j.html_url) all.href = j.html_url;
      })
      .catch(() => { /* GitHub unreachable: the button still downloads */ });
  }

  /* details sheet */
  const sheet = $("#sheet");
  if (!sheet) return;
  let opener = null;
  const open = (from) => {
    opener = from || document.activeElement;
    sheet.classList.add("open"); sheet.removeAttribute("inert"); sheet.setAttribute("aria-hidden", "false");
    sheet.scrollTop = 0;
    const x = $("#sheet-x"); if (x) x.focus({ preventScroll: true });
    if (location.hash !== "#details") history.replaceState(null, "", "#details");
  };
  const close = () => {
    sheet.classList.remove("open"); sheet.setAttribute("inert", ""); sheet.setAttribute("aria-hidden", "true");
    if (location.hash === "#details") history.replaceState(null, "", location.pathname + location.search);
    if (opener && opener.focus) opener.focus({ preventScroll: true });
  };
  document.querySelectorAll("[data-open-sheet]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); open(b); }));
  document.querySelectorAll("[data-close-sheet]").forEach((b) => b.addEventListener("click", close));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet.classList.contains("open")) close(); });
  sheet.querySelectorAll("a[href^='#']").forEach((a) => a.addEventListener("click", (e) => {
    const el = document.getElementById(a.getAttribute("href").slice(1));
    if (el && sheet.contains(el)) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }));
  sheet.addEventListener("pointermove", (e) => {
    const c = e.target.closest && e.target.closest(".cap"); if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px");
  });
  if (location.hash === "#details") open(null);
})();
