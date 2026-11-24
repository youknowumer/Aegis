/* Aegis landing: "Download now" button (Windows installer).
   - The button is always live and starts the download straight from the page (DOWNLOAD_URL in config.js,
     normally the GitHub Releases "latest" link, which redirects to the file).
   - When GITHUB_REPO is set, the page also asks GitHub which release is live and fills in version, size, date
     and download count.
   - Only if GitHub confirms that no release or no installer exists, a click shows a friendly message instead of
     sending the visitor to a GitHub 404 page. If GitHub cannot be reached, the download simply starts. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const btn = $("dl-btn");
  if (!btn) return;
  const cfg = window.AEGIS_CONFIG || {};
  const url = /^https:\/\//.test(cfg.DOWNLOAD_URL || "") ? cfg.DOWNLOAD_URL : "downloads/Aegis-Setup.exe";
  const repo = /^[\w.-]+\/[\w.-]+$/.test(cfg.GITHUB_REPO || "") ? cfg.GITHUB_REPO : "";
  const status = $("dl-status"), toast = $("dl-toast");
  let missing = "";   // set only when GitHub says the installer is not uploaded

  const say = (t, ok) => { if (status) { status.textContent = t; status.classList.toggle("ok", !!ok); } };
  const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return "-"; } };
  const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const toastHtml = (html) => { if (toast) { toast.innerHTML = html; toast.hidden = false; } };

  btn.setAttribute("href", url);
  btn.setAttribute("download", "Aegis-Setup.exe");
  btn.textContent = "Download now";
  btn.classList.remove("disabled", "glass");
  btn.classList.add("solid");
  btn.setAttribute("aria-disabled", "false");

  if (repo) {
    fetch("https://api.github.com/repos/" + repo + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => {
        if (r.status === 404) { missing = "release"; return null; }
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then((j) => {
        if (!j) { say("The installer is not uploaded yet. The web app works today."); return; }
        const a = (j.assets || []).find((x) => /\.exe$/i.test(x.name || ""));
        if (!a) { missing = "asset"; say("The installer is not uploaded yet. The web app works today."); return; }
        set("dl-ver", j.tag_name || j.name || "Latest");
        set("dl-file", a.name);
        set("dl-size", fmtSize(a.size));
        set("dl-date", fmtDate(j.published_at || a.updated_at));
        set("dl-count", Number(a.download_count || 0).toLocaleString());
        say("Latest release " + (j.tag_name || "") + ", ready to download.", true);
        const all = $("dl-releases"); if (all && j.html_url) all.href = j.html_url;
      })
      .catch(() => { /* GitHub unreachable: leave the button working */ });
  }

  btn.addEventListener("click", (e) => {
    if (missing) {
      e.preventDefault();
      toastHtml("<b>The installer is not uploaded yet.</b> It will appear here as soon as it is published. Meanwhile, the <a href=\"app.html\">web app</a> works today.");
      return;
    }
    say("Download started.", true);
    toastHtml("<b>Download started.</b> When it finishes, open the file. If SmartScreen appears, choose More info, then Run anyway.");
  });
})();
