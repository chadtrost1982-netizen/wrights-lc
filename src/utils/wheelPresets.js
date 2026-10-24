import {
  bookFromLegacy,
  booksEqual,
  emptyWheelBook,
  mergeWheelBooks,
  normalizeWheelBook,
  rememberWheelLines as rememberLinesInBook,
  visibleCustomers,
  visibleWorks,
} from "./wheelPresetCore.js";

const BOOK_KEY = "wheel_shared_presets";
const CUSTOMER_KEY = "wheel_customer_names";
const WORK_KEY = "wheel_work_presets";
const ATTEMPTS = 8;

let chain = Promise.resolve();
let driveFactory = () => null;

export function setWheelDriveFactory(factory) {
  driveFactory = typeof factory === "function" ? factory : () => null;
}

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function storage() {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function readJson(key, fallback) {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function readCachedWheelBook() {
  const cached = normalizeWheelBook(readJson(BOOK_KEY, emptyWheelBook()));
  const legacy = bookFromLegacy(readJson(CUSTOMER_KEY, []), readJson(WORK_KEY, []));
  return mergeWheelBooks(cached, legacy);
}

export function writeCachedWheelBook(book) {
  const store = storage();
  if (!store) return;
  const normalized = normalizeWheelBook(book);
  try {
    store.setItem(BOOK_KEY, JSON.stringify(normalized));
    store.setItem(CUSTOMER_KEY, JSON.stringify(visibleCustomers(normalized)));
    store.setItem(WORK_KEY, JSON.stringify(visibleWorks(normalized)));
  } catch {
    // A full browser cache should not block typing the invoice.
  }
}

function defaultDrive(drive) {
  if (drive !== undefined) return drive;
  return driveFactory();
}

async function casWrite(drive, desired) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const current = await drive.read();
    const remote = current.found ? normalizeWheelBook(current.value) : emptyWheelBook();
    const merged = mergeWheelBooks(remote, desired);
    if (current.found && booksEqual(remote, merged)) {
      writeCachedWheelBook(merged);
      return { ok: true, book: merged, shared: true };
    }
    const written = await drive.write({
      create: !current.found,
      etag: current.etag,
      value: merged,
    });
    if (written?.conflict) continue;
    if (!written?.ok) throw new Error("Could not save wheel prices on OneDrive.");
    writeCachedWheelBook(merged);
    return { ok: true, book: merged, shared: true };
  }
  throw new Error("Could not save wheel prices because they changed on another device. Try again.");
}

export async function loadSharedWheelBook({ drive } = {}) {
  return enqueue(async () => {
    const local = readCachedWheelBook();
    const resolved = defaultDrive(drive);
    if (!resolved) {
      writeCachedWheelBook(local);
      return { ok: true, book: local, shared: false };
    }
    try {
      const current = await resolved.read();
      const remote = current.found ? normalizeWheelBook(current.value) : emptyWheelBook();
      const merged = mergeWheelBooks(remote, local);
      if (!current.found || !booksEqual(remote, merged)) {
        const saved = await casWrite(resolved, merged);
        return { ...saved, ok: true };
      }
      writeCachedWheelBook(merged);
      return { ok: true, book: merged, shared: true };
    } catch (err) {
      return {
        ok: false,
        book: local,
        shared: false,
        error: err?.message || "Could not read saved wheel prices on OneDrive.",
      };
    }
  });
}

export async function commitWheelBook(book, drive) {
  return casWrite(drive, normalizeWheelBook(book));
}

export async function saveSharedWheelBook(book, { drive } = {}) {
  return enqueue(async () => {
    const desired = normalizeWheelBook(book);
    writeCachedWheelBook(desired);
    const resolved = defaultDrive(drive);
    if (!resolved) return { ok: true, book: desired, shared: false };
    try {
      return await casWrite(resolved, desired);
    } catch (err) {
      return {
        ok: false,
        book: readCachedWheelBook(),
        shared: false,
        error: err?.message || "Could not save wheel prices on OneDrive.",
      };
    }
  });
}

export async function rememberWheelLines(lines, options = {}) {
  const now = options.now || Date.now();
  const desired = rememberLinesInBook(readCachedWheelBook(), lines, now);
  if (booksEqual(readCachedWheelBook(), desired)) {
    return { ok: true, book: desired, shared: false, unchanged: true };
  }
  return saveSharedWheelBook(desired, options);
}

export { visibleCustomers, visibleWorks };
