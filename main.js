
/**
 * PixelGameMaker – main.js
 * Portable-first: stores user data under ./portable_data next to the EXE.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { pathToFileURL } = require("url");

const isDev = !app.isPackaged;

// ---------- Portable dirs ----------
function getBaseDir() {
  try {
    if (!isDev) return path.join(path.dirname(process.execPath), "portable_data");
  } catch {}
  return path.join(process.cwd(), "portable_data");
}
const BASE_DIR = getBaseDir();
const ASSETS_DIR = path.join(BASE_DIR, "assets");
const MODULES_DIR = path.join(BASE_DIR, "modules");

function ensurePortableDirs() {
  for (const p of [BASE_DIR, ASSETS_DIR, MODULES_DIR]) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

// ---------- Window ----------
let win;
function createWindow() {
  ensurePortableDirs();
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Pixel Game Maker",
  });
  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------- Helper: safe join within base ----------
function safeRelJoin(baseDir, rel) {
  const abs = path.normalize(path.join(baseDir, rel || ""));
  if (!abs.startsWith(path.normalize(baseDir))) {
    throw new Error("Path outside base");
  }
  return abs;
}

// ---------- Modules IPC ----------
ipcMain.handle("modules:addViaPicker", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Add Module (.html)",
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths?.length) return { ok: false, canceled: true };
  const src = res.filePaths[0];
  const id = path.basename(src);
  const dst = path.join(MODULES_DIR, id);
  try {
    await fsp.copyFile(src, dst);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("modules:list", async () => {
  try {
    const files = await fsp.readdir(MODULES_DIR);
    const list = files
      .filter(f => [".html", ".htm"].includes(path.extname(f).toLowerCase()))
      .map(f => ({ id: f, name: path.parse(f).name }));
    return { ok: true, list };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("modules:openFolder", async () => {
  ensurePortableDirs();
  await shell.openPath(MODULES_DIR);
  return { ok: true };
});

// Alias expected by some UIs:
ipcMain.handle("system:openModulesFolder", async () => {
  ensurePortableDirs();
  await shell.openPath(MODULES_DIR);
  return { ok: true };
});

ipcMain.handle("modules:resolveUrl", async (_evt, id) => {
  try {
    const p = path.join(MODULES_DIR, id);
    if (!fs.existsSync(p)) return { ok: false, message: "Module not found" };
    const ext = path.extname(p).toLowerCase();
    if (![".html", ".htm"].includes(ext)) return { ok: false, message: "Not an HTML module" };
    const url = pathToFileURL(p).toString();
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ---------- Assets IPC ----------
ipcMain.handle("assets:openFolder", async () => {
  ensurePortableDirs();
  await shell.openPath(ASSETS_DIR);
  return { ok: true };
});

ipcMain.handle("assets:saveDataUrl", async (_evt, { suggested, dataUrl }) => {
  try {
    ensurePortableDirs();
    const rel = suggested && suggested.trim() ? suggested : "sprite.png";
    const dst = safeRelJoin(ASSETS_DIR, rel);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    const m = String(dataUrl).match(/^data:([\w/+.-]+);base64,(.*)$/);
    if (!m) return { ok: false, error: "Invalid data URL" };
    const base64 = m[2];
    await fsp.writeFile(dst, Buffer.from(base64, "base64"));
    return { ok: true, rel: path.relative(ASSETS_DIR, dst) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("assets:pick", async (_evt, { subdir, filters, properties }) => {
  ensurePortableDirs();
  const defaultPath = subdir ? safeRelJoin(ASSETS_DIR, subdir) : ASSETS_DIR;
  const res = await dialog.showOpenDialog(win, {
    title: "Pick Asset",
    defaultPath,
    filters: filters || [{ name: "All Files", extensions: ["*"] }],
    properties: properties || ["openFile"],
  });
  if (res.canceled) return { ok: false, canceled: true };
  // Return rel paths inside assets
  const rels = res.filePaths.map(p => path.relative(ASSETS_DIR, p));
  return { ok: true, paths: rels };
});

ipcMain.handle("assets:readDataUrl", async (_evt, { rel }) => {
  try {
    const abs = safeRelJoin(ASSETS_DIR, rel);
    const buf = await fsp.readFile(abs);
    // Guess mime by extension (default png)
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
      : ext === ".gif" ? "image/gif"
      : "image/png";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    return { ok: true, dataUrl };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Optional helper for "up one directory" in assets UIs
ipcMain.handle("assets:cwdUp", async (_evt, rel) => {
  try {
    const current = rel ? safeRelJoin(ASSETS_DIR, rel) : ASSETS_DIR;
    const parent = path.relative(ASSETS_DIR, path.dirname(current));
    return { ok: true, rel: parent };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
