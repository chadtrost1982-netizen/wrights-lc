export function emptyWheelBook() {
  return { customers: [], works: [] };
}

export function customerKey(name) {
  return String(name || "").trim().toLowerCase();
}

export function workKey(work) {
  return String(work || "").trim().toLowerCase();
}

function asTime(value) {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 ? time : 0;
}

function collapse(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || item.updatedAt > prev.updatedAt) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

export function normalizeWheelBook(value) {
  const customers = Array.isArray(value?.customers) ? value.customers : [];
  const works = Array.isArray(value?.works) ? value.works : [];
  return {
    customers: collapse(customers.map((item) => {
      const name = String(typeof item === "string" ? item : item?.name || "").trim();
      return {
        name,
        updatedAt: asTime(item?.updatedAt),
        deleted: Boolean(item?.deleted),
      };
    }), (item) => customerKey(item.name)),
    works: collapse(works.map((item) => {
      const work = String(item?.work || "").trim();
      const rate = Number(item?.rate);
      return {
        work,
        rate: Number.isFinite(rate) && rate > 0 ? rate : 0,
        updatedAt: asTime(item?.updatedAt),
        deleted: Boolean(item?.deleted),
      };
    }), (item) => workKey(item.work)),
  };
}

export function bookFromLegacy(customers = [], works = []) {
  return normalizeWheelBook({
    customers: (Array.isArray(customers) ? customers : []).map((name) => ({
      name,
      updatedAt: 0,
      deleted: false,
    })),
    works: (Array.isArray(works) ? works : []).map((item) => ({
      work: item?.work,
      rate: item?.rate,
      updatedAt: 0,
      deleted: false,
    })),
  });
}

export function mergeWheelBooks(base, incoming) {
  const left = normalizeWheelBook(base);
  const right = normalizeWheelBook(incoming);
  return {
    customers: collapse([...left.customers, ...right.customers], (item) => customerKey(item.name)),
    works: collapse([...left.works, ...right.works], (item) => workKey(item.work)),
  };
}

export function booksEqual(left, right) {
  return JSON.stringify(normalizeWheelBook(left)) === JSON.stringify(normalizeWheelBook(right));
}

export function visibleCustomers(book) {
  return normalizeWheelBook(book).customers
    .filter((item) => !item.deleted)
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
}

export function visibleWorks(book) {
  return normalizeWheelBook(book).works
    .filter((item) => !item.deleted)
    .map((item) => ({ work: item.work, rate: item.rate }))
    .sort((a, b) => a.work.localeCompare(b.work));
}

function withCustomer(book, name, now, deleted) {
  const key = customerKey(name);
  const customers = book.customers.filter((item) => customerKey(item.name) !== key);
  customers.push({ name: String(name).trim(), updatedAt: asTime(now) || now, deleted });
  return normalizeWheelBook({ ...book, customers });
}

function withWork(book, work, rate, now, deleted) {
  const key = workKey(work);
  const works = book.works.filter((item) => workKey(item.work) !== key);
  const safeRate = Number(rate);
  works.push({
    work: String(work).trim(),
    rate: Number.isFinite(safeRate) && safeRate > 0 ? safeRate : 0,
    updatedAt: asTime(now) || now,
    deleted,
  });
  return normalizeWheelBook({ ...book, works });
}

export function rememberWheelLine(book, line, now = Date.now()) {
  const source = normalizeWheelBook(book);
  const customer = String(line?.customer || "").trim();
  const work = String(line?.work || "").trim();
  const rate = Number(line?.rate);
  let next = source;

  if (customer) {
    const existing = source.customers.find((item) => customerKey(item.name) === customerKey(customer));
    if (!existing || existing.deleted || existing.name !== customer) {
      next = withCustomer(next, customer, now, false);
    }
  }

  if (work) {
    const existing = next.works.find((item) => workKey(item.work) === workKey(work));
    const positive = Number.isFinite(rate) && rate > 0;
    if (!existing) {
      next = withWork(next, work, positive ? rate : 0, now, false);
    } else if (existing.deleted || (positive && existing.rate !== rate) || existing.work !== work) {
      next = withWork(next, work, positive ? rate : existing.rate, now, false);
    }
  }

  return next;
}

export function rememberWheelLines(book, lines, now = Date.now()) {
  return (Array.isArray(lines) ? lines : []).reduce(
    (current, line) => rememberWheelLine(current, line, now),
    normalizeWheelBook(book)
  );
}

export function editWheelCustomer(book, previousName, nextName, now = Date.now()) {
  const name = String(nextName || "").trim();
  if (!name) return normalizeWheelBook(book);
  let next = normalizeWheelBook(book);
  const previous = customerKey(previousName);
  if (previous && previous !== customerKey(name)) {
    next = withCustomer(next, previousName, now, true);
  }
  return withCustomer(next, name, now, false);
}

export function deleteWheelCustomer(book, name, now = Date.now()) {
  if (!customerKey(name)) return normalizeWheelBook(book);
  return withCustomer(normalizeWheelBook(book), name, now, true);
}

export function editWheelWork(book, previousWork, nextWork, rate, now = Date.now()) {
  const name = String(nextWork || "").trim();
  if (!name) return normalizeWheelBook(book);
  let next = normalizeWheelBook(book);
  const previous = workKey(previousWork);
  if (previous && previous !== workKey(name)) {
    next = withWork(next, previousWork, 0, now, true);
  }
  const existing = next.works.find((item) => workKey(item.work) === workKey(name));
  const safeRate = Number(rate);
  const storedRate = Number.isFinite(safeRate) && safeRate >= 0 ? safeRate : 0;
  if (
    existing
    && !existing.deleted
    && existing.work === name
    && existing.rate === (storedRate > 0 ? storedRate : 0)
    && previous === workKey(name)
  ) {
    return next;
  }
  return withWork(next, name, storedRate, now, false);
}

export function deleteWheelWork(book, work, now = Date.now()) {
  if (!workKey(work)) return normalizeWheelBook(book);
  const existing = normalizeWheelBook(book).works.find((item) => workKey(item.work) === workKey(work));
  return withWork(normalizeWheelBook(book), work, existing?.rate || 0, now, true);
}
