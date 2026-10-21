const PASSWORD_KEY = "wrights_catalog_password";

let cached = null;
let inflight = null;

export function getCatalogPassword() {
  try {
    return localStorage.getItem(PASSWORD_KEY) || "";
  } catch {
    return "";
  }
}

export function setCatalogPassword(password) {
  cached = null;
  try {
    if (password) localStorage.setItem(PASSWORD_KEY, password);
    else localStorage.removeItem(PASSWORD_KEY);
  } catch {
    // Ignore storage failures; the request can still send the password once.
  }
}

export async function fetchCatalog({ idToken = "", force = false } = {}) {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const headers = { Accept: "application/json" };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const password = getCatalogPassword();
    if (password) headers["x-wrights-password"] = password;
    const res = await fetch("/api/catalog", { headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(body.error || "Could not load prices.");
      error.status = res.status;
      throw error;
    }
    cached = body;
    return body;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
