import { PublicClientApplication } from "@azure/msal-browser";
import { activeCountersPath, activeOneDriveFolder, parentDriveFolder } from "./oneDrivePaths.js";
import { encodeGraphPath, ensureDriveFolder } from "./ensureDriveFolder.js";
import { activeMailFrom, normalizeEmail, pickAccounts } from "./mailAccounts.js";

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID || "";
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID || "common";
const redirectUri = import.meta.env.VITE_AZURE_REDIRECT_URI || window.location.origin;

const fileScope = "Files.ReadWrite";
const mailScope = "Mail.Send";
const basicScope = "User.Read";
const driveScopes = [basicScope, fileScope];
const mailScopes = [basicScope, mailScope];
const graphEndpoint = "https://graph.microsoft.com/v1.0";
const PENDING_UPLOAD_KEY = "wrights_pending_onedrive_upload";
const SAVE_NOTICE_KEY = "wrights_save_notice";
const MAIL_CONSENT_ATTEMPT_KEY = "wrights_mail_consent_attempt";

let msalApp = null;
let msalInitPromise = null;
let lastRedirectError = "";
let lastInteractiveAttemptAt = 0;

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function allowedEmailList() {
  return String(import.meta.env.VITE_ALLOWED_EMAILS || "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
}

function accountChoices(app) {
  return pickAccounts(app.getAllAccounts(), {
    allow: allowedEmailList(),
    mailFrom: activeMailFrom(),
  });
}

function useDriveAccount(app) {
  const { drive } = accountChoices(app);
  if (drive) app.setActiveAccount(drive);
  return drive || null;
}

function getMsalApp() {
  if (!clientId) return null;
  if (!msalApp) {
    msalApp = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri,
        navigateToLoginRequestUrl: false,
      },
      cache: {
        cacheLocation: "localStorage",
        temporaryCacheLocation: "localStorage",
      },
      system: {
        // Avoid false "timed_out" in slower popup/embedded-browser auth flows.
        windowHashTimeout: 120000,
        iframeHashTimeout: 15000,
        loadFrameTimeout: 120000,
        asyncPopups: true,
      },
    });
  }
  return msalApp;
}

export async function initializeOneDriveAuth() {
  const app = getMsalApp();
  if (!app) return;

  if (!msalInitPromise) {
    msalInitPromise = (async () => {
      await app.initialize();
      const redirectResult = await app.handleRedirectPromise().catch((err) => {
        lastRedirectError = err?.message || String(err || "Redirect auth failed");
        return null;
      });
      const drive = useDriveAccount(app);
      const redirectEmail = normalizeEmail(redirectResult?.account?.username);
      if (!drive && redirectResult?.account && redirectEmail && redirectEmail !== activeMailFrom()) {
        app.setActiveAccount(redirectResult.account);
      }
    })();
  }
  await msalInitPromise;
}

export async function getSignedInEmail() {
  const app = getMsalApp();
  if (!app) return "";
  await initializeOneDriveAuth();
  const account = useDriveAccount(app);
  if (!account) return "";
  return String(account.username || "").trim();
}

export async function getIdToken() {
  const app = getMsalApp();
  if (!app) return "";
  try {
    await initializeOneDriveAuth();
    const account = useDriveAccount(app);
    if (!account) return "";
    const silent = await app.acquireTokenSilent({ account, scopes: [basicScope] });
    return silent?.idToken || "";
  } catch {
    return "";
  }
}

export async function beginSignInRedirect() {
  const app = getMsalApp();
  if (!app) return { ok: false, reason: "not-configured" };
  await initializeOneDriveAuth();
  const allow = allowedEmailList();
  await app.loginRedirect({
    scopes: driveScopes,
    loginHint: allow.length === 1 ? allow[0] : undefined,
    prompt: "select_account",
    redirectUri,
    redirectStartPage: window.location.href,
  });
  return { ok: false, reason: "redirecting" };
}

export async function signOutRedirect() {
  const app = getMsalApp();
  if (!app) return;
  await initializeOneDriveAuth();
  const account = useDriveAccount(app) || app.getActiveAccount() || undefined;
  await app.logoutRedirect({
    account,
    postLogoutRedirectUri: redirectUri,
  });
}

async function getFilesTokenSilent() {
  const app = getMsalApp();
  if (!app) return null;
  try {
    await initializeOneDriveAuth();
    const account = useDriveAccount(app);
    if (!account) return null;
    const silent = await app.acquireTokenSilent({ account, scopes: [fileScope] });
    return silent?.accessToken || null;
  } catch {
    return null;
  }
}

async function getAccessToken(scopes = [fileScope]) {
  const app = getMsalApp();
  if (!app) return null;

  await initializeOneDriveAuth();
  if (lastRedirectError) {
    const message = lastRedirectError;
    lastRedirectError = "";
    throw new Error(message);
  }

  const account = useDriveAccount(app);

  if (account) {
    try {
      const silent = await app.acquireTokenSilent({ account, scopes });
      return silent?.accessToken || null;
    } catch (err) {
      const code = String(err?.errorCode || "").toLowerCase();
      const msg = String(err?.message || "").toLowerCase();
      const interactionRequired =
        code.includes("interaction_required") ||
        code.includes("consent_required") ||
        code.includes("invalid_grant") ||
        code.includes("login_required") ||
        msg.includes("interaction_required") ||
        msg.includes("consent_required") ||
        msg.includes("invalid_grant") ||
        msg.includes("login_required");

      if (!interactionRequired) {
        throw err;
      }
      const now = Date.now();
      if (now - lastInteractiveAttemptAt < 30000) {
        throw new Error("Authentication still pending. Please try again in a few seconds.");
      }
      lastInteractiveAttemptAt = now;
      await app.acquireTokenRedirect({
        scopes,
        account,
        redirectUri,
        redirectStartPage: window.location.href,
      });
      return null;
    }
  }

  lastInteractiveAttemptAt = Date.now();
  await app.acquireTokenRedirect({
    scopes,
    account: account || undefined,
    redirectUri,
    redirectStartPage: window.location.href,
  });
  return null;
}

function resolveTargetPath(kind = "invoice") {
  return activeOneDriveFolder(kind);
}

function buildUploadUrl(fileName, kind = "invoice") {
  const targetPath = resolveTargetPath(kind);
  if (!targetPath) return null;
  const encodedPath = encodeGraphPath(targetPath);
  const encodedName = encodeURIComponent(fileName);
  return `${graphEndpoint}/me/drive/root:/${encodedPath}/${encodedName}:/content`;
}

export function isOneDriveGraphConfigured(kind = "invoice") {
  return Boolean(clientId && resolveTargetPath(kind));
}

export async function queuePendingOneDriveUpload(fileName, blob, kind = "invoice") {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = toBase64(arrayBuffer);
    sessionStorage.setItem(
      PENDING_UPLOAD_KEY,
      JSON.stringify({
        fileName,
        kind,
        contentType: blob.type || "application/octet-stream",
        base64,
      })
    );
  } catch {
    // ignore queue failures
  }
}

export function clearPendingOneDriveUpload() {
  sessionStorage.removeItem(PENDING_UPLOAD_KEY);
}

function fromBase64ToBlob(base64, contentType = "application/octet-stream") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

export function consumeSaveNotice() {
  const note = sessionStorage.getItem(SAVE_NOTICE_KEY) || "";
  if (note) sessionStorage.removeItem(SAVE_NOTICE_KEY);
  return note;
}

export async function resumePendingOneDriveUpload() {
  const raw = sessionStorage.getItem(PENDING_UPLOAD_KEY);
  if (!raw) return { ok: false, reason: "none" };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.fileName || !parsed?.base64) return { ok: false, reason: "invalid-pending" };
    const blob = fromBase64ToBlob(parsed.base64, parsed.contentType || "application/octet-stream");
    const result = await uploadBlobToOneDrive(parsed.fileName, blob, parsed.kind || "invoice");
    if (result.ok) {
      clearPendingOneDriveUpload();
      const location = result.parentPath
        ? `${result.parentPath.replace("/drive/root:", "")}/${result.name}`
        : parsed.fileName;
      sessionStorage.setItem(SAVE_NOTICE_KEY, `File saved to OneDrive: ${location}`);
    }
    return result;
  } catch {
    return { ok: false, reason: "resume-failed" };
  }
}

export async function uploadBlobToOneDrive(fileName, blob, kind = "invoice") {
  if (!isOneDriveGraphConfigured(kind)) {
    return { ok: false, reason: "not-configured", kind };
  }

  const token = await getAccessToken([fileScope]);
  if (!token) return { ok: false, reason: "auth-failed" };

  const url = buildUploadUrl(fileName, kind);
  if (!url) return { ok: false, reason: "invalid-path" };

  const folderReady = await ensureDriveFolder(fetch, {
    graphEndpoint,
    token,
    folderPath: resolveTargetPath(kind),
  });
  if (!folderReady.ok) return folderReady;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: blob,
  });

  if (!res.ok) {
    return { ok: false, reason: "upload-failed", status: res.status };
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return {
    ok: true,
    webUrl: payload?.webUrl || "",
    id: payload?.id || "",
    name: payload?.name || fileName,
    parentPath: payload?.parentReference?.path || "",
  };
}

export async function listOneDriveFiles(kind = "invoice", startsWith = "") {
  if (!isOneDriveGraphConfigured(kind)) return { ok: false, reason: "not-configured" };
  const token = await getAccessToken([fileScope]);
  if (!token) return { ok: false, reason: "auth-failed" };
  const folder = resolveTargetPath(kind);
  if (!folder) return { ok: false, reason: "invalid-path" };
  const encodedPath = encodeGraphPath(folder);
  const url = `${graphEndpoint}/me/drive/root:/${encodedPath}:/children?$top=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, reason: "list-failed", status: res.status };
  const payload = await res.json().catch(() => ({}));
  const values = Array.isArray(payload?.value) ? payload.value : [];
  const filtered = values
    .filter((v) => v?.file && String(v.name || "").toLowerCase().startsWith(String(startsWith || "").toLowerCase()))
    .map((v) => ({
      id: v.id,
      name: v.name,
      size: Number(v.size || 0),
      updatedAt: v.lastModifiedDateTime ? new Date(v.lastModifiedDateTime).getTime() : 0,
      webUrl: v.webUrl || "",
      parentPath: v.parentReference?.path || "",
    }));
  filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  return { ok: true, files: filtered };
}

export async function downloadOneDriveFile(kind = "invoice", fileName = "") {
  if (!isOneDriveGraphConfigured(kind)) return { ok: false, reason: "not-configured" };
  const token = await getAccessToken([fileScope]);
  if (!token) return { ok: false, reason: "auth-failed" };
  const folder = resolveTargetPath(kind);
  if (!folder) return { ok: false, reason: "invalid-path" };
  const encodedPath = encodeGraphPath(folder);
  const encodedName = encodeURIComponent(fileName);
  const url = `${graphEndpoint}/me/drive/root:/${encodedPath}/${encodedName}:/content`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, reason: "download-failed", status: res.status };
  const blob = await res.blob();
  return { ok: true, blob };
}

export async function downloadOneDriveFileById(kind = "invoice", itemId = "") {
  if (!isOneDriveGraphConfigured(kind)) return { ok: false, reason: "not-configured" };
  const token = await getAccessToken([fileScope]);
  if (!token) return { ok: false, reason: "auth-failed" };
  if (!itemId) return { ok: false, reason: "invalid-path" };

  const url = `${graphEndpoint}/me/drive/items/${encodeURIComponent(itemId)}/content`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, reason: "download-failed", status: res.status };
  const blob = await res.blob();
  return { ok: true, blob };
}

export async function deleteOneDriveFile(kind = "invoice", fileName = "") {
  if (!isOneDriveGraphConfigured(kind)) return { ok: false, reason: "not-configured" };
  const token = await getAccessToken([fileScope]);
  if (!token) return { ok: false, reason: "auth-failed" };
  const folder = resolveTargetPath(kind);
  if (!folder) return { ok: false, reason: "invalid-path" };
  const encodedPath = encodeGraphPath(folder);
  const encodedName = encodeURIComponent(fileName);
  const url = `${graphEndpoint}/me/drive/root:/${encodedPath}/${encodedName}`;
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 204) return { ok: false, reason: "delete-failed", status: res.status };
  return { ok: true };
}

export async function deleteOneDriveFileById(kind = "invoice", itemId = "") {
  if (!isOneDriveGraphConfigured(kind)) return { ok: false, reason: "not-configured" };
  const token = await getAccessToken([fileScope]);
  if (!token) return { ok: false, reason: "auth-failed" };
  if (!itemId) return { ok: false, reason: "invalid-path" };

  const url = `${graphEndpoint}/me/drive/items/${encodeURIComponent(itemId)}`;
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 204) return { ok: false, reason: "delete-failed", status: res.status };
  return { ok: true };
}

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseJwtClaims(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function needsInteraction(err) {
  const code = String(err?.errorCode || "").toLowerCase();
  const msg = String(err?.message || "").toLowerCase();
  return (
    code.includes("interaction_required") ||
    code.includes("consent_required") ||
    code.includes("invalid_grant") ||
    code.includes("login_required") ||
    msg.includes("interaction_required") ||
    msg.includes("consent_required") ||
    msg.includes("invalid_grant") ||
    msg.includes("login_required")
  );
}

async function beginMailSignIn(app, account) {
  const now = Date.now();
  const senderAddress = activeMailFrom();
  if (now - lastInteractiveAttemptAt < 30000) {
    return {
      ok: false,
      reason: "mail-signin-required",
      senderAddress,
      details: "The Microsoft sign-in page is already opening. Finish it, then press Send again.",
    };
  }
  lastInteractiveAttemptAt = now;
  sessionStorage.setItem(MAIL_CONSENT_ATTEMPT_KEY, String(now));
  await app.loginRedirect({
    scopes: mailScopes,
    account: account || undefined,
    loginHint: senderAddress,
    prompt: account ? "consent" : "select_account",
    redirectUri,
    redirectStartPage: window.location.href,
  });
  return {
    ok: false,
    reason: "mail-signin-required",
    senderAddress,
    details: "Sign in as the sending mailbox, accept Send mail, then press Send again.",
  };
}

async function getMailToken() {
  const app = getMsalApp();
  if (!app) return { ok: false, reason: "not-configured" };
  await initializeOneDriveAuth();
  const { mailAccount } = accountChoices(app);
  useDriveAccount(app);
  if (!mailAccount) return beginMailSignIn(app, null);
  try {
    const silent = await app.acquireTokenSilent({ account: mailAccount, scopes: mailScopes });
    useDriveAccount(app);
    if (!silent?.accessToken) {
      return { ok: false, reason: "auth-failed", senderAddress: activeMailFrom() };
    }
    return { ok: true, token: silent.accessToken };
  } catch (err) {
    if (!needsInteraction(err)) throw err;
    return beginMailSignIn(app, mailAccount);
  }
}

export async function sendGraphEmailWithAttachment({
  to,
  cc = "",
  subject,
  body,
  fileName,
  blob,
}) {
  try {
    if (!clientId) return { ok: false, reason: "not-configured" };
    if (!to || !subject || !fileName || !blob) return { ok: false, reason: "invalid-input" };

    const mailAuth = await withTimeout(getMailToken(), 90000, "Authentication");
    if (!mailAuth?.token) {
      return mailAuth?.reason
        ? mailAuth
        : { ok: false, reason: "auth-failed", senderAddress: activeMailFrom() };
    }
    const token = mailAuth.token;
    let senderAddress = activeMailFrom();
    try {
      const meRes = await fetch(`${graphEndpoint}/me?$select=mail,userPrincipalName`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        senderAddress = String(me?.mail || me?.userPrincipalName || senderAddress).trim();
      }
    } catch {
      // The send still uses the business mailbox token.
    }

    const arrayBuffer = await blob.arrayBuffer();
    const contentBytes = toBase64(arrayBuffer);
    const toRecipients = String(to)
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((address) => ({ emailAddress: { address } }));
    const ccRecipients = String(cc)
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((address) => ({ emailAddress: { address } }));

    const payload = {
      message: {
        subject,
        body: {
          contentType: "Text",
          content: body || "",
        },
        toRecipients,
        ccRecipients,
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: fileName,
            contentType: blob.type || "application/octet-stream",
            contentBytes,
          },
        ],
      },
      saveToSentItems: true,
    };

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 45000);
    let res = await fetch(`${graphEndpoint}/me/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    clearTimeout(abortTimer);
    useDriveAccount(getMsalApp());

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        const app = getMsalApp();
        if (app) {
          const { mailAccount } = accountChoices(app);
          return beginMailSignIn(app, mailAccount);
        }
      }
      let details = "";
      try {
        const payload = await res.json();
        details = payload?.error?.message || "";
      } catch {
        try {
          details = await res.text();
        } catch {
          details = "";
        }
      }
      const claims = parseJwtClaims(token);
      const scopeInfo = claims?.scp ? ` token_scp=${claims.scp}` : "";
      const upnInfo = (claims?.preferred_username || claims?.upn)
        ? ` token_user=${claims.preferred_username || claims.upn}`
        : "";
      details = `${details || "No Graph error details."}${scopeInfo}${upnInfo}`.trim();
      return { ok: false, reason: "send-failed", status: res.status, details };
    }
    return { ok: true, senderAddress, status: res.status };
  } catch (err) {
    const message = err?.name === "AbortError"
      ? "Send request timed out. Please retry."
      : (err?.message || String(err || "Unknown auth error"));
    return {
      ok: false,
      reason: "auth-failed",
      details: message,
    };
  }
}

export function isGraphClientConfigured() {
  return Boolean(clientId);
}

function countersFilePath() {
  return activeCountersPath();
}

export function sharedCounterPath() {
  return countersFilePath();
}

export function createCounterDrive() {
  const encoded = encodeGraphPath(countersFilePath());
  const itemUrl = `${graphEndpoint}/me/drive/root:/${encoded}`;

  return {
    async read() {
      if (!clientId) {
        const err = new Error("Microsoft sign-in is not configured, so numbers stay on this device.");
        err.code = "not-configured";
        throw err;
      }
      const token = await getFilesTokenSilent();
      if (!token) {
        const err = new Error("Sign in with Microsoft to share invoice and estimate numbers. Until then, these are the last numbers on this device.");
        err.code = "auth-failed";
        throw err;
      }
      const metaRes = await fetch(itemUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (metaRes.status === 404) return { found: false };
      if (!metaRes.ok) {
        const err = new Error("Could not read the shared number counter on OneDrive. Check your connection and try again.");
        err.code = "read-failed";
        throw err;
      }
      const meta = await metaRes.json().catch(() => ({}));
      const contentRes = await fetch(`${itemUrl}:/content`, { headers: { Authorization: `Bearer ${token}` } });
      if (contentRes.status === 404) return { found: false };
      if (!contentRes.ok) {
        const err = new Error("Could not read the shared number counter on OneDrive. Check your connection and try again.");
        err.code = "read-failed";
        throw err;
      }
      const value = await contentRes.json().catch(() => null);
      if (!value || typeof value !== "object") {
        const err = new Error("The shared counter file on OneDrive could not be read. No new number was issued.");
        err.code = "invalid-counter";
        throw err;
      }
      return { found: true, etag: meta.eTag || contentRes.headers.get("etag") || "", value };
    },

    async write({ etag, create, value }) {
      const token = await getFilesTokenSilent();
      if (!token) {
        const err = new Error("Sign in with Microsoft to share invoice and estimate numbers. Until then, these are the last numbers on this device.");
        err.code = "auth-failed";
        throw err;
      }
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (create) headers["If-None-Match"] = "*";
      else if (etag) headers["If-Match"] = etag;
      const folderReady = await ensureDriveFolder(fetch, {
        graphEndpoint,
        token,
        folderPath: parentDriveFolder(countersFilePath()),
      });
      if (!folderReady.ok) {
        const err = new Error("Could not create the Disposal Solutions folder on OneDrive. No new number was issued.");
        err.code = "folder-create-failed";
        throw err;
      }
      const res = await fetch(`${itemUrl}:/content`, {
        method: "PUT",
        headers,
        body: JSON.stringify(value),
      });
      if (res.status === 409 || res.status === 412) return { ok: false, conflict: true };
      if (!res.ok) {
        const err = new Error("Could not save the shared number counter on OneDrive. No new number was issued.");
        err.code = "write-failed";
        throw err;
      }
      return { ok: true, conflict: false, etag: res.headers.get("etag") || "" };
    },
  };
}
