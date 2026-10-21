import { handleRoute } from "../server/http/route.js";

export default function handler(req, res) {
  return handleRoute(req, res);
}
