import "dotenv/config";
import path from "path";
import fs from "fs";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app.js";
import { initRegistry } from "./src/bot/commandRegistry.js";
import { addLog } from "./src/bot/botEngine.js";

// Start dev server with Vite in full-stack mode
async function startServer() {
  // Build the command registry (built-ins + commands on disk) before serving.
  await initRegistry();

  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);
  const isProduction = process.env.NODE_ENV === "production";
  const distPath = path.join(process.cwd(), "dist");

  if (isProduction) {
    // Production: serve the built SPA statically.
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    // Dev: Vite dev server middleware setup (with static fallback if unavailable).
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (error: any) {
      console.warn("⚠️ Vite dev middleware unavailable; serving static build if present:", error?.message || error);
      if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get("*", (req, res) => {
          res.sendFile(path.join(distPath, "index.html"));
        });
      }
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    addLog(`🚀 Nebula Controller Panel is live on http://localhost:${PORT}`);
  });
}

startServer();
