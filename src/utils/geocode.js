export async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data[0]) return null;

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
  };
}

export async function getDistanceKm(start, end) {
  const s = await geocodeAddress(start);
  const e = await geocodeAddress(end);

  if (!s || !e) return { km: null, s, e };

  const R = 6371;
  const dLat = ((e.lat - s.lat) * Math.PI) / 180;
  const dLon = ((e.lon - s.lon) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((s.lat * Math.PI) / 180) *
      Math.cos((e.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return {
    km: Math.round(R * c),
    s,
    e,
  };
}
