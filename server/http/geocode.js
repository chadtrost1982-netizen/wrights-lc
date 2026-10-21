import { searchAddresses } from "../geocode.js";
import { sendJson } from "./send.js";

export async function handleGeocode(req, res) {
  if (req.method && req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const url = new URL(req.url || "/", "http://localhost");
  const q = url.searchParams.get("q") || "";
  const found = await searchAddresses(q);
  sendJson(res, 200, { results: found.results || [], error: found.error || "" });
}
