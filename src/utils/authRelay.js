import { mailRedirectPending, readAuthInteraction, shouldRelayAuthReturn } from "./mailAuthority.js";

/**
 * MSAL waits on a same-origin BroadcastChannel for the popup reply.
 * The quoting app must not boot on that reply: its startup reads the
 * Microsoft hash and never posts the channel message, so the opener
 * reports timed_out after the sign-in page has already finished.
 * The redirect address stays the one already registered in Azure.
 */
export async function relayAuthReturn(loc = window.location, storage = window.sessionStorage) {
  try {
    const pending = mailRedirectPending(storage);
    const kind = readAuthInteraction(loc.hash, loc.search);
    if (!shouldRelayAuthReturn(loc.hash, loc.search, { mailRedirectPending: pending })) return false;
    const { broadcastResponseToMainFrame } = await import("@azure/msal-browser/redirect-bridge");
    await broadcastResponseToMainFrame();
    if (kind === "popup") {
      const root = document.getElementById("root");
      if (root) {
        root.textContent = "Sign-in finished. This window should close on its own. If it stays open, close it and go back to the estimate.";
      }
      try {
        window.close();
      } catch {
        // The opener already has the sign-in.
      }
    }
    return true;
  } catch {
    return false;
  }
}
