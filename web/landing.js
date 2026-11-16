(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  $("year").textContent = new Date().getFullYear();

  // Already signed in? Skip straight to the app.
  let signedIn = false;
  try { signedIn = !!localStorage.getItem("aegis_token"); } catch {}
  if (signedIn) {
    $("signin-link").textContent = "Open app";
    $("start-link").textContent = "Open app";
    $("start-link").href = "/app.html";
  }

  // Enable the Windows download button only if the installer has been uploaded.
  fetch("/downloads/Aegis-Setup.exe", { method: "HEAD" })
    .then((r) => {
      if (!r.ok) return;
      const b = $("dl-btn");
      b.textContent = "Download for Windows";
      b.classList.remove("disabled");
      b.setAttribute("aria-disabled", "false");
      b.classList.replace("ghost", "primary");
    })
    .catch(() => {});
})();
