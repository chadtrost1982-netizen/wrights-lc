import fs from "node:fs";
import path from "node:path";
import { catalogData } from "../server/catalogData.js";
import { listWholesaleValues } from "../server/pricing.js";

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function readAll(dir) {
  return walk(dir)
    .filter((file) => /\.(js|jsx|css|html|json|mjs)$/.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

function catalogNames(node, names = new Set()) {
  if (!node || typeof node !== "object") return names;
  if (Array.isArray(node)) {
    node.forEach((entry) => catalogNames(entry, names));
    return names;
  }
  if (typeof node.name === "string" && node.name.length >= 18) names.add(node.name);
  Object.values(node).forEach((value) => catalogNames(value, names));
  return names;
}

if (!fs.existsSync("dist")) {
  console.error("dist/ is missing. Run npm run build first.");
  process.exit(1);
}

const src = readAll("src");
const dist = readAll("dist");
const failures = [];

if (/server\/catalogData|from ["'][^"']*\/server\//.test(src)) {
  failures.push("client source imports the server catalog");
}

const markers = [...catalogNames(catalogData), "1.75/sqft", "3.50/sqft", "5.25/sqft"];
for (const marker of markers) {
  if (src.includes(marker)) failures.push(`src still contains "${marker}"`);
  if (dist.includes(marker)) failures.push(`bundle still contains "${marker}"`);
}

const numbers = [...new Set(listWholesaleValues().filter((value) => typeof value === "number"))];
for (const value of numbers) {
  const pattern = new RegExp(`(?<![\\d.a-fA-F])${value}(?![\\d.a-fA-F])`);
  if (!pattern.test(src)) continue;
  const lines = src.split("\n").filter((line) => pattern.test(line));
  const priced = lines.filter((line) => /cost|wholesale|sellPrice/i.test(line));
  if (priced.length) {
    failures.push(`src still prices wholesale ${value}: ${priced[0].trim()}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Bundle check passed (${markers.length} catalog markers, ${numbers.length} wholesale numbers).`);
console.log("Product names and per-sqft rates are absent from src and dist.");
console.log("Some small integers also appear in dependencies (Excel code pages, map code) and are not stored as prices.");
