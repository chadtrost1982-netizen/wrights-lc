import { authorizeRequest } from "../auth.js";
import { getPublicCatalog } from "../pricing.js";
import { sendJson } from "./send.js";

export async function handleCatalog(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const auth = await authorizeRequest(req.headers || {});
  if (!auth.ok) {
    sendJson(res, auth.status || 401, { error: auth.error || "Not allowed" });
    return;
  }
  sendJson(res, 200, getPublicCatalog());
}
