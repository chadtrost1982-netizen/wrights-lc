import { relayAuthReturn } from "./utils/authRelay.js";

const skipApp = await relayAuthReturn();
if (!skipApp) {
  await import("./main.jsx");
}
