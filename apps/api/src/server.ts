import http from "node:http";
import path from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { attachWebSocketChat } from "./ws-chat.js";

const port = Number(process.env.V2_API_PORT || 4180);

async function main() {
  const app = await createApp();

  // -----------------------------------------------------------------------
  // Serve V2 web build (Vite output) as static files
  // -----------------------------------------------------------------------
  const webDistPath = process.env.WEB_DIST_PATH || path.resolve(process.cwd(), "apps/web/dist");
  app.use(express.static(webDistPath));

  // SPA fallback — serve index.html for unmatched non-API routes
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    if (req.path === "/ws") return next();
    res.sendFile(path.join(webDistPath, "index.html"), (err) => {
      if (err) next(); // If index.html doesn't exist, fall through
    });
  });

  // -----------------------------------------------------------------------
  // Create HTTP server and attach WebSocket chat
  // -----------------------------------------------------------------------
  const server = http.createServer(app);

  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  attachWebSocketChat(server, { ollamaUrl });

  server.listen(port, () => {
    console.log(JSON.stringify({
      ok: true,
      app: "@kxkm/api",
      port,
      ws: "/ws",
      ollama: ollamaUrl,
    }));
  });
}

main().catch((err) => {
  console.error("Failed to start @kxkm/api:", err);
  process.exit(1);
});
