import { app, BrowserWindow } from "electron";
import path from "path";
import { createServer } from "http";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 5173;
const startUrl = process.env.ELECTRON_START_URL || `http://127.0.0.1:${PORT}`;
let server;

function getDistPath() {
  return path.resolve(__dirname, "../dist");
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  if (filePath.endsWith(".woff")) return "font/woff";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  return "text/plain";
}

async function handleRequest(req, res) {
  const requestPath = req.url ? new URL(req.url, `http://localhost`).pathname : "/";
  const distPath = getDistPath();
  let filePath = path.join(distPath, decodeURIComponent(requestPath));

  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    filePath = path.join(distPath, "index.html");
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function createStaticServer() {
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => handleRequest(req, res));
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.removeMenu();
  win.loadURL(startUrl);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (server && typeof server.close === "function") {
    server.close();
  }
});

app.whenReady().then(async () => {
  if (!process.env.ELECTRON_START_URL) {
    try {
      await createStaticServer();
    } catch (error) {
      console.error("Electron failed to start local server:", error);
      app.quit();
      return;
    }
  }

  createWindow();
});
