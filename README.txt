Aegis landing page update (WebGL curved gallery with glass rim)

Copy everything in this folder into the root of your Aegis project, keeping the folder structure.
Say yes to overwrite when asked.

  index.html                 new landing page markup (overwrites the old one)
  landing.css                new styles (overwrites the old one)
  landing.js                 new gallery engine (overwrites the old one)
  three.min.js               three.js r128, hosted locally (new)
  fonts/jetbrains-mono-*.woff2   JetBrains Mono 400 and 500 (new)
  server/app/settings.py     only change: "three.min.js" added to WEB_FILES

Not touched: config.js, landing-download.js, app.html and every other file.
The old landing-*.css / landing-*.js files are no longer used by index.html. You may delete them, or leave them.
