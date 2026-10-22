export const DEFAULT_MAIL_FROM = "disposalsolutions@outlook.com";

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function mailFromAddress(envValue) {
  return normalizeEmail(envValue) || DEFAULT_MAIL_FROM;
}

export function activeMailFrom() {
  return mailFromAddress(import.meta.env?.VITE_MAIL_FROM);
}

export function accountEmail(account) {
  return normalizeEmail(
    account?.idTokenClaims?.preferred_username ||
      account?.idTokenClaims?.email ||
      account?.username ||
      account?.email
  );
}

/** True only when the interactive sign-in is the business mailbox. */
export function interpretMailLogin(account, mailFrom = DEFAULT_MAIL_FROM) {
  const expected = normalizeEmail(mailFrom);
  const email = accountEmail(account);
  if (!email) {
    return {
      ok: false,
      reason: "auth-failed",
      senderAddress: expected,
      details: "Microsoft did not return an email address. The email was not sent.",
    };
  }
  if (email !== expected) {
    return {
      ok: false,
      reason: "wrong-mailbox",
      senderAddress: expected,
      signedInAs: email,
      details: `Microsoft signed in ${email}.`,
    };
  }
  return { ok: true, email };
}

export function classifyMailAuthError(err) {
  const code = String(err?.errorCode || err?.code || "").toLowerCase();
  const msg = String(err?.message || err || "").toLowerCase();
  if (code.includes("user_cancel") || msg.includes("user_cancel") || msg.includes("user closed")) return "cancel";
  if (
    code.includes("popup_window_error") ||
    code.includes("empty_window_error") ||
    msg.includes("popup blocker") ||
    msg.includes("popup_window")
  ) {
    return "popup-blocked";
  }
  return "error";
}

/**
 * OneDrive stays on the allowlisted account. Mail is a second Microsoft
 * account, matched only by the sending address. A personal Outlook mailbox
 * cannot send as a different address.
 */
export function pickAccounts(accounts, { allow = [], mailFrom = DEFAULT_MAIL_FROM } = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const mail = normalizeEmail(mailFrom);
  const allowed = new Set(allow.map(normalizeEmail).filter(Boolean));
  const emailOf = (account) => accountEmail(account);

  const drive =
    list.find((account) => allowed.has(emailOf(account)) && emailOf(account) !== mail) ||
    list.find((account) => emailOf(account) && emailOf(account) !== mail) ||
    null;
  const mailAccount = mail ? list.find((account) => emailOf(account) === mail) || null : null;
  return { drive, mailAccount, mailFrom: mail };
}
