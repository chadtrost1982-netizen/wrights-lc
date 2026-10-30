export const MSAL_INTERACTION_KEY = "msal.interaction.status";

export function withTimeout(promise, ms, message = "The request timed out.") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.name = "DriveTimeout";
      err.code = "timeout";
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/**
 * MSAL stores an unfinished redirect as JSON: {"clientId","type"}.
 * A record left behind after the Microsoft page never returned blocks the next sign-in.
 * An empty value, or a page that is itself the Microsoft reply, must be left alone.
 */
export function isStaleInteractionRecord(raw) {
  if (raw == null || String(raw).trim() === "") return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed && typeof parsed === "object" && parsed.clientId);
  } catch {
    return true;
  }
}

export function driveFailureMessage(reason, status) {
  const code = String(reason || "");
  const http = Number(status) || 0;
  if (code === "timeout") {
    return "Microsoft did not answer in time. Check your connection, then try again. If it keeps happening, click Sign in again at the top of the page.";
  }
  if (code === "auth-failed" || code === "auth-required") {
    return "Microsoft sign-in expired or is missing. Click Sign in again at the top of the page, then try once more.";
  }
  if (code === "not-configured") {
    return "Microsoft sign-in is not set up in this copy of the app.";
  }
  if (code === "invalid-path") {
    return "The OneDrive folder path is empty.";
  }
  if (http === 401 || http === 403) {
    return "Microsoft refused this OneDrive request. Click Sign in again at the top of the page, then try once more.";
  }
  if (http === 404) {
    return "That OneDrive folder was not found yet. Exporting a file creates it after you are signed in. Nothing already saved was moved.";
  }
  if (code === "upload-failed" || code === "list-failed" || code === "download-failed" || code === "delete-failed") {
    return `OneDrive refused the request${http ? ` (${http})` : ""}. Click Sign in again if this keeps happening.`;
  }
  if (code === "folder-create-failed" || code === "folder-check-failed" || code === "path-not-folder") {
    return "Could not open the Disposal Solutions folder on OneDrive. Nothing was moved. Click Sign in again and retry.";
  }
  return `Could not use OneDrive${code ? ` (${code})` : ""}.`;
}

/**
 * The invoices page used to say the path was not configured whenever the file
 * list had not loaded. The path can be set while the list fails because
 * Microsoft sign-in did not finish.
 */
export function invoiceFolderView({ graphMode, configuredPath, listed }) {
  if (!graphMode) {
    return {
      folderLabel: "",
      detail: "Auto-save folder not configured.",
      files: [],
    };
  }
  const folderLabel = `OneDrive: ${configuredPath}`;
  if (!listed) {
    return { folderLabel, detail: "Checking OneDrive…", files: [] };
  }
  if (listed.ok) {
    return { folderLabel, detail: "", files: listed.files || [] };
  }
  return {
    folderLabel,
    detail: driveFailureMessage(listed.reason, listed.status),
    files: [],
  };
}

export function exportResultMessage({ pdfResult, excelResult, pdfName, excelName }) {
  if (!pdfResult?.ok && !excelResult?.ok) {
    return [
      driveFailureMessage(pdfResult?.reason || excelResult?.reason, pdfResult?.status || excelResult?.status),
      `Copies were downloaded in this browser as ${pdfName} and ${excelName}. Those files already have their invoice number.`,
    ].join("\n");
  }
  const line = (result, name, label) => {
    if (result?.ok) {
      const place = result.parentPath
        ? `${String(result.parentPath).replace("/drive/root:", "")}/${result.name || name}`
        : name;
      return `${label} saved to OneDrive: ${place}`;
    }
    return `${label} was not saved to OneDrive. ${driveFailureMessage(result?.reason, result?.status)} A copy was downloaded in this browser as ${name}.`;
  };
  return [line(pdfResult, pdfName, "PDF"), line(excelResult, excelName, "Excel")].join("\n");
}
