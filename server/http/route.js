import { routeBetween } from "../routing.js";
import { readJsonBody, sendJson } from "./send.js";

export async function handleRoute(req, res) {
  if (req.method && req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Enter a start and destination, or type the kilometres." });
    return;
  }
  const result = await routeBetween(body.start, body.end);
  if (!result.ok) {
    sendJson(res, 422, { error: result.error || "Could not calculate a driving route. Enter kilometres manually." });
    return;
  }
  sendJson(res, 200, {
    distanceKm: result.distanceKm,
    durationMin: result.durationMin,
    geometry: result.geometry,
    start: result.start,
    end: result.end,
    provider: result.provider,
  });
}
