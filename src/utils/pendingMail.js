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
    contentType: String(fields.contentType || "application/octet-stream"),
    contentBase64: String(fields.contentBase64 || ""),
    savedAt: fields.savedAt || new Date().toISOString(),
  };
}

export function savePendingMail(record, storage) {
  if (!storage || !record?.listFileName || !record?.to || !record?.contentBase64) {
    return { ok: false, reason: "incomplete" };
  }
  const json = JSON.stringify(record);
  if (json.length > MAX_CHARS) return { ok: false, reason: "too-large" };
  storage.setItem(PENDING_MAIL_KEY, json);
  return { ok: true };
}

export function readPendingMail(storage) {
  if (!storage) return null;
  const raw = storage.getItem(PENDING_MAIL_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.listFileName || !parsed?.to || !parsed?.contentBase64) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingMail(storage) {
  storage?.removeItem(PENDING_MAIL_KEY);
}
