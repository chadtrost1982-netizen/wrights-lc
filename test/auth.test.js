import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { authorizeRequest } from "../server/auth.js";
import { handleCatalog } from "../server/http/catalog.js";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "test-key";
jwk.alg = "RS256";
jwk.use = "sig";

function tokenFor(email, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    aud: "client-id",
    iss: "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0",
    tid: "11111111-1111-1111-1111-111111111111",
    preferred_username: email,
    exp: now + 600,
    nbf: now - 10,
    ...extra,
  })).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url");
  return `${data}.${sig}`;
}

function mockRes() {
  return {
    statusCode: 0,
    body: "",
    setHeader() {},
    end(payload) {
      this.body = payload;
    },
  };
}

test("prices stay locked without a Microsoft allowlist or password", async () => {
  const res = mockRes();
  const previous = {
    ALLOWED_EMAILS: process.env.ALLOWED_EMAILS,
    VITE_ALLOWED_EMAILS: process.env.VITE_ALLOWED_EMAILS,
    APP_ACCESS_PASSWORD: process.env.APP_ACCESS_PASSWORD,
    AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
    VITE_AZURE_CLIENT_ID: process.env.VITE_AZURE_CLIENT_ID,
  };
  delete process.env.ALLOWED_EMAILS;
  delete process.env.VITE_ALLOWED_EMAILS;
  delete process.env.APP_ACCESS_PASSWORD;
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.VITE_AZURE_CLIENT_ID;
  try {
    await handleCatalog({ method: "GET", headers: {} }, res);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.includes("13300"), false);
  assert.equal(res.body.includes('"sellPrice"'), false);
});

test("allowlisted Microsoft token and the shared password can load selling prices", async () => {
  const env = {
    AZURE_CLIENT_ID: "client-id",
    ALLOWED_EMAILS: "chadtrost@hotmail.com",
    APP_ACCESS_PASSWORD: "yard-secret",
  };
  const allowed = await authorizeRequest(
    { authorization: `Bearer ${tokenFor("ChadTrost@hotmail.com")}` },
    { env, jwks: [jwk] }
  );
  assert.equal(allowed.ok, true);
  assert.equal(allowed.email, "chadtrost@hotmail.com");

  const stranger = await authorizeRequest(
    { authorization: `Bearer ${tokenFor("other@example.com")}` },
    { env, jwks: [jwk] }
  );
  assert.equal(stranger.ok, false);
  assert.equal(stranger.status, 403);

  const expired = await authorizeRequest(
    { authorization: `Bearer ${tokenFor("chadtrost@hotmail.com", { exp: 10 })}` },
    { env, jwks: [jwk] }
  );
  assert.equal(expired.ok, false);

  const password = await authorizeRequest({ "x-wrights-password": "yard-secret" }, { env });
  assert.equal(password.ok, true);
  const wrong = await authorizeRequest({ "x-wrights-password": "nope" }, { env });
  assert.equal(wrong.ok, false);

  const previous = process.env.APP_ACCESS_PASSWORD;
  process.env.APP_ACCESS_PASSWORD = "yard-secret";
  delete process.env.ALLOWED_EMAILS;
  delete process.env.VITE_ALLOWED_EMAILS;
  const res = mockRes();
  try {
    await handleCatalog({ method: "GET", headers: { "x-wrights-password": "yard-secret" } }, res);
  } finally {
    if (previous == null) delete process.env.APP_ACCESS_PASSWORD;
    else process.env.APP_ACCESS_PASSWORD = previous;
  }
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.containers.find((item) => item.name === "20ft Used").sellPrice, 3350);
  assert.equal(JSON.stringify(body).includes('"cost"'), false);
});
