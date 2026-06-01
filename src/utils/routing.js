import { geocodeAddress } from "./geocode";

const DEFAULT_OSRM_BASE_URL = "https://router.project-osrm.org";

function getConfiguredOsrmBaseUrl() {
  const raw = import.meta.env.VITE_OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL;
  return String(raw).replace(/\/+$/, "");
}

export async function getRoute(start, end) {
  const baseUrl = getConfiguredOsrmBaseUrl();
  const url = `${baseUrl}/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  if (!data.routes || !data.routes[0]) return null;

  const route = data.routes[0];

  return {
    distanceKm: Math.round(route.distance / 1000),
    durationMin: Math.round(route.duration / 60),
    geometry: route.geometry,
  };
}

export async function getRouteByAddress(startAddress, endAddress) {
  const s = await geocodeAddress(startAddress);
  const e = await geocodeAddress(endAddress);
  if (!s || !e) return null;

  const route = await getRoute(s, e);
  if (!route) return null;

  return {
    ...route,
    s,
    e,
  };
}
