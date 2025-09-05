
/**
 * PixelGameMaker – main.js
 * Adds: assets:pick, assets:readDataUrl; keeps portable layout.
 * Includes modules:addViaPicker for Upload Module button.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

const isDev = !app.isPackaged;

// ---------- Portable dirs ----------
function getBaseDir() {
  try {
    if (!isDev) return path.join(path.dirname(process.execPath), "portable_data");
    return path.join(path.resolve(__dirname), "portable_data");
  } catch {
    return path.join(process.cwd(), "portable_data");
  }
}
const BASE_DIR = getBaseDir();
const ASSETS_DIR = path.join(BASE_DIR, "assets");
const MODULES_DIR = path.join(BASE_DIR, "modules");
for (const d of [BASE_DIR, ASSETS_DIR, MODULES_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

// ---------- State ----------
const STATE_FILE = path.join(BASE_DIR, "state.json");
function readState(){ try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); } catch { return {}; } }
function writeState(partial){ const cur = readState(); const next = { ...cur, ...partial }; fs.writeFileSync(STATE_FILE, JSON.stringify(next,null,2)); return next; }
function getAssetsRoot(){
  const st = readState();
  const root = (st.assetsRoot && fs.existsSync(st.assetsRoot)) ? st.assetsRoot : ASSETS_DIR;
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  if (root !== st.assetsRoot) writeState({ assetsRoot: root });
  return root;
}

// ---------- Helpers ----------
function within(base, target){
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}
async function uniqueDest(dir, baseName){
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let i = 0;
  while (true) {
    const cand = path.join(dir, i ? `${stem} (${i})${ext}` : baseName);
    if (!fs.existsSync(cand)) return cand;
    i++;
  }
}
function toFileUrl(abs){
  let p = abs.replace(/\\/g,"/"); if (!p.startsWith("/")) p = "/"+p;
  return encodeURI(`file://${p}`);
}

// ---------- Window ----------
let mainWindow;
function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, title: "Pixel Game Maker",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ---------- Assets IPC ----------
ipcMain.handle("assets:openFolder", async () => { const root = getAssetsRoot(); await shell.openPath(root); return { ok:true, path: root }; });

ipcMain.handle("assets:saveDataUrl", async (_evt, payload = {}) => {
  try {
    const { suggested = "sprites/sprite.png", dataUrl } = payload;
    if (typeof dataUrl !== "string" || !/^data:image\/png;base64,/.test(dataUrl))
      return { ok:false, error:"Expected data:image/png;base64,..." };
    const root = getAssetsRoot();
    const defAbs = path.resolve(root, path.normalize(suggested));
    const res = await dialog.showSaveDialog({
      title:"Save Sprite to Assets", defaultPath:defAbs, filters:[{ name:"PNG Image", extensions:["png"] }]
    });
    if (res.canceled || !res.filePath) return { ok:false, canceled:true };
    const outAbs = res.filePath;
    if (!within(root, outAbs)) return { ok:false, error:"Save must be inside Assets" };
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    await fsp.mkdir(path.dirname(outAbs), { recursive:true });
    await fsp.writeFile(outAbs, Buffer.from(base64, "base64"));
    return { ok:true, rel: path.relative(root, outAbs).replace(/\\/g,"/"), path: outAbs };
  } catch (e) { return { ok:false, error:String(e?.message||e) }; }
});

// NEW: pick within assets
ipcMain.handle("assets:pick", async (_evt, opts = {}) => {
  const root = getAssetsRoot();
  const subdir = typeof opts.subdir === "string" ? opts.subdir : "";
  const properties = Array.isArray(opts.properties) ? opts.properties : ["openFile"];
  const filters = Array.isArray(opts.filters) && opts.filters.length ? opts.filters : [{ name:"PNG", extensions:["png"] }];
  const defPath = path.resolve(root, path.normalize(subdir || ""));
  if (!fs.existsSync(defPath)) fs.mkdirSync(defPath, { recursive: true });
  const res = await dialog.showOpenDialog({ title:"Pick from Assets", defaultPath:defPath, properties, filters });
  if (res.canceled || !res.filePaths?.length) return { ok:false, canceled:true };
  const rels = res.filePaths.filter(p => within(root, p)).map(p => path.relative(root, p).replace(/\\/g,"/"));
  return { ok:true, paths: rels };
});

// NEW: read file as data URL
ipcMain.handle("assets:readDataUrl", async (_evt, payload = {}) => {
  try {
    const root = getAssetsRoot();
    const rel = String(payload.rel || "");
    const abs = path.resolve(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!within(root, abs) || !fs.existsSync(abs)) return { ok:false, error:"Invalid path" };
    const ext = path.extname(abs).toLowerCase();
    let mime = "application/octet-stream";
    if (ext === ".png") mime = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
    else if (ext === ".gif") mime = "image/gif";
    else if (ext === ".webp") mime = "image/webp";
    else if (ext === ".wav") mime = "audio/wav";
    else if (ext === ".mp3") mime = "audio/mpeg";
    else if (ext === ".ogg") mime = "audio/ogg";
    const buf = await fsp.readFile(abs);
    return { ok:true, dataUrl: `data:${mime};base64,` + buf.toString("base64") };
  } catch (e) { return { ok:false, error:String(e?.message||e) }; }
});

// ---------- Modules IPC (Upload Module) ----------
ipcMain.handle("modules:addViaPicker", async () => {
  const res = await dialog.showOpenDialog({
    title: "Add Module (HTML)",
    properties: ["openFile"],
    filters: [{ name:"HTML", extensions:["html","htm"] }, { name:"All Files", extensions:["*"] }]
  });
  if (res.canceled || !res.filePaths?.length) return { ok:false, canceled:true };

  const src = res.filePaths[0];
  const ext = path.extname(src).toLowerCase();
  if (![".html",".htm"].includes(ext)) return { ok:false, error:"Only .html/.htm modules are supported" };

  const dest = await uniqueDest(MODULES_DIR, path.basename(src));
  await fsp.copyFile(src, dest);
  const st = await fsp.stat(dest);
  return { ok:true, module: { id: path.basename(dest), name: path.basename(dest, ext), path: dest, url: toFileUrl(dest), size: st.size, mtime: st.mtimeMs } };
});
