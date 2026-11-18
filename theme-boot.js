// Runs before first paint (loaded in <head>). External file because the server's CSP blocks inline scripts.
// Default is the dark HUD look that matches the app; a saved choice always wins.
(function () {
  var d = document.documentElement;
  d.classList.add("js");
  var t = "dark";
  try { var s = localStorage.getItem("aegis_site_theme"); if (s === "light" || s === "dark") t = s; } catch (e) {}
  d.setAttribute("data-theme", t);
})();
