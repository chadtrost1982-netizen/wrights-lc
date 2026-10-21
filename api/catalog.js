import { handleCatalog } from "../server/http/catalog.js";

export default function handler(req, res) {
  return handleCatalog(req, res);
}
