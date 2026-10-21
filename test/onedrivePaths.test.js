import test from "node:test";
import assert from "node:assert/strict";
import { ensureDriveFolder } from "../src/utils/ensureDriveFolder.js";
import {
  DEFAULT_COUNTERS_PATH,
  DEFAULT_ESTIMATES_PATH,
  DEFAULT_INVOICES_PATH,
  parentDriveFolder,
  resolveCountersPath,
  resolveOneDriveFolder,
} from "../src/utils/oneDrivePaths.js";

test("new invoices and estimates default to Disposal Solutions on the Desktop", () => {
  assert.equal(resolveOneDriveFolder("estimate", {}), DEFAULT_ESTIMATES_PATH);
  assert.equal(resolveOneDriveFolder("invoice", {}), DEFAULT_INVOICES_PATH);
  assert.equal(DEFAULT_ESTIMATES_PATH, "Desktop/Business/Disposal Solutions/Estimates");
  assert.equal(DEFAULT_INVOICES_PATH, "Desktop/Business/Disposal Solutions/Invoices");
  assert.equal(resolveCountersPath({}), DEFAULT_COUNTERS_PATH);
  assert.equal(parentDriveFolder(DEFAULT_COUNTERS_PATH), "Desktop/Business/Disposal Solutions");
});

test("a leftover Wrights L.C. legacy path does not receive new files", () => {
  const legacy = { legacy: "Business/WRIGHTS LC/Invoices" };
  assert.equal(resolveOneDriveFolder("invoice", legacy), DEFAULT_INVOICES_PATH);
  assert.equal(resolveOneDriveFolder("estimate", legacy), DEFAULT_ESTIMATES_PATH);
});

test("saving creates only the missing Disposal Solutions folders", async () => {
  const created = [];
  const existing = new Set(["Desktop", "Desktop/Business"]);
  const fetchImpl = async (url, options = {}) => {
    assert.equal(url.includes("WRIGHTS"), false);
    if (!options.method || options.method === "GET") {
      const path = decodeURIComponent(url.split("/root:/")[1] || "");
      if (existing.has(path)) {
        return { ok: true, status: 200, json: async () => ({ folder: {} }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const body = JSON.parse(options.body);
    created.push(body.name);
    assert.equal(body.folder !== undefined, true);
    return { ok: true, status: 201, json: async () => ({}) };
  };

  const result = await ensureDriveFolder(fetchImpl, {
    graphEndpoint: "https://graph.microsoft.com/v1.0",
    token: "token",
    folderPath: DEFAULT_INVOICES_PATH,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(created, ["Disposal Solutions", "Invoices"]);
});

test("explicit Vercel folder paths still override the defaults", () => {
  assert.equal(
    resolveOneDriveFolder("invoice", { invoices: "/Business/WRIGHTS LC/Invoices/" }),
    "Business/WRIGHTS LC/Invoices"
  );
  assert.equal(
    resolveOneDriveFolder("estimate", { estimates: "Desktop/Business/Disposal Solutions/Estimates" }),
    DEFAULT_ESTIMATES_PATH
  );
});
