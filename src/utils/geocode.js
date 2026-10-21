const clientCache = new Map();

export async function searchAddresses(query) {
  const q = String(query || "").trim();
  if (q.length < 3) return { results: [], error: "" };
  const key = q.toLowerCase();
  if (clientCache.has(key)) return clientCache.get(key);

  let res;
  try {
    res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
  } catch {
    return { results: [], error: "Address search is unavailable right now. Enter kilometres manually." };
  }
  const data = await res.json().catch(() => ({}));
  const payload = {
    results: Array.isArray(data.results) ? data.results : [],
    error: data.error || (res.ok ? "" : "Address search failed. Enter kilometres manually."),
  };
  if (res.ok && payload.results.length) clientCache.set(key, payload);
  return payload;
}

export async function geocodeAddress(address) {
  if (address && typeof address === "object" && Number.isFinite(Number(address.lat)) && Number.isFinite(Number(address.lon))) {
    return { lat: Number(address.lat), lon: Number(address.lon) };
  }
  const query = typeof address === "string" ? address : address?.address || "";
  const found = await searchAddresses(query);
  const first = found.results?.[0];
  if (!first) return null;
  return { lat: first.lat, lon: first.lon, label: first.label || "" };
}
