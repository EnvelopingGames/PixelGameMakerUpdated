// main.js — v0.5.2 watcher patch (portable-only + modules auto-refresh, return shapes aligned to renderer)
// NOTE: portable_data is locked next to the EXE, never %APPDATA%
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- Portable roots ----------
function getExeDir() {
  try { if (process.defaultApp) return app.getAppPath(); } catch {}
  return path.dirname(process.execPath);
}
const EXE_DIR = getExeDir();
const PORTABLE_ROOT = path.join(EXE_DIR, 'portable_data');
const MODULES_DIR = path.join(PORTABLE_ROOT, 'modules');
const ASSETS_DIR  = path.join(PORTABLE_ROOT, 'assets');
const CONFIG_DIR  = path.join(PORTABLE_ROOT, 'config');
for (const d of [PORTABLE_ROOT, MODULES_DIR, ASSETS_DIR, CONFIG_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
}

// ---------- Globals ----------
let mainWindow = null;

// ---------- Helpers ----------
function toFileUrl(p) {
  let resolved = path.resolve(p);
  if (process.platform === 'win32') {
    resolved = resolved.replace(/\\/g, '/');
    if (!resolved.startsWith('/')) resolved = '/' + resolved;
  }
  return 'file://' + resolved;
}

// Module manifest reader
function readModuleMeta(absPath) {
  try {
    const buf = fs.readFileSync(absPath, 'utf8');
    const comment = buf.match(/<!--\s*PGM:MODULE\s+name="([^"]+)"\s+id="([^"]+)"\s*-->/i);
    if (comment) return { name: comment[1], id: comment[2] };
    const meta = buf.match(/<meta[^>]+name=["']pgm-module["'][^>]+content=['"]([^'"]+)['"][^>]*>/i);
    if (meta) {
      try {
        const j = JSON.parse(meta[1]);
        if (j && j.name && j.id) return { name: String(j.name), id: String(j.id) };
      } catch {}
    }
    // Soft fallback for legacy files
    const t = buf.match(/<title>([^<]+)<\/title>/i);
    const title = t ? t[1].trim() : path.basename(absPath);
    const id = path.basename(absPath).toLowerCase().replace(/\.[^.]+$/, '');
    return { name: title, id };
  } catch {
    return null;
  }
}

function scanModules() {
  const items = [];
  try {
    const files = fs.readdirSync(MODULES_DIR, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile()) continue;
      const ext = path.extname(f.name).toLowerCase();
      if (ext !== '.html' && ext !== '.htm') continue;
      const abs = path.join(MODULES_DIR, f.name);
      const meta = readModuleMeta(abs);
      if (!meta) continue;
      items.push({ file: f.name, abs, ...meta });
    }
  } catch {}
  const seen = new Set();
  return items.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

function resolveModuleFileById(id) {
  const all = scanModules();
  const hit = all.find(m => m.id === id);
  return hit ? hit.abs : null;
}

// ---------- Window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1a1730',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });

  startModulesWatcher();
}

// ---------- fs.watch (debounced) ----------
let watcher = null;
let debounceTimer = null;
function startModulesWatcher() {
  try { if (watcher) watcher.close(); } catch {}
  try {
    watcher = fs.watch(MODULES_DIR, { persistent: true }, (_event, _file) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('modules-changed');
        }
      }, 300);
    });
  } catch (err) {
    console.error('[watch] Failed to watch modules dir:', err);
  }
}

// ---------- IPC: Modules ----------
ipcMain.handle('modules:list', async () => {
  // Return an ARRAY for renderer
  const mods = scanModules().map(m => ({ id: m.id, name: m.name }));
  return mods;
});

ipcMain.handle('modules:addViaPicker', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Add Module (.html)',
      filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    const src = r.filePaths[0];
    const base = path.basename(src).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    const dst = path.join(MODULES_DIR, base);
    if (src !== dst) fs.copyFileSync(src, dst);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('modules-changed');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message || e) };
  }
});

ipcMain.handle('modules:openFolder', async () => {
  try { await shell.openPath(MODULES_DIR); return { ok: true }; }
  catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('modules:remove', async (_e, id) => {
  try {
    const abs = resolveModuleFileById(id);
    if (!abs) return { ok: false, message: 'Not found' };
    fs.unlinkSync(abs);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('modules-changed');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message || e) };
  }
});

ipcMain.handle('modules:resolveUrl', async (_e, id) => {
  const abs = resolveModuleFileById(id);
  if (!abs) return { ok: false, message: 'Not found' };
  return { ok: true, url: toFileUrl(abs) };
});

// ---------- IPC: Assets (portable) ----------
function getAssetsConfigPath(){ return path.join(CONFIG_DIR, 'assets.json'); }
function getAssetsRoot() {
  try {
    const cfg = getAssetsConfigPath();
    if (fs.existsSync(cfg)) {
      const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      if (j && j.root && fs.existsSync(j.root)) return j.root;
    }
  } catch {}
  return ASSETS_DIR;
}

ipcMain.handle('assets:status', async () => {
  const root = getAssetsRoot(); // keep using your existing resolver
  return { ok: true, hasValidRoot: false, root };
});


ipcMain.handle('assets:chooseRoot', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Assets Folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(getAssetsConfigPath(), JSON.stringify({ root: r.filePaths[0] }, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:useDefault', async () => {
  try { const cfg = getAssetsConfigPath(); if (fs.existsSync(cfg)) fs.unlinkSync(cfg); return { ok: true }; }
  catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:openFolder', async () => {
  try { await shell.openPath(getAssetsRoot()); return { ok: true }; }
  catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:list', async (_e, relCwd) => {
  try {
    const ROOT = getAssetsRoot();
    const CWD = path.normalize(path.join(ROOT, relCwd || ''));
    if (!CWD.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    const items = fs.readdirSync(CWD, { withFileTypes: true }).map(d => {
      const p = path.join(CWD, d.name);
      const stat = fs.statSync(p);
      return { name: d.name, isDir: d.isDirectory(), size: d.isDirectory()?0:stat.size, mtime: stat.mtimeMs };
    });
    const rel = path.relative(ROOT, CWD).split(path.sep).join('/');
    return { ok: true, cwd: (rel === '.' ? '' : rel), items };
  } catch (e) {
    return { ok: false, message: String(e && e.message || e) };
  }
});

ipcMain.handle('assets:fileUrl', async (_e, rel) => {
  try {
    const ROOT = getAssetsRoot();
    const abs = path.normalize(path.join(ROOT, rel || ''));
    if (!abs.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    return { ok: true, url: toFileUrl(abs) };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:readText', async (_e, rel) => {
  try {
    const ROOT = getAssetsRoot();
    const abs = path.normalize(path.join(ROOT, rel || ''));
    if (!abs.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    const text = fs.readFileSync(abs, 'utf8');
    return { ok: true, text };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:readDataUrl', async (_e, payload) => {
  try {
    const rel = typeof payload === 'string' ? payload : (payload && payload.rel);
    const ROOT = getAssetsRoot();
    const abs = path.normalize(path.join(ROOT, rel || ''));
    if (!abs.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    const buf = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime = (ext === '.png') ? 'image/png' :
                 ((ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' :
                 (ext === '.gif') ? 'image/gif' : 'application/octet-stream');
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    return { ok: true, dataUrl };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:saveDataUrl', async (_e, { suggested, dataUrl }) => {
  try {
    const ROOT = getAssetsRoot();
    const def = path.join(ROOT, suggested || 'sprite.png');
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Save to Assets',
      defaultPath: def,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const out = r.filePath;
    const comma = String(dataUrl).indexOf(',');
    if (comma === -1) return { ok: false, message: 'Bad data URL' };
    const base64 = String(dataUrl).slice(comma + 1);
    const buf = Buffer.from(base64, 'base64');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    const rel = path.relative(ROOT, out).split(path.sep).join('/');
    return { ok: true, rel };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:cwdUp', async (_e, rel) => {
  const ROOT = getAssetsRoot();
  const cur = path.normalize(path.join(ROOT, rel || ''));
  if (!cur.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
  const up = path.dirname(cur);
  const relUp = path.relative(ROOT, up).split(path.sep).join('/');
  return { ok: true, path: relUp === '.' ? '' : relUp };
});

ipcMain.handle('assets:mkdir', async (_e, relCwd, name) => {
  try {
    const ROOT = getAssetsRoot();
    const dir = path.normalize(path.join(ROOT, relCwd || '', name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()));
    if (!dir.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:upload', async (_e, relCwd, srcPath) => {
  try {
    const ROOT = getAssetsRoot();
    const dst = path.normalize(path.join(ROOT, relCwd || '', path.basename(srcPath).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()));
    if (!dst.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    fs.copyFileSync(srcPath, dst);
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:rename', async (_e, relDir, from, to) => {
  try {
    const ROOT = getAssetsRoot();
    const src = path.normalize(path.join(ROOT, relDir || '', from));
    const dst = path.normalize(path.join(ROOT, relDir || '', to.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()));
    if (!src.startsWith(ROOT) || !dst.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    fs.renameSync(src, dst);
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:move', async (_e, relFrom, relTo) => {
  try {
    const ROOT = getAssetsRoot();
    const src = path.normalize(path.join(ROOT, relFrom || ''));
    const dst = path.normalize(path.join(ROOT, relTo || ''));
    if (!src.startsWith(ROOT) || !dst.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:duplicate', async (_e, rel) => {
  try {
    const ROOT = getAssetsRoot();
    const src = path.normalize(path.join(ROOT, rel || ''));
    if (!src.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    const dir = path.dirname(src);
    const base = path.basename(src);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext  = dot > 0 ? base.slice(dot) : '';
    let i = 2, dst;
    do { dst = path.join(dir, `${stem} (${i})${ext}`); i++; } while (fs.existsSync(dst));
    fs.copyFileSync(src, dst);
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('assets:delete', async (_e, rel) => {
  try {
    const ROOT = getAssetsRoot();
    const p = path.normalize(path.join(ROOT, rel || ''));
    if (!p.startsWith(ROOT)) return { ok: false, message: 'Invalid path' };
    const st = fs.statSync(p);
    if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else fs.unlinkSync(p);
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

// --- Added: Assets Picker (durable) ---
ipcMain.handle('assets:pick', async (_e, opts) => {
  try {
    const ROOT = getAssetsRoot();
    const {
      title = 'Choose Asset(s)',
      properties = ['openFile'],
      filters = [{ name: 'All files', extensions: ['*'] }],
      defaultPath = ROOT
    } = (opts || {});

    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      defaultPath,
      properties,   // e.g. ['openFile','multiSelections']
      filters       // e.g. [{name:'Images', extensions:['png','jpg','jpeg','gif']}]
    });

    if (result.canceled) return { ok: false, canceled: true };

    // Return *relative* paths under the portable assets root
    const paths = (result.filePaths || [])
      .map(abs => {
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        return abs.startsWith(ROOT) ? rel : null;
      })
      .filter(Boolean);

    return { ok: true, paths };
  } catch (e) {
    return { ok: false, message: String((e && e.message) || e) };
  }
});
// --- End: Assets Picker ---


// ---------- App lifecycle ----------
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

console.log('[PGM] portable_root=', PORTABLE_ROOT);
console.log('[PGM] modules_dir  =', MODULES_DIR);
console.log('[PGM] assets_dir   =', ASSETS_DIR);
