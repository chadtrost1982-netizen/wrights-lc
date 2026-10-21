import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAIL_FROM, mailFromAddress, pickAccounts } from "../src/utils/mailAccounts.js";

const chad = { username: "chadtrost@hotmail.com" };
const business = { username: "DisposalSolutions@outlook.com" };

test("mail defaults to the Disposal Solutions mailbox", () => {
  assert.equal(mailFromAddress(""), DEFAULT_MAIL_FROM);
  assert.equal(mailFromAddress(undefined), "disposalsolutions@outlook.com");
  assert.equal(mailFromAddress(" Other@example.com "), "other@example.com");
});

test("OneDrive stays on the allowlisted account when both accounts are signed in", () => {
  const picked = pickAccounts([business, chad], {
    allow: ["chadtrost@hotmail.com"],
    mailFrom: DEFAULT_MAIL_FROM,
  });
  assert.equal(picked.drive, chad);
  assert.equal(picked.mailAccount, business);
});

test("sending waits for a second sign-in and does not use the business mailbox for OneDrive", () => {
  const onlyBusiness = pickAccounts([business], {
    allow: ["chadtrost@hotmail.com"],
    mailFrom: DEFAULT_MAIL_FROM,
  });
  assert.equal(onlyBusiness.drive, null);
  assert.equal(onlyBusiness.mailAccount, business);

  const onlyChad = pickAccounts([chad], {
    allow: ["chadtrost@hotmail.com"],
    mailFrom: DEFAULT_MAIL_FROM,
  });
  assert.equal(onlyChad.drive, chad);
  assert.equal(onlyChad.mailAccount, null);
});
