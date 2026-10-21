import crypto from "node:crypto";

const JWKS_URL = "https://login.microsoftonline.com/common/discovery/v2.0/keys";
const CLOCK_SKEW_SEC = 5 * 60;

let jwksCache = { fetchedAt: 0, keys: [] };

function allowlistFrom(env) {
  return String(env.ALLOWED_EMAILS || env.VITE_ALLOWED_EMAILS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function clientIdFrom(env) {
  return String(env.AZURE_CLIENT_ID || env.VITE_AZURE_CLIENT_ID || "").trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function decodePart(part) {
  const pad = part + "=".repeat((4 - (part.length % 4)) % 4);
  const json = Buffer.from(pad.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json);
}

function emailFromClaims(claims) {
  return String(claims.preferred_username || claims.email || claims.upn || "")
    .trim()
    .toLowerCase();
}

async function loadJwks(fetchImpl, force) {
  if (!force && jwksCache.keys.length && Date.now() - jwksCache.fetchedAt < 6 * 60 * 60 * 1000) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new Error("signing-keys");
  const body = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { fetchedAt: Date.now(), keys };
  return keys;
}

export function resetAuthCacheForTests() {
  jwksCache = { fetchedAt: 0, keys: [] };
}

export async function verifyMicrosoftIdToken(token, options = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodePart(headerPart);
  const claims = decodePart(payloadPart);
  if (header.alg !== "RS256") throw new Error("alg");

  const now = Number(options.now || Date.now());
  const exp = Number(claims.exp || 0);
  const nbf = Number(claims.nbf || claims.iat || 0);
  if (!exp || exp * 1000 + CLOCK_SKEW_SEC * 1000 < now) throw new Error("expired");
  if (nbf && nbf * 1000 - CLOCK_SKEW_SEC * 1000 > now) throw new Error("early");

  const clientId = options.clientId;
  if (!clientId) throw new Error("audience-config");
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId;
  if (!audOk) throw new Error("audience");

  const tid = String(claims.tid || "");
  const iss = String(claims.iss || "");
  const v2 = `https://login.microsoftonline.com/${tid}/v2.0`;
  const v1 = `https://sts.windows.net/${tid}/`;
  if (!tid || (iss !== v2 && iss !== v1)) throw new Error("issuer");

  let keys = options.jwks;
  if (!keys) {
    keys = await loadJwks(options.fetchImpl || fetch, false);
    if (!keys.some((key) => key.kid === header.kid)) {
      keys = await loadJwks(options.fetchImpl || fetch, true);
    }
  }
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("kid");

  const signature = Buffer.from(signaturePart.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const valid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    publicKey,
    signature
  );
  if (!valid) throw new Error("signature");

  const email = emailFromClaims(claims);
  if (!email) throw new Error("email");
  return { email, tid };
}

/**
 * Allow the request when the Microsoft ID token belongs to an allowlisted
 * account, or when it presents the shared password from APP_ACCESS_PASSWORD.
 * Fails closed when neither check is configured.
 */
export async function authorizeRequest(headers = {}, options = {}) {
  const env = options.env || process.env;
  const password = String(env.APP_ACCESS_PASSWORD || "");
  const suppliedPassword = String(headers["x-wrights-password"] || "");
  if (password && suppliedPassword && safeEqual(password, suppliedPassword)) {
    return { ok: true, method: "password" };
  }

  const bearer = String(headers.authorization || headers.Authorization || "");
  const match = bearer.match(/^Bearer\s+(\S+)\s*$/i);
  const token = match ? match[1] : "";
  if (password && token && !token.includes(".") && safeEqual(password, token)) {
    return { ok: true, method: "password" };
  }

  const allow = allowlistFrom(env);
  const clientId = clientIdFrom(env);

  if (token.includes(".")) {
    if (!clientId || !allow.length) {
      return {
        ok: false,
        status: 503,
        error: "Prices are locked until ALLOWED_EMAILS and the Azure client id are set in Vercel.",
      };
    }
    try {
      const identity = await verifyMicrosoftIdToken(token, {
        clientId,
        jwks: options.jwks,
        fetchImpl: options.fetchImpl,
        now: options.now,
      });
      if (!allow.includes(identity.email)) {
        return { ok: false, status: 403, error: "This Microsoft account is not allowed to view prices." };
      }
      return { ok: true, method: "microsoft", email: identity.email };
    } catch {
      return {
        ok: false,
        status: 401,
        error: "Sign-in could not be verified. Sign in again, or enter the access password.",
      };
    }
  }

  if (!password && !allow.length) {
    return {
      ok: false,
      status: 503,
      error: "Prices are locked until ALLOWED_EMAILS or APP_ACCESS_PASSWORD is set in Vercel.",
    };
  }

  return {
    ok: false,
    status: 401,
    error: "Sign in with the allowed Microsoft account, or enter the access password.",
  };
}
