import { PublicClientApplication } from "@azure/msal-browser";
import { activeCountersPath, activeOneDriveFolder, parentDriveFolder } from "./oneDrivePaths.js";
import { encodeGraphPath, ensureDriveFolder } from "./ensureDriveFolder.js";
import { activeMailFrom, classifyMailAuthError, interpretMailLogin, normalizeEmail, pickAccounts } from "./mailAccounts.js";
import { markFileSent, plainMailError, writeMailNotice } from "./mailNotice.js";
import { buildPendingMail, clearPendingMailAll, readPendingMailFirst, savePendingMailAll } from "./pendingMail.js";
import {
  clearMailRedirectAll,
  driveAuthority,
  MAIL_AUTHORITY,
  MAIL_POPUP_BRIDGE_MS,
  mailRedirectPendingAny,
  markMailRedirectAll,
  prefersMailRedirect,
  shouldSendByRedirect,
} from "./mailAuthority.js";

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
let msalMailApp = null;
let msalInitPromise = null;
let lastRedirectError = "";
let lastInteractiveAttemptAt = 0;

function browserStorages() {
  const stores = [];
  try {
    if (typeof localStorage !== "undefined") stores.push(localStorage);
  } catch { /* private mode */ }
  try {
    if (typeof sessionStorage !== "undefined") stores.push(sessionStorage);
  } catch { /* private mode */ }
  return stores;
}

function devicePrefersMailRedirect() {
  if (typeof navigator === "undefined") return false;
  let coarsePointer = false;
  let narrow = false;
  try {
    coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    narrow = window.matchMedia("(max-width: 900px)").matches;
  } catch { /* matchMedia missing */ }
  return prefersMailRedirect({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer,
    narrow,
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
        authority: driveAuthority(tenantId),
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

function getMailMsalApp() {
  if (!clientId) return null;
  if (!msalMailApp) {
    msalMailApp = new PublicClientApplication({
      auth: {
        clientId,
        authority: MAIL_AUTHORITY,
        redirectUri,
        navigateToLoginRequestUrl: false,
      },
      cache: {
        cacheLocation: "localStorage",
      },
      system: {
        popupBridgeTimeout: MAIL_POPUP_BRIDGE_MS,
      },
    });
  }
  return msalMailApp;
}

async function consumeMailRedirect() {
  const mail = getMailMsalApp();
  const drive = getMsalApp();
  const stores = browserStorages();
  if (!mail) {
    clearMailRedirectAll(stores);
    return;
  }
  try {
    await mail.initialize();
    await mail.handleRedirectPromise();
  } catch (err) {
    lastRedirectError = err?.message || String(err || "Redirect auth failed");
  } finally {
    clearMailRedirectAll(stores);
    if (drive) useDriveAccount(drive);
  }
}

export async function initializeOneDriveAuth() {
  const app = getMsalApp();
  if (!app) return;

  if (!msalInitPromise) {
    msalInitPromise = (async () => {
      await app.initialize();
      if (mailRedirectPendingAny(browserStorages())) {
        await consumeMailRedirect();
        useDriveAccount(app);
        return;
      }
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

async function beginMailRedirect() {
  const senderAddress = activeMailFrom();
  const mail = getMailMsalApp();
  if (!mail) return { ok: false, reason: "not-configured", senderAddress };
  const now = Date.now();
  if (now - lastInteractiveAttemptAt < 30000) {
    return {
      ok: false,
      reason: "mail-signin-required",
      senderAddress,
      details: "The Microsoft sign-in page is already opening. Finish it, then this email sends itself.",
    };
  }
  lastInteractiveAttemptAt = now;
  try { sessionStorage.setItem(MAIL_CONSENT_ATTEMPT_KEY, String(now)); } catch { /* storage blocked */ }
  markMailRedirectAll(browserStorages());
  try {
    await mail.initialize();
    await mail.loginRedirect({
      scopes: mailScopes,
      loginHint: senderAddress,
      prompt: "select_account",
      authority: MAIL_AUTHORITY,
      redirectUri,
      redirectStartPage: window.location.href,
    });
  } catch (err) {
    clearMailRedirectAll(browserStorages());
    throw err;
  }
  return { ok: false, reason: "mail-redirecting", senderAddress };
}

async function loginMailPopup() {
  const senderAddress = activeMailFrom();
  const mail = getMailMsalApp();
  const drive = getMsalApp();
  if (!mail) return { ok: false, reason: "not-configured", senderAddress };
  await mail.initialize();
  let result = null;
  try {
    result = await mail.loginPopup({
      scopes: mailScopes,
      prompt: "select_account",
      loginHint: senderAddress,
      authority: MAIL_AUTHORITY,
      redirectUri,
    });
  } catch (err) {
    const kind = classifyMailAuthError(err);
    if (kind === "cancel") return { ok: false, reason: "user-cancelled", senderAddress };
    if (kind === "popup-blocked" || kind === "timeout") return { ok: false, reason: "use-redirect", senderAddress };
    return {
      ok: false,
      reason: "auth-failed",
      senderAddress,
      details: err?.message || "Microsoft sign-in failed.",
    };
  } finally {
    if (drive) useDriveAccount(drive);
  }

  const check = interpretMailLogin(result?.account, senderAddress);
  if (!check.ok) return check;
  if (result?.accessToken) return { ok: true, token: result.accessToken };
  try {
    const silent = await mail.acquireTokenSilent({
      account: result.account,
      scopes: mailScopes,
      authority: MAIL_AUTHORITY,
    });
    if (!silent?.accessToken) {
      return { ok: false, reason: "auth-failed", senderAddress, details: "Microsoft did not return a mail token." };
    }
    return { ok: true, token: silent.accessToken };
  } catch (err) {
    return {
      ok: false,
      reason: "auth-failed",
      senderAddress,
      details: err?.message || "Microsoft did not return a mail token.",
    };
  } finally {
    if (drive) useDriveAccount(drive);
  }
}

async function getMailToken({ interactive = "popup" } = {}) {
  const drive = getMsalApp();
  const mail = getMailMsalApp();
  if (!drive || !mail) return { ok: false, reason: "not-configured", senderAddress: activeMailFrom() };
  await initializeOneDriveAuth();
  await mail.initialize();
  const { mailAccount } = accountChoices(mail);
  useDriveAccount(drive);
  const wantsRedirect = interactive === "redirect" || devicePrefersMailRedirect();
  if (mailAccount) {
    try {
      const silent = await mail.acquireTokenSilent({
        account: mailAccount,
        scopes: mailScopes,
        authority: MAIL_AUTHORITY,
      });
      useDriveAccount(drive);
      if (silent?.accessToken) return { ok: true, token: silent.accessToken };
    } catch (err) {
      useDriveAccount(drive);
      if (interactive === "none" || (!needsInteraction(err) && !wantsRedirect)) {
        return {
          ok: false,
          reason: "auth-failed",
          senderAddress: activeMailFrom(),
          details: err?.message || "Microsoft did not grant Send mail.",
        };
      }
    }
  } else if (interactive === "none") {
    return {
      ok: false,
      reason: "wrong-mailbox",
      senderAddress: activeMailFrom(),
      details: "Microsoft came back without the business mailbox.",
    };
  }

  if (interactive === "none") {
    return { ok: false, reason: "auth-failed", senderAddress: activeMailFrom(), details: "Send mail still needs a sign-in." };
  }
  if (wantsRedirect) return { ok: false, reason: "use-redirect", senderAddress: activeMailFrom() };
  const popup = await loginMailPopup();
  if (popup.reason === "use-redirect" || popup.reason === "popup-blocked") {
    return { ok: false, reason: "use-redirect", senderAddress: activeMailFrom() };
  }
  return popup;
}

async function persistAndRedirectMail(fields) {
  const stores = browserStorages();
  const saved = savePendingMailAll(buildPendingMail({
    ...fields,
    senderAddress: activeMailFrom(),
  }), stores);
  if (!saved.ok) {
    return {
      ok: false,
      reason: "auth-failed",
      senderAddress: activeMailFrom(),
      details: "This email is too large to finish after the Microsoft sign-in page. The email was not sent.",
    };
  }
  writeMailNotice({
    state: "sending",
    from: activeMailFrom(),
    fileName: fields.listFileName,
    message: `Sending from ${activeMailFrom()}...`,
  });
  try {
    const redirected = await beginMailRedirect();
    return redirected.reason === "mail-signin-required" ? redirected : { ok: false, reason: "mail-redirecting", senderAddress: activeMailFrom() };
  } catch (err) {
    clearPendingMailAll(stores);
    clearMailRedirectAll(stores);
    return {
      ok: false,
      reason: "auth-failed",
      senderAddress: activeMailFrom(),
      details: err?.message || "Microsoft sign-in did not finish.",
    };
  }
}

async function deliverMail({ token, to, cc, subject, body, fileName, blob }) {
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

  if (normalizeEmail(senderAddress) !== activeMailFrom()) {
    return {
      ok: false,
      reason: "wrong-mailbox",
      senderAddress: activeMailFrom(),
      signedInAs: senderAddress,
    };
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
    const app = getMsalApp();
    if (app) useDriveAccount(app);

    if (!res.ok) {
      let details = "";
      try {
        const errorBody = await res.json();
        details = errorBody?.error?.message || "";
      } catch {
        try {
          details = await res.text();
        } catch {
          details = "";
        }
      }
      return { ok: false, reason: "send-failed", status: res.status, details: details || "Microsoft refused the message.", senderAddress };
    }
    return { ok: true, senderAddress, status: res.status };
}

export async function sendGraphEmailWithAttachment({
  to,
  cc = "",
  subject,
  body,
  fileName,
  blob,
  listFileName = "",
  kind = "estimate",
  itemId = "",
  customerName = "",
}) {
  try {
    if (!clientId) return { ok: false, reason: "not-configured", senderAddress: activeMailFrom() };
    if (!to || !subject || !fileName || !blob) return { ok: false, reason: "invalid-input", senderAddress: activeMailFrom() };

    writeMailNotice({
      state: "sending",
      from: activeMailFrom(),
      fileName: listFileName || fileName,
      message: `Sending from ${activeMailFrom()}...`,
    });

    const mobile = devicePrefersMailRedirect();
    const mailAuth = await getMailToken({ interactive: mobile ? "redirect" : "popup" });
    if (!mailAuth?.token) {
      if (shouldSendByRedirect({ mobile, authKind: mailAuth?.reason })) {
        const contentBase64 = toBase64(await blob.arrayBuffer());
        return persistAndRedirectMail({
          kind,
          listFileName: listFileName || fileName,
          attachmentName: fileName,
          itemId,
          to,
          cc,
          subject,
          body,
          customerName,
          contentType: blob.type || "application/octet-stream",
          contentBase64,
        });
      }
      return mailAuth?.reason
        ? mailAuth
        : { ok: false, reason: "auth-failed", senderAddress: activeMailFrom(), details: "Microsoft sign-in did not finish." };
    }

    return deliverMail({ token: mailAuth.token, to, cc, subject, body, fileName, blob });
  } catch (err) {
    const message = err?.name === "AbortError"
      ? "Send request timed out. Please retry."
      : (err?.message || String(err || "Unknown auth error"));
    return {
      ok: false,
      reason: "auth-failed",
      senderAddress: activeMailFrom(),
      details: message,
    };
  }
}

function announceMailResult(result) {
  if (typeof window === "undefined" || typeof window.alert !== "function") return;
  if (result?.ok) {
    window.alert(`Sent from ${result.senderAddress || activeMailFrom()}.`);
    return;
  }
  window.alert(plainMailError(result));
}

export async function resumePendingMailSend() {
  const stores = browserStorages();
  const pending = readPendingMailFirst(stores);
  if (!pending) return { ok: false, reason: "none" };
  const fail = (result) => {
    clearPendingMailAll(stores);
    writeMailNotice({
      state: "error",
      fileName: pending.listFileName,
      message: plainMailError(result),
    });
    announceMailResult(result);
    return result;
  };
  try {
    if (lastRedirectError) {
      const details = lastRedirectError;
      lastRedirectError = "";
      return fail({ ok: false, reason: "auth-failed", senderAddress: activeMailFrom(), details });
    }
    const mailAuth = await getMailToken({ interactive: "none" });
    if (!mailAuth?.token) {
      return fail(mailAuth?.reason ? mailAuth : {
        ok: false,
        reason: "wrong-mailbox",
        senderAddress: activeMailFrom(),
      });
    }
    const blob = fromBase64ToBlob(pending.contentBase64, pending.contentType);
    const result = await deliverMail({
      token: mailAuth.token,
      to: pending.to,
      cc: pending.cc,
      subject: pending.subject,
      body: pending.body,
      fileName: pending.attachmentName || pending.listFileName,
      blob,
    });
    if (!result.ok) return fail(result);
    clearPendingMailAll(stores);
    markFileSent(pending.listFileName);
    writeMailNotice({
      state: "sent",
      from: result.senderAddress,
      fileName: pending.listFileName,
      message: "Sent",
    });
    announceMailResult(result);
    return result;
  } catch (err) {
    return fail({
      ok: false,
      reason: "auth-failed",
      senderAddress: activeMailFrom(),
      details: err?.message || "The email could not be finished after sign-in.",
    });
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
