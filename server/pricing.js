import { catalogData } from "./catalogData.js";

// Wholesale + $150, then round to the nearest $50. This is the only copy of that rule.
export function applyMarkup(cost) {
  if (!cost || cost === "Ask" || cost === "N/A") return cost;
  if (typeof cost !== "number" || Number.isNaN(cost)) return cost;
  const marked = cost + 150;
  return Math.round(marked / 50) * 50;
}

function publishItem(item) {
  const purchasable = typeof item.cost === "number" && Number.isFinite(item.cost);
  const published = {
    name: item.name,
    sellPrice: purchasable ? applyMarkup(item.cost) : null,
    priceLabel: purchasable ? null : String(item.cost),
    purchasable,
  };
  if (item.stock) published.stock = item.stock;
  if (item.type) published.type = item.type;
  return published;
}

function publishSections(sections) {
  return sections.map((section) => ({
    title: section.title,
    items: section.items.map(publishItem),
  }));
}

/** Selling prices only. Wholesale `cost` is never included. */
export function getPublicCatalog() {
  return {
    containers: catalogData.containers.map(publishItem),
    presetSections: publishSections(catalogData.presets),
    modSections: publishSections(catalogData.mods),
    quoteContainerSections: publishSections(catalogData.quoteContainers),
    quoteModSections: publishSections(catalogData.quoteMods),
  };
}

export function listWholesaleValues() {
  const values = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(node, "cost")) values.push(node.cost);
    Object.values(node).forEach(walk);
  };
  walk(catalogData);
  return values;
}
