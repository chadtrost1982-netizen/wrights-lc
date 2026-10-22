export const MAIL_AUTHORITY = "https://login.microsoftonline.com/consumers";
export const MAIL_REDIRECT_FLAG = "wrights_mail_redirect";

const AUTH_MARKERS = ["code", "error", "id_token", "access_token"];

/** OneDrive sign-in. Unset or blank tenant stays on common, same as before. */
export function driveAuthority(tenantId) {
  const tenant = String(tenantId || "").trim() || "common";
  return `https://login.microsoftonline.com/${tenant}`;
}

export function markMailRedirect(storage) {
  storage?.setItem(MAIL_REDIRECT_FLAG, "1");
}

export function clearMailRedirect(storage) {
  storage?.removeItem(MAIL_REDIRECT_FLAG);
}

export function mailRedirectPending(storage) {
  try {
    return storage?.getItem(MAIL_REDIRECT_FLAG) === "1";
  } catch {
    return false;
  }
}

function paramsFrom(value) {
  const raw = String(value || "");
  if (raw.length < 2) return null;
  const body = raw.startsWith("#") || raw.startsWith("?") ? raw.slice(1) : raw;
  const params = new URLSearchParams(body);
  if (!params.get("state")) return null;
  if (!AUTH_MARKERS.some((key) => params.has(key))) return null;
  return params;
}

export function authReturnParams(hash, search) {
  return paramsFrom(hash) || paramsFrom(search);
}

function decodeLibraryState(state) {
  const library = String(state || "").split("|")[0];
  if (!library) return null;
  try {
    const normalized = library.replace(/-/g, "+").replace(/_/g, "/");
    const remainder = normalized.length % 4;
    if (remainder === 1) return null;
    const padded = remainder === 0 ? normalized : normalized + "=".repeat(4 - remainder);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** "popup", "redirect", or "" when this URL is not a Microsoft reply. */
export function readAuthInteraction(hash, search) {
  const params = authReturnParams(hash, search);
  if (!params) return "";
  const parsed = decodeLibraryState(params.get("state"));
  return String(parsed?.meta?.interactionType || "");
}

/**
 * Hand the Microsoft reply to MSAL's redirect bridge before the app boots.
 * Popup replies always relay, even when window.opener was cleared.
 * Full-page replies relay only for the business mailbox, so Hotmail sign-in
 * still runs through the existing page load.
 */
export function shouldRelayAuthReturn(hash, search, { mailRedirectPending: pending = false } = {}) {
  const kind = readAuthInteraction(hash, search);
  if (kind === "popup") return true;
  if (kind === "redirect" && pending) return true;
  return false;
}
