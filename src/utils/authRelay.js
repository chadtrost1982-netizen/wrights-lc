import { readAuthInteraction, shouldRelayAuthReturn } from "./mailAuthority.js";

/**
 * MSAL waits on a same-origin BroadcastChannel for a popup reply.
 * Only that popup reply is handed back here. A full-page redirect must
 * boot the app, which finishes the email after handleRedirectPromise.
 * The redirect address stays the one already registered in Azure.
 */
export async function relayAuthReturn(loc = window.location) {
  try {
    const kind = readAuthInteraction(loc.hash, loc.search);
    if (!shouldRelayAuthReturn(loc.hash, loc.search)) return false;
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
