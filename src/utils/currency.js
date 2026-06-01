export function formatCurrency(value) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return `$${safe.toFixed(2)}`;
}
