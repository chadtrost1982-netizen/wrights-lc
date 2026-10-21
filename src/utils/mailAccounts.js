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

/**
 * OneDrive stays on the allowlisted account. Mail is a second Microsoft
 * account, matched only by the sending address. A personal Outlook mailbox
 * cannot send as a different address.
 */
export function pickAccounts(accounts, { allow = [], mailFrom = DEFAULT_MAIL_FROM } = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const mail = normalizeEmail(mailFrom);
  const allowed = new Set(allow.map(normalizeEmail).filter(Boolean));
  const emailOf = (account) => normalizeEmail(account?.username || account?.email);

  const drive =
    list.find((account) => allowed.has(emailOf(account)) && emailOf(account) !== mail) ||
    list.find((account) => emailOf(account) && emailOf(account) !== mail) ||
    null;
  const mailAccount = mail ? list.find((account) => emailOf(account) === mail) || null : null;
  return { drive, mailAccount, mailFrom: mail };
}
