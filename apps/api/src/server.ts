import http from "node:http";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { attachWebSocketChat } from "./ws-chat.js";
import { DEFAULT_PERSONAS } from "./personas-default.js";
import { LocalRAG } from "./rag.js";
import { ContextStore } from "./context-store.js";

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

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
  // Try multiple paths: relative to cwd (inside container /app) and absolute on host
  const dataFiles = [
    "data/manifeste.md",
    "data/manifeste_references_nouvelles.md",
    // Also try absolute path on host (network_mode: host)
    "/home/kxkm/KXKM_Clown/data/manifeste.md",
    "/home/kxkm/KXKM_Clown/data/manifeste_references_nouvelles.md",
  ];

  (async () => {
    try {
      const indexed = new Set<string>();
      for (const file of dataFiles) {
        const filePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
        // Deduplicate by basename so we don't index the same file twice
        const basename = path.basename(filePath);
        if (indexed.has(basename)) continue;
        if (fs.existsSync(filePath)) {
          const text = await fsp.readFile(filePath, "utf-8");
          const count = await rag.addDocument(text, basename);
          if (DEBUG) console.log(`[rag] Indexed ${filePath}: ${count} chunks`);
          indexed.add(basename);
        }
      }
      if (DEBUG) console.log(`[rag] Ready: ${rag.size} total chunks`);
    } catch (err) {
      console.error("[rag] Init failed:", err);
    }
  })();

  // -----------------------------------------------------------------------
  // Initialize persistent context store (auto-compaction, 750 MB max)
  // -----------------------------------------------------------------------
  const contextStore = new ContextStore({
    ollamaUrl,
    maxTotalSizeMB: 750,
    maxEntriesBeforeCompact: 200,
    compactionModel: "qwen3:8b",
  });
  contextStore.init().then(() => {
    if (DEBUG) console.log("[context] Persistent context store ready");
  }).catch((err) => {
    console.error("[context] Init failed:", err);
  });

  attachWebSocketChat(server, {
    ollamaUrl,
    rag,
    contextStore,
    loadPersonas: async () => {
      const list = await personaRepo.list();
      return list.map((p) => {
        const defaultDef = DEFAULT_PERSONAS.find((d) => d.id === p.id);
        return {
          id: p.id,
          nick: p.name,
          model: defaultDef?.model || p.model,
          systemPrompt: defaultDef?.systemPrompt || p.summary,
          color: defaultDef?.color || "",
          enabled: !(p as unknown as { disabled?: boolean }).disabled,
          maxTokens: defaultDef?.maxTokens,
        };
      });
    },
  });

  server.listen(port, () => {
    if (DEBUG) console.log(JSON.stringify({
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
