import test from "node:test";
import assert from "node:assert/strict";
import {
  clearMailRedirect,
  clearMailRedirectAll,
  driveAuthority,
  MAIL_AUTHORITY,
  MAIL_POPUP_BRIDGE_MS,
  mailRedirectPending,
  mailRedirectPendingAny,
  markMailRedirect,
  prefersMailRedirect,
  readAuthInteraction,
  shouldRelayAuthReturn,
  shouldSendByRedirect,
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

test("a popup reply is relayed and a full-page redirect boots the app", () => {
  const popup = authHash("popup");
  const redirect = authHash("redirect");
  assert.equal(readAuthInteraction(popup, ""), "popup");
  assert.equal(shouldRelayAuthReturn(popup, ""), true);
  assert.equal(shouldRelayAuthReturn(redirect, ""), false);
  assert.equal(shouldRelayAuthReturn("#/estimates", ""), false);
  assert.equal(shouldRelayAuthReturn("", "?q=containers"), false);
});

test("a phone uses full-page sign-in and a desktop popup timeout does too", () => {
  assert.equal(prefersMailRedirect({
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit Chrome/120.0 Mobile",
  }), true);
  assert.equal(prefersMailRedirect({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  }), true);
  assert.equal(prefersMailRedirect({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
  }), false);
  assert.equal(prefersMailRedirect({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    maxTouchPoints: 10,
    coarsePointer: true,
  }), true);
  assert.equal(shouldSendByRedirect({ mobile: true, authKind: "use-redirect" }), true);
  assert.equal(shouldSendByRedirect({ mobile: false, authKind: "timeout" }), true);
  assert.equal(shouldSendByRedirect({ mobile: false, authKind: "popup-blocked" }), true);
  assert.equal(shouldSendByRedirect({ mobile: false, authKind: "user-cancelled" }), false);
  assert.equal(shouldSendByRedirect({ mobile: true, authKind: "user-cancelled" }), false);
  assert.ok(MAIL_POPUP_BRIDGE_MS >= 10 * 60 * 1000);
});

test("the business-mailbox redirect flag is separate from other sign-ins", () => {
  const storage = memoryStorage();
  assert.equal(mailRedirectPending(storage), false);
  markMailRedirect(storage);
  assert.equal(mailRedirectPending(storage), true);
  clearMailRedirect(storage);
  assert.equal(mailRedirectPending(storage), false);
  const local = memoryStorage();
  const session = memoryStorage();
  markMailRedirect(local);
  assert.equal(mailRedirectPendingAny([local, session]), true);
  clearMailRedirectAll([local, session]);
  assert.equal(mailRedirectPendingAny([local, session]), false);
});
