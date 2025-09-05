/**
 * PixelGameMaker – main.js (v0.5.1+ patched)
 * Portable-first, Modules manager, Assets browser APIs, and minimal Updates manager.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const AdmZip = require("adm-zip");

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
const UPDATES_DIR = path.join(BASE_DIR, "updates");
for (const d of [BASE_DIR, ASSETS_DIR, MODULES_DIR, UPDATES_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

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
  // Avoid backslash string literals to survive packagers/minifiers.
  const BSLASH = String.fromCharCode(92); // '\'
  let p = String(abs).split(BSLASH).join('/');
  if (!p.startsWith('/')) p = '/' + p;
  return 'file://' + encodeURI(p);
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

// ======================= ASSETS IPC =======================
ipcMain.handle("assets:openFolder", async () => {
  const root = getAssetsRoot(); await shell.openPath(root); return { ok:true, path: root };
});

ipcMain.handle("assets:chooseRoot", async () => {
  const res = await dialog.showOpenDialog({ title:"Choose Assets Folder", properties:["openDirectory","createDirectory"] });
  if (res.canceled || !res.filePaths?.length) return { ok:false, canceled:true };
  const dir = res.filePaths[0];
  writeState({ assetsRoot: dir });
  return { ok:true, path: dir };
});

ipcMain.handle("assets:list", async (_evt, rel = "") => {
  try {
    const root = getAssetsRoot();
    const abs = path.resolve(root, path.normalize(rel));
    if (!within(root, abs)) return { ok:false, message:"Invalid path" };
    if (!fs.existsSync(abs)) await fsp.mkdir(abs, { recursive:true });
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const items = [];
    for (const e of entries){
      const p = path.join(abs, e.name);
      const st = await fsp.stat(p);
      items.push({ name: e.name, isDir: e.isDirectory(), size: e.isDirectory()?0:st.size, mtime: st.mtimeMs });
    }
    return { ok:true, cwd: path.relative(root, abs).replace(/\/g,"/"), items };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

ipcMain.handle("assets:fileUrl", async (_evt, rel = "") => {
  try {
    const root = getAssetsRoot();
    const abs = path.resolve(root, path.normalize(rel));
    if (!within(root, abs) || !fs.existsSync(abs)) return { ok:false, message:"Invalid path" };
    return { ok:true, url: toFileUrl(abs) };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

ipcMain.handle("assets:readText", async (_evt, rel = "") => {
  try {
    const root = getAssetsRoot();
    const abs = path.resolve(root, path.normalize(rel));
    if (!within(root, abs) || !fs.existsSync(abs)) return { ok:false, message:"Invalid path" };
    const text = await fsp.readFile(abs, "utf-8");
    return { ok:true, text };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

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
    return { ok:true, rel: path.relative(root, outAbs).replace(/\/g,"/"), path: outAbs };
  } catch (e) { return { ok:false, error:String(e?.message||e) }; }
});

ipcMain.handle("assets:pick", async (_evt, opts = {}) => {
  const root = getAssetsRoot();
  const subdir = typeof opts.subdir === "string" ? opts.subdir : "";
  const properties = Array.isArray(opts.properties) ? opts.properties : ["openFile"];
  const filters = Array.isArray(opts.filters) && opts.filters.length ? opts.filters : [{ name:"PNG", extensions:["png"] }];
  const defPath = path.resolve(root, path.normalize(subdir || ""));
  if (!fs.existsSync(defPath)) fs.mkdirSync(defPath, { recursive: true });
  const res = await dialog.showOpenDialog({ title:"Pick from Assets", defaultPath:defPath, properties, filters });
  if (res.canceled || !res.filePaths?.length) return { ok:false, canceled:true };
  const rels = res.filePaths.filter(p => within(root, p)).map(p => path.relative(root, p).replace(/\/g,"/"));
  return { ok:true, paths: rels };
});

ipcMain.handle("assets:readDataUrl", async (_evt, payload = {}) => {
  try {
    const root = getAssetsRoot();
    const rel = String(payload.rel || "");
    const abs = path.resolve(root, path.normalize(rel).replace(/^(\.\.[/\])+/, ""));
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

ipcMain.handle("assets:cwdUp", async (_evt, rel = "") => {
  const root = getAssetsRoot();
  const abs = path.resolve(root, path.normalize(rel));
  if (!within(root, abs)) return { ok:false };
  const parent = path.dirname(abs);
  return { ok:true, path: path.relative(root, parent).replace(/\/g,"/") };
});

ipcMain.handle("assets:mkdir", async (_evt, cwdRel = "", name = "") => {
  try {
    const root = getAssetsRoot();
    if (!name) return { ok:false, message:"No name" };
    const dir = path.resolve(root, path.normalize(cwdRel));
    const dest = path.join(dir, name);
    if (!within(root, dest)) return { ok:false, message:"Invalid path" };
    await fsp.mkdir(dest, { recursive: true });
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

ipcMain.handle("assets:upload", async (_evt, cwdRel = "", srcFile = "") => {
  try {
    const root = getAssetsRoot();
    const dir = path.resolve(root, path.normalize(cwdRel));
    if (!within(root, dir)) return { ok:false, message:"Invalid destination" };
    if (!srcFile || !fs.existsSync(srcFile)) return { ok:false, message:"Source missing" };
    const baseName = path.basename(srcFile);
    const dest = await uniqueDest(dir, baseName);
    await fsp.copyFile(srcFile, dest);
    return { ok:true, rel: path.relative(root, dest).replace(/\/g,"/") };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

ipcMain.handle("assets:rename", async (_evt, dirRel = "", oldName = "", newName = "") => {
  try {
    const root = getAssetsRoot();
    const dir = path.resolve(root, path.normalize(dirRel));
    const src = path.join(dir, oldName);
    const dest = path.join(dir, newName);
    if (!within(root, src) || !within(root, dest)) return { ok:false, message:"Invalid path" };
    await fsp.rename(src, dest);
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

ipcMain.handle("assets:move", async (_evt, fromRel = "", toRel = "") => {
  try {
    const root = getAssetsRoot();
    const src = path.resolve(root, path.normalize(fromRel));
    const dest = path.resolve(root, path.normalize(toRel));
    if (!within(root, src) || !within(root, dest)) return { ok:false, message:"Invalid path" };
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(src, dest);
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

ipcMain.handle("assets:duplicate", async (_evt, rel = "") => {
  try {
    const root = getAssetsRoot();
    const src = path.resolve(root, path.normalize(rel));
    if (!within(root, src) || !fs.existsSync(src)) return { ok:false, message:"Invalid path" };
    const dest = await uniqueDest(path.dirname(src), path.basename(src));
    await fsp.copyFile(src, dest);
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

ipcMain.handle("assets:delete", async (_evt, rel = "") => {
  try {
    const root = getAssetsRoot();
    const target = path.resolve(root, path.normalize(rel));
    if (!within(root, target) || !fs.existsSync(target)) return { ok:false, message:"Invalid path" };
    const st = await fsp.stat(target);
    if (st.isDirectory()) await fsp.rm(target, { recursive:true, force:true });
    else await fsp.unlink(target);
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

// ======================= MODULES IPC =======================
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

ipcMain.handle("modules:list", async () => {
  const out = [];
  const ents = await fsp.readdir(MODULES_DIR, { withFileTypes:true });
  for (const e of ents){
    if (!e.isFile()) continue;
    const full = path.join(MODULES_DIR, e.name);
    const ext = path.extname(full).toLowerCase();
    if (ext !== ".html" && ext !== ".htm") continue;
    const st = await fsp.stat(full);
    out.push({ id: e.name, name: path.basename(full, ext), url: toFileUrl(full), size: st.size, mtime: st.mtimeMs });
  }
  return out;
});

ipcMain.handle("modules:resolveUrl", async (_evt, id) => {
  const full = path.join(MODULES_DIR, id);
  if (!within(MODULES_DIR, full) || !fs.existsSync(full)) return { ok:false, message:"Missing module" };
  return { ok:true, url: toFileUrl(full) };
});

ipcMain.handle("modules:remove", async (_evt, id) => {
  try {
    const full = path.join(MODULES_DIR, id);
    if (!within(MODULES_DIR, full) || !fs.existsSync(full)) return { ok:false, message:"Missing module" };
    await fsp.unlink(full);
    return { ok:true };
  } catch (e) { return { ok:false, message:String(e?.message||e) }; }
});

ipcMain.handle("modules:openFolder", async () => {
  await shell.openPath(MODULES_DIR);
  return { ok:true };
});

// ======================= UPDATES (MINIMAL) =======================
function updatesDir(){ if (!fs.existsSync(UPDATES_DIR)) fs.mkdirSync(UPDATES_DIR,{recursive:true}); return UPDATES_DIR; }

ipcMain.handle("updates:status", async () => {
  const dir = updatesDir();
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const versions = [];
  for (const e of ents){
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    const st = await fsp.stat(p);
    versions.push({ id: e.name, name: e.name, created: st.mtimeMs });
  }
  const st = readState();
  return { versions, activeId: st.activeUpdate || null };
});

ipcMain.handle("updates:importZip", async () => {
  const res = await dialog.showOpenDialog({ title:"Import Update (.zip)", filters:[{ name:"Zip", extensions:["zip"] }], properties:["openFile"] });
  if (res.canceled || !res.filePaths?.length) return { ok:false, canceled:true };
  const zipPath = res.filePaths[0];
  const baseName = path.basename(zipPath, path.extname(zipPath));
  const destDir = await uniqueDest(updatesDir(), baseName);
  await fsp.mkdir(destDir, { recursive:true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  return { ok:true, id: path.basename(destDir) };
});

ipcMain.handle("updates:activate", async (_evt, id) => {
  // Minimal: record active ID only.
  writeState({ activeUpdate: id || null });
  return { ok:true };
});

ipcMain.handle("updates:remove", async (_evt, id) => {
  const dir = path.join(updatesDir(), id);
  if (!fs.existsSync(dir)) return { ok:false };
  await fsp.rm(dir, { recursive:true, force:true });
  const st = readState();
  if (st.activeUpdate === id) writeState({ activeUpdate: null });
  return { ok:true };
});

ipcMain.handle("updates:clear", async () => {
  writeState({ activeUpdate: null });
  return { ok:true };
});
