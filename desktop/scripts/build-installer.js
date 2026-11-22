"use strict";
/**
 * Builds dist/Aegis-Setup.exe with electron-builder (settings: "build" in package.json).
 *
 * On Linux and macOS electron-builder normally needs `wine` to create the uninstaller. It already contains a wine-free
 * way to do that (it reads the uninstaller out of the finished installer), but only switches it on for macOS Catalina.
 * That code is not specific to macOS, so we switch it on everywhere except Windows: no wine needed.
 */
const { build, Platform, Arch } = require("electron-builder");

if (process.platform !== "win32") {
  require("app-builder-lib/out/util/macosVersion").isMacOsCatalina = () => true;
}

build({ targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64), publish: "never" })
  .then((files) => { console.log("built:\n" + files.join("\n")); })
  .catch((e) => { console.error("[installer] FAILED: " + (e && e.message || e)); process.exit(1); });
