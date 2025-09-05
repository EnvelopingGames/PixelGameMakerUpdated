/**
 * PixelGameMaker – preload.js (v0.5.1+ patched)
 * Exposes Assets, Modules, and minimal UpdateAPI to the renderer.
 */
const { contextBridge, ipcRenderer } = require("electron");
const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

// Assets
const Assets = {
  openFolder: () => invoke("assets:openFolder"),
  chooseRoot: () => invoke("assets:chooseRoot"),
  list: (rel) => invoke("assets:list", rel),
  fileUrl: (rel) => invoke("assets:fileUrl", rel),
  readText: (rel) => invoke("assets:readText", rel),
  saveDataUrl: (payload) => invoke("assets:saveDataUrl", payload),
  pick: (opts) => invoke("assets:pick", opts),
  readDataUrl: (payload) => invoke("assets:readDataUrl", payload),
  cwdUp: (rel) => invoke("assets:cwdUp", rel),
  mkdir: (cwdRel, name) => invoke("assets:mkdir", cwdRel, name),
  upload: (cwdRel, srcPath) => invoke("assets:upload", cwdRel, srcPath),
  rename: (dirRel, oldName, newName) => invoke("assets:rename", dirRel, oldName, newName),
  move: (fromRel, toRel) => invoke("assets:move", fromRel, toRel),
  duplicate: (rel) => invoke("assets:duplicate", rel),
  delete: (rel) => invoke("assets:delete", rel),
};

// Modules
const Modules = {
  addViaPicker: () => invoke("modules:addViaPicker"),
  list: () => invoke("modules:list"),
  resolveUrl: (id) => invoke("modules:resolveUrl", id),
  remove: (id) => invoke("modules:remove", id),
  openFolder: () => invoke("modules:openFolder"),
};

// Updates (minimal)
const Updates = {
  status: () => invoke("updates:status"),
  importZip: () => invoke("updates:importZip"),
  activate: (id) => invoke("updates:activate", id),
  remove: (id) => invoke("updates:remove", id),
  clear: () => invoke("updates:clear"),
};

// Unified APIs expected by index.html
const AppAPI = {
  // Assets
  assetsOpenFolder: () => Assets.openFolder(),
  assetsChooseRoot: () => Assets.chooseRoot(),
  assetsList: (rel) => Assets.list(rel),
  assetsFileUrl: (rel) => Assets.fileUrl(rel),
  assetsReadText: (rel) => Assets.readText(rel),
  assetsSaveDataUrl: (payload) => Assets.saveDataUrl(payload),
  assetsPick: (opts) => Assets.pick(opts),
  assetsReadDataUrl: (payload) => Assets.readDataUrl(payload),
  assetsCwdUp: (rel) => Assets.cwdUp(rel),
  assetsMkdir: (cwdRel, name) => Assets.mkdir(cwdRel, name),
  assetsUpload: (cwdRel, srcPath) => Assets.upload(cwdRel, srcPath),
  assetsRename: (dirRel, oldName, newName) => Assets.rename(dirRel, oldName, newName),
  assetsMove: (fromRel, toRel) => Assets.move(fromRel, toRel),
  assetsDuplicate: (rel) => Assets.duplicate(rel),
  assetsDelete: (rel) => Assets.delete(rel),
  // Modules
  addModuleViaPicker: () => Modules.addViaPicker(),
  listModules: () => Modules.list(),
  resolveModuleUrl: (id) => Modules.resolveUrl(id),
  removeModule: (id) => Modules.remove(id),
  openModulesFolder: () => Modules.openFolder(),
  // Updates passthroughs used by modal buttons
  importUpdateZip: () => Updates.importZip(),
  clearUpdate: () => Updates.clear(),
  // Escape hatch
  invoke,
};

contextBridge.exposeInMainWorld("AppAPI", AppAPI);
contextBridge.exposeInMainWorld("UpdateAPI", Updates);
// Optional shims for older code
contextBridge.exposeInMainWorld("assets", Assets);
contextBridge.exposeInMainWorld("modules", Modules);
contextBridge.exposeInMainWorld("ipc", { invoke });
