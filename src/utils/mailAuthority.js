export const MAIL_AUTHORITY = "https://login.microsoftonline.com/consumers";
export const MAIL_REDIRECT_FLAG = "wrights_mail_redirect";
/** Desktop popup wait. Password plus a PIN can take several minutes. */
export const MAIL_POPUP_BRIDGE_MS = 10 * 60 * 1000;

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

export function markMailRedirectAll(storages) {
  for (const storage of storages || []) markMailRedirect(storage);
}

export function clearMailRedirectAll(storages) {
  for (const storage of storages || []) clearMailRedirect(storage);
}

export function mailRedirectPendingAny(storages) {
  return (storages || []).some((storage) => mailRedirectPending(storage));
}

/**
 * Phones open a popup as another tab, and that tab cannot reliably hand the
 * sign-in back. A touch-primary or narrow screen uses the full-page sign-in.
 */
export function prefersMailRedirect({
  userAgent = "",
  maxTouchPoints = 0,
  coarsePointer = false,
  narrow = false,
} = {}) {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
  return Boolean(Number(maxTouchPoints) > 0 && (coarsePointer || narrow));
}

/** Full-page sign-in on a phone, and whenever a desktop popup is blocked or times out. */
export function shouldSendByRedirect({ mobile = false, authKind = "" } = {}) {
  if (authKind === "user-cancelled" || authKind === "not-configured" || authKind === "wrong-mailbox") return false;
  if (mobile) return true;
  return authKind === "popup-blocked" || authKind === "timeout" || authKind === "use-redirect";
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
 * Hand a popup reply to MSAL's redirect bridge before the app boots.
 * A full-page redirect, including the business mailbox, must boot the app
 * so handleRedirectPromise can finish the email. Relaying it here drops it.
 */
export function shouldRelayAuthReturn(hash, search) {
  return readAuthInteraction(hash, search) === "popup";
}
