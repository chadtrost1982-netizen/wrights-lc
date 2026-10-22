import test from "node:test";
import assert from "node:assert/strict";
import { accountEmail, classifyMailAuthError, interpretMailLogin, pickAccounts } from "../src/utils/mailAccounts.js";
import { buildPendingMail, clearPendingMailAll, readPendingMailFirst, savePendingMailAll } from "../src/utils/pendingMail.js";
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
  assert.equal(classifyMailAuthError({ errorCode: "timed_out", message: "timed_out: See https://aka.ms/msal.js.errors#timed_out" }), "timeout");
  assert.equal(classifyMailAuthError({ message: "interaction_required" }), "error");
});

test("a phone sign-in keeps the estimate in local storage so another tab can finish it", () => {
  const local = memoryStorage();
  const session = memoryStorage();
  const pending = buildPendingMail({
    kind: "estimate",
    listFileName: "Est 528 - Customer.xlsx",
    attachmentName: "Est 528 - Customer.pdf",
    to: "customer@example.com",
    subject: "Estimate",
    body: "Please find your estimate attached.",
    senderAddress: "disposalsolutions@outlook.com",
    contentBase64: "YQ==",
  });
  assert.equal(savePendingMailAll(pending, [local, session]).ok, true);
  assert.equal(readPendingMailFirst([local, session]).listFileName, "Est 528 - Customer.xlsx");
  assert.equal(readPendingMailFirst([local, session]).senderAddress, "disposalsolutions@outlook.com");
  clearPendingMailAll([session]);
  assert.equal(readPendingMailFirst([local, session]).listFileName, "Est 528 - Customer.xlsx");
  clearPendingMailAll([local, session]);
  assert.equal(readPendingMailFirst([local, session]), null);
});

test("mail failures always have a plain message and a sent file is marked", () => {
  assert.match(plainMailError(null), /not sent/i);
  assert.match(plainMailError({ reason: "wrong-mailbox", signedInAs: "chadtrost@hotmail.com" }), /chadtrost@hotmail.com/);
  const timedOut = plainMailError({
    reason: "auth-failed",
    details: "timed_out: See https://aka.ms/msal.js.errors#timed_out",
  });
  assert.match(timedOut, /did not finish in time/i);
  assert.match(timedOut, /disposalsolutions@outlook.com/);
  assert.equal(timedOut.includes("aka.ms"), false);
  assert.match(plainMailError({ reason: "send-failed", status: 403, details: "ErrorAccessDenied token_scp=Mail.Send" }), /Send mail/);
  assert.equal(plainMailError({ reason: "send-failed", status: 403, details: "token_scp=Mail.Send" }).includes("token_scp"), false);
  assert.equal(statusLine({ state: "sending", from: "disposalsolutions@outlook.com" }), "Sending from disposalsolutions@outlook.com...");
  assert.equal(statusLine({ state: "sent" }), "Sent");
  assert.match(statusLine({ state: "error", message: "" }), /not sent/i);

  const storage = memoryStorage();
  markFileSent("Est 528 - Customer.xlsx", storage, "2026-10-21T00:00:00.000Z");
  assert.equal(JSON.parse(storage.getItem(SENT_LOG_KEY))["Est 528 - Customer.xlsx"], "2026-10-21T00:00:00.000Z");
});
