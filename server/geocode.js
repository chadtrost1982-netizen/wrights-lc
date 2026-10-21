export const NOMINATIM_USER_AGENT =
  "WrightsLC/1.0 (container quoting for Wrights L.C.; https://wrights-lc.vercel.app)";

// Ontario, roughly: left, top, right, bottom (Nominatim viewbox order).
const ONTARIO_VIEWBOX = "-95.16,56.86,-74.34,41.66";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cache = new Map();
let chain = Promise.resolve();
let lastRequestAt = 0;
let minIntervalMs = 1100;

export function setGeocodePolicyForTests({ minIntervalMs: next, clearCache = true } = {}) {
  if (Number.isFinite(next)) minIntervalMs = next;
  if (clearCache) cache = new Map();
  chain = Promise.resolve();
  lastRequestAt = 0;
}

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOntario(item) {
  const state = String(item?.address?.state || "").toLowerCase();
  const code = String(item?.address?.["ISO3166-2-lvl4"] || "");
  const country = String(item?.address?.country_code || "").toLowerCase();
  const display = String(item?.display_name || "").toLowerCase();
  if (country && country !== "ca") return false;
  return state.includes("ontario") || code === "CA-ON" || display.includes("ontario");
}

function buildPrimaryLabel(item) {
  const address = item?.address || {};
  if (address.house_number && address.road) return `${address.house_number} ${address.road}`;
  return address.road || address.neighbourhood || address.suburb || address.city || item?.name || item?.display_name || "";
}

function buildSecondaryLabel(item) {
  const address = item?.address || {};
  const city = address.city || address.town || address.village || address.municipality || address.county || "";
  const state = address.state || "Ontario";
  const postcode = address.postcode || "";
  return [city, state, postcode].filter(Boolean).join(", ");
}

function scoreResult(item, query) {
  const q = String(query || "").toLowerCase();
  const address = item?.address || {};
  let score = Number(item?.importance || 0) + Number(item?.place_rank || 0) / 100;
  if (address.house_number && q.includes(String(address.house_number).toLowerCase())) score += 0.55;
  const postcode = String(address.postcode || "").replace(/\s/g, "").toLowerCase();
  if (postcode && q.replace(/\s/g, "").includes(postcode)) score += 0.45;
  const town = String(address.town || address.city || address.village || "").toLowerCase();
  if (town && q.includes(town)) score += 0.4;
  if (/line|road|street|avenue|drive|concession/i.test(String(address.road || "")) && q.includes(String(address.road || "").toLowerCase())) {
    score += 0.15;
  }
  return score;
}

function toResult(item, query) {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  return {
    label: String(item.display_name || buildPrimaryLabel(item)),
    primary: buildPrimaryLabel(item),
    secondary: buildSecondaryLabel(item),
    lat,
    lon,
    score: scoreResult(item, query),
  };
}

async function nominatimSearch(query, fetchImpl, extra = {}) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("dedupe", "1");
  url.searchParams.set("viewbox", ONTARIO_VIEWBOX);
  url.searchParams.set("bounded", "0");
  const structured = Boolean(extra.street || extra.postalcode || extra.city);
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value);
  }
  if (!structured && query) url.searchParams.set("q", query);

  const wait = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();

  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": NOMINATIM_USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en",
    },
  });
  if (res.status === 429) {
    return { ok: false, error: "Address search is busy. Wait a moment and try again, or enter kilometres manually." };
  }
  if (!res.ok) {
    return { ok: false, error: "Address search failed. Enter kilometres manually." };
  }
  const data = await res.json();
  const results = (Array.isArray(data) ? data : [])
    .filter(isOntario)
    .map((item) => toResult(item, query))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .sort((a, b) => b.score - a.score)
    .slice(0, 7)
    .map((item) => {
      const published = { ...item };
      delete published.score;
      return published;
    });
  return { ok: true, results };
}

function structuredParams(query) {
  const postal = (String(query).match(/[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d/) || [])[0] || "";
  const street = String(query)
    .replace(postal, "")
    .replace(/\b(ontario|canada|on)\b/gi, " ")
    .replace(/[,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    street,
    state: "Ontario",
    country: "Canada",
    postalcode: postal,
  };
}

export async function searchAddresses(query, { fetchImpl = fetch } = {}) {
  const q = String(query || "").trim();
  if (q.length < 3) return { results: [], error: "" };

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { results: hit.results, error: hit.error, cached: true };
  }

  return enqueue(async () => {
    const again = cache.get(key);
    if (again && Date.now() - again.at < CACHE_TTL_MS) {
      return { results: again.results, error: again.error, cached: true };
    }

    try {
      let found = await nominatimSearch(q, fetchImpl);
      if (!found.ok) {
        cache.set(key, { at: Date.now(), results: [], error: found.error });
        return { results: [], error: found.error };
      }

      if (!found.results.length && !/ontario/i.test(q)) {
        found = await nominatimSearch(`${q}, Ontario, Canada`, fetchImpl);
        if (!found.ok) return { results: [], error: found.error };
      }

      if (!found.results.length) {
        const params = structuredParams(q);
        if (params.street) {
          found = await nominatimSearch(q, fetchImpl, params);
          if (!found.ok) return { results: [], error: found.error };
        }
      }

      const error = found.results.length
        ? ""
        : "No matching address in Ontario, Canada. Check the town, or enter kilometres manually.";
      cache.set(key, { at: Date.now(), results: found.results, error });
      return { results: found.results, error };
    } catch {
      const error = "Address search is unavailable right now. Enter kilometres manually.";
      return { results: [], error };
    }
  });
}
