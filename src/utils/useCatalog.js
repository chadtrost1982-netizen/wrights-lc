import { useCallback, useEffect, useState } from "react";
import { fetchCatalog, setCatalogPassword } from "./catalogClient.js";
import { getIdToken } from "./oneDriveGraph.js";

async function readCatalog(password) {
  if (typeof password === "string") setCatalogPassword(password);
  const idToken = await getIdToken();
  return fetchCatalog({ idToken, force: typeof password === "string" });
}

export function useCatalog() {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);

  const applyResult = useCallback((data) => {
    setCatalog(data);
    setNeedsPassword(false);
    setError("");
    setLoading(false);
  }, []);

  const applyError = useCallback((err) => {
    setCatalog(null);
    const status = Number(err?.status || 0);
    setNeedsPassword(status === 401 || status === 403 || status === 503);
    setError(err?.message || "Could not load prices.");
    setLoading(false);
  }, []);

  const reload = useCallback(async (password) => {
    setLoading(true);
    setError("");
    try {
      applyResult(await readCatalog(password));
    } catch (err) {
      applyError(err);
    }
  }, [applyError, applyResult]);

  useEffect(() => {
    let cancelled = false;
    readCatalog()
      .then((data) => {
        if (!cancelled) applyResult(data);
      })
      .catch((err) => {
        if (!cancelled) applyError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [applyError, applyResult]);

  return { catalog, loading, error, needsPassword, reload };
}