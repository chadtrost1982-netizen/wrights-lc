import { searchAddresses, setGeocodePolicyForTests } from "../server/geocode.js";
import { routeBetween } from "../server/routing.js";

setGeocodePolicyForTests({ minIntervalMs: 1100 });
delete process.env.ORS_API_KEY;

function haversine(a, b) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const yard = { lat: 44.0958627, lon: -79.7069405 };
const toronto = { lat: 43.6536032, lon: -79.3840055 };
const chatham = { lat: 42.2769, lon: -82.2799 };

const cases = [
  ["4805 8th Line, Beeton, ON L0G 1A0", yard, 3],
  ["100 Queen Street West, Toronto, Ontario", toronto, 2],
  ["8th Line, Beeton, Ontario", yard, 25],
];

for (const [query, expected, limitKm] of cases) {
  const found = await searchAddresses(query);
  const hit = found.results?.[0];
  if (!hit) {
    console.error(`No Ontario match for ${query}: ${found.error || "unknown error"}`);
    process.exit(1);
  }
  const km = haversine(hit, expected);
  console.log(`${query} -> ${hit.label} (${km.toFixed(1)} km from expected)`);
  if (km > limitKm) {
    console.error(`Match is ${km.toFixed(1)} km away; limit is ${limitKm}.`);
    process.exit(1);
  }
  if (query.includes("Beeton") && haversine(hit, chatham) < 100) {
    console.error(`Rural Line road matched the wrong place: ${hit.label}`);
    process.exit(1);
  }
}

const route = await routeBetween(
  { lat: yard.lat, lon: yard.lon },
  { lat: toronto.lat, lon: toronto.lon }
);
console.log(`Beeton to Toronto: ${route.distanceKm ?? "?"} km via ${route.provider || "none"}`);
if (!route.ok || route.distanceKm < 50 || route.distanceKm > 120) {
  console.error(route.error || "Unexpected driving distance.");
  process.exit(1);
}

const missed = await searchAddresses("zzzz-not-a-real-place-99999");
if (missed.results?.length || !/Ontario|kilometres/i.test(missed.error || "")) {
  console.error("Expected a clear manual-kilometre error for a nonsense address.", missed);
  process.exit(1);
}
console.log(`Nonsense address: ${missed.error}`);
console.log("Distance checks passed.");
