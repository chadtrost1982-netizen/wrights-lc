import { activeMailFrom, DEFAULT_MAIL_FROM } from "./mailAccounts.js";

export const MAIL_NOTICE_KEY = "wrights_mail_notice";
export const MAIL_NOTICE_EVENT = "wrights-mail-notice";
export const SENT_LOG_KEY = "wrights_file_sent_log";

export function plainMailError(result) {
  const from = result?.senderAddress || DEFAULT_MAIL_FROM;
  if (!result) return "The email was not sent. Press Send again.";
  if (result.reason === "wrong-mailbox") {
    const who = result.signedInAs ? ` (${result.signedInAs})` : "";
    return `That sign-in was not ${from}${who}. The email was not sent. Press Send again and choose ${from}.`;
  }
  if (result.reason === "user-cancelled") {
    return "Sign-in was cancelled. The email was not sent.";
  }
  if (result.reason === "popup-blocked") {
    return "The sign-in window was blocked. Allow popups for this site and press Send again.";
  }
  if (result.reason === "mail-redirecting") {
    return `Opening Microsoft to sign in as ${from}. This email will send when you come back.`;
  }
  if (result.reason === "mail-signin-required") {
    return `Choose ${from} on the Microsoft page and accept Send mail. The email was not sent yet.`;
  }
  if (result.reason === "not-configured") {
    return "Email is not configured. The Azure app client id is missing, so the email was not sent.";
  }
  if (result.reason === "invalid-input") {
    return "Enter a recipient before sending. The email was not sent.";
  }
  if (result.reason === "send-failed") {
    return `Microsoft did not send the email${result.status ? ` (${result.status})` : ""}. ${friendlyGraph(result.details)}`.trim();
  }
  if (result.reason === "auth-failed") {
    const extra = cleanDetail(result.details);
    return extra
      ? `Microsoft sign-in did not finish, so the email was not sent. ${extra}`
      : "Microsoft sign-in did not finish, so the email was not sent.";
  }
  const fallback = cleanDetail(result.details || result.message);
  return fallback || "The email was not sent. Press Send again.";
}

function friendlyGraph(details) {
  const text = String(details || "");
  if (/ErrorAccessDenied|ErrorSendAsDenied|Access is denied|Authorization_RequestDenied/i.test(text)) {
    return `Allow Send mail for ${DEFAULT_MAIL_FROM}, then press Send again.`;
  }
  const cleaned = cleanDetail(text);
  return cleaned || "Press Send again. If it still fails, sign in as the business mailbox and accept Send mail.";
}

function cleanDetail(details) {
  return String(details || "")
    .replace(/token_scp=\S+/gi, "")
    .replace(/token_user=\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function statusLine(notice) {
  if (!notice) return "";
  if (notice.state === "sending") return `Sending from ${notice.from || activeMailFrom()}...`;
  if (notice.state === "sent") return "Sent";
  return notice.message || "The email was not sent. Press Send again.";
}

export function writeMailNotice(notice, storage = defaultStorage()) {
  if (!storage) return;
  storage.setItem(MAIL_NOTICE_KEY, JSON.stringify(notice));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MAIL_NOTICE_EVENT));
}

export function readMailNotice(storage = defaultStorage()) {
  if (!storage) return null;
  const raw = storage.getItem(MAIL_NOTICE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function finishMailAttempt(fileName, result) {
  if (result?.reason === "mail-redirecting") {
    writeMailNotice({
      state: "sending",
      from: result.senderAddress || activeMailFrom(),
      fileName,
      message: `Sending from ${result.senderAddress || activeMailFrom()}...`,
    });
    return { redirecting: true, message: plainMailError(result) };
  }
  if (result?.ok) {
    markFileSent(fileName);
    writeMailNotice({
      state: "sent",
      from: result.senderAddress || activeMailFrom(),
      fileName,
      message: "Sent",
    });
    return { ok: true, message: "Sent" };
  }
  const message = plainMailError(result);
  writeMailNotice({ state: "error", fileName, message });
  return { ok: false, message };
}

export function markFileSent(fileName, storage = defaultLocalStorage(), at = new Date().toISOString()) {
  if (!storage || !fileName) return "";
  let log = {};
  try {
    log = JSON.parse(storage.getItem(SENT_LOG_KEY) || "{}") || {};
  } catch {
    log = {};
  }
  log[fileName] = at;
  storage.setItem(SENT_LOG_KEY, JSON.stringify(log));
  return at;
}

function defaultStorage() {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function defaultLocalStorage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}
