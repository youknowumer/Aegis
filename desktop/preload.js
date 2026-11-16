"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// The only surface the web page can use. No Node, no file access.
contextBridge.exposeInMainWorld("aegisDesktop", {
  isDesktop: true,
  setToken: (token) => ipcRenderer.invoke("aegis:set-token", token),
  retry: () => ipcRenderer.invoke("aegis:retry"),
});
