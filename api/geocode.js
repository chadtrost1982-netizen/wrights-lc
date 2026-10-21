import { handleGeocode } from "../server/http/geocode.js";

export default function handler(req, res) {
  return handleGeocode(req, res);
}
