import { activeMailFrom } from "./mailAccounts.js";

export const MAIL_DISPLAY_NAME = "Disposal Solutions";
export const MAIL_PHONE = "416-889-5284";

export function documentNumber(fileName, kind = "estimate") {
  const text = String(fileName || "");
  const pattern = kind === "invoice"
    ? /Inv(?:oice)?\s*#?\s*(\d+)/i
    : /Est(?:imate)?\s*#?\s*(\d+)/i;
  const match = text.match(pattern);
  return match ? String(Number.parseInt(match[1], 10)) : "";
}

/** JOHN SMITH -> John Smith. Apostrophes and hyphens keep their own capitals. */
export function titleCaseName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/(^|[^a-z0-9])([a-z])/g, (_, sep, letter) => sep + letter.toUpperCase());
}

/** First name when we have one, otherwise the title-cased name. */
export function greetingName(customerName, firstName = "") {
  const preferred = titleCaseName(firstName);
  if (preferred) return preferred.split(/\s+/)[0];
  const full = titleCaseName(customerName);
  if (!full) return "";
  return full.split(/\s+/)[0];
}

export function mailSubject({ kind = "estimate", fileName = "" } = {}) {
  const label = kind === "invoice" ? "Invoice" : "Estimate";
  const number = documentNumber(fileName, kind);
  return number
    ? `${label} #${number} from ${MAIL_DISPLAY_NAME}`
    : `${label} from ${MAIL_DISPLAY_NAME}`;
}

function fileExtension(fileName) {
  const match = String(fileName || "").match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

/**
 * The name the customer sees on the attachment.
 * The OneDrive file keeps its own name.
 */
export function mailAttachmentName({ kind = "estimate", fileName = "" } = {}) {
  const label = kind === "invoice" ? "Invoice" : "Estimate";
  const number = documentNumber(fileName, kind);
  const sourceExt = fileExtension(fileName);
  const excel = sourceExt === "xlsx" || sourceExt === "xlsm" || sourceExt === "xls";
  const ext = kind === "estimate" && (excel || !sourceExt) ? "pdf" : (sourceExt || "pdf");
  const num = number ? ` ${number}` : "";
  return `${label}${num} - ${MAIL_DISPLAY_NAME}.${ext}`;
}

export function defaultMailBody({ kind = "estimate", fileName = "", customerName = "", firstName = "" } = {}) {
  const who = greetingName(customerName, firstName);
  const hello = who ? `Hi ${who},` : "Hi,";
  const number = documentNumber(fileName, kind);
  const ref = number ? ` #${number}` : "";
  const signOff = `Thanks,\nChad\n${MAIL_DISPLAY_NAME}\n${MAIL_PHONE}\n${activeMailFrom()}`;
  if (kind === "invoice") {
    return `${hello}\n\nThanks for your business. Your invoice${ref} is attached. Please use it for payment, and let me know if you have any questions.\n\n${signOff}`;
  }
  return `${hello}\n\nThanks for reaching out. Your estimate${ref} is attached. Let me know if you have any questions or would like to go ahead.\n\n${signOff}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The message box stays plain text. The sent email is simple HTML of that text. */
export function mailBodyHtml(text) {
  const blocks = escapeHtml(text).split(/\n{2,}/).map((block) => (
    `<p style="margin:0 0 14px;font-family:Calibri,Arial,sans-serif;font-size:15px;line-height:1.4;color:#222222;">${block.replace(/\n/g, "<br>")}</p>`
  ));
  return `<!DOCTYPE html><html><body style="margin:0;padding:16px;">${blocks.join("")}</body></html>`;
}

export function attachmentContentType(fileName, blobType = "") {
  const ext = fileExtension(fileName);
  if (ext === "pdf") return "application/pdf";
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "xls") return "application/vnd.ms-excel";
  const given = String(blobType || "").trim();
  if (given && given !== "application/octet-stream") return given;
  return "application/octet-stream";
}

function addressList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

export function buildOutgoingMessage({
  fromAddress,
  subject,
  body,
  to,
  cc = "",
  fileName,
  contentType = "",
  contentBytes = "",
} = {}) {
  const address = String(fromAddress || activeMailFrom()).trim();
  return {
    subject: String(subject || ""),
    body: {
      contentType: "HTML",
      content: mailBodyHtml(body),
    },
    from: {
      emailAddress: {
        name: MAIL_DISPLAY_NAME,
        address,
      },
    },
    replyTo: [
      {
        emailAddress: {
          name: MAIL_DISPLAY_NAME,
          address,
        },
      },
    ],
    toRecipients: addressList(to),
    ccRecipients: addressList(cc),
    attachments: [
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: fileName,
        contentType: attachmentContentType(fileName, contentType),
        contentBytes,
      },
    ],
  };
}
