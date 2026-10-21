import test from "node:test";
import assert from "node:assert/strict";
import { catalogData } from "../server/catalogData.js";
import { applyMarkup, getPublicCatalog } from "../server/pricing.js";

function legacyMarkup(cost) {
  if (!cost || cost === "Ask" || cost === "N/A") return cost;
  if (typeof cost !== "number" || Number.isNaN(cost)) return cost;
  const marked = cost + 150;
  return Math.round(marked / 50) * 50;
}

function walkItems(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((entry) => walkItems(entry, visit));
    return;
  }
  if (Object.prototype.hasOwnProperty.call(node, "cost")) visit(node);
  Object.values(node).forEach((value) => walkItems(value, visit));
}

test("markup matches the original wholesale plus 150, nearest 50 rule", () => {
  const seen = [];
  walkItems(catalogData, (item) => {
    assert.equal(applyMarkup(item.cost), legacyMarkup(item.cost), item.name);
    seen.push(item);
  });
  assert.ok(seen.length >= 50, `expected the wholesale catalog, found ${seen.length}`);
});

test("public catalog has selling prices only", () => {
  const catalog = getPublicCatalog();
  const published = JSON.stringify(catalog);
  assert.equal(published.includes('"cost"'), false);

  const sells = new Set();
  walkItems(catalogData, (item) => {
    if (typeof item.cost === "number") sells.add(applyMarkup(item.cost));
  });
  walkItems(catalogData, (item) => {
    if (typeof item.cost !== "number") return;
    if (sells.has(item.cost)) return;
    const pattern = new RegExp(`(?<![\\d.])${item.cost}(?!\\d)`);
    assert.equal(pattern.test(published), false, `wholesale ${item.cost} leaked for ${item.name}`);
  });

  const used = catalog.containers.find((item) => item.name === "20ft Used");
  assert.equal(used.sellPrice, 3350);
  assert.equal(used.cost, undefined);

  const lock = catalog.modSections
    .flatMap((section) => section.items)
    .find((item) => item.name === "Container Lock");
  assert.equal(lock.sellPrice, 200);

  const foam = catalog.modSections
    .flatMap((section) => section.items)
    .find((item) => item.name === '1"');
  assert.equal(foam.purchasable, false);
  assert.equal(foam.priceLabel, "1.75/sqft");
  assert.equal(foam.sellPrice, null);
});
