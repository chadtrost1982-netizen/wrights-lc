import test from "node:test";
import assert from "node:assert/strict";
import {
  driveFailureMessage,
  exportResultMessage,
  invoiceFolderView,
  isStaleInteractionRecord,
  withTimeout,
} from "../src/utils/driveStatus.js";

const INVOICES = "Desktop/Business/Disposal Solutions/Invoices";

test("a failed OneDrive list still shows the configured Disposal Solutions folder", () => {
  const view = invoiceFolderView({
    graphMode: true,
    configuredPath: INVOICES,
    listed: { ok: false, reason: "auth-failed" },
  });
  assert.equal(view.folderLabel, `OneDrive: ${INVOICES}`);
  assert.match(view.detail, /Sign in again/);
  assert.equal(view.detail.includes("not configured"), false);
  assert.deepEqual(view.files, []);
});

test("the folder line is the configured path while the list is still loading", () => {
  const view = invoiceFolderView({
    graphMode: true,
    configuredPath: INVOICES,
    listed: null,
  });
  assert.equal(view.folderLabel, `OneDrive: ${INVOICES}`);
  assert.match(view.detail, /Checking OneDrive/);
  assert.equal(view.detail.includes("not configured"), false);
});

test("a successful list keeps the same folder and the files", () => {
  const files = [{ name: "Inv 523.xlsx" }];
  const view = invoiceFolderView({
    graphMode: true,
    configuredPath: INVOICES,
    listed: { ok: true, files },
  });
  assert.equal(view.folderLabel, `OneDrive: ${INVOICES}`);
  assert.equal(view.detail, "");
  assert.deepEqual(view.files, files);
});

test("without Microsoft sign-in configured, the local folder message stays", () => {
  const view = invoiceFolderView({ graphMode: false, configuredPath: INVOICES, listed: null });
  assert.equal(view.folderLabel, "");
  assert.match(view.detail, /Auto-save folder not configured/);
});

test("export tells the truth when OneDrive sign-in did not finish", () => {
  const message = exportResultMessage({
    pdfResult: { ok: false, reason: "auth-failed" },
    excelResult: { ok: false, reason: "auth-failed" },
    pdfName: "Inv 524 - Alloy Wheel - Services Rendered.pdf",
    excelName: "Inv 524 - Alloy Wheel - Services Rendered.xlsx",
  });
  assert.match(message, /Sign in again/);
  assert.match(message, /Inv 524/);
  assert.equal(message.includes("not configured"), false);
});

test("a stuck Microsoft redirect record is recognizable and a blank one is not", () => {
  assert.equal(isStaleInteractionRecord(JSON.stringify({ clientId: "app", type: "signin" })), true);
  assert.equal(isStaleInteractionRecord("not-json"), true);
  assert.equal(isStaleInteractionRecord(""), false);
  assert.equal(isStaleInteractionRecord(null), false);
});

test("a Microsoft request that never returns is reported instead of waiting forever", async () => {
  const hung = new Promise(() => {});
  await assert.rejects(withTimeout(hung, 20, "Microsoft did not answer."), (err) => {
    assert.equal(err.code, "timeout");
    assert.equal(err.name, "DriveTimeout");
    assert.match(err.message, /did not answer/);
    return true;
  });
});

test("auth and timeout messages name the sign-in button", () => {
  assert.match(driveFailureMessage("timeout"), /Sign in again/);
  assert.match(driveFailureMessage("auth-failed"), /Sign in again/);
  assert.match(driveFailureMessage("list-failed", 401), /Sign in again/);
  assert.match(driveFailureMessage("list-failed", 404), /Nothing already saved was moved/);
});
