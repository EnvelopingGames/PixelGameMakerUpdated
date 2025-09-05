
// preload.js – exposes a minimal, consistent AppAPI expected by index.html and modules
const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

// Namespaced helpers
const Modules = {
  addViaPicker: () => invoke("modules:addViaPicker"),
  list: () => invoke("modules:list"),
  openFolder: () => invoke("modules:openFolder"),
  resolveUrl: (id) => invoke("modules:resolveUrl", id),
};

const Assets = {
  openFolder: () => invoke("assets:openFolder"),
  saveDataUrl: (opts) => invoke("assets:saveDataUrl", opts || {}),
  pick: (opts) => invoke("assets:pick", opts || {}),
  readDataUrl: (opts) => invoke("assets:readDataUrl", opts || {}),
  cwdUp: (rel) => invoke("assets:cwdUp", rel || ""),
};

const System = {
  openModulesFolder: () => invoke("system:openModulesFolder"),
};

const AppAPI = {
  // modules
  addModuleViaPicker: () => Modules.addViaPicker(),
  listModules: () => Modules.list(),
  openModulesFolder: () => Modules.openFolder(), // keep legacy
  resolveModuleUrl: (id) => Modules.resolveUrl(id),
  // assets
  assetsOpenFolder: () => Assets.openFolder(),
  assetsSaveDataUrl: (opts) => Assets.saveDataUrl(opts),
  assetsPick: (opts) => Assets.pick(opts),
  assetsReadDataUrl: (opts) => Assets.readDataUrl(opts),
  assetsCwdUp: (rel) => Assets.cwdUp(rel),
  // system
  systemOpenModulesFolder: () => System.openModulesFolder(),
  // misc
  invoke,
};

contextBridge.exposeInMainWorld("AppAPI", AppAPI);
