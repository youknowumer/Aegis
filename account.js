// Aegis account & data (v11): change password, sign out everywhere, download my data, delete my account.
// Talks to /api/account/*, /api/export. Hidden in local (no-server) mode, where nothing lives on a server.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const toast = (t, ms) => { if (window.AegisApp && AegisApp.toast) AegisApp.toast(t, ms); };
  const rt = () => window.AEGIS_RUNTIME || {};

  async function call(path, opts) {
    const app = window.AegisApp;
    const token = app && app.getToken && app.getToken();
    if (!token) throw new Error("Sign in first.");
    let res;
    try {
      res = await fetch((rt().api || "") + path, {
        ...(opts || {}),
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      });
    } catch {
      throw new Error("Could not reach the server.");
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).detail; } catch {}
      throw new Error(typeof detail === "string" && detail ? detail : "Request failed (" + res.status + ").");
    }
    return res;
  }

  function init() {
    const group = $("account-group");
    if (!group) return;
    if (rt().local) { group.classList.add("hidden"); return; }

    const busy = (btn, on) => { if (btn) btn.disabled = on; };

    $("acct-export").addEventListener("click", async (e) => {
      busy(e.target, true);
      try {
        const res = await call("/api/export");
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url; a.download = "aegis-data.json";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast("Your data was downloaded.");
      } catch (err) { toast(err.message, 6000); }
      busy(e.target, false);
    });

    $("acct-logout-all").addEventListener("click", async (e) => {
      if (!confirm("Sign out of every device? You stay signed in here.")) return;
      busy(e.target, true);
      try {
        const j = await (await call("/api/account/logout-all", { method: "POST" })).json();
        AegisApp.setToken(j.token);
        toast("Signed out everywhere else.");
      } catch (err) { toast(err.message, 6000); }
      busy(e.target, false);
    });

    $("acct-pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const cur = $("acct-pw-cur").value, next = $("acct-pw-new").value;
      if (next.length < 8) return toast("The new password needs at least 8 characters.", 5000);
      const btn = e.target.querySelector("button[type=submit]");
      busy(btn, true);
      try {
        const j = await (await call("/api/account/password", { method: "POST", body: JSON.stringify({ current: cur, new: next }) })).json();
        AegisApp.setToken(j.token);
        $("acct-pw-cur").value = ""; $("acct-pw-new").value = "";
        toast("Password changed. Other devices were signed out.");
      } catch (err) { toast(err.message, 6000); }
      busy(btn, false);
    });

    $("acct-del").addEventListener("click", async (e) => {
      const pw = $("acct-del-pw").value;
      if (!pw) return toast("Type your password to confirm.", 4000);
      if (!confirm("Delete your account and everything in it? This cannot be undone.")) return;
      busy(e.target, true);
      try {
        await call("/api/account/delete", { method: "POST", body: JSON.stringify({ password: pw }) });
        $("acct-del-pw").value = "";
        toast("Your account was deleted.", 6000);
        AegisApp.logout();
      } catch (err) { toast(err.message, 6000); }
      busy(e.target, false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
