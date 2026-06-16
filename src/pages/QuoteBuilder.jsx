import { useEffect, useMemo, useRef, useState } from "react";
import { useQuoteStore } from "../store/quoteStore";
import { appDB } from "../db/appDB";
import { useSettingsStore } from "../store/settingsStore";
import { getRouteByAddress } from "../utils/routing";
import { calculateDeliveryAmount, detectDeliveryTier } from "../utils/delivery";
import AddressAutocompleteInput from "../components/AddressAutocompleteInput";
import InteractiveMap from "../components/InteractiveMap";
import { formatCurrency } from "../utils/currency";
import { geocodeAddress } from "../utils/geocode";
import ExcelJS from "exceljs";
import {
  writeBlobToEstimateFolder,
} from "../utils/autoSaveFolder";
import { clearPendingOneDriveUpload, queuePendingOneDriveUpload, uploadBlobToOneDrive } from "../utils/oneDriveGraph";

const ESTIMATE_COUNTER_KEY = "wrights_estimate_counter";
const ESTIMATE_START = 500;
const SAVED_CUSTOMERS_KEY = "wrights_saved_customers";
const SERVICE_WORK_PRESETS_KEY = "wrights_service_work_presets";
const MAX_SERVICE_LINES = 50;
const DISPOSAL_BASE_FEE = 250;
const DISPOSAL_RENTAL_DAYS = 7;
const DISPOSAL_SORTED_PER_TON = 150;
const DISPOSAL_MIXED_PER_TON = 300;
const DISPOSAL_STEEL_FLAT = 150;
const DISPOSAL_MATTRESS_EACH = 40;
const DISPOSAL_EXTRA_WEIGHT_PER_100KG = 25;
const DISPOSAL_EXTRA_DAY = 20;
const DISPOSAL_POLICY_LINES = [
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
];
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

function blankServiceLine() {
  return { customer: "", work: "", qty: "", rate: "" };
}

function toNumber(v) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function nextEstimateNumber() {
  const stored = localStorage.getItem(ESTIMATE_COUNTER_KEY);
  const current = Number.isFinite(Number(stored)) ? Number(stored) : ESTIMATE_START - 1;
  const next = current + 1;
  localStorage.setItem(ESTIMATE_COUNTER_KEY, String(next));
  return String(next);
}

export default function QuoteBuilder() {
  const { currentQuote, removeMod, clearQuote, addToQuote } = useQuoteStore();
  const {
    yardAddress,
    delivery20Rate,
    delivery20Min,
    delivery40Rate,
    delivery40Min,
    rounding,
  } = useSettingsStore();

  const [customer, setCustomer] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    distance: "",
  });
  const [savedCustomers, setSavedCustomers] = useState([]);
  const [serviceWorkPresets, setServiceWorkPresets] = useState([]);

  const [delivery, setDelivery] = useState(0);
  const [deliveryMeta, setDeliveryMeta] = useState(null);
  const [notes, setNotes] = useState("");
  const [isCalculatingDelivery, setIsCalculatingDelivery] = useState(false);
  const [isSavingQuote, setIsSavingQuote] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [routeStatus, setRouteStatus] = useState("idle");
  const [routeError, setRouteError] = useState("");
  const [yardCoords, setYardCoords] = useState(null);
  const [estimateType, setEstimateType] = useState("");
  const [disposal, setDisposal] = useState({
    qty: 1,
    rentalDays: DISPOSAL_RENTAL_DAYS,
    binRate: DISPOSAL_BASE_FEE,
    dropoffFee: 0,
    pickupFee: 0,
    wasteType: "sorted",
    wasteTons: 0,
    steelIncluded: false,
    mattressCount: 0,
    extraWeightKg: 0,
    extraDayFee: DISPOSAL_EXTRA_DAY,
  });
  const [serviceLines, setServiceLines] = useState(Array.from({ length: 8 }, () => blankServiceLine()));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_CUSTOMERS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setSavedCustomers(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSavedCustomers([]);
    }
    try {
      const raw = localStorage.getItem(SERVICE_WORK_PRESETS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setServiceWorkPresets(Array.isArray(parsed) ? parsed : []);
    } catch {
      setServiceWorkPresets([]);
    }
  }, []);

  const learnServiceWorkPresets = (lines) => {
    const next = [...serviceWorkPresets];
    lines.forEach((line) => {
      const work = String(line.work || "").trim();
      const rate = toNumber(line.rate);
      if (!work || rate <= 0) return;
      const idx = next.findIndex((p) => String(p.work || "").toLowerCase() === work.toLowerCase());
      if (idx >= 0) next[idx] = { work, rate };
      else next.push({ work, rate });
    });
    next.sort((a, b) => String(a.work).localeCompare(String(b.work)));
    setServiceWorkPresets(next);
    localStorage.setItem(SERVICE_WORK_PRESETS_KEY, JSON.stringify(next));
  };

  const applyServiceWorkWithPreset = (rowIndex, workValue) => {
    const work = String(workValue || "");
    const preset = serviceWorkPresets.find((p) => String(p.work || "").toLowerCase() === work.trim().toLowerCase());
    setServiceLines((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? { ...row, work, rate: preset && toNumber(preset.rate) > 0 ? String(preset.rate) : row.rate }
          : row
      )
    );
  };

  const buildEstimateExcelBlob = async (quote, estNumber, customerName, titleLabel) => {
    const wb = new ExcelJS.Workbook();
    const wsEst = wb.addWorksheet("Estimate");
    const wsInfo = wb.addWorksheet("Info");
    const wsData = wb.addWorksheet("Data");
    try {
      const logoDataUrl = await getLogoDataUrl();
      if (logoDataUrl) {
        const logoId = wb.addImage({ base64: logoDataUrl, extension: "png" });
        wsEst.addImage(logoId, {
          tl: { col: 0, row: 0 },
          ext: { width: 140, height: 46 },
        });
      }
    } catch {
      // Keep export working even if logo fails to load.
    }

    wsEst.columns = [{ width: 34 }, { width: 2 }, { width: 22 }, { width: 10 }, { width: 13 }, { width: 13 }];
    wsEst.addRow(["", "", "", "", ""]);
    wsEst.addRow([""]);
    wsEst.addRow(["DISPOSAL SOLUTIONS", "", "", "", ""]);
    wsEst.addRow(["o/a Wrights L.C.", "", "", "", ""]);
    wsEst.addRow(["4805 8th Line", "", "", "", ""]);
    wsEst.addRow(["Beeton, ON, L0G 1A0"]);
    wsEst.addRow(["Phone 416 889 5284 / 705 707 6064"]);
    wsEst.addRow(["www.DisposalSolutions.ca"]);
    wsEst.addRow([""]);
    wsEst.addRow(["To:", "", "For:"]);
    const toForRow = wsEst.lastRow.number;
    wsEst.addRow([
      customerName || "Customer",
      "",
      quote.estimateType === "disposal"
        ? "Disposal Bin Services"
        : quote.estimateType === "services"
          ? "Services Rendered"
        : "Container Services",
    ]);
    const customerAddressRow = wsEst.addRow([quote.customer?.address || "", "", "Estimate"]).number;
    wsEst.addRow([quote.customer?.phone || ""]);
    wsEst.addRow([""]);
    wsEst.addRow(["DESCRIPTION", "", "", "HR/QTY", "RATE", "AMOUNT"]);
    const headerRow = wsEst.lastRow.number;
    wsEst.getCell(`A${customerAddressRow}`).alignment = { wrapText: true, vertical: "top" };
    if (String(quote.customer?.address || "").length > 36) {
      wsEst.getRow(customerAddressRow).height = 32;
    }

    const detailRows = [];
    if (quote.estimateType === "disposal") {
      const wasteType = quote.disposal?.wasteType === "mixed" ? "mixed" : "sorted";
      const wasteRate = wasteType === "mixed" ? DISPOSAL_MIXED_PER_TON : DISPOSAL_SORTED_PER_TON;
      const wasteTons = Number(quote.disposal?.wasteTons || 0);
      const wasteFee = wasteTons * wasteRate;
      const steelFee = quote.disposal?.steelIncluded ? DISPOSAL_STEEL_FLAT : 0;
      const mattressCount = Number(quote.disposal?.mattressCount || 0);
      const mattressFee = mattressCount * DISPOSAL_MATTRESS_EACH;
      const extraWeightKg = Number(quote.disposal?.extraWeightKg || 0);
      const extraWeightUnits = Math.ceil(Math.max(0, extraWeightKg) / 100);
      const overweightFee = extraWeightUnits * DISPOSAL_EXTRA_WEIGHT_PER_100KG;
      detailRows.push({
        description: "14yd Disposal Bin Rental",
        qty: Number(quote.disposal?.qty || 0),
        rate: Number(quote.disposal?.binRate || 0),
        amount: Number(quote.disposal?.qty || 0) * Number(quote.disposal?.binRate || 0),
      });
      if (Number(quote.disposal?.dropoffFee || 0) > 0) {
        detailRows.push({ description: "Drop-off Fee", qty: 1, rate: Number(quote.disposal.dropoffFee), amount: Number(quote.disposal.dropoffFee) });
      }
      if (Number(quote.disposal?.pickupFee || 0) > 0) {
        detailRows.push({ description: "Pickup Fee", qty: 1, rate: Number(quote.disposal.pickupFee), amount: Number(quote.disposal.pickupFee) });
      }
      if (wasteFee > 0) {
        detailRows.push({
          description: wasteType === "mixed" ? "Mixed Waste" : "Sorted Waste",
          qty: wasteTons,
          rate: wasteRate,
          amount: wasteFee,
        });
      }
      if (steelFee > 0) {
        detailRows.push({ description: "Steel", qty: 1, rate: steelFee, amount: steelFee });
      }
      if (mattressFee > 0) {
        detailRows.push({ description: "Mattress/Box Spring", qty: mattressCount, rate: DISPOSAL_MATTRESS_EACH, amount: mattressFee });
      }
      if (overweightFee > 0) {
        detailRows.push({
          description: `Extra Weight (${extraWeightKg} kg)`,
          qty: extraWeightUnits,
          rate: DISPOSAL_EXTRA_WEIGHT_PER_100KG,
          amount: overweightFee,
        });
      }
      const extraDays = Math.max(0, Number(quote.disposal?.rentalDays || 0) - 7);
      if (extraDays > 0 && Number(quote.disposal?.extraDayFee || 0) > 0) {
        detailRows.push({
          description: `Extra Days (${extraDays})`,
          qty: extraDays,
          rate: Number(quote.disposal.extraDayFee),
          amount: extraDays * Number(quote.disposal.extraDayFee),
        });
      }
    } else if (quote.estimateType === "services") {
      (quote.serviceLines || [])
        .filter((line) => line.customer || line.work || line.qty || line.rate)
        .forEach((line) => {
          const qty = toNumber(line.qty);
          const rate = toNumber(line.rate);
          detailRows.push({
            description: `${line.customer || ""} ${line.work || ""}`.trim(),
            qty,
            rate,
            amount: qty * rate,
          });
        });
    } else if (quote.container) {
      const qty = Number(quote.container?.qty || 1);
      const deliveryAmount = Number(quote.totals.delivery || 0);
      const amount = Number(quote.totals.containerPrice || 0) + deliveryAmount;
      const rate = qty > 0 ? amount / qty : amount;
      const baseContainerName = String(quote.container?.name || "").trim() || "Container";
      const containerLabel = deliveryAmount > 0
        ? `${baseContainerName} (Delivery Included)`
        : baseContainerName;
      detailRows.push({ description: containerLabel, qty, rate, amount });
      (quote.mods || []).forEach((m) => {
        const qty = Number(m.qty || 1);
        const amount = Number(m.finalPrice || 0);
        const rate = qty > 0 ? amount / qty : amount;
        detailRows.push({ description: String(m.name || "").trim() || "Modification", qty, rate, amount });
      });
    }

    detailRows.forEach((r) => wsEst.addRow([r.description, "", "", r.qty, r.rate, r.amount]));
    wsEst.addRow([""]);
    const subtotalRow = wsEst.addRow(["", "", "", "", "SUB TOTAL", Number(quote.totals.subtotal || 0)]).number;
    const hstRow = wsEst.addRow(["", "", "", "", "HST", Number(quote.totals.hst || 0)]).number;
    const totalRow = wsEst.addRow(["", "", "", "", "TOTAL", Number(quote.totals.finalTotal || 0)]).number;
    wsEst.addRow([""]);
    if (String(quote.notes || "").trim()) {
      wsEst.addRow(["Notes:"]);
      String(quote.notes)
        .split(/\r?\n/)
        .map((line) => String(line || "").trim())
        .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
        .forEach((line) => wsEst.addRow([line]));
      wsEst.addRow([""]);
    }
    if (quote.estimateType === "disposal") {
      DISPOSAL_POLICY_LINES.forEach((line) => wsEst.addRow([line]));
      wsEst.addRow([""]);
    }
    wsEst.addRow(["", "", "Thank you for your business!"]);
    wsEst.addRow(["", "", "HST: 811718162"]);

    ["E1", "A3", "A4", "A5", "A6", "A7", "A8", "A9"].forEach((cell) => {
      wsEst.getCell(cell).font = { bold: true };
    });
    wsEst.getCell("E1").value = {
      richText: [{ text: String(titleLabel || "ESTIMATE"), font: { bold: true } }],
    };
    wsEst.getCell("A7").font = { bold: true };
    wsEst.getCell("A8").font = { bold: true };
    wsEst.getCell("A9").font = { bold: true };
    wsEst.getCell(`A${toForRow}`).font = { bold: true };
    wsEst.getCell(`C${toForRow}`).font = { bold: true };
    ["A", "D", "E", "F"].forEach((col) => {
      wsEst.getCell(`${col}${headerRow}`).font = { bold: true };
    });
    wsEst.getCell("E3").value = {
      richText: [
        { text: `${titleLabel === "INVOICE" ? "Invoice" : "Estimate"} #: `, font: { bold: true } },
        { text: String(estNumber || ""), font: { bold: false } },
      ],
    };
    wsEst.getCell("E4").value = {
      richText: [
        { text: "Date: ", font: { bold: true } },
        { text: new Date(quote.date).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }), font: { bold: false } },
      ],
    };

    wsEst.getCell(`E${subtotalRow}`).font = { bold: false };
    wsEst.getCell(`F${subtotalRow}`).font = { bold: false };
    wsEst.getCell(`E${hstRow}`).font = { bold: false };
    wsEst.getCell(`F${hstRow}`).font = { bold: false };
    wsEst.getCell(`E${totalRow}`).font = { bold: true };
    wsEst.getCell(`F${totalRow}`).font = { bold: true };

    for (let r = headerRow + 1; r <= headerRow + detailRows.length; r++) {
      wsEst.getCell(`D${r}`).numFmt = "0";
      wsEst.getCell(`E${r}`).numFmt = "$#,##0.00";
      wsEst.getCell(`F${r}`).numFmt = "$#,##0.00";
    }
    wsEst.getCell(`F${subtotalRow}`).numFmt = "$#,##0.00";
    wsEst.getCell(`F${hstRow}`).numFmt = "$#,##0.00";
    wsEst.getCell(`F${totalRow}`).numFmt = "$#,##0.00";

    wsInfo.columns = [{ width: 20 }, { width: 40 }];
    [
      ["Company", "DISPOSAL SOLUTIONS"],
      ["Operating As", "o/a Wrights L.C."],
      ["Address", "4805 8th Line, Beeton, ON, L0G 1A0"],
      ["Phone", "416 889 5284 / 705 707 6064"],
      ["Website", "www.DisposalSolutions.ca"],
      ["Email", quote.customer?.email || ""],
      ["Customer Address", quote.customer?.address || ""],
      [`${titleLabel === "INVOICE" ? "Invoice" : "Estimate"} #`, String(estNumber || "")],
      ["Date", new Date(quote.date).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })],
      ["Customer", customerName],
      [
        "Estimate Type",
        quote.estimateType === "disposal"
          ? "Disposal Bin (14yd)"
          : quote.estimateType === "services"
            ? "Services Rendered"
            : "Container",
      ],
      ["Notes", quote.notes || ""],
      ["HST #", "811718162"],
    ].forEach((row) => wsInfo.addRow(row));
    wsInfo.getColumn(1).font = { bold: true };

    wsData.columns = [{ width: 24 }, { width: 60 }, { width: 12 }, { width: 14 }, { width: 14 }];
    wsData.addRow(["TYPE", "DESCRIPTION", "QTY", "RATE", "AMOUNT"]);
    wsData.getRow(1).font = { bold: true };
    detailRows.forEach((r, idx) => {
      wsData.addRow([
        quote.estimateType === "disposal"
          ? (idx === 0 ? "Disposal Bin" : "Disposal Fee")
          : quote.estimateType === "services"
            ? "Service Line"
          : (idx === 0 ? "Container/Item" : "Item"),
        r.description,
        r.qty,
        r.rate,
        r.amount,
      ]);
    });

    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  };

  const applyMarkup = (cost) => {
    if (!cost || Number.isNaN(Number(cost))) return 0;
    const marked = Number(cost) + 150;
    return Math.round(marked / 50) * 50;
  };

  const quickContainersBySection = [
    {
      title: "10ft Containers",
      items: [
        { name: "10ft Cutdown Used - Barn Doors or Rollup", cost: 3000 },
        { name: "10ft Cutdown One Trip - Barn Doors", cost: 3350 },
        { name: "10ft Cutdown One Trip - Rollup", cost: 3550 },
        { name: "10ft Factory One Trip (new)", cost: 4300 },
      ],
    },
    {
      title: "20ft Containers",
      items: [
        { name: "20ft Construction Grade", cost: 1400 },
        { name: "20ft Mid Grade", cost: 1700 },
        { name: "20ft Handpicked Used (Residential)", cost: 1900 },
        { name: "20ft Multi-Trip (Wrinkle Walls)", cost: 2300 },
        { name: "20ft One Trip New", cost: 2400 },
        { name: "20ft One Trip (Grey)", cost: 2450 },
        { name: "20ft Double Door One Trip", cost: 3400 },
        { name: "20ft HC One Trip", cost: 3950 },
        { name: "20ft Side Door One Trip", cost: 4900 },
        { name: "20ft Full Openside One Trip", cost: 6200 },
        { name: "20ft Non-Operating Reefer", cost: "N/A" },
        { name: "20ft Used Pre-Tripped Reefer", cost: "N/A" },
        { name: "20ft HC One Trip Insulated", cost: 13300 },
      ],
    },
    {
      title: "40ft Standard Containers",
      items: [
        { name: "40ft Std Used Rough Grade", cost: 1950 },
        { name: "40ft Std Used Commercial", cost: 2200 },
        { name: "40ft Std Used Residential", cost: 2300 },
      ],
    },
    {
      title: "40ft High Cube Containers",
      items: [
        { name: "40ft HC Used Rough Grade", cost: 1850 },
        { name: "40ft HC Used Commercial", cost: 2200 },
        { name: "40ft HC Used Residential", cost: 2400 },
        { name: "40ft HC Multi-Trip (Wrinkle Walls)", cost: 3675 },
        { name: "40ft HC One Trip (Beige)", cost: 3875 },
        { name: "40ft HC Double Door Multi-Trip", cost: 4700 },
        { name: "40ft HC Double Door One Trip", cost: 5250 },
        { name: "40ft HC Side Door One Trip", cost: 7250 },
        { name: "40ft HC Non-Operating Reefer", cost: 5600 },
        { name: "40ft HC Pre-Tripped Reefer (CE Certified)", cost: 6600 },
      ],
    },
    {
      title: "Specialty Containers",
      items: [
        { name: "Office Containers (Various Builds)", cost: "N/A" },
        { name: "20ft CW Flatrack", cost: 6300 },
        { name: "40ft IICL Flatrack", cost: 8300 },
        { name: "53ft HC Heater (As-Is)", cost: 3900 },
        { name: "53ft HC Steel Used", cost: 5100 },
      ],
    },
    {
      title: "Certifications",
      items: [
        { name: "Certify & Prefix Used Container", cost: 350 },
        { name: "Certify One Trip Container", cost: 300 },
      ],
    },
  ];

  const quickModsBySection = [
    {
      title: "Roll-up Doors",
      items: [
        { name: "6ft Wide", cost: 1550 },
        { name: "8ft Wide", cost: 1750 },
        { name: "10ft Wide", cost: 1950 },
        { name: "Other Custom Sizes", cost: "Ask" },
      ],
    },
    {
      title: "Man Doors",
      items: [
        { name: '36" Steel Slab Non-Insulated', cost: 1550 },
        { name: '36" Steel Slab Insulated', cost: 1650 },
        { name: '36" Steel Slab w/ Window', cost: 2050 },
        { name: '36" Steel 3-Piece Frame', cost: 2250 },
        { name: '36" Freezer Door', cost: 4400 },
        { name: "Fire-Rated / Panel / Patio / Custom", cost: "Ask" },
      ],
    },
    {
      title: "Windows",
      items: [
        { name: '36" x 36" Sliding Window', cost: 1200 },
        { name: '48" x 36" Sliding Window', cost: 1300 },
        { name: '48" x 48" Sliding Window', cost: 1400 },
        { name: "Bars / Cage / Custom", cost: "Ask" },
      ],
    },
    {
      title: "Side Barn Doors",
      items: [
        { name: "Standard Height", cost: 2500 },
        { name: "High Cube Height", cost: 2800 },
      ],
    },
    {
      title: "Security",
      items: [
        { name: "Lockbox", cost: 150 },
        { name: "Lockbox Combo w/ Lock", cost: 175 },
        { name: "Container Lock", cost: 30 },
        { name: "Deadbolt Add-on", cost: 200 },
      ],
    },
    {
      title: "Vents",
      items: [
        { name: '12" x 12" Louver Vent (Door)', cost: 175 },
        { name: '12" x 12" Louver Vent (Side)', cost: 375 },
        { name: "Custom / Exhaust", cost: "Ask" },
      ],
    },
    {
      title: "Partition Walls",
      items: [
        { name: "Standard Height", cost: 825 },
        { name: "High Cube Height", cost: 975 },
      ],
    },
    {
      title: "Spray Foam",
      items: [
        { name: '1"', cost: "1.75/sqft" },
        { name: '2"', cost: "3.50/sqft" },
        { name: '3"', cost: "5.25/sqft" },
        { name: "Minimum Charge", cost: 1500 },
      ],
    },
    {
      title: "Painting",
      items: [
        { name: "20ft", cost: 850 },
        { name: "20ft HC", cost: 900 },
        { name: "40ft", cost: 1200 },
        { name: "40ft HC", cost: 1300 },
        { name: "45ft HC", cost: 1500 },
        { name: "53ft HC", cost: 1900 },
      ],
    },
    {
      title: "Custom Mods",
      items: [
        { name: "Cutouts", cost: "Ask" },
        { name: "Framing", cost: "Ask" },
        { name: "Electrical", cost: "Ask" },
        { name: "Cladding", cost: "Ask" },
        { name: "Steel Floor", cost: "Ask" },
        { name: "Forklift Pockets", cost: "Ask" },
        { name: "Decals", cost: "Ask" },
      ],
    },
  ];
  const requestSeq = useRef(0);

  const containerPrice = currentQuote.container
    ? Number(currentQuote.container.finalPrice) || 0
    : 0;

  const modsTotal = currentQuote.mods.reduce(
    (sum, m) => sum + (Number(m.finalPrice) || 0),
    0
  );

  const disposalWasteRate = disposal.wasteType === "mixed" ? DISPOSAL_MIXED_PER_TON : DISPOSAL_SORTED_PER_TON;
  const disposalWasteFee = Number(disposal.wasteTons || 0) * disposalWasteRate;
  const disposalSteelFee = disposal.steelIncluded ? DISPOSAL_STEEL_FLAT : 0;
  const disposalMattressFee = Number(disposal.mattressCount || 0) * DISPOSAL_MATTRESS_EACH;
  const disposalExtraWeightUnits = Math.ceil(Math.max(0, Number(disposal.extraWeightKg || 0)) / 100);
  const disposalOverweightFee = disposalExtraWeightUnits * DISPOSAL_EXTRA_WEIGHT_PER_100KG;
  const disposalBinTotal = Number(disposal.qty || 0) * Number(disposal.binRate || 0);
  const disposalExtraDayTotal = Number(disposal.extraDayFee || 0) * Math.max(0, Number(disposal.rentalDays || 0) - 7);
  const disposalSubtotal =
    disposalBinTotal +
    Number(disposal.dropoffFee || 0) +
    Number(disposal.pickupFee || 0) +
    disposalWasteFee +
    disposalSteelFee +
    disposalMattressFee +
    disposalOverweightFee +
    disposalExtraDayTotal;
  const servicesSubtotal = serviceLines.reduce(
    (sum, line) => sum + toNumber(line.qty) * toNumber(line.rate),
    0
  );

  const subtotal =
    estimateType === "disposal"
      ? disposalSubtotal
      : estimateType === "services"
        ? servicesSubtotal
        : containerPrice + modsTotal + (Number(delivery) || 0);
  const hst = Math.round(subtotal * 0.13 * 100) / 100;
  const finalTotal = subtotal + hst;

  const deliveryTier = useMemo(
    () => detectDeliveryTier(currentQuote.container),
    [currentQuote.container]
  );

  const calculateDelivery = async (silent = false) => {
    if (!customer.address.trim()) {
      if (!silent) alert("Enter a customer address first.");
      return;
    }

    const seq = ++requestSeq.current;
    setRouteStatus("loading");
    setRouteError("");
    setIsCalculatingDelivery(true);
    try {
      const result = await getRouteByAddress(yardAddress, customer.address);
      if (seq !== requestSeq.current) return;

      if (!result?.distanceKm) {
        setRouteStatus("error");
        setRouteError("Could not calculate route for that address.");
        if (!silent) alert("Could not calculate distance for that address.");
        return;
      }

      const km = Number(result.distanceKm) || 0;
      const use40 = deliveryTier === "40";
      const rate = use40 ? delivery40Rate : delivery20Rate;
      const min = use40 ? delivery40Min : delivery20Min;

      const amount = calculateDeliveryAmount(km, rate, min, rounding);
      const travelTimeMin = Number(result.durationMin) || 0;

      setCustomer((prev) => ({ ...prev, distance: String(km) }));
      setDelivery(amount);
      setDeliveryMeta({
        startAddress: yardAddress,
        endAddress: customer.address,
        startCoords: result.s || null,
        endCoords: result.e || null,
        km,
        travelTimeMin,
        tier: deliveryTier,
        rate,
        min,
        rounding,
        calculatedAmount: amount,
      });
      setRouteStatus("ready");
    } finally {
      if (seq === requestSeq.current) {
        setIsCalculatingDelivery(false);
      }
    }
  };

  useEffect(() => {
    if (estimateType !== "container") return;
    const addr = customer.address.trim();
    if (addr.length < 8) {
      setCustomer((prev) => ({ ...prev, distance: "" }));
      setDeliveryMeta(null);
      setRouteStatus("idle");
      setRouteError("");
      return;
    }

    const t = setTimeout(() => {
      calculateDelivery(true);
    }, 700);

    return () => clearTimeout(t);
  }, [customer.address, yardAddress, deliveryTier, estimateType]);

  useEffect(() => {
    let active = true;
    const loadYard = async () => {
      const coords = await geocodeAddress(yardAddress);
      if (active) setYardCoords(coords || null);
    };
    loadYard();
    return () => {
      active = false;
    };
  }, [yardAddress]);

  const saveQuote = async () => {
    if (isSavingQuote) return;
    if (!estimateType) {
      alert("Select an Estimate Type before saving.");
      return;
    }
    setIsSavingQuote(true);
    try {
      const quote = {
        estimateType,
        customer,
        container: currentQuote.container,
        mods: currentQuote.mods,
        disposal,
        serviceLines,
        delivery: Number(delivery) || 0,
        deliveryDetails: deliveryMeta,
        notes,
        totals: {
          containerPrice,
          modsTotal,
          delivery: Number(delivery) || 0,
          subtotal,
          hst,
          finalTotal,
        },
        date: new Date().toISOString(),
      };

      const fullName = `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
      if (fullName) {
        const next = [...savedCustomers];
        const idx = next.findIndex((c) => String(c.name || "").toLowerCase() === fullName.toLowerCase());
        const profile = {
          name: fullName,
          firstName: customer.firstName || "",
          lastName: customer.lastName || "",
          email: customer.email || "",
          phone: customer.phone || "",
          address: customer.address || "",
        };
        if (idx >= 0) next[idx] = profile;
        else next.push(profile);
        next.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        setSavedCustomers(next);
        localStorage.setItem(SAVED_CUSTOMERS_KEY, JSON.stringify(next));
      }
      if (estimateType === "services") {
        learnServiceWorkPresets(serviceLines);
      }

      await appDB.quotes.add(quote);

      const customerName = `${quote.customer?.firstName || ""} ${quote.customer?.lastName || ""}`.trim() || "Customer";
      const safeName = customerName.replace(/[\\/:*?"<>|]/g, "").trim() || "Customer";
      const estNumber = nextEstimateNumber();

      const quoteExcelBlob = await buildEstimateExcelBlob(quote, estNumber, customerName, "ESTIMATE");
      const quoteExcelFile = `Est ${estNumber} - ${safeName}.xlsx`;
      await queuePendingOneDriveUpload(quoteExcelFile, quoteExcelBlob, "estimate");
      const graphSaved = await uploadBlobToOneDrive(quoteExcelFile, quoteExcelBlob, "estimate");
      if (graphSaved.ok) clearPendingOneDriveUpload();
      let excelAutoSave = graphSaved;
      if (!excelAutoSave.ok) excelAutoSave = await writeBlobToEstimateFolder(quoteExcelFile, quoteExcelBlob);

      if (graphSaved.ok) {
        const graphLocation = graphSaved.parentPath
          ? `${graphSaved.parentPath.replace("/drive/root:", "")}/${graphSaved.name}`
          : `${quoteExcelFile}`;
        alert(`File saved to OneDrive: ${graphLocation}`);
      } else if (excelAutoSave.ok) {
        alert(`File saved to selected local folder: ${quoteExcelFile}`);
      } else {
        if (graphSaved.reason === "not-configured") {
          alert("Estimate path is not configured. Set VITE_ONEDRIVE_ESTIMATES_PATH in Vercel and redeploy.");
        } else {
          alert("Estimate saved locally in app data. Estimates folder is not configured.");
        }
      }
      clearQuote();
    } catch (error) {
      const msg = error?.message || String(error || "Unknown save error");
      alert(`Could not save estimate. ${msg}`);
    } finally {
      setIsSavingQuote(false);
    }
  };

  const handleQuickContainerChange = (e) => {
    const selectedName = e.target.value;
    if (!selectedName) return;
    const allContainers = quickContainersBySection.flatMap((section) => section.items);
    const chosen = allContainers.find((c) => c.name === selectedName);
    if (!chosen) return;
    if (typeof chosen.cost !== "number") return;

    addToQuote({
      type: "container",
      name: chosen.name,
      qty: 1,
      cost: chosen.cost,
      finalPrice: applyMarkup(chosen.cost),
      notes: "",
    });
  };

  const handleQuickModChange = (e) => {
    const selectedName = e.target.value;
    if (!selectedName) return;
    const allMods = quickModsBySection.flatMap((section) => section.items);
    const chosen = allMods.find((m) => m.name === selectedName);
    if (!chosen) return;
    if (typeof chosen.cost !== "number") return;

    addToQuote({
      type: "mod",
      name: chosen.name,
      qty: 1,
      cost: chosen.cost,
      finalPrice: applyMarkup(chosen.cost),
      notes: "",
    });

    e.target.value = "";
  };

  const handleClearQuote = () => {
    setShowClearConfirm(true);
  };

  const confirmClearQuote = () => {
    clearQuote();
    setEstimateType("");
    setCustomer({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      address: "",
      distance: "",
    });
    setDisposal({
      qty: 1,
      rentalDays: DISPOSAL_RENTAL_DAYS,
      binRate: DISPOSAL_BASE_FEE,
      dropoffFee: 0,
      pickupFee: 0,
      wasteType: "sorted",
      wasteTons: 0,
      steelIncluded: false,
      mattressCount: 0,
      extraWeightKg: 0,
      extraDayFee: DISPOSAL_EXTRA_DAY,
    });
    setServiceLines(Array.from({ length: 8 }, () => blankServiceLine()));
    setDelivery(0);
    setDeliveryMeta(null);
    setNotes("");
    setRouteStatus("idle");
    setRouteError("");
    setShowClearConfirm(false);
  };

  return (
    <div className="page">
      <h1 className="page-title">Estimate</h1>

      <div className="quote-builder-layout">
        <div className="quote-builder-left">
          <h2 className="section-title">Customer Info</h2>
          <div className="customer-row compact-row">
            <select
              id="estimate-type-select"
              className="estimate-type-compact"
              value={estimateType}
              onChange={(e) => setEstimateType(e.target.value)}
            >
              <option value="" disabled>Estimate Type</option>
              <option value="container">Container</option>
              <option value="disposal">Disposal Bin (14yd)</option>
              <option value="services">Services Rendered</option>
            </select>
            <input
              type="number"
              className="distance-compact"
              placeholder="Distance (km)"
              value={customer.distance}
              onChange={(e) => setCustomer({ ...customer, distance: e.target.value })}
            />
          </div>
          <datalist id="saved-first-names">
            {[...new Set(savedCustomers.map((c) => c.firstName).filter(Boolean))].map((first) => (
              <option key={first} value={first} />
            ))}
          </datalist>

          <div className="customer-row">
            <input
              placeholder="First Name"
              value={customer.firstName}
              list="saved-first-names"
              onChange={(e) => {
                const first = e.target.value;
                const found = savedCustomers.find(
                  (c) => String(c.firstName || "").toLowerCase() === first.trim().toLowerCase()
                );
                if (!found) {
                  setCustomer({ ...customer, firstName: first });
                  return;
                }
                setCustomer((prev) => ({
                  ...prev,
                  firstName: found.firstName || first,
                  lastName: found.lastName || prev.lastName,
                  email: found.email || prev.email,
                  phone: found.phone || prev.phone,
                  address: found.address || prev.address,
                }));
              }}
            />

            <input
              placeholder="Last Name"
              value={customer.lastName}
              onChange={(e) => setCustomer({ ...customer, lastName: e.target.value })}
            />
          </div>

          <div className="customer-row">
            <input
              placeholder="Email"
              value={customer.email || ""}
              onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
            />

            <input
              placeholder="Phone"
              value={customer.phone}
              onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
            />
          </div>

          <AddressAutocompleteInput
            value={customer.address}
            onChange={(address) => setCustomer({ ...customer, address })}
            placeholder="Address"
          />

          {estimateType === "container" && (
            <>
              <h2 className="section-title">Selected Container</h2>

          <div className="quick-container-field">
            <label htmlFor="quick-container-select">Quick Select Container</label>
            <select
              id="quick-container-select"
              value={currentQuote.container?.name || ""}
              onChange={handleQuickContainerChange}
            >
              <option value="">Choose container...</option>
              {quickContainersBySection.map((section) => (
                <optgroup key={section.title} label={section.title}>
                  {section.items.map((c) => (
                    <option
                      key={`${section.title}-${c.name}`}
                      value={c.name}
                      disabled={typeof c.cost !== "number"}
                    >
                      {c.name} {typeof c.cost === "number" ? `- ${formatCurrency(applyMarkup(c.cost))}` : `- ${c.cost}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {currentQuote.container ? (
            <div className="quote-card">
              <h3>{currentQuote.container.name}</h3>
              <p>Qty: {currentQuote.container.qty}</p>
              <p>Price: {formatCurrency(currentQuote.container.finalPrice)}</p>
              <p>Delivery Tier: {deliveryTier}ft</p>
            </div>
          ) : (
            <p className="empty-text">No container selected yet.</p>
          )}

              <h2 className="section-title">Selected Modifications</h2>

          <div className="quick-container-field">
            <label htmlFor="quick-mod-select">Quick Select Modification</label>
            <select id="quick-mod-select" defaultValue="" onChange={handleQuickModChange}>
              <option value="">Choose modification...</option>
              {quickModsBySection.map((section) => (
                <optgroup key={section.title} label={section.title}>
                  {section.items.map((m) => (
                    <option key={`${section.title}-${m.name}`} value={m.name} disabled={typeof m.cost !== "number"}>
                      {m.name} {typeof m.cost === "number" ? `- ${formatCurrency(applyMarkup(m.cost))}` : `- ${m.cost}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

              {currentQuote.mods.length > 0 ? (
                currentQuote.mods.map((mod, index) => (
                  <div key={index} className="quote-card">
                    <h3>{mod.name}</h3>
                    <p>Qty: {mod.qty}</p>
                    <p>Price: {formatCurrency(mod.finalPrice)}</p>
                    <button className="remove-btn" onClick={() => removeMod(index)}>
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <p className="empty-text">No modifications added yet.</p>
              )}
            </>
          )}

          {estimateType === "disposal" && (
            <>
              <h2 className="section-title">Disposal Bin (14yd)</h2>
              <label>Quantity of Bins</label>
              <input type="number" placeholder="Qty" value={disposal.qty} onChange={(e) => setDisposal({ ...disposal, qty: Number(e.target.value) || 0 })} />
              <label>Rental Period (days)</label>
              <input type="number" placeholder="Rental Days" value={disposal.rentalDays} onChange={(e) => setDisposal({ ...disposal, rentalDays: Number(e.target.value) || 0 })} />
              <label>Base Fee (per bin)</label>
              <input type="number" placeholder="Base Fee" value={disposal.binRate} onChange={(e) => setDisposal({ ...disposal, binRate: Number(e.target.value) || 0 })} />
              <label>Drop-off Fee</label>
              <input type="number" placeholder="Drop-off Fee" value={disposal.dropoffFee} onChange={(e) => setDisposal({ ...disposal, dropoffFee: Number(e.target.value) || 0 })} />
              <label>Pickup Fee</label>
              <input type="number" placeholder="Pickup Fee" value={disposal.pickupFee} onChange={(e) => setDisposal({ ...disposal, pickupFee: Number(e.target.value) || 0 })} />
              <label>Waste Type</label>
              <select value={disposal.wasteType} onChange={(e) => setDisposal({ ...disposal, wasteType: e.target.value })}>
                <option value="sorted">Sorted Waste ({formatCurrency(DISPOSAL_SORTED_PER_TON)}/ton)</option>
                <option value="mixed">Mixed Waste ({formatCurrency(DISPOSAL_MIXED_PER_TON)}/ton)</option>
              </select>
              <label>Waste Weight (tons)</label>
              <input type="number" step="0.01" placeholder="Waste Tons" value={disposal.wasteTons} onChange={(e) => setDisposal({ ...disposal, wasteTons: Number(e.target.value) || 0 })} />
              <label className="disposal-steel-row">
                <input type="checkbox" checked={Boolean(disposal.steelIncluded)} onChange={(e) => setDisposal({ ...disposal, steelIncluded: e.target.checked })} />
                Steel ({formatCurrency(DISPOSAL_STEEL_FLAT)} flat)
              </label>
              <label>Mattress / Box Spring (qty)</label>
              <input type="number" placeholder="Mattress / Box Spring Qty" value={disposal.mattressCount} onChange={(e) => setDisposal({ ...disposal, mattressCount: Number(e.target.value) || 0 })} />
              <label>Extra Weight (kg)</label>
              <input type="number" placeholder="Extra Weight (kg)" value={disposal.extraWeightKg} onChange={(e) => setDisposal({ ...disposal, extraWeightKg: Number(e.target.value) || 0 })} />
              <label>Extra Day Fee (after 7 days)</label>
              <input type="number" placeholder="Extra Day Fee (after 7 days)" value={disposal.extraDayFee} onChange={(e) => setDisposal({ ...disposal, extraDayFee: Number(e.target.value) || 0 })} />
            </>
          )}

          {estimateType === "services" && (
            <>
              <h2 className="section-title">Services Rendered</h2>
              <datalist id="service-work-options">
                {serviceWorkPresets.map((p) => (
                  <option key={p.work} value={p.work} />
                ))}
              </datalist>
              <table className="win-table wheel-lines-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "9px 8px" }}>Customer</th>
                    <th style={{ textAlign: "left", padding: "9px 8px" }}>Work Performed</th>
                    <th style={{ textAlign: "left", padding: "9px 8px" }}>QTY</th>
                    <th style={{ textAlign: "left", padding: "9px 8px" }}>Rate</th>
                    <th style={{ textAlign: "left", padding: "9px 8px" }}>Amount</th>
                    <th style={{ textAlign: "left", padding: "9px 8px" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceLines.map((line, i) => (
                    <tr key={i}>
                      <td style={{ padding: "8px" }}>
                        <input
                          value={line.customer}
                          onChange={(e) => setServiceLines((prev) => prev.map((row, idx) => idx === i ? { ...row, customer: e.target.value } : row))}
                          placeholder="Customer"
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          value={line.work}
                          list="service-work-options"
                          onChange={(e) => applyServiceWorkWithPreset(i, e.target.value)}
                          placeholder="Work performed"
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          value={line.qty}
                          onChange={(e) => setServiceLines((prev) => prev.map((row, idx) => idx === i ? { ...row, qty: e.target.value } : row))}
                          placeholder="0"
                          type="number"
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          value={line.rate}
                          onChange={(e) => setServiceLines((prev) => prev.map((row, idx) => idx === i ? { ...row, rate: e.target.value } : row))}
                          placeholder="0.00"
                          type="number"
                          step="0.01"
                        />
                      </td>
                      <td style={{ padding: "8px" }}>{formatCurrency(toNumber(line.qty) * toNumber(line.rate))}</td>
                      <td style={{ padding: "8px" }}>
                        <button
                          className="danger"
                          onClick={() => setServiceLines((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="btn-primary"
                onClick={() => setServiceLines((prev) => prev.length >= MAX_SERVICE_LINES ? prev : [...prev, blankServiceLine()])}
                disabled={serviceLines.length >= MAX_SERVICE_LINES}
              >
                Add Line
              </button>
            </>
          )}

          <h2 className="section-title">Delivery</h2>
          <input
            type="number"
            placeholder="Delivery Charge"
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
            disabled={estimateType !== "container"}
          />
          <button
            className="btn-primary"
            onClick={() => calculateDelivery(false)}
            disabled={isCalculatingDelivery || estimateType !== "container"}
          >
            {isCalculatingDelivery ? "Calculating..." : "Recalculate Delivery"}
          </button>

          <h2 className="section-title">Notes</h2>
          <textarea
            className="estimate-notes"
            placeholder="Additional notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <h2 className="section-title">Totals</h2>
          {estimateType === "container" ? (
            <>
              <p>Container: {formatCurrency(containerPrice)}</p>
              <p>Mods Total: {formatCurrency(modsTotal)}</p>
              <p>Delivery: {formatCurrency(delivery)}</p>
            </>
          ) : estimateType === "disposal" ? (
            <>
              <p>14yd Bin Rental: {formatCurrency(disposalBinTotal)}</p>
              <p>Drop-off: {formatCurrency(disposal.dropoffFee)}</p>
              <p>Pickup: {formatCurrency(disposal.pickupFee)}</p>
              <p>{disposal.wasteType === "mixed" ? "Mixed Waste" : "Sorted Waste"}: {formatCurrency(disposalWasteFee)}</p>
              <p>Steel (flat): {formatCurrency(disposalSteelFee)}</p>
              <p>Mattress/Box Spring: {formatCurrency(disposalMattressFee)}</p>
              <p>Extra Weight: {formatCurrency(disposalOverweightFee)}</p>
              <p>Extra Days: {formatCurrency(disposalExtraDayTotal)}</p>
            </>
          ) : (
            <>
              <p>Service Lines: {serviceLines.length}</p>
            </>
          )}
          <p>Subtotal: {formatCurrency(subtotal)}</p>
          <p>HST (13%): {formatCurrency(hst)}</p>

          <h2 className="final-total">Final Total: {formatCurrency(finalTotal)}</h2>

          <button className="btn-primary" onClick={saveQuote} disabled={isSavingQuote}>
            {isSavingQuote ? "Saving..." : "Save Quote"}
          </button>
        </div>

        <div className="quote-builder-right">
          <button className="btn-secondary" onClick={handleClearQuote}>
            Clear Quote
          </button>

          <div className="settings-card route-summary-card">
            <h3 className="route-title">Fastest Route</h3>
            <p className="route-line"><strong>Destination:</strong> {deliveryMeta?.endAddress || "-"}</p>
            <p className="route-line"><strong>Distance:</strong> {customer.distance ? `${customer.distance} km` : "-"}</p>
            <p className="route-line">
              <strong>Travel Time:</strong>{" "}
              {deliveryMeta?.travelTimeMin ? `${Math.floor(deliveryMeta.travelTimeMin / 60)}h ${deliveryMeta.travelTimeMin % 60}m` : "-"}
            </p>
            {estimateType === "container" && routeStatus === "loading" && <p className="route-line">Calculating fastest route...</p>}
            {routeStatus === "error" && <p className="route-line" style={{ color: "#fca5a5" }}>{routeError}</p>}
          </div>

          <InteractiveMap
            mapId="quote-builder-map"
            height={560}
            startCoords={
              routeStatus === "ready" && deliveryMeta?.startCoords
                ? [deliveryMeta.startCoords.lat, deliveryMeta.startCoords.lon]
                : yardCoords
                  ? [yardCoords.lat, yardCoords.lon]
                  : undefined
            }
            endCoords={
              routeStatus === "ready" && deliveryMeta?.endCoords
                ? [deliveryMeta.endCoords.lat, deliveryMeta.endCoords.lon]
                : undefined
            }
            startLabel={`Yard: ${yardAddress}`}
            endLabel={`Customer: ${deliveryMeta?.endAddress || ""}`}
          />
        </div>
      </div>

      {showClearConfirm && (
        <div className="modal" onClick={() => setShowClearConfirm(false)}>
          <div className="modal-content clear-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="clear-confirm-title">Clear This Quote?</h3>
            <div className="clear-confirm-icon" aria-hidden="true">
              <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
                <defs>
                  <linearGradient id="faceFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#fff7f7" />
                    <stop offset="100%" stopColor="#ffdede" />
                  </linearGradient>
                </defs>
                <circle cx="32" cy="32" r="28" fill="url(#faceFill)" />
                <circle cx="22.5" cy="25" r="3.2" fill="#7f1d1d" />
                <circle cx="41.5" cy="25" r="3.2" fill="#7f1d1d" />
                <path
                  d="M20 46c3.2-6 8.1-9 12-9s8.8 3 12 9"
                  fill="none"
                  stroke="#9f1239"
                  strokeWidth="3.4"
                  strokeLinecap="round"
                />
                <circle cx="22" cy="24" r="1.1" fill="#fff" opacity="0.9" />
                <circle cx="41" cy="24" r="1.1" fill="#fff" opacity="0.9" />
              </svg>
            </div>
            <p className="clear-confirm-copy">
              This will remove the selected container, modifications, and unsaved
              quote details.
            </p>
            <button className="btn-primary clear-confirm-danger" onClick={confirmClearQuote}>
              Yes, Clear Quote
            </button>
            <button
              className="btn-secondary clear-confirm-cancel"
              onClick={() => setShowClearConfirm(false)}
              style={{ marginTop: "10px", width: "92%", marginLeft: "4%" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
