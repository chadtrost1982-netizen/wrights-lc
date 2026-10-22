export const SHELL_CACHE = "disposal-solutions-shell-v1";

const AUTH_QUERY_KEYS = [
  "code",
  "error",
  "error_description",
  "state",
  "id_token",
  "client_info",
  "session_state",
];

/** Microsoft sign-in returns here. A service-worker reload must not interrupt it. */
export function isAuthReturnUrl(href) {
  return /[?#&](?:code|error|state|id_token)=/.test(String(href || ""));
}

function isMicrosoftOrDriveHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (
    host === "login.microsoftonline.com" ||
    host === "login.microsoft.com" ||
    host === "login.windows.net" ||
    host === "login.live.com" ||
    host === "account.live.com" ||
    host === "graph.microsoft.com" ||
    host === "substrate.office.com" ||
    host === "outlook.office.com" ||
    host === "onedrive.live.com" ||
    host.endsWith(".onedrive.live.com") ||
    host === "sharepoint.com" ||
    host.endsWith(".sharepoint.com")
  ) {
    return true;
  }
  return false;
}

/**
 * Only the app shell may be stored, and only as a fallback when the network fails.
 * API, Microsoft sign-in, Graph, and OneDrive are never stored.
 */
export function shouldCacheAppRequest(rawUrl, method = "GET", appOrigin = "") {
  if (String(method || "GET").toUpperCase() !== "GET") return false;
  let url;
  try {
    url = new URL(String(rawUrl || ""), appOrigin || "https://wrights-lc.vercel.app");
  } catch {
    return false;
  }
  if (appOrigin && url.origin !== appOrigin) return false;
  if (isMicrosoftOrDriveHost(url.hostname)) return false;
  if (url.pathname === "/sw.js" || url.pathname === "/pwaPolicy.js" || url.pathname === "/manifest.webmanifest") {
    return false;
  }
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return false;
  if (AUTH_QUERY_KEYS.some((key) => url.searchParams.has(key))) return false;
  return true;
}
