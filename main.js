// PixelGameMaker portable bootstrap + window creation
// v0.5.3 – portable + non-blocking assets modal support
const { app, BrowserWindow, dialog, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ----- Strict portable paths: create and redirect early -----
const exeDir = path.dirname(app.getPath('exe'));
const PORTABLE_DIR = path.join(exeDir, 'portable_data');
try { fs.mkdirSync(PORTABLE_DIR, { recursive: true }); } catch {}
// Redirect Electron data BEFORE anything else touches userData
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

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function writeJSON(p, obj) {
  try { fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); } catch (e) { console.error('Failed to write', p, e); }
}
function readSettings(){ return readJSON(SETTINGS_PATH); }
function writeSettings(next){ writeJSON(SETTINGS_PATH, next); }
function pathExists(p){ try { return !!p && fs.existsSync(p); } catch { return false; } }

// Ensure defaults exist (non-blocking; no OS dialog here)
function ensurePortableScaffolding(){
  try { fs.mkdirSync(PORTABLE_DIR, { recursive: true }); } catch {}
  try { fs.mkdirSync(DEFAULT_ASSETS, { recursive: true }); } catch {}
}

// Build app menu
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Change Assets Folder…',
          click: async () => {
            const settings = readSettings();
            const res = await dialog.showOpenDialog({
              title: 'Choose your Assets folder',
              defaultPath: settings.assetsDir || DEFAULT_ASSETS,
              properties: ['openDirectory', 'createDirectory']
            });
            if (!res.canceled && res.filePaths && res.filePaths[0]) {
              settings.assetsDir = res.filePaths[0];
              writeSettings(settings);
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

// ----- IPC: non-blocking assets prompt helpers -----
ipcMain.handle('assets:status', async () => {
  const s = readSettings();
  const valid = pathExists(s.assetsDir);
  return {
    ok: true,
    hasValidRoot: !!valid,
    root: valid ? s.assetsDir : null,
    defaultPath: DEFAULT_ASSETS
  };
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
  if (res.canceled || !res.filePaths || !res.filePaths[0]) {
    return { ok: false, canceled: true };
  }
  const chosen = res.filePaths[0];
  try { fs.mkdirSync(chosen, { recursive: true }); } catch {}
  s.assetsDir = chosen;
  writeSettings(s);
  return { ok: true, root: chosen };
});

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
