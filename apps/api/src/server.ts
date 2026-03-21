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
import crypto from "node:crypto";
import logger from "./logger.js";

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

const port = Number(process.env.V2_API_PORT || 4180);

async function main() {
  const { app, personaRepo } = await createApp();

  // -----------------------------------------------------------------------
  // Serve V2 web build (Vite output) as static files
  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // Serve AI-generated samples for openDIAW.be import
  // -----------------------------------------------------------------------
  const dawSamplesDir = path.join(process.cwd(), "data", "daw-samples");
  fs.mkdirSync(dawSamplesDir, { recursive: true });
  app.use("/daw/samples", express.static(dawSamplesDir, {
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
  }));

  // POST /api/v2/daw/samples — upload a generated sample
  app.post("/api/v2/daw/samples", express.raw({ type: "audio/*", limit: "50mb" }), (req, res) => {
    const id = crypto.randomUUID();
    const name = (req.query.name as string) || id;
    const type = (req.query.type as string) || "music";
    const duration = parseFloat(req.query.duration as string) || 0;
    const filename = `${id}.wav`;
    fs.writeFileSync(path.join(dawSamplesDir, filename), req.body);
    // Save metadata
    const meta = { id, name, type, duration, filename, url: `/daw/samples/${filename}`, createdAt: new Date().toISOString() };
    fs.appendFileSync(path.join(dawSamplesDir, "index.jsonl"), JSON.stringify(meta) + "\n");
    res.json({ ok: true, data: meta });
  });

  // GET /api/v2/daw/samples — list all available samples
  app.get("/api/v2/daw/samples", (req, res) => {
    const indexPath = path.join(dawSamplesDir, "index.jsonl");
    if (!fs.existsSync(indexPath)) return res.json({ ok: true, data: [] });
    const lines = fs.readFileSync(indexPath, "utf-8").trim().split("\n").filter(Boolean);
    const samples = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json({ ok: true, data: samples });
  });

  // DELETE /api/v2/daw/samples/:id — delete a sample
  app.delete("/api/v2/daw/samples/:id", (req, res) => {
    const indexPath = path.join(dawSamplesDir, "index.jsonl");
    if (!fs.existsSync(indexPath)) return res.json({ ok: true });
    const lines = fs.readFileSync(indexPath, "utf-8").trim().split("\n").filter(Boolean);
    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const entry = entries.find((e: any) => e.id === req.params.id);
    if (entry?.filename) {
      const filepath = path.join(dawSamplesDir, entry.filename);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    }
    const remaining = entries.filter((e: any) => e.id !== req.params.id);
    fs.writeFileSync(indexPath, remaining.map((e: any) => JSON.stringify(e)).join("\n") + (remaining.length ? "\n" : ""));
    res.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // Serve openDIAW.be studio at /daw with COOP/COEP headers
  // -----------------------------------------------------------------------
  const dawDistPath = process.env.DAW_DIST_PATH || "/home/kxkm/openDAW/packages/app/studio/dist";
  app.use("/daw", (req, res, next) => {
    // Required for crossOriginIsolated (SharedArrayBuffer, AudioWorklet)
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  }, express.static(dawDistPath));
  // SPA fallback for /daw (only for paths without file extension)
  app.get("/daw/*", (req, res, next) => {
    if (path.extname(req.path)) return next();
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.sendFile(path.join(dawDistPath, "index.html"));
  });

  // AI Bridge proxy — forward /api/v2/ai-bridge/* to localhost:8301/*
  const AI_BRIDGE_URL = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
  app.all("/api/v2/ai-bridge/*", async (req, res) => {
    const targetPath = req.path.replace("/api/v2/ai-bridge", "");
    const targetUrl = `${AI_BRIDGE_URL}${targetPath}`;
    try {
      const headers: Record<string, string> = { "Content-Type": req.headers["content-type"] || "application/json" };
      const resp = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.method !== "GET" ? JSON.stringify(req.body) : undefined,
        signal: AbortSignal.timeout(300_000),
      });
      // Forward content-type and binary body
      const ct = resp.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", ct);
      res.status(resp.status);
      const buf = Buffer.from(await resp.arrayBuffer());
      res.send(buf);
    } catch (err) {
      res.status(502).json({ error: `AI Bridge unavailable: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // Local proxy for openDIAW.be API calls (replaces api.opendaw.studio)
  app.all("/api/opendaw/*", (req, res) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.path.includes("list")) return res.json(req.path.includes("music") ? {tracks:[]} : []);
    if (req.path.includes("counter")) return res.json({ ok: true });
    res.json({ ok: true });
  });
  app.all("/api/opendaw-logs/*", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({ ok: true });
  });

  // openDIAW.be files at root — ONLY serve files with build UUID pattern in filename
  // This prevents intercepting main app files (index.html, assets/, etc.)
  const dawUuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/ws" || req.path.startsWith("/daw")) return next();
    // Only serve if filename contains build UUID (e.g., main.048779e6-xxxx.js)
    if (!dawUuidPattern.test(req.path) && !req.path.startsWith("/processors.") && !req.path.startsWith("/graph-runtime.") && !req.path.startsWith("/index.") && req.path !== "/favicon.svg" && req.path !== "/build-info.json" && !req.path.startsWith("/assets/")) return next();
    const dawFile = path.join(dawDistPath, req.path);
    if (fs.existsSync(dawFile) && fs.statSync(dawFile).isFile()) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      return res.sendFile(dawFile);
    }
    next();
  });

  // Serve exported files (history-export, etc.)
  app.use("/api/v2/media/exports", express.static(path.join(process.cwd(), "data", "exports")));

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
  // Pre-warm Ollama: load primary model into VRAM (non-blocking)
  // First inference is ~1-2s slower without this.
  // -----------------------------------------------------------------------
  const primaryModel = process.env.OLLAMA_MODEL || "qwen3.5:9b";
  fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: primaryModel,
      messages: [{ role: "user", content: "ping" }],
      stream: false,
      options: { num_predict: 1, num_ctx: 512 },
      keep_alive: "30m",
    }),
  }).then(() => {
    if (DEBUG) console.log(`[ollama] Pre-warmed ${primaryModel}`);
  }).catch(() => {
    // Ollama not ready yet — model will load on first real request
  });

  // Pre-warm ComfyUI: load default checkpoint into VRAM (non-blocking)
  import("./comfyui.js").then(({ preloadComfyUIModel }) => {
    preloadComfyUIModel().catch(() => {});
  });

  // -----------------------------------------------------------------------
  // Initialize local RAG (embeddings via Ollama)
  // -----------------------------------------------------------------------
  const rag = new LocalRAG({ ollamaUrl, lightragUrl: process.env.LIGHTRAG_URL, rerankerUrl: process.env.RERANKER_URL });
  // Expose RAG instance on app for API routes
  (app as any)._rag = rag;

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
      await rag.init(); // verify / pull embedding model
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

  const wss = attachWebSocketChat(server, {
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

  // --- Graceful shutdown (lot-74) ---
  function gracefulShutdown(signal: string) {
    logger.info({ signal }, "Shutting down gracefully...");
    if (wss) wss.close();
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => { process.exit(1); }, 10000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

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
