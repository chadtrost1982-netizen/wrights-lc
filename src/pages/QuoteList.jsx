import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadEstimateDirectoryHandle, saveEstimateDirectoryHandle } from "../utils/autoSaveFolder";
import {
  deleteOneDriveFile,
  deleteOneDriveFileById,
  downloadOneDriveFile,
  downloadOneDriveFileById,
  isOneDriveGraphConfigured,
  listOneDriveFiles,
  ensureBusinessMailbox,
  sendGraphEmailWithAttachment,
} from "../utils/oneDriveGraph";
import { activeOneDriveFolder } from "../utils/oneDrivePaths";
import { invoiceFolderView } from "../utils/driveStatus";
import { activeMailFrom } from "../utils/mailAccounts";
import { buildEstimatePdfFromExcelFile } from "../utils/estimatePdf";
import { defaultMailBody, mailAttachmentName, mailSubject } from "../utils/mailMessage";
import { finishMailAttempt, MAIL_NOTICE_EVENT, plainMailError } from "../utils/mailNotice";
import * as XLSX from "xlsx";

const CUSTOMER_CONTACTS_KEY = "wrights_customer_contacts";
const FILE_SENT_LOG_KEY = "wrights_file_sent_log";
const INVOICE_DRAFT_FROM_ESTIMATE_KEY = "wrights_invoice_draft_from_estimate";
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function guessCustomerFromFileName(fileName) {
  const base = String(fileName || "").replace(/\.[^.]+$/, "");
  const refCut = base.replace(/\s+-\s+Ref\s+\d+$/i, "");
  const invMatch = refCut.match(/^Inv\s+\d+\s+-\s+(.+)$/i);
  if (invMatch?.[1]) return invMatch[1].trim();
  const estMatch = refCut.match(/^Est\s+\d+\s+-\s+(.+)$/i);
  if (estMatch?.[1]) return estMatch[1].trim();
  return "";
}

function extractEstimateNumber(fileName) {
  const match = String(fileName || "").match(/Est\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

function getMaxEstimateNumberFromFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return 0;
  return files.reduce((max, file) => {
    const num = extractEstimateNumber(file.name);
    return Math.max(max, num);
  }, 0);
}

function sentBadgeLabel(stamp) {
  if (!stamp) return "";
  const sent = new Date(stamp);
  const now = new Date();
  const isToday =
    sent.getFullYear() === now.getFullYear() &&
    sent.getMonth() === now.getMonth() &&
    sent.getDate() === now.getDate();
  return isToday ? "Sent Today" : "Sent Earlier";
}

function emailErrorMessage(result) {
  return plainMailError(result);
}

async function extractCustomerEmailFromEstimateFile(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const infoSheetName = workbook.SheetNames.includes("Info")
      ? "Info"
      : workbook.SheetNames[0];
    const infoSheet = workbook.Sheets[infoSheetName];
    const infoRows = XLSX.utils.sheet_to_json(infoSheet, { header: 1, defval: "" });
    const match = (Array.isArray(infoRows) ? infoRows : []).find((row) =>
      /email/i.test(String((row && row[0]) || ""))
    );
    const value = String((match && match[1]) || "").trim();
    if (!value || !value.includes("@")) return "";
    return value;
  } catch {
    return "";
  }
}

function estimateAttachmentName(fileName) {
  return mailAttachmentName({ kind: "estimate", fileName });
}

export default function QuoteList() {
  const navigate = useNavigate();
  const estimatesPath = activeOneDriveFolder("estimate");
  const estimatesGraph = isOneDriveGraphConfigured("estimate");
  const [estimateFiles, setEstimateFiles] = useState([]);
  const [folderName, setFolderName] = useState(estimatesGraph ? `OneDrive: ${estimatesPath}` : "");
  const [folderDetail, setFolderDetail] = useState(estimatesGraph ? "Checking OneDrive…" : "");
  const [emailFile, setEmailFile] = useState(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerContacts, setCustomerContacts] = useState([]);
  const [fileSentLog, setFileSentLog] = useState({});
  const [estimateSource, setEstimateSource] = useState("none");

  const loadEstimateFiles = async () => {
    if (estimatesGraph) {
      setFolderName(`OneDrive: ${estimatesPath}`);
      setFolderDetail("Checking OneDrive…");
      let graphList;
      try {
        graphList = await listOneDriveFiles("estimate", "Est");
      } catch (err) {
        graphList = { ok: false, reason: err?.code || "list-failed" };
      }
      const view = invoiceFolderView({
        graphMode: true,
        configuredPath: estimatesPath,
        listed: graphList,
      });
      setEstimateFiles(view.files || []);
      setFolderName(view.folderLabel);
      setFolderDetail(view.detail);
      setEstimateSource(graphList.ok ? "onedrive" : "none");
      return;
    }

    const handle = await loadEstimateDirectoryHandle();
    if (!handle) {
      setEstimateFiles([]);
      setFolderName("");
      setFolderDetail("Auto-save folder not configured.");
      setEstimateSource("none");
      return;
    }
    setFolderDetail("");

    setFolderName(handle.name || "");
    const entries = [];
    for await (const [name, entryHandle] of handle.entries()) {
      if (entryHandle.kind !== "file") continue;
      if (!name.startsWith("Est")) continue;
      const file = await entryHandle.getFile();
      entries.push({
        name,
        size: file.size,
        updatedAt: file.lastModified,
      });
    }
    entries.sort((a, b) => extractEstimateNumber(b.name) - extractEstimateNumber(a.name));
    setEstimateFiles(entries);
    setEstimateSource("local");
  };


  useEffect(() => {
    const init = async () => {
      const existing = estimatesGraph ? null : await loadEstimateDirectoryHandle();
      if (!estimatesGraph && !existing && window.showDirectoryPicker) {
        const shouldPick = confirm(
          "Select your Estimates folder now (recommended: C:\\Users\\chadt\\OneDrive\\Desktop\\Business\\Disposal Solutions\\Estimates)?"
        );
        if (shouldPick) {
          try {
            const picked = await window.showDirectoryPicker();
            await saveEstimateDirectoryHandle(picked);
          } catch {
            // user canceled picker
          }
        }
      }
      await loadEstimateFiles();
    };
    init();
    setCustomerContacts(loadJson(CUSTOMER_CONTACTS_KEY, []));
    setFileSentLog(loadJson(FILE_SENT_LOG_KEY, {}));
    const refreshSent = () => setFileSentLog(loadJson(FILE_SENT_LOG_KEY, {}));
    window.addEventListener(MAIL_NOTICE_EVENT, refreshSent);
    return () => window.removeEventListener(MAIL_NOTICE_EVENT, refreshSent);
  }, []);

  const deleteEstimateFile = async (name) => {
    if (estimateSource === "onedrive") {
      if (!confirm(`Delete ${name}?`)) return;
      const entry = estimateFiles.find((item) => item.name === name) || null;
      const result = entry?.id
        ? await deleteOneDriveFileById("estimate", entry.id)
        : await deleteOneDriveFile("estimate", name);
      if (!result.ok) {
        alert("Could not delete file from OneDrive.");
        return;
      }
      await loadEstimateFiles();
      return;
    }

    const handle = await loadEstimateDirectoryHandle();
    if (!handle) return;
    if (!confirm(`Delete ${name}?`)) return;
    await handle.removeEntry(name);
    await loadEstimateFiles();
  };

  const openEmailModal = async (fileName) => {
    setEmailFile(fileName);
    setSendSuccess(false);
    const guessedCustomer = guessCustomerFromFileName(fileName);
    setCustomerName(guessedCustomer);
    setEmailSubject(mailSubject({ kind: "estimate", fileName }));
    setEmailBody(defaultMailBody({ kind: "estimate", fileName, customerName: guessedCustomer }));
    const existing = customerContacts.find((c) => c.name.toLowerCase() === guessedCustomer.toLowerCase());
    let inferredEmail = existing?.email || "";
    try {
      if (estimateSource === "onedrive") {
        const entry = estimateFiles.find((item) => item.name === fileName) || null;
        const dl = entry?.id
          ? await downloadOneDriveFileById("estimate", entry.id)
          : await downloadOneDriveFile("estimate", fileName);
        if (dl.ok) {
          const file = new File([dl.blob], fileName, { type: dl.blob.type || "application/octet-stream" });
          const fileEmail = await extractCustomerEmailFromEstimateFile(file);
          if (fileEmail) inferredEmail = fileEmail;
        }
      } else {
        const handle = await loadEstimateDirectoryHandle();
        if (handle) {
          const fh = await handle.getFileHandle(fileName);
          const f = await fh.getFile();
          const fileEmail = await extractCustomerEmailFromEstimateFile(f);
          if (fileEmail) inferredEmail = fileEmail;
        }
      }
    } catch {
      // ignore parse/read issues and keep fallback
    }
    setEmailTo(inferredEmail);
    setEmailCc("");
  };

  const onCustomerNameChange = (name) => {
    setEmailBody((current) => {
      const previous = defaultMailBody({ kind: "estimate", fileName: emailFile, customerName });
      if (current !== previous) return current;
      return defaultMailBody({ kind: "estimate", fileName: emailFile, customerName: name });
    });
    setCustomerName(name);
    const existing = customerContacts.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (existing?.email) setEmailTo(existing.email);
  };

  const sendEstimateEmail = async () => {
    if (!emailFile) return;
    if (!emailTo.trim()) {
      alert("Please enter at least one recipient email.");
      return;
    }

    setSending(true);
    try {
      const gate = await ensureBusinessMailbox({
        kind: "estimate",
        listFileName: emailFile,
        attachmentName: estimateAttachmentName(emailFile),
        itemId: estimateFiles.find((item) => item.name === emailFile)?.id || "",
        to: emailTo,
        cc: emailCc,
        subject: emailSubject || mailSubject({ kind: "estimate", fileName: emailFile }),
        body: emailBody,
        customerName,
        regenerate: estimateSource === "onedrive",
      });
      if (gate?.reason === "mail-redirecting") {
        finishMailAttempt(emailFile, gate);
        return;
      }
      if (gate && gate.ok === false) {
        alert(finishMailAttempt(emailFile, gate).message);
        return;
      }
      let file = null;
      if (estimateSource === "onedrive") {
        const entry = estimateFiles.find((item) => item.name === emailFile) || null;
        const dl = entry?.id
          ? await downloadOneDriveFileById("estimate", entry.id)
          : await downloadOneDriveFile("estimate", emailFile);
        if (!dl.ok) {
          alert("Could not load estimate from OneDrive.");
          setSending(false);
          return;
        }
        file = new File([dl.blob], emailFile, { type: dl.blob.type || "application/octet-stream" });
      } else {
        const handle = await loadEstimateDirectoryHandle();
        if (!handle) {
          alert("Estimates folder is not configured.");
          setSending(false);
          return;
        }
        const fileHandle = await handle.getFileHandle(emailFile);
        file = await fileHandle.getFile();
      }
      const lowerName = String(emailFile || "").toLowerCase();
      const looksLikeExcelName = /\.(xlsx|xlsm|xls)$/i.test(lowerName);
      const looksLikeExcelMime =
        String(file.type || "").includes("spreadsheet") ||
        String(file.type || "").includes("excel");

      let blobToSend = file;
      const nameToSend = estimateAttachmentName(emailFile);
      if (looksLikeExcelName || looksLikeExcelMime) {
        const rawPdfBlob = await buildEstimatePdfFromExcelFile(file);
        if (!rawPdfBlob) {
          alert("Could not convert estimate to PDF. Email was not sent.");
          setSending(false);
          return;
        }
        const pdfBytes = await rawPdfBlob.arrayBuffer();
        blobToSend = new Blob([pdfBytes], { type: "application/pdf" });
      }
      const result = await sendGraphEmailWithAttachment({
        to: emailTo,
        cc: emailCc,
        subject: emailSubject || mailSubject({ kind: "estimate", fileName: emailFile }),
        body: emailBody,
        fileName: nameToSend,
        blob: blobToSend,
        listFileName: emailFile,
        kind: "estimate",
        itemId: estimateFiles.find((item) => item.name === emailFile)?.id || "",
        customerName,
        regenerate: estimateSource === "onedrive",
      });
      const outcome = finishMailAttempt(emailFile, result);
      if (outcome.redirecting) return;

      if (result.ok) {
        const normalizedName = customerName.trim();
        if (normalizedName && emailTo.trim()) {
          const nextContacts = [...customerContacts];
          const idx = nextContacts.findIndex((c) => c.name.toLowerCase() === normalizedName.toLowerCase());
          if (idx >= 0) nextContacts[idx] = { ...nextContacts[idx], email: emailTo.trim() };
          else nextContacts.push({ name: normalizedName, email: emailTo.trim() });
          nextContacts.sort((a, b) => a.name.localeCompare(b.name));
          setCustomerContacts(nextContacts);
          saveJson(CUSTOMER_CONTACTS_KEY, nextContacts);
        }

        setFileSentLog(loadJson(FILE_SENT_LOG_KEY, {}));
        alert(`Sent from ${result.senderAddress || activeMailFrom()}.`);
        setSendSuccess(true);
        setTimeout(() => {
          setSendSuccess(false);
          setEmailFile(null);
        }, 1200);
      } else {
        alert(outcome.message || emailErrorMessage(result));
      }
    } catch (err) {
      alert(`Could not send email. ${err?.message || "Please check Azure sign-in and Mail.Send consent."}`);
    } finally {
      setSending(false);
    }
  };

  const createInvoiceFromEstimate = async (fileName) => {
    try {
      let file = null;
      if (estimateSource === "onedrive") {
        const entry = estimateFiles.find((item) => item.name === fileName) || null;
        const dl = entry?.id
          ? await downloadOneDriveFileById("estimate", entry.id)
          : await downloadOneDriveFile("estimate", fileName);
        if (!dl.ok) {
          alert("Could not load estimate from OneDrive.");
          return;
        }
        file = new File([dl.blob], fileName, { type: dl.blob.type || "application/octet-stream" });
      } else {
        const handle = await loadEstimateDirectoryHandle();
        if (!handle) {
          alert("Estimates folder is not configured.");
          return;
        }
        const fileHandle = await handle.getFileHandle(fileName);
        file = await fileHandle.getFile();
      }
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const infoSheetName = workbook.SheetNames.includes("Info")
        ? "Info"
        : workbook.SheetNames[0];
      const dataSheetName = workbook.SheetNames.includes("Data")
        ? "Data"
        : workbook.SheetNames[0];
      const infoSheet = workbook.Sheets[infoSheetName];
      const sheet = workbook.Sheets[dataSheetName];
      const infoRows = XLSX.utils.sheet_to_json(infoSheet, { header: 1, defval: "" });
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const rows = Array.isArray(json) ? json : [];
      const findInfo = (label) => {
        const row = (Array.isArray(infoRows) ? infoRows : []).find(
          (r) => String((r && r[0]) || "").trim().toLowerCase() === String(label).trim().toLowerCase()
        );
        return String((row && row[1]) || "").trim();
      };
      const customer = findInfo("Customer") || guessCustomerFromFileName(fileName) || "Customer";
      const customerEmail = findInfo("Email");
      const customerAddress = findInfo("Customer Address") || findInfo("Address");
      const estimateNotes = findInfo("Notes");
      const estimateType = findInfo("Estimate Type").toLowerCase();
      const draftForLabel = estimateType.includes("disposal")
        ? "Disposal Bin Services"
        : estimateType.includes("service")
          ? "Services Rendered"
          : "Container Services";

      const lines = rows
        .map((r) => ({
          customer,
          work: String(r.DESCRIPTION || r["WORK PERFORMED"] || r.Item || "").trim(),
          qty: String(r.QTY ?? r["HR/QTY"] ?? ""),
          rate: String(r.RATE ?? ""),
          amount: String(r.AMOUNT ?? ""),
        }))
        .filter((r) => r.work || r.qty || r.rate || r.amount)
        .filter((r) => !/subtotal|hst|total/i.test(String(r.work || "")));

      if (!lines.length) {
        alert("No line items found in this estimate.");
        return;
      }

      localStorage.setItem(
        INVOICE_DRAFT_FROM_ESTIMATE_KEY,
        JSON.stringify({
          sourceFile: fileName,
          refEstNumber: (String(fileName).match(/Est\s+(\d+)/i) || [])[1] || "",
          invoiceType: "services",
          customer,
          customerEmail,
          customerAddress,
          notes: estimateNotes,
          draftForLabel,
          lines: lines.slice(0, 50),
        })
      );
      navigate("/create-invoice");
    } catch {
      alert("Could not build invoice draft from that estimate.");
    }
  };

  return (
    <div className="page invoice-tools-page">
      <h2 className="page-title">Estimates</h2>

      <div className="settings-card win-panel">
        <h3>Existing Folder Contents</h3>
        <p>{folderName ? `Folder: ${folderName}` : (folderDetail || "Auto-save folder not configured.")}</p>
        {folderName && folderDetail ? <p>{folderDetail}</p> : null}
        <button className="btn-secondary win-btn-secondary" onClick={loadEstimateFiles}>
          Refresh Folder List
        </button>
        <p style={{ marginTop: "10px" }}>Estimate files beginning with "Est" are shown below.</p>

        <div style={{ marginTop: "10px", maxHeight: "320px", overflowY: "auto" }}>
          {estimateFiles.length === 0 ? (
            <p>No estimate files found.</p>
          ) : (
            estimateFiles.map((f) => (
              <div
                className="file-list-row quote-file-row"
                key={`${f.name}-${f.updatedAt}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto",
                  gap: "10px",
                  padding: "8px 0",
                  borderBottom: "1px solid #d4d4d4",
                  fontSize: "13px",
                  alignItems: "center",
                }}
              >
                <span className="file-list-name quote-file-name" style={{ wordBreak: "break-word" }}>{f.name}</span>
                <span className="file-list-meta quote-file-size">{((f.size || 0) / 1024).toFixed(1)} KB</span>
                <span className="file-list-meta quote-file-date">{new Date(f.updatedAt).toLocaleString()}</span>
                <span className="file-list-actions quote-file-actions" style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: "12px", color: "#4a4a4a" }}>
                    Last sent: {fileSentLog[f.name] ? new Date(fileSentLog[f.name]).toLocaleString() : "Never"}
                  </span>
                  {fileSentLog[f.name] && <span className="file-sent-badge">{sentBadgeLabel(fileSentLog[f.name])}</span>}
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ width: "auto", marginTop: 0, padding: "6px 10px" }}
                    onClick={() => createInvoiceFromEstimate(f.name)}
                  >
                    Create Invoice
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ width: "auto", marginTop: 0, padding: "6px 10px" }}
                    onClick={() => openEmailModal(f.name)}
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    className="danger"
                    style={{ width: "auto", marginTop: 0, padding: "6px 10px" }}
                    onClick={() => deleteEstimateFile(f.name)}
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {emailFile && (
        <div className="modal">
          <div className="modal-content">
            <h3>Email Estimate</h3>
            <p><strong>From:</strong> {activeMailFrom()}</p>
            <p><strong>Attachment:</strong> {estimateAttachmentName(emailFile)}</p>
            <label>Customer</label>
            <input
              value={customerName}
              onChange={(e) => onCustomerNameChange(e.target.value)}
              placeholder="Customer name"
              list="customer-contact-options"
            />
            <datalist id="customer-contact-options">
              {customerContacts.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
            <label>To</label>
            <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="customer@email.com" />
            <label>CC (optional)</label>
            <input value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="cc@email.com" />
            <label>Subject</label>
            <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            <label>Message</label>
            <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
            {sending && (
              <div className="email-status sending">
                <span className="mail-fly" aria-hidden="true">✉</span>
                <span>Sending from {activeMailFrom()}...</span>
              </div>
            )}
            {sendSuccess && (
              <div className="email-status sent">
                <span className="check-pop" aria-hidden="true">✓</span>
                <span>Sent</span>
              </div>
            )}
            <div className="actions" style={{ marginTop: "14px" }}>
              <button className="btn-secondary" onClick={() => setEmailFile(null)} disabled={sending}>
                Cancel
              </button>
              <button className="btn-primary" onClick={sendEstimateEmail} disabled={sending}>
                {sending ? "Sending..." : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
