export const NOMINATIM_USER_AGENT =
  "WrightsLC/1.0 (container quoting for Wrights L.C.; https://wrights-lc.vercel.app)";

// Ontario, with a little room at the Manitoba and Quebec edges.
const ONTARIO_BOX = { minLat: 41.5, maxLat: 57.2, minLon: -95.6, maxLon: -74.2 };
const PHOTON_BBOX = "-95.16,41.66,-74.34,56.86";
const NOMINATIM_VIEWBOX = "-95.16,56.86,-74.34,41.66";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WEAK_KEYS = new Set([
  "aeroway",
  "leisure",
  "amenity",
  "shop",
  "office",
  "tourism",
  "craft",
  "historic",
  "natural",
  "railway",
]);
const GENERIC = new Set([
  "road", "rd", "street", "st", "drive", "dr", "line", "avenue", "ave", "highway", "hwy",
  "concession", "lot", "north", "south", "east", "west", "way", "court", "crt", "lane", "ln",
  "trail", "boulevard", "blvd", "crescent", "cres", "circle", "cir", "terrace", "ter",
  "place", "pl", "ontario", "canada", "the", "and",
]);

const HINTS = {
  street: "House number was not found. This is the road. Drag the blue pin if the spot is wrong.",
  place: "This is the town centre. Drag the blue pin to the exact spot.",
  postal: "This is the postal area. Drag the blue pin to the exact spot.",
};

let cache = new Map();
let chain = Promise.resolve();
let lastPhotonAt = 0;
let lastNominatimAt = 0;
let photonIntervalMs = 250;
let nominatimIntervalMs = 1100;

export function setGeocodePolicyForTests({ minIntervalMs: next, clearCache = true } = {}) {
  if (Number.isFinite(next)) {
    photonIntervalMs = next;
    nominatimIntervalMs = next;
  }
  if (clearCache) cache = new Map();
  chain = Promise.resolve();
  lastPhotonAt = 0;
  lastNominatimAt = 0;
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

async function pace(kind) {
  const interval = kind === "photon" ? photonIntervalMs : nominatimIntervalMs;
  const last = kind === "photon" ? lastPhotonAt : lastNominatimAt;
  const wait = Math.max(0, interval - (Date.now() - last));
  if (wait) await sleep(wait);
  const now = Date.now();
  if (kind === "photon") lastPhotonAt = now;
  else lastNominatimAt = now;
}

function tokens(value) {
  return String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function isPlaceWord(word) {
  return Boolean(word) && word.length >= 3 && !GENERIC.has(word) && !/^\d/.test(word);
}

function wordMatches(word, resultWords) {
  return resultWords.some((item) => item === word || (word.length >= 3 && item.startsWith(word)));
}

function normalizedPostal(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function postalInQuery(query) {
  const match = String(query || "").toUpperCase().match(/[A-Z]\d[A-Z][ -]?\d[A-Z]\d/);
  return match ? normalizedPostal(match[0]) : "";
}

function fsaInQuery(query) {
  const full = postalInQuery(query);
  if (full) return full.slice(0, 3);
  const match = String(query || "").toUpperCase().match(/\b([A-Z]\d[A-Z])\b/);
  return match ? match[1] : "";
}

function formatPostal(compact) {
  const raw = normalizedPostal(compact);
  return raw.length === 6 ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw;
}

function civicInQuery(query) {
  const match = String(query || "").trim().match(/^(\d+[a-zA-Z]?)\b/);
  return match ? match[1] : "";
}

function looksLikeStreet(value) {
  return Boolean(civicInQuery(value))
    || /\b(street|st|road|rd|drive|dr|line|avenue|ave|highway|hwy|concession|crescent|court|lane|trail|boulevard|way|terrace)\b/i.test(String(value || ""));
}

function mentionsOntario(query) {
  return /\b(ontario|on)\b/i.test(String(query || ""));
}

function commaParts(query) {
  return String(query || "").split(",").map((part) => part.trim()).filter(Boolean);
}

function isSkippablePart(part) {
  return /^(on|ont|ontario|canada)$/i.test(part)
    || Boolean(postalInQuery(part))
    || /^[A-Za-z]\d[A-Za-z]$/i.test(part);
}

function norm(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function inLooseOntario(lat, lon) {
  return lat >= ONTARIO_BOX.minLat && lat <= ONTARIO_BOX.maxLat
    && lon >= ONTARIO_BOX.minLon && lon <= ONTARIO_BOX.maxLon;
}

function isOntarioLocation({ state = "", country = "", lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const countryNorm = String(country || "").toLowerCase();
  if (countryNorm && countryNorm !== "ca" && countryNorm !== "canada") return false;
  const stateNorm = String(state || "").toLowerCase();
  const saysOntario = stateNorm.includes("ontario") || stateNorm === "on";
  if (saysOntario) return inLooseOntario(lat, lon);
  return !stateNorm && inLooseOntario(lat, lon);
}

function explicitTownWords(query) {
  return commaParts(query)
    .filter((part) => !isSkippablePart(part) && !looksLikeStreet(part))
    .flatMap((part) => tokens(part).filter(isPlaceWord));
}

function matchesExplicitTown(query, { locality = "", placeName = "" } = {}) {
  const towns = explicitTownWords(query);
  if (!towns.length) return true;
  const nameWords = tokens(placeName);
  if (placeName) return towns.every((word) => nameWords.includes(word));
  const localityWords = tokens(locality);
  if (localityWords.includes("unorganized")) return false;
  return towns.every((word) => wordMatches(word, localityWords));
}

function exactTownBonus(query, { locality = "", placeName = "" } = {}) {
  const towns = explicitTownWords(query);
  if (!towns.length) return 0;
  const same = (value) => {
    const words = tokens(value).filter((word) => isPlaceWord(word) || towns.includes(word));
    return towns.every((word) => words.includes(word)) && words.length === towns.length;
  };
  return same(locality) || same(placeName) ? 4 : 0;
}

function acceptsHit(query, matchText, { housenumber = "", postcode = "" } = {}) {
  const wantedPostal = postalInQuery(query);
  const gotPostal = normalizedPostal(postcode);
  if (wantedPostal && gotPostal && gotPostal !== wantedPostal) return false;
  if (wantedPostal && gotPostal === wantedPostal) return true;

  const wantedFsa = fsaInQuery(query);
  const queryIsFsaOnly = /^[A-Za-z]\d[A-Za-z]$/.test(String(query || "").trim());
  if (queryIsFsaOnly && gotPostal) return gotPostal.startsWith(wantedFsa);

  const places = tokens(query).filter(isPlaceWord);
  const resultWords = tokens(matchText);
  const placeHit = places.some((word) => wordMatches(word, resultWords));
  if (places.length && !placeHit) return false;

  const civic = civicInQuery(query);
  if (civic && housenumber && civic.toLowerCase() === String(housenumber).toLowerCase()) return true;
  if (placeHit) return true;
  if (!places.length && (civic || wantedPostal || wantedFsa || looksLikeStreet(query))) {
    const signals = tokens(query).filter((word) => !GENERIC.has(word));
    if (!signals.length) return true;
    return signals.some((word) => wordMatches(word, resultWords) || (wantedFsa && gotPostal.startsWith(wantedFsa)));
  }
  return false;
}

function hintFor(precision) {
  return HINTS[precision] || "";
}

function buildCard({ housenumber = "", street = "", place = "", postcode = "", district = "" }) {
  const line = [housenumber, street].filter(Boolean).join(" ").trim();
  const city = place && (!line || place.toLowerCase() !== line.toLowerCase()) ? place : "";
  const label = line && city
    ? `${line}, ${city}, ON`
    : city
      ? `${city}, ON`
      : line
        ? `${line}, ON`
        : "";
  const primary = line || city;
  const area = district && city && !/unorganized/i.test(district) && district.toLowerCase() !== city.toLowerCase()
    ? `${district} · ${city}, ON`
    : (line && city ? `${city}, ON` : "Ontario");
  const secondary = [area, postcode || ""].filter(Boolean).join(" ");
  return { label, primary, secondary };
}

function scoreHit(query, { matchText, housenumber, postcode, kind, importance = 0, townBonus = 0 }) {
  let score = (Number(importance) || 0) + (Number(townBonus) || 0);
  const civic = civicInQuery(query);
  if (civic && housenumber && civic.toLowerCase() === String(housenumber).toLowerCase()) score += 5;
  const words = tokens(matchText);
  for (const word of tokens(query).filter(isPlaceWord)) {
    if (wordMatches(word, words)) score += 2;
  }
  const wanted = postalInQuery(query);
  const got = normalizedPostal(postcode);
  if (wanted && got === wanted) score += 4;
  else if (got && fsaInQuery(query) && got.startsWith(fsaInQuery(query))) score += 1.5;
  if (kind === "place") score += civic ? 0.2 : 3;
  if (kind === "highway") score += 1.2;
  if (kind === "house") score += 2;
  return score;
}

function precisionFor({ housenumber, street, postcode, kind }, query) {
  const civic = civicInQuery(query);
  if (civic && housenumber && civic.toLowerCase() === String(housenumber).toLowerCase()) return "address";
  if (housenumber && street) return "address";
  if (kind === "highway" || street) return "street";
  if (postalInQuery(query) || /^[A-Za-z]\d[A-Za-z]$/.test(String(query || "").trim())) return "postal";
  return "place";
}

function finishHit(query, hit) {
  if (!hit?.label) return null;
  const precision = precisionFor(hit, query);
  return {
    ...hit,
    precision,
    hint: hintFor(precision),
    score: scoreHit(query, hit),
  };
}

function photonFeatureToHit(feature, query) {
  const coords = feature?.geometry?.coordinates;
  const lon = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  const props = feature?.properties || {};
  if (!isOntarioLocation({ state: props.state, country: props.country || props.countrycode, lat, lon })) return null;
  if (WEAK_KEYS.has(String(props.osm_key || "").toLowerCase())) return null;

  const isPlace = props.osm_key === "place"
    && /town|city|village|hamlet|municipality|locality|isolated_dwelling/.test(String(props.osm_value || ""));
  const street = props.osm_key === "highway"
    ? (props.name || props.street || "")
    : (props.street || "");
  const city = props.city || props.town || props.village || props.hamlet || props.locality || "";
  const locality = [props.city, props.town, props.village, props.hamlet, props.locality].filter(Boolean).join(" ");
  const placeName = isPlace ? (props.name || "") : "";
  if (!matchesExplicitTown(query, { locality, placeName })) return null;
  const housenumber = props.housenumber || "";
  const postcode = props.postcode || "";
  const namedPlace = placeName || city || (!street && !housenumber ? props.name || "" : "");
  const matchText = [housenumber, street, props.name, locality].filter(Boolean).join(" ");
  if (!acceptsHit(query, matchText, { housenumber, postcode })) return null;

  const kind = props.osm_key === "highway"
    ? "highway"
    : isPlace
      ? "place"
      : housenumber
        ? "house"
        : "other";
  const card = buildCard({
    housenumber,
    street,
    place: namedPlace,
    postcode,
    district: props.district || ([props.town, props.village, props.hamlet].find((part) => part && part !== city) || ""),
  });
  return finishHit(query, {
    ...card,
    lat,
    lon,
    housenumber,
    street,
    postcode,
    kind,
    matchText,
    importance: 0,
    townBonus: exactTownBonus(query, { locality, placeName }),
  });
}

function nominatimItemToHit(item, query) {
  const lat = Number(item?.lat);
  const lon = Number(item?.lon);
  const address = item?.address || {};
  const category = String(item?.class || item?.category || "").toLowerCase();
  if (WEAK_KEYS.has(category)) return null;
  if (!isOntarioLocation({
    state: address.state,
    country: address.country_code || address.country,
    lat,
    lon,
  })) return null;

  const street = address.road || "";
  const city = address.city || address.town || address.village || address.hamlet || address.municipality || "";
  const locality = [address.city, address.town, address.village, address.hamlet, address.municipality].filter(Boolean).join(" ");
  const placeName = category === "place" || category === "boundary" ? (item?.name || "") : "";
  if (!matchesExplicitTown(query, { locality, placeName })) return null;
  const housenumber = address.house_number || "";
  const postcode = address.postcode || "";
  const matchText = [housenumber, street, placeName, locality].filter(Boolean).join(" ");
  if (!acceptsHit(query, matchText, { housenumber, postcode })) return null;

  const kind = category === "highway"
    ? "highway"
    : placeName
      ? "place"
      : housenumber
        ? "house"
        : street
          ? "highway"
          : "place";
  const card = buildCard({
    housenumber,
    street,
    place: placeName || city || (!street && !housenumber ? item?.name || "" : ""),
    postcode,
    district: address.suburb || address.city_district || "",
  });
  return finishHit(query, {
    ...card,
    lat,
    lon,
    housenumber,
    street,
    postcode,
    kind,
    matchText,
    importance: Number(item?.importance) || 0,
    townBonus: exactTownBonus(query, { locality, placeName }),
  });
}

function publish(results) {
  const seen = new Set();
  const ranked = results
    .filter((item) => item && item.label && Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const key = item.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 7)
    .map((item) => ({
      label: item.label,
      primary: item.primary,
      secondary: item.secondary,
      lat: item.lat,
      lon: item.lon,
      precision: item.precision,
      hint: item.hint || "",
    }));
  return ranked;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function photonSearch(query, fetchImpl) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  url.searchParams.set("bbox", PHOTON_BBOX);
  try {
    await pace("photon");
    const res = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": NOMINATIM_USER_AGENT,
      },
    });
    if (res.status === 429) return { ok: false, error: "busy", results: [] };
    if (!res.ok) return { ok: false, error: "failed", results: [] };
    const data = await readJson(res);
    const features = Array.isArray(data?.features) ? data.features : [];
    return { ok: true, results: features.map((feature) => photonFeatureToHit(feature, query)).filter(Boolean) };
  } catch {
    return { ok: false, error: "failed", results: [] };
  }
}

async function nominatimSearch(query, fetchImpl, extra = {}) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("dedupe", "1");
  url.searchParams.set("viewbox", NOMINATIM_VIEWBOX);
  url.searchParams.set("bounded", "0");
  const structured = Boolean(extra.street || extra.city || extra.postalcode);
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value);
  }
  if (!structured && query) url.searchParams.set("q", query);

  try {
    await pace("nominatim");
    const res = await fetchImpl(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "en",
      },
    });
    if (res.status === 429) return { ok: false, error: "busy", results: [] };
    if (!res.ok) return { ok: false, error: "failed", results: [] };
    const data = await readJson(res);
    const rows = Array.isArray(data) ? data : [];
    return { ok: true, results: rows.map((item) => nominatimItemToHit(item, query)).filter(Boolean) };
  } catch {
    return { ok: false, error: "failed", results: [] };
  }
}

function structuredFrom(query) {
  const postal = postalInQuery(query);
  const parts = commaParts(query);
  const street = (parts.find((part) => looksLikeStreet(part)) || "").replace(postal, "").trim();
  const city = parts.find((part) => !isSkippablePart(part) && !looksLikeStreet(part)) || "";
  if (!street && !city) return null;
  return {
    street,
    city,
    state: "Ontario",
    country: "Canada",
    postalcode: postal ? formatPostal(postal) : "",
  };
}

function fallbackQueries(query) {
  const postal = postalInQuery(query);
  const fsa = postal ? postal.slice(0, 3) : fsaInQuery(query);
  const town = commaParts(query).filter((part) => !isSkippablePart(part) && !looksLikeStreet(part)).join(", ");
  const bare = norm(commaParts(query).filter((part) => !isSkippablePart(part)).join(", "));
  const list = [];
  if (town && norm(town) !== bare && norm(town) !== norm(query)) {
    list.push({ q: `${town}, Ontario`, precision: "place", hint: HINTS.place });
  }
  if (postal) list.push({ q: formatPostal(postal), precision: "postal", hint: HINTS.postal });
  if (fsa && fsa !== postal) list.push({ q: fsa, precision: "postal", hint: HINTS.postal });
  return list;
}

function preferPlaces(results) {
  const places = results.filter((item) => item.kind === "place");
  return places.length ? places : results;
}

function retag(results, precision, hint) {
  return results.map((item) => ({
    ...item,
    precision,
    hint,
  }));
}

async function searchOne(query, fetchImpl, tried, transport) {
  const key = norm(query);
  if (!key || tried.has(key)) return [];
  tried.add(key);

  const photon = await photonSearch(query, fetchImpl);
  if (!photon.ok) transport.error = photon.error || transport.error;
  if (photon.results.length) return photon.results;

  let nominatim = await nominatimSearch(query, fetchImpl);
  if (!nominatim.ok) transport.error = nominatim.error || transport.error;
  if (!nominatim.results.length && !mentionsOntario(query)) {
    const again = await nominatimSearch(`${query}, Ontario, Canada`, fetchImpl);
    if (!again.ok) transport.error = again.error || transport.error;
    else nominatim = again;
  }
  return nominatim.results;
}

export async function searchAddresses(query, { fetchImpl = fetch } = {}) {
  const q = String(query || "").trim();
  if (q.length < 3) return { results: [], error: "", hint: "" };

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { results: hit.results, error: hit.error, hint: hit.hint || "", cached: true };
  }

  return enqueue(async () => {
    const again = cache.get(key);
    if (again && Date.now() - again.at < CACHE_TTL_MS) {
      return { results: again.results, error: again.error, hint: again.hint || "", cached: true };
    }

    const tried = new Set();
    const transport = { error: "" };
    try {
      let found = await searchOne(q, fetchImpl, tried, transport);
      if (!found.length) {
        const structured = structuredFrom(q);
        if (structured) {
          const extra = await nominatimSearch(q, fetchImpl, structured);
          if (!extra.ok) transport.error = extra.error || transport.error;
          found = extra.results;
        }
      }
      if (!found.length) {
        for (const fallback of fallbackQueries(q)) {
          const matches = await searchOne(fallback.q, fetchImpl, tried, transport);
          if (!matches.length) continue;
          found = retag(preferPlaces(matches), fallback.precision, fallback.hint);
          break;
        }
      }

      const results = publish(found);
      if (!results.length && transport.error) {
        const error = transport.error === "busy"
          ? "Address search is busy. Wait a moment and try again, or enter kilometres manually."
          : "Address search is unavailable right now. Enter kilometres manually.";
        return { results: [], error, hint: "" };
      }

      const error = results.length
        ? ""
        : "No matching address in Ontario, Canada. Check the town, or enter kilometres manually.";
      const hint = results[0]?.hint || "";
      cache.set(key, { at: Date.now(), results, error, hint });
      return { results, error, hint };
    } catch {
      return {
        results: [],
        error: "Address search is unavailable right now. Enter kilometres manually.",
        hint: "",
      };
    }
  });
}
