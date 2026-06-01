export function detectDeliveryTier(container) {
  const name = container?.name?.toLowerCase?.() || "";
  if (name.includes("40") || name.includes("45") || name.includes("53")) {
    return "40";
  }
  return "20";
}

export function calculateDeliveryAmount(km, rate, min, rounding) {
  if (!Number.isFinite(km) || km <= 0) return 0;
  const raw = km * rate;
  const applied = raw < min ? min : raw;
  if (rounding === "50") {
    return Math.round(applied / 50) * 50;
  }
  return Math.round(applied * 100) / 100;
}

export function calculateTravelTimeMinutes(km) {
  if (!Number.isFinite(km) || km <= 0) return 0;
  const avgSpeedKmH = 70;
  return Math.round((km / avgSpeedKmH) * 60);
}
