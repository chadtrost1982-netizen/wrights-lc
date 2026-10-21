import { allocateNumber, COUNTER_BASELINE, normalizeCounters, setCounters } from "./counterCore.js";
import { createCounterDrive, isGraphClientConfigured } from "./oneDriveGraph.js";

const ESTIMATE_KEY = "wrights_estimate_counter";
const INVOICE_KEY = "wrights_invoice_counter";

function storage() {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function readStored(key, fallback) {
  const raw = storage()?.getItem(key);
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function readLocalCounters() {
  return {
    estimate: readStored(ESTIMATE_KEY, COUNTER_BASELINE.estimate),
    invoice: readStored(INVOICE_KEY, COUNTER_BASELINE.invoice),
  };
}

function writeLocalCounters(value) {
  const store = storage();
  if (!store) return;
  const normalized = normalizeCounters(value);
  store.setItem(ESTIMATE_KEY, String(normalized.estimate));
  store.setItem(INVOICE_KEY, String(normalized.invoice));
}

function atLeastBaseline(local) {
  return {
    estimate: Math.max(local.estimate, COUNTER_BASELINE.estimate),
    invoice: Math.max(local.invoice, COUNTER_BASELINE.invoice),
  };
}

export async function loadDocumentCounters() {
  const local = atLeastBaseline(readLocalCounters());
  if (!isGraphClientConfigured()) return { ...local, shared: false };
  try {
    const current = await createCounterDrive().read();
    if (!current.found) return { ...local, shared: true };
    const remote = normalizeCounters(current.value);
    return {
      estimate: Math.max(remote.estimate, local.estimate),
      invoice: Math.max(remote.invoice, local.invoice),
      shared: true,
    };
  } catch (err) {
    return { ...local, shared: false, error: err?.message || "Could not read the shared counter." };
  }
}

export async function saveDocumentCounters(nextValues) {
  const local = readLocalCounters();
  if (!isGraphClientConfigured()) {
    const estimate = Number(nextValues.estimate);
    const invoice = Number(nextValues.invoice);
    const floor = atLeastBaseline(local);
    if (!Number.isInteger(estimate) || estimate < 1 || !Number.isInteger(invoice) || invoice < 1) {
      return { ok: false, error: "Enter whole numbers greater than zero." };
    }
    if (estimate < floor.estimate || invoice < floor.invoice) {
      return {
        ok: false,
        error: `Numbers cannot go backwards. Estimates are at ${floor.estimate} and invoices are at ${floor.invoice}.`,
      };
    }
    writeLocalCounters({ estimate, invoice });
    return { ok: true, shared: false, estimate, invoice };
  }

  const result = await setCounters(nextValues, { drive: createCounterDrive(), local });
  if (result.ok) writeLocalCounters(result);
  return { ...result, shared: true };
}

export async function allocateDocumentNumber(kind) {
  const local = readLocalCounters();
  if (!isGraphClientConfigured()) {
    const next = Math.max(local[kind], COUNTER_BASELINE[kind]) + 1;
    writeLocalCounters({ ...local, [kind]: next });
    return String(next);
  }
  const number = await allocateNumber(kind, { drive: createCounterDrive(), local });
  writeLocalCounters({ ...local, [kind]: number });
  return String(number);
}
