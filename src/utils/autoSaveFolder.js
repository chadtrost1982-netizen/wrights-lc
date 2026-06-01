const DB_NAME = "wrightsAutoSave";
const STORE_NAME = "handles";
const HANDLE_KEY = "autosaveDir";
const ESTIMATE_HANDLE_KEY = "estimatesDir";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeValue(key, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadValue(key) {
  const db = await openDb();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

export async function saveAutoSaveDirectoryHandle(handle) {
  await storeValue(HANDLE_KEY, handle);
}

export async function clearAutoSaveDirectoryHandle() {
  await storeValue(HANDLE_KEY, null);
}

export async function loadAutoSaveDirectoryHandle() {
  return loadValue(HANDLE_KEY);
}

export async function saveEstimateDirectoryHandle(handle) {
  await storeValue(ESTIMATE_HANDLE_KEY, handle);
}

export async function loadEstimateDirectoryHandle() {
  return loadValue(ESTIMATE_HANDLE_KEY);
}

export async function ensureWritePermission(handle) {
  if (!handle) return false;
  if (!handle.queryPermission || !handle.requestPermission) return false;
  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted") return true;
  const requested = await handle.requestPermission({ mode: "readwrite" });
  return requested === "granted";
}

export async function writeBlobToAutoSaveFolder(fileName, blob) {
  const handle = await loadAutoSaveDirectoryHandle();
  if (!handle) return { ok: false, reason: "not-configured" };
  const granted = await ensureWritePermission(handle);
  if (!granted) return { ok: false, reason: "permission-denied" };

  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { ok: true, folderName: handle.name };
}

export async function writeBlobToEstimateFolder(fileName, blob) {
  const handle = await loadEstimateDirectoryHandle();
  if (!handle) return { ok: false, reason: "not-configured" };
  const granted = await ensureWritePermission(handle);
  if (!granted) return { ok: false, reason: "permission-denied" };

  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { ok: true, folderName: handle.name };
}
