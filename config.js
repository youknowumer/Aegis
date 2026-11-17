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
  };
})();
