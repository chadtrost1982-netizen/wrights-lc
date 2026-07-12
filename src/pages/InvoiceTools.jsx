import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import { formatCurrency } from "../utils/currency";
import {
  loadAutoSaveDirectoryHandle,
  saveAutoSaveDirectoryHandle,
  writeBlobToAutoSaveFolder,
} from "../utils/autoSaveFolder";
import {
  clearPendingOneDriveUpload,
  isOneDriveGraphConfigured,
  listOneDriveFiles,
  queuePendingOneDriveUpload,
  downloadOneDriveFile,
  downloadOneDriveFileById,
  sendGraphEmailWithAttachment,
  uploadBlobToOneDrive,
} from "../utils/oneDriveGraph";

const INVOICE_COUNTER_KEY = "wrights_invoice_counter";
const WHEEL_INVOICE_START = 492;
const MAX_WHEEL_LINES = 50;
const CUSTOMER_KEY_WHEEL = "wheel_customer_names";
const CUSTOMER_KEY_SERVICE = "service_customer_names";
const WORK_PRESET_KEY_WHEEL = "wheel_work_presets";
const WORK_PRESET_KEY_SERVICE = "service_work_presets";
const CUSTOMER_CONTACTS_KEY_WHEEL = "wrights_customer_contacts";
const CUSTOMER_CONTACTS_KEY_SERVICE = "wrights_service_customer_contacts";
const FILE_SENT_LOG_KEY = "wrights_file_sent_log";
const INVOICE_DRAFT_FROM_ESTIMATE_KEY = "wrights_invoice_draft_from_estimate";
const DISPOSAL_POLICY_TEXT = [
  "Overweight Charges",
  "If the load exceeds the included 1,000 kg:",
  "$25 per additional 100 kg",
  "",
  "What's Not Accepted",
  "No hazardous waste",
  "No chemicals, oils, fuels, or asbestos",
  "No medical waste",
  "",
  "What You Can Put in the Bin",
  "Household junk",
  "Renovation debris",
  "Wood, drywall, flooring",
  "Furniture",
  "Appliances (non-refrigerated)",
  "Yard waste",
  "Scrap steel",
  "Mattresses (extra fee applies)",
].join("\n");
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

function toDisplay(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function toNumber(v) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findRefEstNumber(name) {
  const m = String(name || "").match(/Est\s+(\d+)/i);
  return m ? m[1] : "";
}

function nextInvoiceNumber() {
  const stored = localStorage.getItem(INVOICE_COUNTER_KEY);
  const baseline = WHEEL_INVOICE_START - 1;
  const current = Number.isFinite(Number(stored)) ? Number(stored) : baseline;
  const next = current + 1;
  localStorage.setItem(INVOICE_COUNTER_KEY, String(next));
  return String(next);
}

function inferCustomerFromWheel(lines) {
  const first = lines.find((l) => l.customer.trim());
  return first?.customer?.trim() || "Customer";
}

function isMoneyColumn(header) {
  const h = String(header).toLowerCase();
  return (
    h.includes("rate") ||
    h.includes("price") ||
    h.includes("amount") ||
    h.includes("total") ||
    h.includes("cost") ||
    h.includes("subtotal") ||
    h.includes("tax") ||
    h.includes("hst")
  );
}

function rowLooksLikeMoneySummary(row) {
  const joined = Object.values(row || {})
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return /hst|tax|total|subtotal|amount/.test(joined);
}

function formatCell(header, value, row) {
  const headerLooksNumericValue = /value|amount|price|total|cost|subtotal|tax|hst|rate/i.test(
    String(header || "")
  );
  if (!isMoneyColumn(header) && !(headerLooksNumericValue && rowLooksLikeMoneySummary(row))) {
    return toDisplay(value);
  }
  return formatCurrency(toNumber(value));
}

function blankWheelLine() {
  return { customer: "", work: "", qty: "", rate: "" };
}

function wheelLineAmount(line) {
  return toNumber(line.qty) * toNumber(line.rate);
}

function looksLikeDisposalLine(text) {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("14yd disposal bin") ||
    t.includes("sorted waste") ||
    t.includes("mixed waste") ||
    t.includes("mattress") ||
    t.includes("extra weight") ||
    t.includes("steel")
  );
}

function looksLikeContainerDeliveryLine(text) {
  const t = String(text || "").toLowerCase().trim();
  return t.startsWith("delivery (") || t === "delivery";
}

function loadJsonFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJsonToStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
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

function extractInvoiceNumber(fileName) {
  const match = String(fileName || "").match(/Inv\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

function getMaxInvoiceNumberFromFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return 0;
  return files.reduce((max, file) => {
    const num = extractInvoiceNumber(file.name);
    return Math.max(max, num);
  }, 0);
}

function guessCustomerFromFileName(fileName) {
  const base = String(fileName || "").replace(/\.[^.]+$/, "");
  const refCut = base.replace(/\s+-\s+Ref\s+\d+$/i, "");
  const invMatch = refCut.match(/^Inv\s+\d+\s+-\s+(.+)$/i);
  if (invMatch?.[1]) {
    const value = invMatch[1].trim();
    if (!/alloy wheel\s*-\s*services rendered/i.test(value)) return value;
  }
  const estMatch = refCut.match(/^Est\s+\d+\s+-\s+(.+)$/i);
  if (estMatch?.[1]) return estMatch[1].trim();
  return "";
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

const BILL_TO_BLOCK = [
  "Alloy Wheel Repair Specialist of Toronto",
  "80 Hanlan Rd Unit #9",
  "Woodbridge, ON, L4L 3P6",
];
const WHEEL_TO_NAME = "Alloy Wheel Repair";
const WHEEL_TO_ADDRESS = "80 Hanlan Rd Unit #9";

function buildPrintSheet(invoiceNumber, invoiceDate, headers, detailRows, subtotal, hst, total) {
  const isContainerLayout = /container/i.test(String(headers?.[0] || "").trim()) || /container/i.test(String(headers?.[2] || "").trim());
  const forLabelText = isContainerLayout ? "Container" : "Services Rendered";
  const aoa = [
    ["", "", "", "", "INVOICE"],
    [""],
    ["DISPOSAL SOLUTIONS", "", "", "", `Invoice #: ${invoiceNumber}`],
    ["4805 8th Line", "", "", "", `Date: ${invoiceDate}`],
    ["Beeton, ON, L0G 1A0"],
    ["Phone 416 889 5284 / 705 707 6064"],
    [""],
    ["To:", "", "For:"],
    [BILL_TO_BLOCK[0], "", forLabelText],
    [BILL_TO_BLOCK[1], "", "Invoice"],
    [BILL_TO_BLOCK[2]],
    [""],
    [headers[0] || "DESCRIPTION", "", "", headers[3] || "HR/QTY", headers[4] || "RATE", headers[5] || "AMOUNT"],
  ];

  detailRows.forEach((line) => {
    aoa.push([
      toDisplay(line[0]),
      "",
      "",
      toNumber(line[3]),
      toNumber(line[4]),
      toNumber(line[5]),
    ]);
  });

  aoa.push([""]);
  aoa.push(["", "", "", "", "SUB TOTAL", subtotal]);
  aoa.push(["", "", "", "", "HST", hst]);
  aoa.push(["", "", "", "", "TOTAL", total]);
  aoa.push([""]);
  aoa.push(["", "", "Thank you for your business!"]);
  aoa.push(["", "", "HST: 76853 9579"]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 36 }, { wch: 2 }, { wch: isContainerLayout ? 18 : 24 }, { wch: 11 }, { wch: 14 }, { wch: 14 }];
  ws["!margins"] = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  ws["!merges"] = [
    { s: { r: 0, c: 4 }, e: { r: 0, c: 5 } },   // INVOICE title block
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },   // company line
    { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 2 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 2 } },   // bill-to lines
    { s: { r: 8, c: 0 }, e: { r: 8, c: 2 } },
    { s: { r: 9, c: 0 }, e: { r: 9, c: 2 } },
    { s: { r: 11, c: 0 }, e: { r: 11, c: 2 } }, // DESCRIPTION header
  ];
  ws["!rows"] = Array.from({ length: aoa.length }, (_, i) => {
    if (i === 0) return { hpt: 24 };
    if (i === 11) return { hpt: 18 };
    return { hpt: 16 };
  });

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const boldCells = ["E1", "A3", "A4", "A5", "E3", "E4", "A8", "C8", "A12", "D12", "E12", "F12"];
  boldCells.forEach((cellRef) => {
    if (!ws[cellRef]) return;
    ws[cellRef].s = {
      ...(ws[cellRef].s || {}),
      font: { ...((ws[cellRef].s && ws[cellRef].s.font) || {}), bold: true },
    };
  });

  for (let r = 0; r <= range.e.r; r++) {
    const qtyRef = XLSX.utils.encode_cell({ r, c: 3 });
    const rateRef = XLSX.utils.encode_cell({ r, c: 4 });
    const amountRef = XLSX.utils.encode_cell({ r, c: 5 });
    if (ws[qtyRef] && ws[qtyRef].v !== "") ws[qtyRef].z = "0";
    if (ws[rateRef] && ws[rateRef].v !== "") ws[rateRef].z = "$#,##0.00";
    if (ws[amountRef] && ws[amountRef].v !== "") ws[amountRef].z = "$#,##0.00";
  }
  return ws;
}

async function buildStyledExcelBlob(saveRows, options = {}) {
  const wb = new ExcelJS.Workbook();
  const wsInv = wb.addWorksheet("Invoice");
  const wsInfo = wb.addWorksheet("Info");
  const wsData = wb.addWorksheet("Data");
  wsInfo.hidden = true;
  wsData.hidden = true;
  try {
    const logoDataUrl = await getLogoDataUrl();
    if (logoDataUrl) {
      const logoId = wb.addImage({ base64: logoDataUrl, extension: "png" });
      wsInv.addImage(logoId, {
        tl: { col: 0, row: 0.15 },
        ext: { width: 136, height: 45 },
      });
    }
  } catch {
    // Keep export working even if logo fails to load.
  }

  const billName = String(options.billToName || "Customer");
  const billAddress = String(options.billToAddress || "");
  const forLabel = String(options.forLabel || "Services Rendered");
  const notesText = String(options.notes || "");
  const isContainerLayout = /container/i.test(forLabel);

  wsInv.columns = [
    { width: 36 }, { width: 2 }, { width: isContainerLayout ? 18 : 24 }, { width: 11 }, { width: 14 }, { width: 14 },
  ];
  const titleRow = wsInv.addRow(["", "", "", "", "INVOICE"]).number;
  wsInv.addRow([""]);
  const companyRow = wsInv.addRow(["DISPOSAL SOLUTIONS", "", "", "", ""]).number;
  const address1Row = wsInv.addRow(["4805 8th Line", "", "", "", ""]).number;
  const address2Row = wsInv.addRow(["Beeton, ON, L0G 1A0"]).number;
  const phoneRow = wsInv.addRow(["Phone 416 889 5284 / 705 707 6064"]).number;
  const websiteRow = wsInv.addRow(["www.DisposalSolutions.ca"]).number;
  wsInv.addRow([""]);
  wsInv.addRow(["To:", "", "For:"]);
  const toForRow = wsInv.lastRow.number;
  wsInv.addRow([billName, "", isContainerLayout ? "Container" : forLabel]);
  const addressRow = wsInv.addRow([billAddress, "", "Invoice"]).number;
  wsInv.addRow([""]);
  wsInv.addRow(["DESCRIPTION", "", "", "HR/QTY", "RATE", "AMOUNT"]);
  wsInv.getCell(`A${addressRow}`).alignment = { wrapText: true, vertical: "top" };
  if (String(billAddress || "").length > 36) {
    wsInv.getRow(addressRow).height = 32;
  }
  const headerRow = wsInv.lastRow.number;

  (options.printRows || []).forEach((r) => {
    const row = wsInv.addRow([r.description || "", "", "", toNumber(r.qty), toNumber(r.rate), toNumber(r.amount)]);
    const description = String(r.description || "");
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    if (description.length > 38) {
      const estimatedLines = Math.min(4, Math.ceil(description.length / 38));
      row.height = Math.max(16, estimatedLines * 14);
    }
  });
  wsInv.addRow([""]);
  const subtotalRow = wsInv.addRow(["", "", "", "", "SUB TOTAL", toNumber(options.printSubtotal)]).number;
  const hstRow = wsInv.addRow(["", "", "", "", "HST", toNumber(options.printHst)]).number;
  const totalRow = wsInv.addRow(["", "", "", "", "TOTAL", toNumber(options.printTotal)]).number;
  wsInv.addRow([""]);
  if (notesText.trim()) {
    wsInv.addRow(["Notes:"]);
    const noteLines = notesText
      .split(/\r?\n/)
      .map((line) => String(line || "").trim())
      .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0));
    noteLines.forEach((line) => {
      wsInv.addRow([line]);
    });
    wsInv.addRow([""]);
  }
  const thankYouRow = wsInv.addRow(["", "", "Thank you for your business!"]).number;
  const hstFooterRow = wsInv.addRow(["", "", "HST: 76853 9579"]).number;

  wsInv.getCell(`C${thankYouRow}`).alignment = { horizontal: "center" };
  wsInv.getCell(`C${hstFooterRow}`).alignment = { horizontal: "center" };

  [`A${companyRow}`, `A${address1Row}`, `A${address2Row}`, `A${phoneRow}`, `A${websiteRow}`].forEach((cell) => {
    wsInv.getCell(cell).font = { bold: true };
  });
  wsInv.getCell(`E${titleRow}`).value = {
    richText: [{ text: "INVOICE", font: { bold: true } }],
  };
  wsInv.getCell(`A${toForRow}`).font = { bold: true };
  wsInv.getCell(`C${toForRow}`).font = { bold: true };
  ["A", "D", "E", "F"].forEach((col) => {
    wsInv.getCell(`${col}${headerRow}`).font = { bold: true };
  });
  wsInv.getCell(`E${companyRow + 1}`).value = {
    richText: [
      { text: "Invoice #: ", font: { bold: true } },
      { text: String(options.invoiceNumber || ""), font: { bold: false } },
    ],
  };
  wsInv.getCell(`E${address1Row + 1}`).value = {
    richText: [
      { text: "Date: ", font: { bold: true } },
      { text: String(options.invoiceDate || ""), font: { bold: false } },
    ],
  };
  wsInv.getCell(`E${subtotalRow}`).font = { bold: false };
  wsInv.getCell(`F${subtotalRow}`).font = { bold: false };
  wsInv.getCell(`E${hstRow}`).font = { bold: false };
  wsInv.getCell(`F${hstRow}`).font = { bold: false };
  wsInv.getCell(`E${totalRow}`).font = { bold: true };
  wsInv.getCell(`F${totalRow}`).font = { bold: true };

  for (let r = headerRow + 1; r <= headerRow + (options.printRows || []).length; r++) {
    wsInv.mergeCells(`A${r}:C${r}`);
    wsInv.getCell(`A${r}`).alignment = { wrapText: true, vertical: "top" };
    wsInv.getCell(`D${r}`).numFmt = "0";
    wsInv.getCell(`E${r}`).numFmt = "$#,##0.00";
    wsInv.getCell(`F${r}`).numFmt = "$#,##0.00";
  }
  wsInv.getCell(`F${subtotalRow}`).numFmt = "$#,##0.00";
  wsInv.getCell(`F${hstRow}`).numFmt = "$#,##0.00";
  wsInv.getCell(`F${totalRow}`).numFmt = "$#,##0.00";

  wsInfo.columns = [{ width: 22 }, { width: 45 }];
  [
    ["Company", "DISPOSAL SOLUTIONS"],
    ["Address", "4805 8th Line, Beeton, ON, L0G 1A0"],
    ["Phone", "416 889 5284 / 705 707 6064"],
    ["Website", "www.DisposalSolutions.ca"],
    ["Invoice #", options.invoiceNumber || ""],
    ["Date", options.invoiceDate || ""],
  ].forEach((row) => wsInfo.addRow(row));
  wsInfo.getColumn(1).font = { bold: true };

  const dataHeaders = Object.keys(saveRows[0] || {});
  if (dataHeaders.length) {
    wsData.addRow(dataHeaders);
    wsData.getRow(1).font = { bold: true };
    saveRows.forEach((row) => {
      wsData.addRow(dataHeaders.map((h) => row[h]));
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export default function InvoiceTools({ pageTitle = "Invoice Tools", showFolder = true, showCreate = true }) {
  const oneDriveInvoicesPath = String(import.meta.env.VITE_ONEDRIVE_INVOICES_PATH || "").trim();
  const oneDriveLegacyPath = String(import.meta.env.VITE_ONEDRIVE_TARGET_PATH || "").trim();
  const graphMode = isOneDriveGraphConfigured("invoice");
  const [invoiceType, setInvoiceType] = useState("wheel");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [wheelLines, setWheelLines] = useState(Array.from({ length: 8 }, () => blankWheelLine()));
  const [refEstNumber, setRefEstNumber] = useState("");
  const [folderFiles, setFolderFiles] = useState([]);
  const [folderName, setFolderName] = useState("");
  const [customerOptions, setCustomerOptions] = useState([]);
  const [workPresets, setWorkPresets] = useState([]); // [{work, rate}]
  const [emailFile, setEmailFile] = useState(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("Please find your invoice attached.");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSendSuccess, setEmailSendSuccess] = useState(false);
  const [emailCustomerName, setEmailCustomerName] = useState("");
  const [customerContacts, setCustomerContacts] = useState([]);
  const [fileSentLog, setFileSentLog] = useState({});
  const [billToName, setBillToName] = useState("");
  const [billToAddress, setBillToAddress] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [draftForLabel, setDraftForLabel] = useState("");

  const isWheelStyle = invoiceType === "wheel" || invoiceType === "services";
  const customerKey = invoiceType === "services" ? CUSTOMER_KEY_SERVICE : CUSTOMER_KEY_WHEEL;
  const workPresetKey = invoiceType === "services" ? WORK_PRESET_KEY_SERVICE : WORK_PRESET_KEY_WHEEL;
  const customerContactsKey = invoiceType === "services" ? CUSTOMER_CONTACTS_KEY_SERVICE : CUSTOMER_CONTACTS_KEY_WHEEL;
  const hasContainerData = rows.length > 0;

  const headers = useMemo(() => {
    if (!hasContainerData) return [];
    return Object.keys(rows[0]);
  }, [hasContainerData, rows]);

  const totals = useMemo(() => {
    const out = {};
    headers.forEach((h) => {
      if (!isMoneyColumn(h)) return;
      let sum = 0;
      let found = false;
      rows.forEach((r) => {
        const n = toNumber(r[h]);
        if (Number.isFinite(n)) {
          sum += n;
          found = true;
        }
      });
      if (found) out[h] = sum;
    });
    return out;
  }, [headers, rows]);

  const wheelSubtotal = useMemo(
    () => wheelLines.reduce((sum, line) => sum + wheelLineAmount(line), 0),
    [wheelLines]
  );
  const wheelHst = Math.round(wheelSubtotal * 0.13 * 100) / 100;
  const wheelTotal = wheelSubtotal + wheelHst;

  const loadFolderContents = async () => {
    if (graphMode) {
      const listed = await listOneDriveFiles("invoice", "");
      if (listed.ok) {
        setFolderFiles(listed.files || []);
        setFolderName(`OneDrive: ${oneDriveInvoicesPath || oneDriveLegacyPath || "(invoices path not configured)"}`);
        return;
      }
    }

    let handle = await loadAutoSaveDirectoryHandle();
    if (!handle && !graphMode && window.showDirectoryPicker) {
      const shouldPick = confirm(
        "Select your Invoices folder now (recommended: C:\\Users\\chadt\\OneDrive\\Desktop\\Business\\WRIGHTS LC\\Invoices)?"
      );
      if (shouldPick) {
        try {
          handle = await window.showDirectoryPicker();
          await saveAutoSaveDirectoryHandle(handle);
        } catch {
          // User canceled or selection failed.
        }
      }
    }

    if (!handle) {
      setFolderFiles([]);
      setFolderName("");
      return;
    }

    setFolderName(handle.name || "");
    const files = [];
    for await (const [name, entryHandle] of handle.entries()) {
      if (entryHandle.kind !== "file") continue;
      const file = await entryHandle.getFile();
      files.push({ name, size: file.size, updatedAt: file.lastModified, file });
    }

    files.sort((a, b) => extractInvoiceNumber(b.name) - extractInvoiceNumber(a.name));
    setFolderFiles(files);
  };

  useEffect(() => {
    loadFolderContents();
    setCustomerOptions(loadJsonFromStorage(customerKey, []));
    setWorkPresets(loadJsonFromStorage(workPresetKey, []));
    setCustomerContacts(loadJsonFromStorage(customerContactsKey, []));
    setFileSentLog(loadJsonFromStorage(FILE_SENT_LOG_KEY, {}));
  }, [customerKey, workPresetKey, customerContactsKey]);

  useEffect(() => {
    if (!showCreate) return;
    const raw = localStorage.getItem(INVOICE_DRAFT_FROM_ESTIMATE_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      const lines = Array.isArray(draft?.lines) ? draft.lines : [];
      if (!lines.length) return;
      const parsed = lines.slice(0, MAX_WHEEL_LINES).map((l) => ({
        customer: String(l.customer || ""),
        work: String(l.work || ""),
        qty: String(l.qty ?? ""),
        rate: String(l.rate ?? ""),
      }));
      setInvoiceType("services");
      setWheelLines(parsed.length ? parsed : Array.from({ length: 8 }, () => blankWheelLine()));
      setRefEstNumber(String(draft?.refEstNumber || ""));
      setFileName(String(draft?.sourceFile || ""));
      setBillToName(String(draft?.customer || ""));
      setBillToAddress(String(draft?.customerAddress || ""));
      setInvoiceNotes(String(draft?.notes || ""));
      setDraftForLabel(String(draft?.draftForLabel || ""));
      localStorage.removeItem(INVOICE_DRAFT_FROM_ESTIMATE_KEY);
    } catch {
      localStorage.removeItem(INVOICE_DRAFT_FROM_ESTIMATE_KEY);
    }
  }, [showCreate]);

  const learnWheelValues = (lines) => {
    const customers = new Set(customerOptions);
    const works = [...workPresets];

    lines.forEach((line) => {
      const customer = line.customer.trim();
      const work = line.work.trim();
      const rate = toNumber(line.rate);

      if (customer) customers.add(customer);
      if (work) {
        const idx = works.findIndex((w) => w.work.toLowerCase() === work.toLowerCase());
        if (idx >= 0) {
          if (rate > 0) works[idx] = { ...works[idx], rate };
        } else {
          works.push({ work, rate: rate > 0 ? rate : 0 });
        }
      }
    });

    const customerList = Array.from(customers).sort((a, b) => a.localeCompare(b));
    const workList = works.sort((a, b) => a.work.localeCompare(b.work));

    setCustomerOptions(customerList);
    setWorkPresets(workList);
    saveJsonToStorage(customerKey, customerList);
    saveJsonToStorage(workPresetKey, workList);
  };

  const buildInvoiceBaseName = (saveRows, linesForCustomer) => {
    const invoiceNumber = nextInvoiceNumber();
    const ref = String(refEstNumber || "").trim();
    if (isWheelStyle) {
      if (invoiceType === "services") {
        return ref
          ? `Inv ${invoiceNumber} - Services Rendered - Ref ${ref}`
          : `Inv ${invoiceNumber} - Services Rendered`;
      }
      return ref
        ? `Inv ${invoiceNumber} - Alloy Wheel - Services Rendered - Ref ${ref}`
        : `Inv ${invoiceNumber} - Alloy Wheel - Services Rendered`;
    }
    const customer =
      isWheelStyle
        ? inferCustomerFromWheel(linesForCustomer)
        : inferCustomerFromRows(saveRows);
    const safeCustomer = customer.replace(/[\\/:*?"<>|]/g, "").trim() || "Customer";
    if (ref) return `Inv ${invoiceNumber} - ${safeCustomer} - Ref ${ref}`;
    return `Inv ${invoiceNumber} - ${safeCustomer}`;
  };

  const buildRowsFromWheel = () => {
    const detailRows = wheelLines
      .filter((line) => line.customer.trim() || line.work.trim() || line.qty || line.rate)
      .map((line) => ({
        CUSTOMER: line.customer.trim(),
        "WORK PERFORMED": line.work.trim(),
        "HR/QTY": toNumber(line.qty),
        RATE: toNumber(line.rate),
        AMOUNT: wheelLineAmount(line),
      }));

    return [
      ...detailRows,
      { CUSTOMER: "", "WORK PERFORMED": "", "HR/QTY": "", RATE: "", AMOUNT: "" },
      { CUSTOMER: "", "WORK PERFORMED": "Subtotal", "HR/QTY": "", RATE: "", AMOUNT: wheelSubtotal },
      { CUSTOMER: "", "WORK PERFORMED": "HST", "HR/QTY": "", RATE: "", AMOUNT: wheelHst },
      { CUSTOMER: "", "WORK PERFORMED": "Total", "HR/QTY": "", RATE: "", AMOUNT: wheelTotal },
    ];
  };

  const inferCustomerFromRows = (saveRows) => {
    if (!Array.isArray(saveRows) || saveRows.length === 0) return "Customer";
    const first = saveRows[0] || {};
    const keys = Object.keys(first);
    const nameKey = keys.find((k) => /customer|client|name/i.test(k));
    const val = nameKey ? String(first[nameKey] || "").trim() : "";
    return val || "Customer";
  };

  const getRowsForSave = () => (isWheelStyle ? buildRowsFromWheel() : rows);

  const buildPrintRowsAndTotals = (saveRows) => {
    if (isWheelStyle) {
      const wheelDetails = wheelLines
        .filter((line) => line.customer.trim() || line.work.trim() || line.qty || line.rate)
        .map((line) => ({
          description: invoiceType === "services" ? String(line.work || "").trim() : `${line.customer} ${line.work}`.trim(),
          qty: toNumber(line.qty),
          rate: toNumber(line.rate),
          amount: wheelLineAmount(line),
        }));
      return {
        lines: wheelDetails,
        subtotal: wheelSubtotal,
        hst: wheelHst,
        total: wheelTotal,
      };
    }

    const detail = [];
    let deliveryAmount = 0;
    let subtotal = 0;
    let hst = 0;
    let total = 0;
    const headers = Object.keys(saveRows[0] || {});
    const descKey = headers.find((h) => /description|item|service|work/i.test(h)) || headers[0];
    const qtyKey = headers.find((h) => /qty|quantity|hr/i.test(h)) || "";
    const rateKey = headers.find((h) => /^rate$|price|unit/i.test(h)) || "";
    const amountKey = headers.find((h) => /amount|line total|total/i.test(h)) || "";

    saveRows.forEach((row) => {
      const label = String(row[descKey] || "").trim().toLowerCase();
      if (/subtotal/.test(label)) {
        subtotal = toNumber(row[amountKey] ?? row.RATE ?? row.AMOUNT);
        return;
      }
      if (/^hst$|tax/.test(label)) {
        hst = toNumber(row[amountKey] ?? row.RATE ?? row.AMOUNT);
        return;
      }
      if (/^total$/.test(label)) {
        total = toNumber(row[amountKey] ?? row.RATE ?? row.AMOUNT);
        return;
      }

      const description = String(row[descKey] || "")
        .replace(/\s+/g, " ")
        .trim();
      const qty = toNumber(qtyKey ? row[qtyKey] : 0);
      const rate = toNumber(rateKey ? row[rateKey] : 0);
      const amount = toNumber(amountKey ? row[amountKey] : 0);
      if (looksLikeContainerDeliveryLine(description)) {
        deliveryAmount += amount;
        return;
      }
      if (!description && !qty && !rate && !amount) return;

      detail.push({ description, qty, rate, amount });
    });

    if (deliveryAmount > 0 && detail.length > 0) {
      const first = detail[0];
      const nextAmount = toNumber(first.amount) + deliveryAmount;
      const nextQty = toNumber(first.qty);
      detail[0] = {
        ...first,
        description: /delivery included/i.test(String(first.description || ""))
          ? String(first.description || "")
          : `${String(first.description || "").trim()} (Delivery Included)`,
        amount: nextAmount,
        rate: nextQty > 0 ? nextAmount / nextQty : toNumber(first.rate) + deliveryAmount,
      };
    }

    if (!subtotal) subtotal = detail.reduce((sum, line) => sum + toNumber(line.amount), 0);
    if (!hst) hst = Math.round(subtotal * 0.13 * 100) / 100;
    if (!total) total = subtotal + hst;

    return { lines: detail, subtotal, hst, total };
  };

  const saveExcel = async () => {
    const saveRows = getRowsForSave();
    if (!saveRows.length) return;

    if (isWheelStyle) {
      learnWheelValues(wheelLines);
    }

    const baseName = buildInvoiceBaseName(saveRows, wheelLines);
    const invoiceNumber = (baseName.match(/^Inv\s+(\d+)/i) || [])[1] || "";
    const invoiceDate = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
    const printData = buildPrintRowsAndTotals(saveRows);
    const toName = invoiceType === "wheel"
      ? WHEEL_TO_NAME
      : (billToName || inferCustomerFromWheel(wheelLines));
    const toAddress = invoiceType === "wheel" ? WHEEL_TO_ADDRESS : billToAddress;
    const hasDisposalContent = printData.lines.some((l) => looksLikeDisposalLine(l.description));
    const forLabel = draftForLabel || (hasDisposalContent
      ? "Disposal Bin Services"
      : invoiceType === "wheel"
        ? "Wheel Repair Services"
        : "Services Rendered");
    const isContainerLayout = /container/i.test(forLabel);
    const forLabelText = isContainerLayout ? "Container" : forLabel;
    const mergedNotes = hasDisposalContent
      ? [String(invoiceNotes || "").trim(), DISPOSAL_POLICY_TEXT].filter(Boolean).join("\n\n")
      : String(invoiceNotes || "");
    const excelName = `${baseName}.xlsx`;
    const blob = await buildStyledExcelBlob(saveRows, {
      invoiceType,
      invoiceNumber,
      invoiceDate,
      billToName: toName,
      billToAddress: toAddress,
      forLabel,
      notes: mergedNotes,
      printRows: printData.lines,
      printSubtotal: printData.subtotal,
      printHst: printData.hst,
      printTotal: printData.total,
    });

    await queuePendingOneDriveUpload(excelName, blob, "invoice");
    const graphSaved = await uploadBlobToOneDrive(excelName, blob, "invoice");
    if (graphSaved.ok) clearPendingOneDriveUpload();
    let autoSaved = graphSaved;
    if (!autoSaved.ok) autoSaved = await writeBlobToAutoSaveFolder(excelName, blob);
    if (!autoSaved.ok) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = excelName;
      a.click();
      URL.revokeObjectURL(url);
      alert(`File downloaded: ${excelName}`);
    } else if (graphSaved.ok) {
      const graphLocation = graphSaved.parentPath
        ? `${graphSaved.parentPath.replace("/drive/root:", "")}/${graphSaved.name}`
        : `${excelName}`;
      alert(`File saved to OneDrive: ${graphLocation}`);
    } else {
      alert(`File saved to selected local folder: ${excelName}`);
    }

    await loadFolderContents();
  };

  const exportPdf = async () => {
    try {
      const saveRows = getRowsForSave();
      if (!saveRows.length) return;

      if (isWheelStyle) {
        learnWheelValues(wheelLines);
      }

      const baseInvoiceName = buildInvoiceBaseName(saveRows, wheelLines);
      const pdfName = `${baseInvoiceName}.pdf`;
      const excelName = `${baseInvoiceName}.xlsx`;
      const invoiceNumber = (baseInvoiceName.match(/^Inv\s+(\d+)/i) || [])[1] || "";
      const invoiceDate = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
      const printData = buildPrintRowsAndTotals(saveRows);
      const toName = invoiceType === "wheel"
        ? WHEEL_TO_NAME
        : (billToName || inferCustomerFromWheel(wheelLines));
      const toAddress = invoiceType === "wheel" ? WHEEL_TO_ADDRESS : billToAddress;
      const hasDisposalContent = printData.lines.some((l) => looksLikeDisposalLine(l.description));
      const forLabel = draftForLabel || (hasDisposalContent
        ? "Disposal Bin Services"
        : invoiceType === "wheel"
          ? "Wheel Repair Services"
          : "Services Rendered");
      const isContainerLayout = /container/i.test(forLabel);
      const forLabelText = isContainerLayout ? "Container" : forLabel;
      const mergedNotes = hasDisposalContent
        ? [String(invoiceNotes || "").trim(), DISPOSAL_POLICY_TEXT].filter(Boolean).join("\n\n")
        : String(invoiceNotes || "");

      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const left = 70;
      const right = 540;
      let y = 72;

      try {
        const logoDataUrl = await getLogoDataUrl();
        if (logoDataUrl) {
          doc.addImage(logoDataUrl, "PNG", left, y - 24, 136, 45);
        }
      } catch {
        // Keep PDF export working even if logo fails to load.
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.setTextColor(58, 74, 94);
      doc.text("INVOICE", right - 10, y, { align: "right" });

      y += 40;
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("DISPOSAL SOLUTIONS", left, y);
      doc.text("4805 8th Line", left, y + 14);
      doc.text("Beeton, ON, L0G 1A0", left, y + 28);
      doc.text("Phone 416 889 5284 / 705 707 6064", left, y + 42);
      doc.text("www.DisposalSolutions.ca", left, y + 56);

      doc.setFontSize(10);
      y += 56;

      let metaY = 126;
      const invoicePrefix = "Invoice #: ";
      const invoiceValue = String(invoiceNumber || "");
      const valueWidth = doc.getTextWidth(invoiceValue);
      doc.setFont("helvetica", "normal");
      doc.text(invoiceValue, right - 10, metaY, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.text(invoicePrefix, right - 10 - valueWidth, metaY, { align: "right" });
      metaY += 16;
      const datePrefix = "Date: ";
      const dateValue = String(invoiceDate || "");
      const dateValueWidth = doc.getTextWidth(dateValue);
      doc.setFont("helvetica", "normal");
      doc.text(dateValue, right - 10, metaY, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.text(datePrefix, right - 10 - dateValueWidth - 5, metaY, { align: "right" });

      y += 28;
      doc.setFont("helvetica", "bold");
      doc.text("To:", left, y);
      doc.text("For:", left + (isContainerLayout ? 200 : 230), y);
      y += 16;
      doc.setFont("helvetica", "bold");
      doc.text(String(toName || "Customer"), left, y);
      doc.text(forLabelText, left + (isContainerLayout ? 200 : 230), y);
      y += 14;
      const addressLines = doc.splitTextToSize(String(toAddress || ""), isContainerLayout ? 180 : 210);
      doc.text(addressLines.length ? addressLines : [""], left, y);
      doc.text(isContainerLayout ? "Container" : "Invoice", left + (isContainerLayout ? 200 : 230), y);
      if (addressLines.length > 1) {
        y += (addressLines.length - 1) * 12;
      }
      if (toAddress) y += 14;

      y += 28;
      const tableLeft = left;
      const tableRight = right;
      const rowHeight = 18;
      const descriptionWidth = 280;
      const qtyX = right - 130;
      const rateX = right - 80;
      const amountX = right - 10;

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
      printData.lines.forEach((line) => {
        if (y > 680) {
          doc.addPage();
          y = 72;
        }
        const wrappedDescription = doc.splitTextToSize(String(line.description || ""), descriptionWidth);
        const descriptionLines = Array.isArray(wrappedDescription) && wrappedDescription.length
          ? wrappedDescription
          : [""];
        doc.text(descriptionLines, tableLeft, y);
        doc.text(String(toNumber(line.qty) || ""), qtyX, y, { align: "right" });
        doc.text(formatCurrency(toNumber(line.rate)), rateX, y, { align: "right" });
        doc.text(formatCurrency(toNumber(line.amount)), amountX, y, { align: "right" });
        y += Math.max(rowHeight, descriptionLines.length * 12);
      });

      y += 16;
      doc.setLineWidth(0.5);
      doc.line(qtyX - 35, y - 12, amountX + 10, y - 12);
      doc.setFont("helvetica", "normal");
      doc.text("SUB TOTAL", qtyX - 60, y, { align: "right" });
      doc.text(formatCurrency(printData.subtotal), amountX, y, { align: "right" });
      y += 16;
      doc.text("HST", qtyX - 60, y, { align: "right" });
      doc.text(formatCurrency(printData.hst), amountX, y, { align: "right" });
      y += 16;
      doc.setFont("helvetica", "bold");
      doc.text("TOTAL", qtyX - 60, y, { align: "right" });
      doc.text(formatCurrency(printData.total), amountX, y, { align: "right" });

      y += 36;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      if (mergedNotes && mergedNotes.trim()) {
        doc.setFont("helvetica", "bold");
        doc.text("Notes:", left, y);
        y += 14;
        doc.setFont("helvetica", "normal");
        const noteLines = doc.splitTextToSize(String(mergedNotes).trim(), 420);
        noteLines.slice(0, 18).forEach((line) => {
          doc.text(line, left, y);
          y += 12;
        });
        y += 4;
      }
      y += 16;
      const pageWidth = doc.internal.pageSize.getWidth();
      const centerX = pageWidth / 2;
      doc.setFont("helvetica", "bold");
      doc.text("Thank you for your business!", centerX, y, { align: "center" });
      y += 12;
      doc.setFont("helvetica", "normal");
      doc.text("HST: 76853 9579", centerX, y, { align: "center" });

      const pdfBlob = doc.output("blob");
      const excelBlob = await buildStyledExcelBlob(saveRows, {
        invoiceType,
        invoiceNumber,
        invoiceDate,
        billToName: toName,
        billToAddress: toAddress,
        forLabel,
        notes: mergedNotes,
        printRows: printData.lines,
        printSubtotal: printData.subtotal,
        printHst: printData.hst,
        printTotal: printData.total,
      });

      const previewUrl = URL.createObjectURL(pdfBlob);
      const previewWindow = window.open(previewUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(previewUrl), 20000);

      const pdfDownloadUrl = URL.createObjectURL(pdfBlob);
      const pdfLink = document.createElement("a");
      pdfLink.href = pdfDownloadUrl;
      pdfLink.download = pdfName;
      pdfLink.rel = "noopener noreferrer";
      document.body.appendChild(pdfLink);
      pdfLink.click();
      pdfLink.remove();
      setTimeout(() => URL.revokeObjectURL(pdfDownloadUrl), 20000);

      const saveResults = await Promise.allSettled([
        uploadBlobToOneDrive(pdfName, pdfBlob, "invoice").then(async (result) => {
          if (result.ok) return result;
          return writeBlobToAutoSaveFolder(pdfName, pdfBlob);
        }),
        uploadBlobToOneDrive(excelName, excelBlob, "invoice").then(async (result) => {
          if (result.ok) return result;
          return writeBlobToAutoSaveFolder(excelName, excelBlob);
        }),
      ]);

      const pdfResult = saveResults[0].status === "fulfilled" ? saveResults[0].value : { ok: false };
      const excelResult = saveResults[1].status === "fulfilled" ? saveResults[1].value : { ok: false };

      if (!previewWindow) {
        // Popup blockers can prevent previewing, but the download click above still runs.
      }

      const pdfStatus = pdfResult?.ok
        ? (pdfResult.parentPath
          ? `PDF saved: ${pdfResult.parentPath.replace("/drive/root:", "")}/${pdfResult.name}`
          : `PDF saved: ${pdfName}`)
        : `PDF downloaded: ${pdfName}`;
      const excelStatus = excelResult?.ok
        ? (excelResult.parentPath
          ? `Excel saved: ${excelResult.parentPath.replace("/drive/root:", "")}/${excelResult.name}`
          : `Excel saved: ${excelName}`)
        : `Excel downloaded: ${excelName}`;

      alert(`${pdfStatus}\n${excelStatus}`);

      await loadFolderContents();
    } catch (error) {
      alert(`Could not export PDF. ${error?.message || String(error || "Unknown error")}`);
    }
  };

  const openFolderFile = async (fileEntry) => {
    try {
      let arrayBuffer;
      if (fileEntry?.file) {
        arrayBuffer = await fileEntry.file.arrayBuffer();
      } else if (graphMode) {
        const result = fileEntry?.id
          ? await downloadOneDriveFileById("invoice", fileEntry.id)
          : await downloadOneDriveFile("invoice", fileEntry.name);
        if (result.ok) {
          arrayBuffer = await result.blob.arrayBuffer();
        } else {
          alert("Could not download file from OneDrive: " + (result.reason || "Unknown error"));
          return;
        }
      } else {
        const folderHandle = await loadAutoSaveDirectoryHandle();
        if (!folderHandle) {
          alert("Auto-save folder is not configured.");
          return;
        }
        const fileHandle = await folderHandle.getFileHandle(fileEntry.name);
        const file = await fileHandle.getFile();
        arrayBuffer = await file.arrayBuffer();
      }

      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const dataSheetName = workbook.SheetNames.includes("Data")
        ? "Data"
        : workbook.SheetNames[0];
      const firstSheet = workbook.Sheets[dataSheetName];
      const json = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
      const loadedRows = Array.isArray(json) ? json : [];

      setFileName(fileEntry.name);
      setRefEstNumber(findRefEstNumber(fileEntry.name));
      setRows(loadedRows);

      const loadedHeaders = Object.keys(loadedRows[0] || {}).map((h) => h.toUpperCase());
      const wheelLike = loadedHeaders.includes("CUSTOMER") && loadedHeaders.includes("WORK PERFORMED");
      setInvoiceType(wheelLike ? "wheel" : "services");

      if (wheelLike) {
        const parsed = loadedRows
          .filter((r) => String(r.CUSTOMER || "").trim() || String(r["WORK PERFORMED"] || "").trim())
          .filter((r) => !/subtotal|hst|total/i.test(String(r["WORK PERFORMED"] || "")))
          .map((r) => ({
            customer: String(r.CUSTOMER || ""),
            work: String(r["WORK PERFORMED"] || ""),
            qty: String(r["HR/QTY"] ?? ""),
            rate: String(r.RATE ?? ""),
          }))
          .slice(0, MAX_WHEEL_LINES);
        setWheelLines(parsed.length ? parsed : Array.from({ length: 8 }, () => blankWheelLine()));
      }
    } catch (err) {
      alert("Could not open that file: " + (err.message || "Unknown error"));
    }
  };

  const viewFolderFile = async (fileEntry) => {
    try {
      if (fileEntry?.webUrl && graphMode) {
        window.open(fileEntry.webUrl, "_blank", "noopener,noreferrer");
      } else if (fileEntry?.file) {
        const url = URL.createObjectURL(fileEntry.file);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      } else if (graphMode) {
        const result = fileEntry?.id
          ? await downloadOneDriveFileById("invoice", fileEntry.id)
          : await downloadOneDriveFile("invoice", fileEntry.name || fileEntry);
        if (result.ok) {
          const url = URL.createObjectURL(result.blob);
          window.open(url, "_blank", "noopener,noreferrer");
          setTimeout(() => URL.revokeObjectURL(url), 15000);
        } else {
          alert("Could not download file from OneDrive: " + (result.reason || "Unknown error"));
        }
      } else {
        // Fall back to local folder
        const folderHandle = await loadAutoSaveDirectoryHandle();
        if (!folderHandle) {
          alert("Auto-save folder is not configured.");
          return;
        }
        const fileHandle = await folderHandle.getFileHandle(fileEntry.name || fileEntry);
        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      }
    } catch (err) {
      alert("Could not open that file: " + (err.message || "Unknown error"));
    }
  };

  const openEmailModal = (fileName) => {
    setEmailFile(fileName);
    setEmailSendSuccess(false);
    const guessedCustomer = guessCustomerFromFileName(fileName);
    setEmailCustomerName(guessedCustomer);
    const existing = customerContacts.find((c) => c.name.toLowerCase() === guessedCustomer.toLowerCase());
    setEmailTo(existing?.email || "");
    setEmailCc("");
    setEmailSubject(`Invoice - ${fileName}`);
    setEmailBody("Please find your invoice attached.");
  };

  const onEmailCustomerChange = (name) => {
    setEmailCustomerName(name);
    const existing = customerContacts.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (existing?.email) setEmailTo(existing.email);
  };

  const sendInvoiceEmail = async () => {
    if (!emailFile) return;
    if (!emailTo.trim()) {
      alert("Please enter at least one recipient email.");
      return;
    }

    const folderHandle = await loadAutoSaveDirectoryHandle();
    if (!folderHandle) {
      alert("Auto-save folder is not configured.");
      return;
    }

    setSendingEmail(true);
    try {
      const fileHandle = await folderHandle.getFileHandle(emailFile);
      const file = await fileHandle.getFile();
      const result = await sendGraphEmailWithAttachment({
        to: emailTo,
        cc: emailCc,
        subject: emailSubject || `Invoice - ${emailFile}`,
        body: emailBody,
        fileName: emailFile,
        blob: file,
      });

      if (result.ok) {
        const normalizedName = emailCustomerName.trim();
        if (normalizedName && emailTo.trim()) {
          const nextContacts = [...customerContacts];
          const idx = nextContacts.findIndex((c) => c.name.toLowerCase() === normalizedName.toLowerCase());
          if (idx >= 0) nextContacts[idx] = { ...nextContacts[idx], email: emailTo.trim() };
          else nextContacts.push({ name: normalizedName, email: emailTo.trim() });
          nextContacts.sort((a, b) => a.name.localeCompare(b.name));
          setCustomerContacts(nextContacts);
          saveJsonToStorage(customerContactsKey, nextContacts);
        }

        const stamp = new Date().toISOString();
        const nextLog = { ...fileSentLog, [emailFile]: stamp };
        setFileSentLog(nextLog);
        saveJsonToStorage(FILE_SENT_LOG_KEY, nextLog);
        const senderNote = result?.senderAddress ? ` from ${result.senderAddress}` : "";
        const statusNote = result?.status ? ` (Graph ${result.status})` : "";
        alert(`Email sent${senderNote}${statusNote}.`);
        setEmailSendSuccess(true);
        setTimeout(() => {
          setEmailSendSuccess(false);
          setEmailFile(null);
        }, 1200);
      } else {
        alert(emailErrorMessage(result));
      }
    } catch (err) {
      alert(`Could not send email. ${err?.message || "Please check Azure sign-in and Mail.Send consent."}`);
    } finally {
      setSendingEmail(false);
    }
  };

  const addWheelLine = () => {
    setWheelLines((prev) => {
      if (prev.length >= MAX_WHEEL_LINES) return prev;
      return [...prev, blankWheelLine()];
    });
  };

  const removeWheelLine = (index) => {
    setWheelLines((prev) => prev.filter((_, i) => i !== index));
  };

  const updateWheelLine = (index, patch) => {
    setWheelLines((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const updateWorkWithPreset = (index, work) => {
    const preset = workPresets.find((w) => w.work.toLowerCase() === work.toLowerCase());
    if (preset && toNumber(preset.rate) > 0) {
      updateWheelLine(index, { work, rate: String(preset.rate) });
    } else {
      updateWheelLine(index, { work });
    }
  };

  useEffect(() => {
    if (isWheelStyle) return;
    if (rows.length > 0) return;
    setRows([
      { DESCRIPTION: "", "HR/QTY": "", RATE: "", AMOUNT: "" },
    ]);
  }, [isWheelStyle, rows.length]);

  const addGenericRow = () => {
    setRows((prev) => [...prev, { DESCRIPTION: "", "HR/QTY": "", RATE: "", AMOUNT: "" }]);
  };

  const selectInvoiceFolder = async () => {
    if (!window.showDirectoryPicker) {
      alert("Folder selection is not available in this browser.");
      return;
    }

    try {
      const picked = await window.showDirectoryPicker();
      await saveAutoSaveDirectoryHandle(picked);
      setFolderName(picked.name || "");
      await loadFolderContents();
    } catch {
      // user canceled or selection failed
    }
  };

  const removeGenericRow = (index) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateGenericRow = (index, patch) => {
    setRows((prev) => prev.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, ...patch };
      const qty = toNumber(next["HR/QTY"]);
      const rate = toNumber(next.RATE);
      next.AMOUNT = qty && rate ? (qty * rate) : next.AMOUNT;
      return next;
    }));
  };

  return (
    <div className="page invoice-tools-page">
      <h2 className="page-title">{pageTitle}</h2>

      {showFolder && (
      <div className="settings-card win-panel">
        <h3>Existing Folder Contents</h3>
        <p>
          {folderName
            ? `Folder: ${folderName}`
            : (graphMode ? "OneDrive invoice path not configured." : "Auto-save folder not configured.")}
        </p>
        <button className="btn-secondary win-btn-secondary" onClick={loadFolderContents}>
          Refresh Folder List
        </button>
        {!folderName && !graphMode && (
          <>
            <button
              className="btn-secondary win-btn-secondary"
              onClick={selectInvoiceFolder}
              style={{ marginLeft: "8px" }}
            >
              Select invoice folder
            </button>
            <p style={{ marginTop: "10px", opacity: 0.9 }}>
              Select a local invoice folder to enable auto-save and file listing.
            </p>
          </>
        )}
        <p style={{ marginTop: "10px" }}>Click an Excel file below to load it.</p>

        <div style={{ marginTop: "10px", maxHeight: "220px", overflowY: "auto" }}>
          {folderFiles.length === 0 ? (
            <p>No files found.</p>
          ) : (
            folderFiles.map((f) => (
              <div
                className="file-list-row invoice-file-row"
                key={`${f.name}-${f.updatedAt}`}
                onClick={() => (showCreate ? openFolderFile(f) : undefined)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto",
                  gap: "10px",
                  padding: "8px 0",
                  borderBottom: "1px solid #d4d4d4",
                  fontSize: "13px",
                  cursor: showCreate ? "pointer" : "default",
                }}
              >
                <span className="file-list-name invoice-file-name" style={{ wordBreak: "break-word" }}>{f.name}</span>
                <span className="file-list-meta invoice-file-size">{(f.size / 1024).toFixed(1)} KB</span>
                <span className="file-list-actions invoice-file-actions" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span className="file-list-meta invoice-file-date">{new Date(f.updatedAt).toLocaleString()}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ width: "auto", marginTop: 0, padding: "6px 10px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      viewFolderFile(f);
                    }}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ width: "auto", marginTop: 0, padding: "6px 10px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEmailModal(f.name);
                    }}
                  >
                    Email
                  </button>
                </span>
                <span style={{ fontSize: "12px", color: "#4a4a4a" }}>
                  Last sent: {fileSentLog[f.name] ? new Date(fileSentLog[f.name]).toLocaleString() : "Never"}
                </span>
                <span>
                  {fileSentLog[f.name] ? <span className="file-sent-badge">{sentBadgeLabel(fileSentLog[f.name])}</span> : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {emailFile && (
        <div className="modal">
          <div className="modal-content">
            <h3>Email Invoice</h3>
            <p><strong>Attachment:</strong> {emailFile}</p>
            <label>Customer</label>
            <input
              value={emailCustomerName}
              onChange={(e) => onEmailCustomerChange(e.target.value)}
              placeholder="Customer name"
              list="invoice-customer-contact-options"
            />
            <datalist id="invoice-customer-contact-options">
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
            {sendingEmail && (
              <div className="email-status sending">
                <span className="mail-fly" aria-hidden="true">✉</span>
                <span>Sending email…</span>
              </div>
            )}
            {emailSendSuccess && (
              <div className="email-status sent">
                <span className="check-pop" aria-hidden="true">✓</span>
                <span>Email sent</span>
              </div>
            )}
            <div className="actions" style={{ marginTop: "14px" }}>
              <button className="btn-secondary" onClick={() => setEmailFile(null)} disabled={sendingEmail}>
                Cancel
              </button>
              <button className="btn-primary" onClick={sendInvoiceEmail} disabled={sendingEmail}>
                {sendingEmail ? "Sending..." : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
      <div className="settings-card win-panel">
        <h3>Create / Edit Invoice</h3>
        <p><strong>Loaded:</strong> {fileName || "New invoice"}</p>

        <>
          <label htmlFor="invoice-type">Invoice Type</label>
          <select id="invoice-type" value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)}>
            <option value="wheel">Wheel Repair</option>
            <option value="services">Services Rendered</option>
          </select>
        </>

        <label htmlFor="ref-est-number">Reference Estimate Number (optional)</label>
        <input
          id="ref-est-number"
          type="text"
          value={refEstNumber}
          onChange={(e) => setRefEstNumber(e.target.value)}
          placeholder="e.g. 111"
        />

        <button
          className="btn-secondary win-btn-secondary"
          onClick={exportPdf}
          style={{ marginTop: "10px" }}
        >
          Export PDF
        </button>
      </div>
      )}

      {showCreate && isWheelStyle && (
        <div className="settings-card win-panel wheel-editor-card" style={{ overflowX: "auto" }}>
          <h3>{invoiceType === "services" ? "Services Rendered Line Items" : "Wheel Repair Line Items"}</h3>
          <p>{wheelLines.length} / {MAX_WHEEL_LINES} lines</p>

          <datalist id="customer-options">
            {customerOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <datalist id="work-options">
            {workPresets.map((w) => (
              <option key={w.work} value={w.work} />
            ))}
          </datalist>

          <table className="win-table wheel-lines-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "9px 8px" }}>Customer</th>
                <th style={{ textAlign: "left", padding: "9px 8px" }}>Work Performed</th>
                <th style={{ textAlign: "left", padding: "9px 8px" }}>QTY</th>
                <th style={{ textAlign: "left", padding: "9px 8px" }}>Rate</th>
                <th style={{ textAlign: "left", padding: "9px 8px" }}>Total</th>
                <th style={{ textAlign: "left", padding: "9px 8px" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {wheelLines.map((line, i) => (
                <tr key={i}>
                  <td style={{ padding: "8px" }}>
                    <input
                      value={line.customer}
                      onChange={(e) => updateWheelLine(i, { customer: e.target.value })}
                      placeholder="Customer"
                      list="customer-options"
                    />
                  </td>
                  <td style={{ padding: "8px" }}>
                    <input
                      value={line.work}
                      onChange={(e) => updateWorkWithPreset(i, e.target.value)}
                      placeholder="Work performed"
                      list="work-options"
                    />
                  </td>
                  <td style={{ padding: "8px" }}>
                    <input
                      value={line.qty}
                      onChange={(e) => updateWheelLine(i, { qty: e.target.value })}
                      placeholder="0"
                      type="number"
                    />
                  </td>
                  <td style={{ padding: "8px" }}>
                    <input
                      value={line.rate}
                      onChange={(e) => updateWheelLine(i, { rate: e.target.value })}
                      placeholder="0.00"
                      type="number"
                      step="0.01"
                    />
                  </td>
                  <td style={{ padding: "8px" }}>{formatCurrency(wheelLineAmount(line))}</td>
                  <td style={{ padding: "8px" }}>
                    <button className="danger" onClick={() => removeWheelLine(i)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button className="btn-primary" onClick={addWheelLine} disabled={wheelLines.length >= MAX_WHEEL_LINES}>
            Add Line
          </button>

          <div style={{ marginTop: "12px" }}>
            <p><strong>Subtotal:</strong> {formatCurrency(wheelSubtotal)}</p>
            <p><strong>HST (13%):</strong> {formatCurrency(wheelHst)}</p>
            <p><strong>Total:</strong> {formatCurrency(wheelTotal)}</p>
          </div>
        </div>
      )}

    </div>
  );
}

