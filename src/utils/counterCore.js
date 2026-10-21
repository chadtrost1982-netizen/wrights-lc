// Last numbers already issued. Estimate 511 and invoice 509 were each
// given to two customers, so the next documents are 512 and 510.
export const COUNTER_BASELINE = {
  estimate: 511,
  invoice: 509,
};

const ATTEMPTS = 20;

export function normalizeCounters(value) {
  const estimate = Number(value?.estimate);
  const invoice = Number(value?.invoice);
  return {
    estimate: Number.isFinite(estimate) ? estimate : COUNTER_BASELINE.estimate,
    invoice: Number.isFinite(invoice) ? invoice : COUNTER_BASELINE.invoice,
  };
}

/**
 * Reserve the next number. `drive` must compare-and-swap with etags so two
 * devices cannot take the same number. Stored values are the last number used.
 */
export async function allocateNumber(kind, { drive, local }) {
  if (kind !== "estimate" && kind !== "invoice") throw new Error("Unknown document counter.");
  const localNorm = normalizeCounters(local);

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const current = await drive.read();
    if (!current.found) {
      const seeded = {
        estimate: Math.max(COUNTER_BASELINE.estimate, localNorm.estimate),
        invoice: Math.max(COUNTER_BASELINE.invoice, localNorm.invoice),
      };
      seeded[kind] += 1;
      const written = await drive.write({ create: true, value: seeded });
      if (written?.conflict) continue;
      if (!written?.ok) throw new Error("Could not create the shared counter.");
      return seeded[kind];
    }

    const remote = normalizeCounters(current.value);
    const next = Math.max(remote[kind], localNorm[kind]) + 1;
    const value = {
      ...current.value,
      estimate: remote.estimate,
      invoice: remote.invoice,
      [kind]: next,
    };
    const written = await drive.write({ create: false, etag: current.etag, value });
    if (written?.conflict) continue;
    if (!written?.ok) throw new Error("Could not update the shared counter.");
    return next;
  }

  throw new Error("Could not reserve a number because two saves happened at once. Try again.");
}

/** Raise the last-used numbers. Never lowers them, so old documents are not reused. */
export async function setCounters(nextValues, { drive, local }) {
  const estimate = Number(nextValues?.estimate);
  const invoice = Number(nextValues?.invoice);
  if (!Number.isInteger(estimate) || estimate < 1 || !Number.isInteger(invoice) || invoice < 1) {
    return { ok: false, error: "Enter whole numbers greater than zero." };
  }

  const localNorm = normalizeCounters(local);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const current = await drive.read();
    const base = current.found
      ? normalizeCounters(current.value)
      : {
          estimate: Math.max(COUNTER_BASELINE.estimate, localNorm.estimate),
          invoice: Math.max(COUNTER_BASELINE.invoice, localNorm.invoice),
        };
    const floorEstimate = Math.max(base.estimate, localNorm.estimate);
    const floorInvoice = Math.max(base.invoice, localNorm.invoice);
    if (estimate < floorEstimate || invoice < floorInvoice) {
      return {
        ok: false,
        error: `Numbers cannot go backwards. Estimates are at ${floorEstimate} and invoices are at ${floorInvoice}.`,
        estimate: floorEstimate,
        invoice: floorInvoice,
      };
    }

    const value = {
      ...(current.found ? current.value : {}),
      estimate,
      invoice,
    };
    const written = await drive.write({
      create: !current.found,
      etag: current.etag,
      value,
    });
    if (written?.conflict) continue;
    if (!written?.ok) throw new Error("Could not save the shared counter.");
    return { ok: true, estimate, invoice };
  }

  throw new Error("Could not save the counter because it changed at the same time. Try again.");
}
