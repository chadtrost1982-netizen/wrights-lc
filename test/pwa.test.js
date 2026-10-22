import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isAuthReturnUrl, shouldCacheAppRequest } from "../src/utils/pwaPolicy.js";

const APP = "https://wrights-lc.vercel.app";

test("the installed app does not store Microsoft, Graph, OneDrive, or API responses", () => {
  assert.equal(shouldCacheAppRequest(`${APP}/`, "GET", APP), true);
  assert.equal(shouldCacheAppRequest(`${APP}/quotes`, "GET", APP), true);
  assert.equal(shouldCacheAppRequest(`${APP}/assets/main-abc.js`, "GET", APP), true);
  assert.equal(shouldCacheAppRequest(`${APP}/api/catalog`, "GET", APP), false);
  assert.equal(shouldCacheAppRequest(`${APP}/api/route`, "POST", APP), false);
  assert.equal(shouldCacheAppRequest(`${APP}/sw.js`, "GET", APP), false);
  assert.equal(shouldCacheAppRequest(`${APP}/manifest.webmanifest`, "GET", APP), false);
  assert.equal(
    shouldCacheAppRequest("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize", "GET", APP),
    false
  );
  assert.equal(shouldCacheAppRequest("https://graph.microsoft.com/v1.0/me/sendMail", "POST", APP), false);
  assert.equal(shouldCacheAppRequest("https://graph.microsoft.com/v1.0/me/drive/root", "GET", APP), false);
  assert.equal(
    shouldCacheAppRequest("https://contoso.sharepoint.com/personal/chad/Documents/a.xlsx", "GET", APP),
    false
  );
  assert.equal(shouldCacheAppRequest("https://onedrive.live.com/download", "GET", APP), false);
  assert.equal(shouldCacheAppRequest(`${APP}/?code=auth-code&state=abc`, "GET", APP), false);
  assert.equal(shouldCacheAppRequest(`${APP}/?error=access_denied&state=abc`, "GET", APP), false);
});

test("a Microsoft return is recognized so the installed window is not reloaded mid sign-in", () => {
  assert.equal(isAuthReturnUrl(`${APP}/#code=abc&state=xyz`), true);
  assert.equal(isAuthReturnUrl(`${APP}/?code=abc&state=xyz`), true);
  assert.equal(isAuthReturnUrl(`${APP}/quotes`), false);
  assert.equal(isAuthReturnUrl(`${APP}/`), false);
});

test("the manifest is a standalone Disposal Solutions launcher with small icons", () => {
  const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));
  assert.equal(manifest.name, "Disposal Solutions");
  assert.equal(manifest.short_name, "Disposal Sol.");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#111111");
  assert.equal(manifest.theme_color, "#111111");
  assert.equal(manifest.launch_handler.client_mode, "navigate-existing");

  const bySize = Object.fromEntries(manifest.icons.map((icon) => [icon.sizes + icon.purpose, icon]));
  assert.equal(bySize["192x192any"].src, "/icons/icon-192.png");
  assert.equal(bySize["512x512any"].src, "/icons/icon-512.png");
  assert.equal(bySize["512x512maskable"].purpose, "maskable");

  for (const icon of manifest.icons) {
    const file = `public${icon.src}`;
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.readUInt32BE(16), Number(icon.sizes.split("x")[0]));
    assert.equal(bytes.readUInt32BE(20), Number(icon.sizes.split("x")[1]));
    assert.ok(bytes.length < 200_000, `${file} is ${bytes.length} bytes`);
  }

  const apple = fs.readFileSync("public/icons/apple-touch-icon.png");
  assert.equal(apple.readUInt32BE(16), 180);
  assert.equal(apple.readUInt32BE(20), 180);
  assert.ok(apple.length < 200_000);

  const sw = fs.readFileSync("public/sw.js", "utf8");
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /shouldCacheAppRequest/);
  assert.match(sw, /await fetch\(request\)/);
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /theme-color/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /src\/boot\.js/);
});
