import test from "node:test";
import assert from "node:assert/strict";
import { allocateNumber, setCounters } from "../src/utils/counterCore.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDrive(initial = null) {
  let etag = initial ? 1 : 0;
  let value = initial ? structuredClone(initial) : null;
  return {
    async read() {
      await delay(8);
      if (!value) return { found: false };
      return { found: true, etag: String(etag), value: structuredClone(value) };
    },
    async write({ etag: match, create, value: next }) {
      await delay(8);
      if (create) {
        if (value) return { ok: false, conflict: true };
        value = structuredClone(next);
        etag += 1;
        return { ok: true, etag: String(etag) };
      }
      if (String(match) !== String(etag)) return { ok: false, conflict: true };
      value = structuredClone(next);
      etag += 1;
      return { ok: true, etag: String(etag) };
    },
    snapshot() {
      return structuredClone(value);
    },
  };
}

test("two devices cannot take the same invoice number", async () => {
  const drive = createDrive({ estimate: 509, invoice: 509 });
  const local = { estimate: 509, invoice: 509 };
  const [first, second] = await Promise.all([
    allocateNumber("invoice", { drive, local }),
    allocateNumber("invoice", { drive, local }),
  ]);
  assert.deepEqual([first, second].sort((a, b) => a - b), [510, 511]);
  assert.equal(drive.snapshot().invoice, 511);
  assert.equal(drive.snapshot().estimate, 509);
});

test("a fresh counter starts above the duplicated estimate 511 and invoice 509", async () => {
  const drive = createDrive(null);
  const local = { estimate: 499, invoice: 491 };
  const estimate = await allocateNumber("estimate", { drive, local });
  const invoice = await allocateNumber("invoice", { drive, local });
  assert.equal(estimate, 512);
  assert.equal(invoice, 510);
  assert.deepEqual(
    { estimate: drive.snapshot().estimate, invoice: drive.snapshot().invoice },
    { estimate: 512, invoice: 510 }
  );
});

test("a higher number already used on one device is never reused", async () => {
  const drive = createDrive(null);
  const seeded = await setCounters(
    { estimate: 511, invoice: 509 },
    { drive, local: { estimate: 499, invoice: 491 } }
  );
  assert.equal(seeded.ok, true);

  const backwards = await setCounters(
    { estimate: 100, invoice: 100 },
    { drive, local: { estimate: 511, invoice: 509 } }
  );
  assert.equal(backwards.ok, false);
  assert.equal(drive.snapshot().invoice, 509);

  const fromThisDevice = await allocateNumber("invoice", {
    drive,
    local: { estimate: 511, invoice: 512 },
  });
  const fromOtherDevice = await allocateNumber("invoice", {
    drive,
    local: { estimate: 511, invoice: 509 },
  });
  assert.equal(fromThisDevice, 513);
  assert.equal(fromOtherDevice, 514);
});

test("ten overlapping creates stay unique and gap-free", async () => {
  const drive = createDrive({ estimate: 511, invoice: 509 });
  const local = { estimate: 511, invoice: 509 };
  const numbers = await Promise.all(
    Array.from({ length: 10 }, () => allocateNumber("estimate", { drive, local }))
  );
  const sorted = [...numbers].sort((a, b) => a - b);
  assert.deepEqual(sorted, [512, 513, 514, 515, 516, 517, 518, 519, 520, 521]);
  assert.equal(new Set(numbers).size, 10);
  assert.equal(drive.snapshot().invoice, 509);
});
