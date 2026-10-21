async function postRoute(start, end) {
  let res;
  try {
    res = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ start, end }),
    });
  } catch {
    return { error: "Driving route is unavailable right now. Enter kilometres manually." };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Number.isFinite(Number(data.distanceKm))) {
    return { error: data.error || "Could not calculate a driving route. Enter kilometres manually." };
  }
  return {
    distanceKm: Number(data.distanceKm),
    durationMin: Number(data.durationMin) || 0,
    geometry: data.geometry || null,
    s: data.start || null,
    e: data.end || null,
    provider: data.provider || "",
  };
}

export async function getRoute(start, end) {
  return postRoute(start, end);
}

export async function getRouteByAddress(start, end) {
  const normalize = (value) => {
    if (typeof value === "string") return { address: value };
    return value || {};
  };
  return postRoute(normalize(start), normalize(end));
}
