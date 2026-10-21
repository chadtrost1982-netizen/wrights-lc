import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

function applyServerEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

function attachApi(server) {
  server.middlewares.use(async (req, res, next) => {
    const path = String(req.url || "").split("?")[0];
    if (!path.startsWith("/api/")) return next();
    try {
      if (path === "/api/catalog") {
        const { handleCatalog } = await import("./server/http/catalog.js");
        await handleCatalog(req, res);
        return;
      }
      if (path === "/api/geocode") {
        const { handleGeocode } = await import("./server/http/geocode.js");
        await handleGeocode(req, res);
        return;
      }
      if (path === "/api/route") {
        const { handleRoute } = await import("./server/http/route.js");
        await handleRoute(req, res);
        return;
      }
      next();
    } catch {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Server error" }));
    }
  });
}

function wrightsApiPlugin(env) {
  return {
    name: "wrights-api",
    configureServer(server) {
      applyServerEnv(env);
      attachApi(server);
    },
    configurePreviewServer(server) {
      applyServerEnv(env);
      attachApi(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      wrightsApiPlugin(env),
    ],
  };
})
