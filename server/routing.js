import { searchAddresses } from "./geocode.js";

const DEFAULT_OSRM_BASE_URL = "https://router.project-osrm.org";

function osrmBaseUrl() {
  const raw = process.env.OSRM_BASE_URL || process.env.VITE_OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL;
  return String(raw).replace(/\/+$/, "");
}

function hasCoords(input) {
  const lat = Number(input?.lat);
  const lon = Number(input?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

async function resolvePoint(input, fetchImpl) {
  if (hasCoords(input)) {
    return { ok: true, point: { lat: Number(input.lat), lon: Number(input.lon) } };
  }
  const address = typeof input === "string" ? input : input?.address;
  if (!address || !String(address).trim()) {
    return { ok: false, error: "Enter a start and destination address, or type the kilometres." };
  }
  const found = await searchAddresses(address, { fetchImpl });
  if (!found.results?.length) {
    return {
      ok: false,
      error: found.error || "Could not find that address in Ontario. Enter kilometres manually.",
    };
  }
  return { ok: true, point: { lat: found.results[0].lat, lon: found.results[0].lon } };
}

async function routeWithOsrm(start, end, fetchImpl) {
  const base = osrmBaseUrl();
  const url = `${base}/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;
  const res = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "WrightsLC/1.0 (https://wrights-lc.vercel.app)",
    },
  });
  if (!res.ok) {
    return { ok: false, error: "Driving route is unavailable right now. Enter kilometres manually." };
  }
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route || !Number.isFinite(route.distance)) {
    return { ok: false, error: "No driving route was found. Enter kilometres manually." };
  }
  return {
    ok: true,
    provider: "osrm",
    distanceKm: Math.round(route.distance / 1000),
    durationMin: Math.round(route.duration / 60),
    geometry: route.geometry || null,
    start,
    end,
  };
}

async function routeWithOrs(start, end, fetchImpl) {
  const res = await fetchImpl("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
    method: "POST",
    headers: {
      Authorization: process.env.ORS_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      coordinates: [
        [start.lon, start.lat],
        [end.lon, end.lat],
      ],
    }),
  });
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: "OpenRouteService rejected the API key. Check ORS_API_KEY in Vercel, or remove it to use the default router.",
    };
  }
  if (!res.ok) {
    return { ok: false, error: "Driving route is unavailable right now. Enter kilometres manually." };
  }
  const data = await res.json();
  const feature = data?.features?.[0];
  const summary = feature?.properties?.summary;
  if (!feature || !Number.isFinite(summary?.distance)) {
    return { ok: false, error: "No driving route was found. Enter kilometres manually." };
  }
  return {
    ok: true,
    provider: "openrouteservice",
    distanceKm: Math.round(summary.distance / 1000),
    durationMin: Math.round(summary.duration / 60),
    geometry: feature.geometry || null,
    start,
    end,
  };
}

export async function routeBetween(startInput, endInput, { fetchImpl = fetch } = {}) {
  try {
    const start = await resolvePoint(startInput, fetchImpl);
    if (!start.ok) return start;
    const end = await resolvePoint(endInput, fetchImpl);
    if (!end.ok) return end;
    if (process.env.ORS_API_KEY) return routeWithOrs(start.point, end.point, fetchImpl);
    return routeWithOsrm(start.point, end.point, fetchImpl);
  } catch {
    return { ok: false, error: "Driving route is unavailable right now. Enter kilometres manually." };
  }
}
