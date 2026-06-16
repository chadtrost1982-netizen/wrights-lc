import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadEstimateDirectoryHandle, saveEstimateDirectoryHandle } from "../utils/autoSaveFolder";
import {
  deleteOneDriveFile,
  downloadOneDriveFile,
  isOneDriveGraphConfigured,
  listOneDriveFiles,
  sendGraphEmailWithAttachment,
} from "../utils/oneDriveGraph";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";

const CUSTOMER_CONTACTS_KEY = "wrights_customer_contacts";
const FILE_SENT_LOG_KEY = "wrights_file_sent_log";
const INVOICE_DRAFT_FROM_ESTIMATE_KEY = "wrights_invoice_draft_from_estimate";
let cachedLogoDataUrl = null;

function toBase64FromBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function getLogoDataUrl() {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  const res = await fetch("/disposal-logo.png");
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const b64 = toBase64FromBytes(new Uint8Array(buf));
  cachedLogoDataUrl = `data:image/png;base64,${b64}`;
  return cachedLogoDataUrl;
}

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
  if (!result) return "Could not send email.";
  if (result.reason === "not-configured") return "Email is not configured. Check Azure app settings.";
  if (result.reason === "auth-failed") {
    const extra = result.details ? ` ${result.details}` : "";
    return `Sign-in/consent failed.${extra}`;
  }
  if (result.reason === "invalid-input") return "Missing email send fields.";
  if (result.reason === "send-failed") {
    const extra = result.details ? ` ${result.details}` : "";
    return `Graph send failed (${result.status || "unknown"}).${extra} Ensure Mail.Send is granted.`;
  }
  return `Could not send email. ${result.reason || ""}`.trim();
}

async function buildEstimatePdfFromExcelFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const infoSheetName = workbook.SheetNames.includes("Info")
    ? "Info"
    : workbook.SheetNames[0];
  const dataSheetName = workbook.SheetNames.includes("Data")
    ? "Data"
    : workbook.SheetNames[0];
  const infoSheet = workbook.Sheets[infoSheetName];
  const dataSheet = workbook.Sheets[dataSheetName];
  const infoRows = XLSX.utils.sheet_to_json(infoSheet, { header: 1, defval: "" });
  const dataRows = XLSX.utils.sheet_to_json(dataSheet, { defval: "" });

  const findInfo = (label) => {
    const row = (Array.isArray(infoRows) ? infoRows : []).find(
      (r) => String((r && r[0]) || "").trim().toLowerCase() === String(label).trim().toLowerCase()
    );
    return String((row && row[1]) || "").trim();
  };

  const estimateNumber = findInfo("Estimate #");
  const estimateDate = findInfo("Date");
  const customerName = findInfo("Customer");
  const customerAddress = findInfo("Customer Address");
  const estimateType = findInfo("Estimate Type");
  const notes = findInfo("Notes");

  const detailLines = (Array.isArray(dataRows) ? dataRows : [])
    .filter((r) => {
      const d = String(r.DESCRIPTION || r["WORK PERFORMED"] || "").trim();
      const type = String(r.TYPE || "").trim();
      return (d || type) && !/subtotal|hst|total/i.test(d);
    })
    .map((r) => ({
      description: String(r.DESCRIPTION || r["WORK PERFORMED"] || "").trim(),
      qty: Number(r.QTY ?? r["HR/QTY"] ?? 0) || 0,
      rate: Number(String(r.RATE ?? "0").replace(/[$,\s]/g, "")) || 0,
      amount: Number(String(r.AMOUNT ?? "0").replace(/[$,\s]/g, "")) || 0,
    }));

  const subtotal = detailLines.reduce((s, l) => s + l.amount, 0);
  const hst = Math.round(subtotal * 0.13 * 100) / 100;
  const total = subtotal + hst;
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const left = 70;
  const right = 540;
  let y = 72;

  try {
    const logoDataUrl = await getLogoDataUrl();
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", left, y - 20, 120, 40);
    }
  } catch {
    // Keep PDF export working even if logo fails to load.
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(58, 74, 94);
  doc.text("ESTIMATE", right - 10, y, { align: "right" });

  y += 40;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("DISPOSAL SOLUTIONS", left, y);
  doc.text("o/a Wrights L.C.", left, y + 14);
  doc.text("4805 8th Line", left, y + 28);
  doc.text("Beeton, ON, L0G 1A0", left, y + 42);
  doc.text("Phone 416 889 5284 / 705 707 6064", left, y + 56);
  doc.text("www.DisposalSolutions.ca", left, y + 70);

  let metaY = 126;
  doc.setFontSize(10);
  const numLabel = "Estimate #: ";
  const numValue = estimateNumber || "";
  const numWidth = doc.getTextWidth(numValue);
  doc.setFont("helvetica", "normal");
  doc.text(numValue, right - 10, metaY, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(numLabel, right - 10 - numWidth, metaY, { align: "right" });
  metaY += 16;
  const dateLabel = "Date: ";
  const dateValue = estimateDate || "";
  const dateWidth = doc.getTextWidth(dateValue);
  doc.setFont("helvetica", "normal");
  doc.text(dateValue, right - 10, metaY, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(dateLabel, right - 10 - dateWidth, metaY, { align: "right" });

  y += 98;
  doc.setFont("helvetica", "bold");
  doc.text("To:", left, y);
  doc.text("For:", left + 230, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.text(customerName || "Customer", left, y);
  doc.setFont("helvetica", "normal");
  doc.text(estimateType || "Services", left + 230, y);
  y += 14;
  const addrLines = doc.splitTextToSize(customerAddress || "", 210);
  doc.text(addrLines.length ? addrLines : [""], left, y);
  doc.text("Estimate", left + 230, y);
  if (addrLines.length > 1) y += (addrLines.length - 1) * 12;
  y += 26;

  const tableLeft = left;
  const tableRight = right;
  const rowHeight = 18;
  const qtyX = tableLeft + 330;
  const rateX = tableLeft + 390;
  const amountX = tableLeft + 450;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("DESCRIPTION", tableLeft, y);
  doc.text("HR/QTY", qtyX, y);
  doc.text("RATE", rateX, y);
  doc.text("AMOUNT", amountX, y);
  y += 10;
  doc.setLineWidth(0.5);
  doc.line(tableLeft, y, tableRight, y);
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  detailLines.forEach((line) => {
    if (y > 680) {
      doc.addPage();
      y = 72;
    }
    const wrapped = doc.splitTextToSize(String(line.description || ""), 315);
    const lines = wrapped.length ? wrapped : [""];
    doc.text(lines, tableLeft, y);
    doc.text(String(line.qty || ""), qtyX + 28, y, { align: "right" });
    doc.text(money(line.rate), rateX + 45, y, { align: "right" });
    doc.text(money(line.amount), amountX + 55, y, { align: "right" });
    y += Math.max(rowHeight, lines.length * 12);
  });

  y += 16;
  doc.line(amountX - 18, y - 12, amountX + 62, y - 12);
  doc.setFont("helvetica", "normal");
  doc.text("SUB TOTAL", amountX - 52, y, { align: "right" });
  doc.text(money(subtotal), amountX + 55, y, { align: "right" });
  y += 16;
  doc.text("HST", amountX - 52, y, { align: "right" });
  doc.text(money(hst), amountX + 55, y, { align: "right" });
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL", amountX - 52, y, { align: "right" });
  doc.text(money(total), amountX + 55, y, { align: "right" });

  y += 24;
  if (notes) {
    doc.setFont("helvetica", "bold");
    doc.text("Notes:", left, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    const noteLines = doc.splitTextToSize(notes, 420);
    noteLines.slice(0, 18).forEach((line) => {
      doc.text(line, left, y);
      y += 12;
    });
  }

  y += 14;
  doc.setFont("helvetica", "bold");
  doc.text("Thank you for your business!", left + 135, y);
  y += 16;
  doc.text("HST: 811718162", left + 170, y);

  return doc.output("blob");
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

function displayEmailAttachmentName(fileName) {
  const name = String(fileName || "");
  if (/\.(xlsx|xlsm|xls)$/i.test(name)) return name.replace(/\.(xlsx|xlsm|xls)$/i, ".pdf");
  return name;
}

export default function QuoteList() {
  const navigate = useNavigate();
  const [estimateFiles, setEstimateFiles] = useState([]);
  const [folderName, setFolderName] = useState("");
  const [emailFile, setEmailFile] = useState(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("Please find your estimate attached.");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerContacts, setCustomerContacts] = useState([]);
  const [fileSentLog, setFileSentLog] = useState({});
  const [estimateSource, setEstimateSource] = useState("none");

  const loadEstimateFiles = async () => {
    if (isOneDriveGraphConfigured("estimate")) {
      const graphList = await listOneDriveFiles("estimate", "Est");
      if (graphList.ok) {
        setEstimateFiles(graphList.files || []);
        setFolderName("OneDrive (Estimates)");
        setEstimateSource("onedrive");
        return;
      }
    }

    const handle = await loadEstimateDirectoryHandle();
    if (!handle) {
      setEstimateFiles([]);
      setFolderName("");
      setEstimateSource("none");
      return;
    }

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
      const existing = await loadEstimateDirectoryHandle();
      if (!existing && window.showDirectoryPicker) {
        const shouldPick = confirm(
          "Select your Estimates folder now (recommended: C:\\Users\\chadt\\OneDrive\\Desktop\\Business\\WRIGHTS LC\\Estimates)?"
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
  }, []);

  const deleteEstimateFile = async (name) => {
    if (estimateSource === "onedrive") {
      if (!confirm(`Delete ${name}?`)) return;
      const result = await deleteOneDriveFile("estimate", name);
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
    setEmailSubject(`Estimate - ${displayEmailAttachmentName(fileName)}`);
    const guessedCustomer = guessCustomerFromFileName(fileName);
    setCustomerName(guessedCustomer);
    const existing = customerContacts.find((c) => c.name.toLowerCase() === guessedCustomer.toLowerCase());
    let inferredEmail = existing?.email || "";
    try {
      if (estimateSource === "onedrive") {
        const dl = await downloadOneDriveFile("estimate", fileName);
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
    setEmailBody("Please find your estimate attached.");
  };

  const onCustomerNameChange = (name) => {
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
      let file = null;
      if (estimateSource === "onedrive") {
        const dl = await downloadOneDriveFile("estimate", emailFile);
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
      let nameToSend = emailFile;
      if (looksLikeExcelName || looksLikeExcelMime) {
        const rawPdfBlob = await buildEstimatePdfFromExcelFile(file);
        if (!rawPdfBlob) {
          alert("Could not convert estimate to PDF. Email was not sent.");
          setSending(false);
          return;
        }
        const pdfBytes = await rawPdfBlob.arrayBuffer();
        blobToSend = new Blob([pdfBytes], { type: "application/pdf" });
        const baseName = String(emailFile || "").replace(/\.[^.]+$/, "");
        nameToSend = `${baseName}.pdf`;
      }
      const result = await sendGraphEmailWithAttachment({
        to: emailTo,
        cc: emailCc,
        subject: emailSubject || `Estimate - ${emailFile}`,
        body: emailBody,
        fileName: nameToSend,
        blob: blobToSend,
      });

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

        const stamp = new Date().toISOString();
        const nextLog = { ...fileSentLog, [emailFile]: stamp };
        setFileSentLog(nextLog);
        saveJson(FILE_SENT_LOG_KEY, nextLog);
        const senderNote = result?.senderAddress ? ` from ${result.senderAddress}` : "";
        const statusNote = result?.status ? ` (Graph ${result.status})` : "";
        alert(`Email sent${senderNote}${statusNote}.`);
        setSendSuccess(true);
        setTimeout(() => {
          setSendSuccess(false);
          setEmailFile(null);
        }, 1200);
      } else {
        alert(emailErrorMessage(result));
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
        const dl = await downloadOneDriveFile("estimate", fileName);
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
        <p>{folderName ? `Folder: ${folderName}` : "Auto-save folder not configured."}</p>
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
                <span style={{ wordBreak: "break-word" }}>{f.name}</span>
                <span>{((f.size || 0) / 1024).toFixed(1)} KB</span>
                <span>{new Date(f.updatedAt).toLocaleString()}</span>
                <span style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "flex-end" }}>
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
            <p><strong>Attachment:</strong> {displayEmailAttachmentName(emailFile)}</p>
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
                <span>Sending email…</span>
              </div>
            )}
            {sendSuccess && (
              <div className="email-status sent">
                <span className="check-pop" aria-hidden="true">✓</span>
                <span>Email sent</span>
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
