import { useEffect, useState } from "react";

function runningStandalone() {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const fullscreen = window.matchMedia?.("(display-mode: fullscreen)")?.matches;
  return Boolean(standalone || fullscreen || window.navigator.standalone);
}

export default function InstallAppButton() {
  const [promptEvent, setPromptEvent] = useState(null);

  useEffect(() => {
    if (runningStandalone()) return undefined;
    const onPrompt = (event) => {
      event.preventDefault();
      setPromptEvent(event);
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!promptEvent || runningStandalone()) return null;

  const install = async () => {
    promptEvent.prompt();
    try {
      await promptEvent.userChoice;
    } catch {
      // The browser closed the prompt.
    }
    setPromptEvent(null);
  };

  return (
    <button type="button" className="install-app" onClick={install}>
      Install app
    </button>
  );
}
