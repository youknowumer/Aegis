"use strict";
// Automatic updates from GitHub Releases (the same place the website's download button points at).
// On start and every few hours the installed app checks for a newer release, downloads it in the background
// (only the changed parts, thanks to the .blockmap file), and asks the user to restart. If they say "later",
// it installs by itself the next time Aegis is closed.
const { app, dialog } = require("electron");

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

function startAutoUpdate(getWindow) {
  // Not when running from source (npm start) and not when the user turned it off.
  if (!app.isPackaged || process.env.AEGIS_NO_UPDATE === "1") return null;

  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return null; }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  let asked = false;
  autoUpdater.on("update-downloaded", async (info) => {
    if (asked) return;
    asked = true;
    const win = getWindow();
    const opts = {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Aegis update",
      message: "Aegis " + (info && info.version ? info.version : "") + " is ready.",
      detail: "Restart to finish updating. If you choose Later, it installs the next time you close Aegis.",
    };
    try {
      const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    } catch {}
  });
  autoUpdater.on("error", () => {}); // offline / rate limited: just try again at the next check

  const check = () => { autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 15000);              // let the app finish starting first
  const timer = setInterval(check, CHECK_EVERY_MS);
  if (timer.unref) timer.unref();
  return autoUpdater;
}

module.exports = { startAutoUpdate };
