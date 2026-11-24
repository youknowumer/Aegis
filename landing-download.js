/* Aegis landing: Windows download button.
   - Uses DOWNLOAD_URL from config.js.
   - Asks GitHub (when GITHUB_REPO is set) which release is live, then shows version, size, date and download count.
   - If no release or installer exists yet, the button stays disabled and says so honestly.
   - If GitHub cannot be reached (offline, rate limit), the button still works with DOWNLOAD_URL. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const btn = $("dl-btn");
  if (!btn) return;
  const cfg = window.AEGIS_CONFIG || {};
  const url = cfg.DOWNLOAD_URL || "";
  const repo = /^[\w.-]+\/[\w.-]+$/.test(cfg.GITHUB_REPO || "") ? cfg.GITHUB_REPO : "";
  const status = $("dl-status");
  const say = (t, ok) => { if (status) { status.textContent = t; status.classList.toggle("ok", !!ok); } };

  const enable = (href) => {
    if (href) btn.setAttribute("href", href);
    btn.textContent = "Download for Windows";
    btn.classList.remove("disabled", "glass");
    btn.classList.add("solid");
    btn.setAttribute("aria-disabled", "false");
  };
  const disable = (label) => {
    btn.textContent = label;
    btn.classList.add("disabled");
    btn.classList.remove("solid");
    btn.setAttribute("aria-disabled", "true");
  };
  const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return "-"; } };
  const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };

  // Optimistic: an https link is trusted straight away (GitHub files cannot be probed by HEAD because of CORS).
  if (/^https:\/\//.test(url)) { enable(url); say("Windows 10 and 11, 64-bit."); }
  else {
    fetch("downloads/Aegis-Setup.exe", { method: "HEAD" })
      .then((r) => { if (r.ok) { enable(""); say("Windows 10 and 11, 64-bit."); } else say("The Windows installer is not published yet. The web app works today."); })
      .catch(() => say("The Windows installer is not published yet. The web app works today."));
  }

  if (repo) {
    fetch("https://api.github.com/repos/" + repo + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => {
        if (r.status === 404) { disable("Windows app is coming soon"); say("The first release is not published yet. The web app works today."); return null; }
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then((j) => {
        if (!j) return;
        const a = (j.assets || []).find((x) => /\.exe$/i.test(x.name || ""));
        if (!a) { disable("Installer is being prepared"); say("A release exists, but the installer is not attached yet."); return; }
        enable(a.browser_download_url || url);
        set("dl-ver", j.tag_name || j.name || "Latest");
        set("dl-file", a.name);
        set("dl-size", fmtSize(a.size));
        set("dl-date", fmtDate(j.published_at || a.updated_at));
        set("dl-count", Number(a.download_count || 0).toLocaleString());
        say("Latest release " + (j.tag_name || "") + ", ready to download.", true);
        const all = $("dl-releases"); if (all && j.html_url) all.href = j.html_url;
      })
      .catch(() => { /* keep the optimistic state */ });
  }

  btn.addEventListener("click", (e) => {
    if (btn.getAttribute("aria-disabled") === "true") { e.preventDefault(); return; }
    const t = $("dl-toast");
    if (t) { t.hidden = false; }
    say("Download started.", true);
  });
})();
