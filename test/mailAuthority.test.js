import test from "node:test";
import assert from "node:assert/strict";
import {
  clearMailRedirect,
  driveAuthority,
  MAIL_AUTHORITY,
  mailRedirectPending,
  markMailRedirect,
  readAuthInteraction,
  shouldRelayAuthReturn,
} from "../src/utils/mailAuthority.js";

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

function authHash(interactionType) {
  const state = Buffer.from(JSON.stringify({
    id: "11111111-1111-1111-1111-111111111111",
    meta: { interactionType },
  })).toString("base64url");
  return `#code=auth-code&state=${state}`;
}

test("business mailbox sign-in ignores the OneDrive tenant", () => {
  assert.equal(MAIL_AUTHORITY, "https://login.microsoftonline.com/consumers");
  assert.equal(driveAuthority("common"), "https://login.microsoftonline.com/common");
  assert.equal(driveAuthority(""), "https://login.microsoftonline.com/common");
  assert.equal(
    driveAuthority("11111111-1111-1111-1111-111111111111"),
    "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111"
  );
  assert.notEqual(MAIL_AUTHORITY, driveAuthority("organizations"));
});

test("a popup reply is relayed and a Hotmail redirect is left on the app", () => {
  const popup = authHash("popup");
  const redirect = authHash("redirect");
  assert.equal(readAuthInteraction(popup, ""), "popup");
  assert.equal(shouldRelayAuthReturn(popup, "", { mailRedirectPending: false }), true);
  assert.equal(shouldRelayAuthReturn(redirect, "", { mailRedirectPending: false }), false);
  assert.equal(shouldRelayAuthReturn(redirect, "", { mailRedirectPending: true }), true);
  assert.equal(shouldRelayAuthReturn("#/estimates", ""), false);
  assert.equal(shouldRelayAuthReturn("", "?q=containers"), false);
});

test("the business-mailbox redirect flag is separate from other sign-ins", () => {
  const storage = memoryStorage();
  assert.equal(mailRedirectPending(storage), false);
  markMailRedirect(storage);
  assert.equal(mailRedirectPending(storage), true);
  clearMailRedirect(storage);
  assert.equal(mailRedirectPending(storage), false);
});
