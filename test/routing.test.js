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

function photonFeature({ lon, lat, ...props }) {
  return {
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { state: "Ontario", country: "Canada", ...props },
  };
}

test("geocoding prefers Photon, stays in Ontario, and uses a short label", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "photon.komoot.io");
    assert.equal(parsed.searchParams.get("bbox"), "-95.16,41.66,-74.34,56.86");
    assert.equal(parsed.searchParams.get("lat"), null);
    return jsonResponse({
      features: [
        photonFeature({
          lon: -83.5,
          lat: 42.2,
          osm_key: "highway",
          osm_value: "residential",
          name: "8th Line",
          state: "Michigan",
          country: "United States",
          city: "Detroit",
        }),
        photonFeature({
          lon: -82.28,
          lat: 42.27,
          osm_key: "highway",
          osm_value: "residential",
          street: "8th Line",
          city: "Chatham",
        }),
        photonFeature({
          lon: -79.7069,
          lat: 44.0958,
          osm_key: "place",
          osm_value: "house",
          housenumber: "4805",
          street: "8th Line",
          city: "Beeton",
          postcode: "L0G 1A0",
        }),
      ],
    });
  };

  const found = await searchAddresses("4805 8th Line, Beeton", { fetchImpl });
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].label, "4805 8th Line, Beeton, ON");
  assert.equal(found.results[0].precision, "address");
  assert.equal(found.results[0].hint, "");
  assert.equal(found.results.some((item) => /Michigan|Chatham|County|Northeastern/.test(item.label)), false);
  const again = await searchAddresses("4805 8th Line, Beeton", { fetchImpl });
  assert.equal(again.cached, true);
  assert.equal(calls, 1);
});

test("Nominatim is the fallback, keeps the app header, and does not use the long OSM label", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.hostname.includes("photon")) {
      return jsonResponse({
        features: [
          photonFeature({
            lon: -81.35,
            lat: 48.47,
            osm_key: "aeroway",
            osm_value: "aerodrome",
            name: "Timmins Airport",
            city: "Timmins",
          }),
        ],
      });
    }
    assert.equal(init.headers["User-Agent"], NOMINATIM_USER_AGENT);
    assert.equal(parsed.searchParams.get("countrycodes"), "ca");
    return jsonResponse([
      {
        lat: "48.47627",
        lon: "-81.35245",
        display_name: "100, Riverside Drive, Timmins, Cochrane District, Northeastern Ontario, Ontario, P4N 2V1, Canada",
        address: {
          house_number: "100",
          road: "Riverside Drive",
          city: "Timmins",
          state: "Ontario",
          country_code: "ca",
          postcode: "P4N 2V1",
        },
        importance: 0.4,
      },
    ]);
  };

  const found = await searchAddresses("100 Riverside Drive, Timmins", { fetchImpl });
  assert.equal(found.results[0].label, "100 Riverside Drive, Timmins, ON");
  assert.equal(found.results[0].precision, "address");
  assert.equal(/Northeastern|District/.test(found.results[0].label), false);
});

test("Highway 11 in Cochrane is not pulled into Kapuskasing, and airports are dropped", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "photon.komoot.io");
    return jsonResponse({
      features: [
        photonFeature({
          lon: -82.43,
          lat: 49.41,
          osm_key: "aeroway",
          osm_value: "aerodrome",
          name: "Highway 11",
          city: "Cochrane",
        }),
        photonFeature({
          lon: -82.43,
          lat: 49.42,
          osm_key: "highway",
          osm_value: "primary",
          name: "Government Road",
          city: "Kapuskasing",
        }),
        photonFeature({
          lon: -82.34,
          lat: 49.39,
          osm_key: "highway",
          osm_value: "trunk",
          name: "Highway 11",
          city: "Unorganized North Cochrane",
        }),
        photonFeature({
          lon: -81.0,
          lat: 49.06,
          osm_key: "highway",
          osm_value: "trunk",
          name: "Highway 11",
          city: "Cochrane",
        }),
      ],
    });
  };

  const found = await searchAddresses("Highway 11, Cochrane, ON", { fetchImpl });
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].label, "Highway 11, Cochrane, ON");
  assert.equal(found.results[0].lat, 49.06);
});

test("a missing concession falls back to the town instead of a golf course", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const q = parsed.searchParams.get("q") || "";
    if (parsed.hostname.includes("photon")) {
      if (q.startsWith("Hearst")) {
        return jsonResponse({
          features: [
            photonFeature({
              lon: -83.66,
              lat: 49.69,
              osm_key: "place",
              osm_value: "town",
              name: "Hearst",
              city: "Hearst",
            }),
          ],
        });
      }
      return jsonResponse({
        features: [
          photonFeature({
            lon: -83.7,
            lat: 49.7,
            osm_key: "leisure",
            osm_value: "golf_course",
            name: "Hearst Golf Club",
            city: "Hearst",
          }),
          photonFeature({
            lon: -75.89,
            lat: 45.32,
            osm_key: "highway",
            osm_value: "tertiary",
            name: "Hearst Way",
            city: "Ottawa",
          }),
        ],
      });
    }
    return jsonResponse([]);
  };

  const found = await searchAddresses("Concession 4, Hearst, ON", { fetchImpl });
  assert.equal(found.results[0].label, "Hearst, ON");
  assert.equal(found.results[0].precision, "place");
  assert.match(found.results[0].hint, /town centre/i);
});

test("a northern town is labeled with its name, not the unorganized township", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  const fetchImpl = async () => jsonResponse({
    features: [
      photonFeature({
        lon: -81.7251,
        lat: 47.6737,
        osm_key: "place",
        osm_value: "town",
        name: "Gogama",
        city: "Unorganized North Sudbury",
        county: "Sudbury",
      }),
      photonFeature({
        lon: -81.7495,
        lat: 47.7039,
        osm_key: "highway",
        osm_value: "residential",
        name: "Old Gogama Road",
        city: "Unorganized North Sudbury",
        district: "Gogama",
      }),
      photonFeature({
        lon: -81.7218,
        lat: 47.6799,
        osm_key: "tourism",
        osm_value: "museum",
        name: "Gogama Heritage Museum",
        city: "Unorganized North Sudbury",
      }),
    ],
  });

  const found = await searchAddresses("Gogama, ON", { fetchImpl });
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].label, "Gogama, ON");
  assert.equal(found.results[0].precision, "place");
  assert.equal(found.results[0].lat, 47.6737);
});

test("Sudbury house numbers prefer the city named Sudbury and mention a different district", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  const fetchImpl = async () => jsonResponse({
    features: [
      photonFeature({
        lon: -81.1914,
        lat: 46.5833,
        osm_key: "place",
        osm_value: "house",
        housenumber: "123",
        street: "Main Street East",
        city: "Greater Sudbury",
        district: "Chelmsford",
      }),
      photonFeature({
        lon: -81.204,
        lat: 46.583,
        osm_key: "place",
        osm_value: "house",
        housenumber: "123",
        street: "Main Street",
        city: "Sudbury",
        district: "Chelmsford",
      }),
    ],
  });

  const found = await searchAddresses("123 Main St, Sudbury, ON", { fetchImpl });
  assert.equal(found.results[0].label, "123 Main Street, Sudbury, ON");
  assert.match(found.results[0].secondary, /Chelmsford/);
});

test("a mismatched postal code is dropped and the postal area is used", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const q = parsed.searchParams.get("q") || "";
    if (!parsed.hostname.includes("photon")) return jsonResponse([]);
    if (q === "P3E") {
      return jsonResponse({
        features: [
          photonFeature({
            lon: -81.0,
            lat: 46.49,
            osm_key: "place",
            osm_value: "postcode",
            name: "P3E",
            city: "Sudbury",
            postcode: "P3E 1A1",
          }),
        ],
      });
    }
    return jsonResponse({
      features: [
        photonFeature({
          lon: -81.01,
          lat: 46.5,
          osm_key: "place",
          osm_value: "postcode",
          name: "P3C 3P2",
          city: "Sudbury",
          postcode: "P3C 3P2",
        }),
      ],
    });
  };

  const found = await searchAddresses("P3E 3P2", { fetchImpl });
  assert.equal(found.results[0].label, "Sudbury, ON");
  assert.equal(found.results[0].precision, "postal");
  assert.equal(found.results[0].lon, -81);
  assert.match(found.results[0].hint, /postal area/i);
});

test("a search outage is not cached", async () => {
  setGeocodePolicyForTests({ minIntervalMs: 0 });
  let offline = true;
  const fetchImpl = async () => {
    if (offline) throw new Error("offline");
    return jsonResponse({
      features: [
        photonFeature({
          lon: -79.7069,
          lat: 44.0958,
          osm_key: "place",
          osm_value: "house",
          housenumber: "4805",
          street: "8th Line",
          city: "Beeton",
        }),
      ],
    });
  };

  const first = await searchAddresses("4805 8th Line, Beeton, ON", { fetchImpl });
  assert.match(first.error, /unavailable|kilometres/i);
  assert.equal(first.results.length, 0);
  offline = false;
  const second = await searchAddresses("4805 8th Line, Beeton, ON", { fetchImpl });
  assert.equal(second.cached, undefined);
  assert.equal(second.results[0].label, "4805 8th Line, Beeton, ON");
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
