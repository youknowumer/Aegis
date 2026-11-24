// Aegis frontend settings. This is the ONLY line you need to edit after deploying the server.
//
// API_BASE = public https address of your Aegis server (Render / Railway / Fly.io ...),
// with no slash at the end. GitHub Pages can only host static files, so login, chat and memory
// run on that server and this page talks to it.
//
// On your own computer (localhost) it automatically uses the server that served the page.
(function () {
  var local = ["localhost", "127.0.0.1", "[::1]"].indexOf(location.hostname) !== -1;
  window.AEGIS_CONFIG = {
    API_BASE: local ? "" : "https://YOUR-AEGIS-SERVER.onrender.com",
    // Where the "Download for Windows" button points. Leave empty to use downloads/Aegis-Setup.exe on this site, or paste the
    // GitHub Releases link, e.g. https://github.com/YOUR-NAME/Aegis/releases/latest/download/Aegis-Setup.exe
    // GitHub repo that holds the Releases. The landing page asks GitHub which version is live and shows its size and date.
    // Leave empty to skip that check (the button then trusts DOWNLOAD_URL).
    GITHUB_REPO: "youknowumer/Aegis",
    DOWNLOAD_URL: "https://github.com/youknowumer/Aegis/releases/latest/download/Aegis-Setup.exe",
  };
})();
