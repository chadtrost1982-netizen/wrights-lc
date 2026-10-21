export const DEFAULT_ESTIMATES_PATH = "Desktop/Business/Disposal Solutions/Estimates";
export const DEFAULT_INVOICES_PATH = "Desktop/Business/Disposal Solutions/Invoices";
export const DEFAULT_COUNTERS_PATH = "Desktop/Business/Disposal Solutions/counters.json";

export function cleanDrivePath(path) {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function envBag() {
  return import.meta.env || {};
}

/**
 * Folder inside the OneDrive root. An explicit env path wins. The old
 * VITE_ONEDRIVE_TARGET_PATH value is not used, so a leftover Wrights L.C.
 * path cannot keep receiving new files.
 */
export function resolveOneDriveFolder(kind, env = {}) {
  if (kind === "estimate") {
    return cleanDrivePath(env.estimates) || DEFAULT_ESTIMATES_PATH;
  }
  return cleanDrivePath(env.invoices) || DEFAULT_INVOICES_PATH;
}

export function resolveCountersPath(env = {}) {
  return cleanDrivePath(env.counters) || DEFAULT_COUNTERS_PATH;
}

export function activeOneDriveFolder(kind = "invoice") {
  const env = envBag();
  return resolveOneDriveFolder(kind, {
    estimates: env.VITE_ONEDRIVE_ESTIMATES_PATH,
    invoices: env.VITE_ONEDRIVE_INVOICES_PATH,
  });
}

export function activeCountersPath() {
  const env = envBag();
  return resolveCountersPath({ counters: env.VITE_ONEDRIVE_COUNTERS_PATH });
}

export function parentDriveFolder(filePath) {
  const parts = cleanDrivePath(filePath).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}
