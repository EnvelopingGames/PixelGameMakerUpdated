
// PixelGameMaker portable bootstrap + window creation
// v0.5.2-portable-fix
const { app, BrowserWindow, dialog, Menu } = require('electron');
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
  // Optional: keep cache/temp near the app too (best-effort; safe if not supported on platform)
  try { app.setPath('temp', path.join(PORTABLE_DIR, 'temp')); } catch {}
  try { app.setPath('cache', path.join(PORTABLE_DIR, 'cache')); } catch {}
} catch (e) {
  // If this ever fails, we still continue; worst case Electron uses APPDATA.
  // But we log to a file next to the exe.
  try {
    fs.writeFileSync(path.join(exeDir, 'portable_bootstrap_error.log'), String(e));
  } catch {}
}

const SETTINGS_PATH = path.join(PORTABLE_DIR, 'settings.json');

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeSettings(next) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write settings.json:', e);
  }
}

function pathExists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

async function ensureAssetsDir() {
  let settings = readSettings();
  let assetsDir = settings.assetsDir;

  // If missing or invalid, prompt user
  if (!pathExists(assetsDir)) {
    // Fallback default inside portable_data
    const defaultAssets = path.join(PORTABLE_DIR, 'assets');
    try { fs.mkdirSync(defaultAssets, { recursive: true }); } catch {}

    const res = await dialog.showOpenDialog({
      title: 'Choose your Assets folder',
      defaultPath: defaultAssets,
      properties: ['openDirectory', 'createDirectory']
    });

    if (res.canceled) {
      // If the user cancels and we still have no valid folder, use fallback
      assetsDir = defaultAssets;
    } else {
      assetsDir = res.filePaths && res.filePaths[0] ? res.filePaths[0] : defaultAssets;
    }

    settings.assetsDir = assetsDir;
    writeSettings(settings);
  }

  // Ensure it exists on every launch
  try { fs.mkdirSync(settings.assetsDir, { recursive: true }); } catch {}
  return settings.assetsDir;
}

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
              defaultPath: settings.assetsDir || PORTABLE_DIR,
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
        {
          label: 'Open portable_data folder',
          click: () => {
            const { shell } = require('electron');
            shell.openPath(PORTABLE_DIR);
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

let mainWindow;

async function createWindow() {
  await ensureAssetsDir();
  buildMenu();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // Keep your existing preload filename; this is a drop-in
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  });

  // Load your existing index.html
  await mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// macOS sanity
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) await createWindow();
});
