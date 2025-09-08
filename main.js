
// PixelGameMaker main.js
// v0.5.4 – portable + non-blocking assets modal + restored Assets/Modules IPC
const { app, BrowserWindow, dialog, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { pathToFileURL } = require('url');

// ---------- Portable bootstrap ----------
const exeDir = path.dirname(app.getPath('exe'));
const PORTABLE_DIR = path.join(exeDir, 'portable_data');
try { fs.mkdirSync(PORTABLE_DIR, { recursive: true }); } catch {}
try {
  app.setPath('userData', PORTABLE_DIR);
  app.setAppLogsPath(PORTABLE_DIR);
  try { app.setPath('temp', path.join(PORTABLE_DIR, 'temp')); } catch {}
  try { app.setPath('cache', path.join(PORTABLE_DIR, 'cache')); } catch {}
} catch (e) {
  try { fs.writeFileSync(path.join(exeDir, 'portable_bootstrap_error.log'), String(e)); } catch {}
}

const SETTINGS_PATH = path.join(PORTABLE_DIR, 'settings.json');
const DEFAULT_ASSETS = path.join(PORTABLE_DIR, 'assets');
const MODULES_DIR = path.join(PORTABLE_DIR, 'modules');
const MODULES_DB = path.join(PORTABLE_DIR, 'modules.json');

function ensurePortableScaffolding(){
  try { fs.mkdirSync(PORTABLE_DIR, { recursive: true }); } catch {}
  try { fs.mkdirSync(DEFAULT_ASSETS, { recursive: true }); } catch {}
  try { fs.mkdirSync(MODULES_DIR, { recursive: true }); } catch {}
  try { if (!fs.existsSync(MODULES_DB)) fs.writeFileSync(MODULES_DB, '[]', 'utf8'); } catch {}
}

function readJSON(p, fallback){ try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, obj){ try { fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); } catch (e){ console.error('writeJSON failed', p, e); } }
function readSettings(){ return readJSON(SETTINGS_PATH, {}); }
function writeSettings(next){ writeJSON(SETTINGS_PATH, next); }
function readModules(){ return readJSON(MODULES_DB, []); }
function writeModules(list){ writeJSON(MODULES_DB, list); }

function validPath(p){ try { return !!p && fs.existsSync(p); } catch { return false; } }
function resolveIn(base, rel=''){
  const abs = path.resolve(base, rel || '');
  const relPath = path.relative(base, abs);
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
    throw new Error('Path traversal blocked');
  }
  return abs;
}
function statSafe(p){ try { return fs.statSync(p); } catch { return null; } }

// ---------- Menu ----------
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Change Assets Folder…',
          click: async () => {
            const s = readSettings();
            const res = await dialog.showOpenDialog({
              title: 'Choose your Assets folder',
              defaultPath: s.assetsDir || DEFAULT_ASSETS,
              properties: ['openDirectory', 'createDirectory']
            });
            if (!res.canceled && res.filePaths && res.filePaths[0]) {
              s.assetsDir = res.filePaths[0];
              writeSettings(s);
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open portable_data folder', click: () => shell.openPath(PORTABLE_DIR) }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ---------- IPC: Assets (full) ----------
function getAssetsRoot(){
  const s = readSettings();
  return s.assetsDir && validPath(s.assetsDir) ? s.assetsDir : null;
}

ipcMain.handle('assets:status', async () => {
  const root = getAssetsRoot();
  return { ok: true, hasValidRoot: !!root, root, defaultPath: DEFAULT_ASSETS };
});

ipcMain.handle('assets:useDefault', async () => {
  try { fs.mkdirSync(DEFAULT_ASSETS, { recursive: true }); } catch {}
  const s = readSettings();
  s.assetsDir = DEFAULT_ASSETS;
  writeSettings(s);
  return { ok: true, root: DEFAULT_ASSETS };
});

ipcMain.handle('assets:chooseRoot', async () => {
  const s = readSettings();
  const res = await dialog.showOpenDialog({
    title: 'Choose your Assets folder',
    defaultPath: s.assetsDir || DEFAULT_ASSETS,
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok:false, canceled:true };
  const chosen = res.filePaths[0];
  try { fs.mkdirSync(chosen, { recursive: true }); } catch {}
  s.assetsDir = chosen;
  writeSettings(s);
  return { ok:true, root: chosen };
});

ipcMain.handle('assets:openFolder', async () => {
  const root = getAssetsRoot() || DEFAULT_ASSETS;
  try { fs.mkdirSync(root, { recursive: true }); } catch {}
  await shell.openPath(root);
  return { ok: true, root };
});

ipcMain.handle('assets:list', async (_evt, cwdRel='') => {
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  let dir;
  try { dir = resolveIn(root, cwdRel); } catch (e) { return { ok:false, message:String(e) }; }
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return { ok:false, message:String(e) }; }
  const items = entries.map(d => {
    const full = path.join(dir, d.name);
    const st = statSafe(full) || { size:0, mtimeMs: Date.now() };
    return { name: d.name, isDir: d.isDirectory(), size: st.size||0, mtime: st.mtimeMs||Date.now() };
  });
  const cwd = path.relative(root, dir).split(path.sep).join('/');
  return { ok:true, cwd, items };
});

ipcMain.handle('assets:fileUrl', async (_evt, rel) => {
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  let full;
  try { full = resolveIn(root, rel); } catch (e) { return { ok:false, message:String(e) }; }
  return { ok:true, url: pathToFileURL(full).href };
});

ipcMain.handle('assets:readText', async (_evt, rel) => {
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  let full;
  try { full = resolveIn(root, rel); } catch (e) { return { ok:false, message:String(e) }; }
  try {
    const text = fs.readFileSync(full, 'utf8');
    return { ok:true, text };
  } catch (e) { return { ok:false, message:String(e) }; }
});

ipcMain.handle('assets:saveDataUrl', async (_evt, payload) => {
  // payload: { rel, dataUrl }
  const { rel, dataUrl } = payload || {};
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  let full;
  try { full = resolveIn(root, rel); } catch (e) { return { ok:false, message:String(e) }; }
  try {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
    if (!m) return { ok:false, message:'Invalid dataUrl' };
    const buf = Buffer.from(m[2], 'base64');
    fs.mkdirSync(path.dirname(full), { recursive:true });
    fs.writeFileSync(full, buf);
    return { ok:true, path:full };
  } catch (e) { return { ok:false, message:String(e) }; }
});

ipcMain.handle('assets:pick', async (_evt, opts={}) => {
  const res = await dialog.showOpenDialog({
    title: opts.title || 'Pick a file',
    properties: ['openFile'],
    filters: opts.filters || []
  });
  if (res.canceled || !res.filePaths?.[0]) return { ok:false, canceled:true };
  return { ok:true, path: res.filePaths[0] };
});

ipcMain.handle('assets:readDataUrl', async (_evt, payload) => {
  // payload: { rel, mime }
  const { rel, mime } = payload || {};
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  let full;
  try { full = resolveIn(root, rel); } catch (e) { return { ok:false, message:String(e) }; }
  try {
    const data = fs.readFileSync(full);
    const m = mime || 'application/octet-stream';
    return { ok:true, dataUrl: `data:${m};base64,${data.toString('base64')}` };
  } catch (e) { return { ok:false, message:String(e) }; }
});

ipcMain.handle('assets:cwdUp', async (_evt, cwdRel='') => {
  const parts = (cwdRel || '').split('/').filter(Boolean);
  parts.pop();
  const up = parts.join('/');
  return { ok:true, path: up };
});

ipcMain.handle('assets:mkdir', async (_evt, cwdRel='', name) => {
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  try {
    const dir = resolveIn(root, path.posix.join(cwdRel||'', name));
    fs.mkdirSync(dir, { recursive:true });
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e) }; }
});

ipcMain.handle('assets:upload', async (_evt, cwdRel='', srcPath) => {
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  try {
    const base = path.basename(srcPath);
    const dest = resolveIn(root, path.posix.join(cwdRel||'', base));
    fs.mkdirSync(path.dirname(dest), { recursive:true });
    fs.copyFileSync(srcPath, dest);
    return { ok:true, path: dest };
  } catch (e) { return { ok:false, message:String(e) }; }
});

ipcMain.handle('assets:rename', async (_evt, dirRel='', oldName, newName) => {
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  try {
    const src = resolveIn(root, path.posix.join(dirRel||'', oldName));
    const dest = resolveIn(root, path.posix.join(dirRel||'', newName));
    fs.renameSync(src, dest);
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e) }; }
});

ipcMain.handle('assets:move', async (_evt, fromRel, toRel) => {
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  try {
    const from = resolveIn(root, fromRel);
    const to = resolveIn(root, toRel);
    fs.mkdirSync(path.dirname(to), { recursive:true });
    fs.renameSync(from, to);
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e) }; }
});

ipcMain.handle('assets:duplicate', async (_evt, rel) => {
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  try {
    const src = resolveIn(root, rel);
    const dir = path.dirname(src);
    const ext = path.extname(src);
    const base = path.basename(src, ext);
    let n = 1, dest;
    do { dest = path.join(dir, `${base} copy${n>1?` ${n}`:''}${ext}`); n++; } while (fs.existsSync(dest));
    fs.copyFileSync(src, dest);
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e) }; }
});

ipcMain.handle('assets:delete', async (_evt, rel) => {
  const root = getAssetsRoot();
  if (!root) return { ok:false, message:'No assets root set' };
  try {
    const target = resolveIn(root, rel);
    fs.rmSync(target, { recursive:true, force:true });
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e) }; }
});

// ---------- IPC: Modules ----------
ipcMain.handle('modules:openFolder', async () => {
  ensurePortableScaffolding();
  await shell.openPath(MODULES_DIR);
  return { ok:true, path: MODULES_DIR };
});

ipcMain.handle('modules:list', async () => {
  ensurePortableScaffolding();
  const list = readModules();
  // Return minimal info for UI
  return { ok:true, modules: list.map(m => ({ id: m.id, name: m.name })) };
});

ipcMain.handle('modules:addViaPicker', async () => {
  ensurePortableScaffolding();
  const res = await dialog.showOpenDialog({
    title: 'Add Module (.html)',
    properties: ['openFile'],
    filters: [{ name:'HTML', extensions:['html','htm'] }]
  });
  if (res.canceled || !res.filePaths?.[0]) return { ok:false, canceled:true };
  const src = res.filePaths[0];
  const name = path.basename(src);
  const id = `${name.replace(/\W+/g, '_')}-${Date.now()}`;
  const dest = path.join(MODULES_DIR, name);
  try {
    fs.copyFileSync(src, dest);
  } catch (e) {
    // If copy fails (same drive perms), fall back to referencing original (not ideal, but okay)
    console.warn('Copy module failed, referencing original:', e);
  }
  const actualPath = fs.existsSync(dest) ? dest : src;
  const list = readModules();
  list.push({ id, name, path: actualPath });
  writeModules(list);
  return { ok:true, id, name };
});

ipcMain.handle('modules:resolveUrl', async (_evt, id) => {
  const list = readModules();
  const mod = list.find(m => m.id === id);
  if (!mod || !fs.existsSync(mod.path)) return { ok:false, message:'Module missing' };
  return { ok:true, url: pathToFileURL(mod.path).href };
});

ipcMain.handle('modules:remove', async (_evt, id) => {
  const list = readModules();
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return { ok:false, message:'Not found' };
  const mod = list[idx];
  list.splice(idx, 1);
  writeModules(list);
  // Best-effort: delete file if it lives inside MODULES_DIR
  try {
    const inside = path.relative(MODULES_DIR, mod.path);
    if (inside && !inside.startsWith('..')) fs.rmSync(mod.path, { force:true });
  } catch {}
  return { ok:true };
});

// ---------- IPC: Updates (stubs) ----------
ipcMain.handle('updates:status', async () => ({ ok:true, updates:[] }));
ipcMain.handle('updates:importZip', async () => ({ ok:false, message:'updates disabled' }));
ipcMain.handle('updates:activate', async () => ({ ok:false, message:'updates disabled' }));
ipcMain.handle('updates:remove', async () => ({ ok:false, message:'updates disabled' }));
ipcMain.handle('updates:clear', async () => ({ ok:true }));

// ---------- Window ----------
let mainWindow;
async function createWindow() {
  ensurePortableScaffolding();
  buildMenu();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  });
  await mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', async () => { if (BrowserWindow.getAllWindows().length === 0) await createWindow(); });
