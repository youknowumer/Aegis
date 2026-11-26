// Runs before first paint (loaded in <head>). External file because the server's CSP blocks inline scripts.
// Default is the light sage look (it matches the hero photo); a saved choice always wins.
(function () {
  var d = document.documentElement;
  d.classList.add("js");
  var t = "light";
  try { var s = localStorage.getItem("aegis_site_theme"); if (s === "light" || s === "dark") t = s; } catch (e) {}
  d.setAttribute("data-theme", t);
})();
