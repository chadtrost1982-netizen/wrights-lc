const DB_NAME = "wrights-pending-mail";
const STORE = "blob";
const KEY = "pending";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finish(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePendingBlob(record) {
  const incomingBlob = record?.blob || null;
  const incomingDescriptor = record?.descriptor?.listFileName && record?.descriptor?.to
    ? record.descriptor
    : null;
  if (!incomingBlob && !incomingDescriptor) {
    return { ok: false, reason: "incomplete", keptBytes: false, keptDescriptor: false };
  }
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      fileName: String(record.fileName || incomingDescriptor?.attachmentName || incomingDescriptor?.listFileName || ""),
      contentType: incomingBlob?.type || record.contentType || "application/octet-stream",
      blob: incomingBlob,
      descriptor: incomingDescriptor,
    }, KEY);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return {
      ok: true,
      keptBytes: Boolean(incomingBlob),
      keptDescriptor: Boolean(incomingDescriptor),
    };
  } catch {
    return { ok: false, reason: "unavailable", keptBytes: false, keptDescriptor: false };
  }
}

export async function readPendingBlob() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const row = await finish(tx.objectStore(STORE).get(KEY));
    db.close();
    if (!row?.blob && !row?.descriptor) return null;
    return {
      fileName: row.fileName || "",
      blob: row.blob || null,
      descriptor: row.descriptor || null,
    };
  } catch {
    return null;
  }
}

export async function clearPendingBlob() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Nothing stored.
  }
}
