// preload.js — v0.5.2 watcher bridge (aligned with renderer expectations)
const { contextBridge, ipcRenderer } = require('electron');

function invoke(ch, ...args){ return ipcRenderer.invoke(ch, ...args); }

contextBridge.exposeInMainWorld('AppAPI', {
  // ----- Modules -----
  listModules:        () => invoke('modules:list'),                 // returns ARRAY
  addModuleViaPicker: () => invoke('modules:addViaPicker'),         // {ok}
  openModulesFolder:  () => invoke('modules:openFolder'),           // {ok}
  removeModule:       (id) => invoke('modules:remove', id),         // {ok}
  resolveModuleUrl:   (id) => invoke('modules:resolveUrl', id),     // {ok,url}

  onModulesChanged(cb){
    if (typeof cb === 'function') ipcRenderer.on('modules-changed', cb);
  },

  // ----- Assets -----
  assetsStatus:      () => invoke('assets:status'),
  assetsChooseRoot:  () => invoke('assets:chooseRoot'),
  assetsUseDefault:  () => invoke('assets:useDefault'),
  assetsOpenFolder:  () => invoke('assets:openFolder'),             // added to match index.html usage

  assetsList:        (cwd) => invoke('assets:list', cwd),
  assetsFileUrl:     (rel) => invoke('assets:fileUrl', rel),
  assetsReadText:    (rel) => invoke('assets:readText', rel),
  assetsReadDataUrl: (payload) => invoke('assets:readDataUrl', payload),
  assetsSaveDataUrl: (payload) => invoke('assets:saveDataUrl', payload),
  assetsPick:        (opts) => invoke('assets:pick', opts),

  assetsCwdUp:       (cwd) => invoke('assets:cwdUp', cwd),
  assetsMkdir:       (cwd, name) => invoke('assets:mkdir', cwd, name),
  assetsUpload:      (cwd, srcPath) => invoke('assets:upload', cwd, srcPath),
  assetsRename:      (relDir, from, to) => invoke('assets:rename', relDir, from, to),
  assetsMove:        (relFrom, relTo) => invoke('assets:move', relFrom, relTo),
  assetsDuplicate:   (rel) => invoke('assets:duplicate', rel),
  assetsDelete:      (rel) => invoke('assets:delete', rel)
});
