import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { attachWebSocketChat } from "./ws-chat.js";
import { LocalRAG } from "./rag.js";

const port = Number(process.env.V2_API_PORT || 4180);

async function main() {
  const { app, personaRepo } = await createApp();

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

  // -----------------------------------------------------------------------
  // Initialize local RAG (embeddings via Ollama)
  // -----------------------------------------------------------------------
  const rag = new LocalRAG({ ollamaUrl });

  // Index manifeste files asynchronously (non-blocking)
  (async () => {
    try {
      for (const file of ["data/manifeste.md", "data/manifeste_references_nouvelles.md"]) {
        const filePath = path.resolve(process.cwd(), file);
        if (fs.existsSync(filePath)) {
          const text = fs.readFileSync(filePath, "utf-8");
          const count = await rag.addDocument(text, file);
          console.log(`[rag] Indexed ${file}: ${count} chunks`);
        }
      }
      console.log(`[rag] Ready: ${rag.size} total chunks`);
    } catch (err) {
      console.error("[rag] Init failed:", err);
    }
  })();

  attachWebSocketChat(server, {
    ollamaUrl,
    rag,
    loadPersonas: async () => {
      const list = await personaRepo.list();
      return list.map((p) => ({
        id: p.id,
        nick: p.name,
        model: p.model,
        systemPrompt: p.summary,
        color: "",
        enabled: !(p as unknown as { disabled?: boolean }).disabled,
      }));
    },
  });

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
