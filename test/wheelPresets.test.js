import test from "node:test";
import assert from "node:assert/strict";
import {
  bookFromLegacy,
  deleteWheelCustomer,
  mergeWheelBooks,
  rememberWheelLine,
  visibleCustomers,
  visibleWorks,
} from "../src/utils/wheelPresetCore.js";
import { commitWheelBook, loadSharedWheelBook, readCachedWheelBook } from "../src/utils/wheelPresets.js";

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

function installStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  return () => {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  };
}

test("wheel prices and customers merge without dropping either device", () => {
  const phone = bookFromLegacy(["Phone Shop"], [{ work: "Straighten", rate: 80 }]);
  const pc = bookFromLegacy(["PC Shop"], [{ work: "Paint", rate: 40 }]);
  const merged = mergeWheelBooks(phone, pc);
  assert.deepEqual(visibleCustomers(merged), ["PC Shop", "Phone Shop"]);
  assert.deepEqual(visibleWorks(merged), [
    { work: "Paint", rate: 40 },
    { work: "Straighten", rate: 80 },
  ]);
});

test("a newer wheel rate wins and a delete is not restored by an old copy", () => {
  const remote = rememberWheelLine(bookFromLegacy([], []), { work: "Straighten", rate: 90 }, 200);
  const older = rememberWheelLine(bookFromLegacy([], []), { work: "Straighten", rate: 80 }, 100);
  assert.equal(visibleWorks(mergeWheelBooks(remote, older))[0].rate, 90);

  const removed = deleteWheelCustomer(
    rememberWheelLine(bookFromLegacy(["Bob's Auto"], []), { customer: "Bob's Auto" }, 100),
    "Bob's Auto",
    300
  );
  const legacy = bookFromLegacy(["Bob's Auto"], []);
  assert.deepEqual(visibleCustomers(mergeWheelBooks(removed, legacy)), []);
});

test("typing a work name does not erase a saved rate when the rate box is still empty", () => {
  const saved = rememberWheelLine(bookFromLegacy([], []), { work: "Straighten", rate: 80 }, 100);
  const typed = rememberWheelLine(saved, { customer: "New Shop", work: "Straighten", rate: "" }, 150);
  assert.equal(visibleWorks(typed)[0].rate, 80);
  assert.deepEqual(visibleCustomers(typed), ["New Shop"]);
  const changed = rememberWheelLine(typed, { work: "Straighten", rate: "95" }, 180);
  assert.equal(visibleWorks(changed)[0].rate, 95);
});

test("two devices saving at once keep both wheel prices", async () => {
  const drive = createDrive(null);
  const phone = bookFromLegacy(["Phone Shop"], [{ work: "Straighten", rate: 80 }]);
  const pc = bookFromLegacy(["PC Shop"], [{ work: "Paint", rate: 40 }]);
  const [first, second] = await Promise.all([
    commitWheelBook(phone, drive),
    commitWheelBook(pc, drive),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const saved = drive.snapshot();
  assert.deepEqual(visibleCustomers(saved), ["PC Shop", "Phone Shop"]);
  assert.deepEqual(visibleWorks(saved).map((item) => item.work), ["Paint", "Straighten"]);
});

test("an older save does not overwrite a price saved a moment earlier", async () => {
  const drive = createDrive(rememberWheelLine(bookFromLegacy([], []), { work: "Straighten", rate: 90 }, 200));
  const stale = rememberWheelLine(bookFromLegacy([], []), { work: "Straighten", rate: 80 }, 100);
  const saved = await commitWheelBook(stale, drive);
  assert.equal(saved.ok, true);
  assert.equal(visibleWorks(drive.snapshot())[0].rate, 90);
});

test("the first load copies prices already saved in this browser", async () => {
  const restore = installStorage({
    wheel_customer_names: JSON.stringify(["Phone Shop"]),
    wheel_work_presets: JSON.stringify([{ work: "Straighten", rate: 80 }]),
  });
  try {
    const drive = createDrive(null);
    const loaded = await loadSharedWheelBook({ drive });
    assert.equal(loaded.shared, true);
    assert.deepEqual(visibleCustomers(drive.snapshot()), ["Phone Shop"]);
    assert.equal(visibleWorks(drive.snapshot())[0].rate, 80);
    assert.equal(visibleWorks(readCachedWheelBook())[0].work, "Straighten");
  } finally {
    restore();
  }
});
