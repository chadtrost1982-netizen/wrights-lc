import * as XLSX from "xlsx";
import jsPDF from "jspdf";

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

export async function buildEstimatePdfFromExcelFile(file) {
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
      doc.addImage(logoDataUrl, "PNG", left, y - 24, 136, 45);
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
  doc.text("4805 8th Line", left, y + 14);
  doc.text("Beeton, ON, L0G 1A0", left, y + 28);
  doc.text("Phone 416 889 5284 / 705 707 6064", left, y + 42);
  doc.text("www.DisposalSolutions.ca", left, y + 56);

  let metaY = 126;
  doc.setFontSize(10);
  const numLabel = "Estimate #: ";
  const numValue = estimateNumber || "";
  const numWidth = doc.getTextWidth(numValue);
  doc.setFont("helvetica", "normal");
  doc.text(numValue, right - 10, metaY, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(numLabel, right - 10 - numWidth - 5, metaY, { align: "right" });
  metaY += 16;
  const dateLabel = "Date: ";
  const dateValue = estimateDate || "";
  const dateValueWidth = doc.getTextWidth(dateValue);
  doc.setFont("helvetica", "normal");
  doc.text(dateValue, right - 10, metaY, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(dateLabel, right - 10 - dateValueWidth - 15, metaY, { align: "right" });

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
  detailLines.forEach((line) => {
    if (y > 680) {
      doc.addPage();
      y = 72;
    }
    const wrapped = doc.splitTextToSize(String(line.description || ""), descriptionWidth);
    const lines = wrapped.length ? wrapped : [""];
    doc.text(lines, tableLeft, y);
    doc.text(String(line.qty || ""), qtyX, y, { align: "right" });
    doc.text(money(line.rate), rateX, y, { align: "right" });
    doc.text(money(line.amount), amountX, y, { align: "right" });
    y += Math.max(rowHeight, lines.length * 12);
  });

  y += 16;
  doc.line(qtyX - 35, y - 12, amountX + 10, y - 12);
  doc.setFont("helvetica", "normal");
  doc.text("SUB TOTAL", qtyX - 60, y, { align: "right" });
  doc.text(money(subtotal), amountX, y, { align: "right" });
  y += 16;
  doc.text("HST", qtyX - 60, y, { align: "right" });
  doc.text(money(hst), amountX, y, { align: "right" });
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL", qtyX - 60, y, { align: "right" });
  doc.text(money(total), amountX, y, { align: "right" });

  y += 24;
  if (notes) {
    if (y > 650) {
      doc.addPage();
      y = 72;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Notes:", left, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    const noteLines = doc.splitTextToSize(notes, 420);
    const maxNoteLines = Math.max(0, Math.floor((750 - y) / 12) - 4);
    noteLines.slice(0, Math.max(10, maxNoteLines)).forEach((line) => {
      if (y > 730) {
        doc.addPage();
        y = 72;
      }
      doc.text(line, left, y);
      y += 12;
    });
    y += 10;
  }

  if (y > 700) {
    doc.addPage();
    y = 72;
  }
  doc.setFont("helvetica", "bold");
  doc.text("Thank you for your business!", left + 135, y);

  return doc.output("blob");
}
