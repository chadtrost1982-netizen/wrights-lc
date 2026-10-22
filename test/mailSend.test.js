import test from "node:test";
import assert from "node:assert/strict";
import { accountEmail, classifyMailAuthError, interpretMailLogin, pickAccounts } from "../src/utils/mailAccounts.js";
import { buildPendingMail, clearPendingMail, readPendingMail, savePendingMail } from "../src/utils/pendingMail.js";
import { markFileSent, plainMailError, SENT_LOG_KEY, statusLine } from "../src/utils/mailNotice.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test("a business-mailbox login is accepted and Chad's OneDrive account stays separate", () => {
  const chad = { username: "chadtrost@hotmail.com" };
  const business = {
    username: "live.com#abc",
    idTokenClaims: { preferred_username: "DisposalSolutions@outlook.com" },
  };
  assert.equal(accountEmail(business), "disposalsolutions@outlook.com");
  assert.equal(interpretMailLogin(business).ok, true);
  const wrong = interpretMailLogin(chad);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, "wrong-mailbox");
  const picked = pickAccounts([business, chad], { allow: ["chadtrost@hotmail.com"] });
  assert.equal(picked.drive, chad);
  assert.equal(picked.mailAccount, business);
});

test("popup failure decides between cancel, redirect fallback, and a visible error", () => {
  assert.equal(classifyMailAuthError({ errorCode: "popup_window_error" }), "popup-blocked");
  assert.equal(classifyMailAuthError({ errorCode: "user_cancelled" }), "cancel");
  assert.equal(classifyMailAuthError({ message: "interaction_required" }), "error");
});

test("a blocked popup keeps the estimate id so the send can resume", () => {
  const storage = memoryStorage();
  const pending = buildPendingMail({
    kind: "estimate",
    listFileName: "Est 528 - Customer.xlsx",
    attachmentName: "Est 528 - Customer.pdf",
    to: "customer@example.com",
    subject: "Estimate",
    body: "Please find your estimate attached.",
    contentBase64: "YQ==",
  });
  assert.equal(savePendingMail(pending, storage).ok, true);
  assert.equal(readPendingMail(storage).listFileName, "Est 528 - Customer.xlsx");
  clearPendingMail(storage);
  assert.equal(readPendingMail(storage), null);
});

test("mail failures always have a plain message and a sent file is marked", () => {
  assert.match(plainMailError(null), /not sent/i);
  assert.match(plainMailError({ reason: "wrong-mailbox", signedInAs: "chadtrost@hotmail.com" }), /chadtrost@hotmail.com/);
  assert.match(plainMailError({ reason: "send-failed", status: 403, details: "ErrorAccessDenied token_scp=Mail.Send" }), /Send mail/);
  assert.equal(plainMailError({ reason: "send-failed", status: 403, details: "token_scp=Mail.Send" }).includes("token_scp"), false);
  assert.equal(statusLine({ state: "sending", from: "disposalsolutions@outlook.com" }), "Sending from disposalsolutions@outlook.com...");
  assert.equal(statusLine({ state: "sent" }), "Sent");
  assert.match(statusLine({ state: "error", message: "" }), /not sent/i);

  const storage = memoryStorage();
  markFileSent("Est 528 - Customer.xlsx", storage, "2026-10-21T00:00:00.000Z");
  assert.equal(JSON.parse(storage.getItem(SENT_LOG_KEY))["Est 528 - Customer.xlsx"], "2026-10-21T00:00:00.000Z");
});
