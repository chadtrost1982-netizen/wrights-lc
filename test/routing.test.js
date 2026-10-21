import test from "node:test";
import assert from "node:assert/strict";
import { NOMINATIM_USER_AGENT, searchAddresses, setGeocodePolicyForTests } from "../server/geocode.js";
import { routeBetween } from "../server/routing.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("geocoding stays in Ontario, identifies the app, and caches", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.equal(init.headers["User-Agent"], NOMINATIM_USER_AGENT);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("countrycodes"), "ca");
    return jsonResponse([
      {
        lat: "42.2",
        lon: "-83.5",
        display_name: "8th Line, Michigan, USA",
        address: { state: "Michigan", country_code: "us", road: "8th Line" },
        importance: 0.9,
        place_rank: 26,
      },
      {
        lat: "42.27",
        lon: "-82.28",
        display_name: "8th Line, Chatham, Ontario, Canada",
        address: { state: "Ontario", country_code: "ca", road: "8th Line", town: "Chatham" },
        importance: 0.2,
        place_rank: 26,
      },
      {
        lat: "44.08",
        lon: "-79.78",
        display_name: "8th Line, Beeton, Ontario, Canada",
        address: { state: "Ontario", country_code: "ca", road: "8th Line", town: "Beeton" },
        importance: 0.05,
        place_rank: 26,
      },
    ]);
  };

  const found = await searchAddresses("8th Line, Beeton", { fetchImpl });
  assert.equal(found.results.length, 2);
  assert.match(found.results[0].label, /Beeton/);
  assert.equal(found.results.some((item) => /Michigan/.test(item.label)), false);
  const again = await searchAddresses("8th Line, Beeton", { fetchImpl });
  assert.equal(again.cached, true);
  assert.equal(calls, 1);
});

test("picked coordinates skip geocoding and an API key switches routing to OpenRouteService", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  const previous = process.env.ORS_API_KEY;
  process.env.ORS_API_KEY = "server-only-key";
  const calls = [];
  try {
    const result = await routeBetween(
      { lat: 44.0958, lon: -79.7069, address: "4805, 8th Line, Beeton, New Tecumseth, Ontario, Canada" },
      { lat: 43.6536, lon: -79.384, address: "100 Queen Street West, Toronto, Ontario, Canada" },
      {
        fetchImpl: async (url, init) => {
          calls.push(String(url));
          assert.equal(init.headers.Authorization, "server-only-key");
          assert.equal(String(url).includes("nominatim"), false);
          return jsonResponse({
            features: [{
              geometry: { type: "LineString", coordinates: [[-79.7, 44.1], [-79.38, 43.65]] },
              properties: { summary: { distance: 68000, duration: 3660 } },
            }],
          });
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.provider, "openrouteservice");
    assert.equal(result.distanceKm, 68);
    assert.equal(result.durationMin, 61);
    assert.equal(calls.length, 1);
  } finally {
    if (previous == null) delete process.env.ORS_API_KEY;
    else process.env.ORS_API_KEY = previous;
  }
});

test("a missed address returns a manual-kilometre error and OSRM stays the default", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  const previous = process.env.ORS_API_KEY;
  delete process.env.ORS_API_KEY;
  const calls = [];
  try {
    const missing = await routeBetween(
      { address: "zzzz-not-a-real-place-99999" },
      { lat: 44.1, lon: -79.7 },
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (String(url).includes("nominatim")) return jsonResponse([]);
          return jsonResponse({ code: "Ok", routes: [{ distance: 1000, duration: 60, geometry: null }] });
        },
      }
    );
    assert.equal(missing.ok, false);
    assert.match(missing.error, /kilometres|Ontario/i);
    assert.equal(calls.some((url) => url.includes("router.project-osrm.org")), false);

    const routed = await routeBetween(
      { lat: 44.1, lon: -79.7 },
      { lat: 43.7, lon: -79.4 },
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          return jsonResponse({
            code: "Ok",
            routes: [{ distance: 50000, duration: 2400, geometry: { type: "LineString", coordinates: [] } }],
          });
        },
      }
    );
    assert.equal(routed.ok, true);
    assert.equal(routed.provider, "osrm");
    assert.equal(routed.distanceKm, 50);
    assert.equal(calls.some((url) => url.includes("router.project-osrm.org")), true);
  } finally {
    if (previous == null) delete process.env.ORS_API_KEY;
    else process.env.ORS_API_KEY = previous;
  }
});
