
/**
 * PixelGameMaker – preload.js
 * Exposes assetsPick/assetsReadDataUrl + module picker via AppAPI.
 */
const { contextBridge, ipcRenderer } = require("electron");
const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

// Assets
const Assets = {
  openFolder: () => invoke("assets:openFolder"),
  saveDataUrl: (payload) => invoke("assets:saveDataUrl", payload),
  pick: (opts) => invoke("assets:pick", opts),
  readDataUrl: (payload) => invoke("assets:readDataUrl", payload),
};

// Modules
const Modules = {
  addViaPicker: () => invoke("modules:addViaPicker"),
};

// Unified API
const AppAPI = {
  // Assets
  assetsOpenFolder: () => Assets.openFolder(),
  assetsSaveDataUrl: (payload) => Assets.saveDataUrl(payload),
  assetsPick: (opts) => Assets.pick(opts),
  assetsReadDataUrl: (payload) => Assets.readDataUrl(payload),
  // Modules
  addModuleViaPicker: () => Modules.addViaPicker(),
  // Escape hatch
  invoke,
};

contextBridge.exposeInMainWorld("AppAPI", AppAPI);
// Optional shims for older code
contextBridge.exposeInMainWorld("assets", Assets);
contextBridge.exposeInMainWorld("modules", Modules);
contextBridge.exposeInMainWorld("ipc", { invoke });
