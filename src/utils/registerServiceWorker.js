import { isAuthReturnUrl } from "./pwaPolicy.js";

export function registerAppServiceWorker() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (!import.meta.env.PROD) return;
  if (!window.isSecureContext) return;
  if (!("serviceWorker" in navigator)) return;
  if (isAuthReturnUrl(window.location.href)) return;
  if (window.__WRIGHTS_SW_REGISTERED__) return;
  window.__WRIGHTS_SW_REGISTERED__ = true;

  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (isAuthReturnUrl(window.location.href)) return;
    window.location.reload();
  });

  navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    type: "module",
    updateViaCache: "none",
  }).catch(() => {
    // The site still works in the browser tab if installation is unavailable.
  });
}
