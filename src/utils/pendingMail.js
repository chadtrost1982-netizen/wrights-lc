export const PENDING_MAIL_KEY = "wrights_pending_mail";
const MAX_CHARS = 4000000;

export function buildPendingMail(fields) {
  return {
    kind: fields.kind === "invoice" ? "invoice" : "estimate",
    listFileName: String(fields.listFileName || ""),
    attachmentName: String(fields.attachmentName || ""),
    itemId: String(fields.itemId || ""),
    to: String(fields.to || ""),
    cc: String(fields.cc || ""),
    subject: String(fields.subject || ""),
    body: String(fields.body || ""),
    customerName: String(fields.customerName || ""),
    senderAddress: String(fields.senderAddress || ""),
    regenerate: fields.regenerate === true,
    savedAt: fields.savedAt || new Date().toISOString(),
  };
}

/** The saved file can be opened again, so the PDF itself is not kept here. */
export function shouldKeepAttachmentBytes({ canRegenerate = false, byteLength = 0 } = {}) {
  return !canRegenerate && Number(byteLength) > 0;
}

export function savePendingMail(record, storage) {
  if (!storage || !record?.listFileName || !record?.to) {
    return { ok: false, reason: "incomplete" };
  }
  const descriptor = buildPendingMail(record);
  const json = JSON.stringify(descriptor);
  if (json.length > MAX_CHARS) return { ok: false, reason: "too-large" };
  try {
    storage.setItem(PENDING_MAIL_KEY, json);
  } catch {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true };
}

export function readPendingMail(storage) {
  if (!storage) return null;
  const raw = storage.getItem(PENDING_MAIL_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.listFileName || !parsed?.to) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createMemoryBlobStore() {
  let row = null;
  return {
    async save(record) {
      const hasBytes = Boolean(record?.bytes || record?.blob);
      const hasDescriptor = Boolean(record?.descriptor?.listFileName && record?.descriptor?.to);
      if (!hasBytes && !hasDescriptor) {
        return { ok: false, reason: "incomplete", keptBytes: false, keptDescriptor: false };
      }
      row = {
        fileName: record.fileName || "",
        bytes: record.bytes || null,
        blob: record.blob || null,
        descriptor: hasDescriptor ? record.descriptor : null,
      };
      return { ok: true, keptBytes: hasBytes, keptDescriptor: hasDescriptor };
    },
    async read() {
      return row;
    },
    async clear() {
      row = null;
    },
  };
}

/**
 * The browser note stays small. A file is copied into the larger store only
 * when it cannot be opened again after Microsoft sends the page back.
 */
export async function keepPendingSend({ record, blob, storages, blobStore }) {
  const descriptor = buildPendingMail(record);
  const saved = savePendingMailAll(descriptor, storages);
  const byteLength = Number(blob?.size || record?.byteLength || 0);
  const keepBytes = shouldKeepAttachmentBytes({
    canRegenerate: descriptor.regenerate,
    byteLength,
  });
  let held = { ok: true, keptBytes: false, keptDescriptor: false, reason: "skipped" };
  if (!saved.ok || keepBytes) {
    if (!blobStore?.save) {
      held = { ok: false, keptBytes: false, keptDescriptor: false, reason: "unavailable" };
    } else {
      held = await blobStore.save({
        fileName: descriptor.attachmentName || descriptor.listFileName,
        blob: keepBytes ? blob : undefined,
        bytes: keepBytes ? record?.bytes : undefined,
        descriptor: saved.ok ? undefined : descriptor,
      });
    }
  }
  const descriptorKept = Boolean(saved.ok || held?.keptDescriptor);
  const bytesKept = !keepBytes || Boolean(held?.keptBytes);
  return {
    ok: descriptorKept && bytesKept,
    descriptor,
    reason: descriptorKept && bytesKept ? "" : "unavailable",
  };
}

export function clearPendingMail(storage) {
  storage?.removeItem(PENDING_MAIL_KEY);
}

export function savePendingMailAll(record, storages) {
  const list = (storages || []).filter(Boolean);
  if (!list.length) return { ok: false, reason: "incomplete" };
  let saved = { ok: false, reason: "incomplete" };
  for (const storage of list) {
    try {
      const attempt = savePendingMail(record, storage);
      if (attempt.ok) saved = attempt;
    } catch {
      saved = saved.ok ? saved : { ok: false, reason: "too-large" };
    }
  }
  return saved;
}

export function readPendingMailFirst(storages) {
  for (const storage of storages || []) {
    const found = readPendingMail(storage);
    if (found) return found;
  }
  return null;
}

export function clearPendingMailAll(storages) {
  for (const storage of storages || []) clearPendingMail(storage);
}
