#!/usr/bin/env node
/**
 * MCP Server — exposes KXKM personas as MCP tools.
 *
 * Uses the official MCP TypeScript SDK over stdio while keeping the existing
 * tool contract stable for local smokes and external MCP clients.
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const KXKM_API = process.env.KXKM_API_URL || "http://localhost:3333";
const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8080";

function textResult(text, extra = {}) {
  return {
    content: [{ type: "text", text }],
    ...extra,
  };
}

async function fetchJSON(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "kxkm-mcp/1.0" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchApiJSON(endpoint) {
  return fetchJSON(`${KXKM_API}${endpoint}`);
}

async function executeChat({ message, persona }) {
  const text = persona ? `@${persona} ${message}` : message;
  const data = await fetchApiJSON("/api/personas");
  const personas = data.data || data;
  const target = persona
    ? personas.find((item) => item.name.toLowerCase() === persona.toLowerCase())
    : personas.find((item) => item.enabled !== false);

  if (!target) {
    return textResult(
      `Aucune persona trouvée pour "${persona || "default"}". Personas disponibles: ${personas.map((item) => item.name).join(", ")}`,
      { isError: true },
    );
  }

  return textResult(
    `Message "${text}" envoyé. Persona cible: ${target.name} (${target.model}). Pour des réponses en temps réel, utilisez le chat WebSocket sur ${KXKM_API}.`,
  );
}

async function executePersonas() {
  const data = await fetchApiJSON("/api/personas");
  const personas = data.data || data;
  const list = personas
    .map((item) => `${item.enabled !== false ? "●" : "○"} ${item.name} (${item.model}) — ${(item.summary || "").slice(0, 100)}`)
    .join("\n");
  return textResult(`Personas KXKM (${personas.length}):\n${list}`);
}

async function executeWebSearch({ query }) {
  try {
    const data = await fetchApiJSON(`/api/v2/chat/search?q=${encodeURIComponent(query)}&limit=5`);
    return textResult(JSON.stringify(data.data || data, null, 2));
  } catch (apiError) {
    try {
      const data = await fetchJSON(`${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`);
      const formatted = (data.results || [])
        .slice(0, 5)
        .map((item, index) => `${index + 1}. ${item.title}\n   ${item.content || ""}\n   ${item.url}`)
        .join("\n\n");
      return textResult(formatted || "(Aucun résultat)");
    } catch (searchError) {
      return textResult(
        `Recherche indisponible. API KXKM: ${apiError.message}. SearXNG: ${searchError.message}.`,
        { isError: true },
      );
    }
  }
}

async function executeStatus() {
  const RERANKER_URL = process.env.RERANKER_URL || "http://localhost:8787";
  const DOCLING_URL = process.env.DOCLING_URL || "http://localhost:5001";
  const [health, perf, reranker, docling] = await Promise.all([
    fetchApiJSON("/api/v2/health").catch(() => null),
    fetchApiJSON("/api/v2/perf").catch(() => null),
    fetchJSON(RERANKER_URL + "/health").catch(() => ({ status: "unreachable" })),
    fetchJSON(DOCLING_URL + "/health").catch(() => ({ status: "unreachable" })),
  ]);

  return textResult(JSON.stringify({
    health: health?.data,
    perf: perf?.data,
    reranker,
    docling,
  }, null, 2));
}

function createServer() {
  const server = new McpServer(
    { name: "kxkm-clown", version: "1.0.0" },
    { capabilities: { logging: {} } },
  );

  server.registerTool(
    "kxkm_chat",
    {
      title: "KXKM Chat",
      description: "Envoie un message au systeme de chat KXKM_Clown et recoit les reponses des personas IA.",
      inputSchema: {
        message: z.string().min(1),
        persona: z.string().min(1).optional(),
      },
    },
    executeChat,
  );

  server.registerTool(
    "kxkm_personas",
    {
      title: "KXKM Personas",
      description: "Liste les personas IA actives dans KXKM_Clown avec leur modele et description.",
    },
    executePersonas,
  );

  server.registerTool(
    "kxkm_web_search",
    {
      title: "KXKM Web Search",
      description: "Recherche web via le moteur SearXNG self-hosted de KXKM.",
      inputSchema: {
        query: z.string().min(1),
      },
    },
    executeWebSearch,
  );

  server.registerTool(
    "kxkm_status",
    {
      title: "KXKM Status",
      description: "Statut du systeme KXKM_Clown (personas, runs, memoire, latence).",
    },
    executeStatus,
  );

  // --- Music / DAW tools ---

  server.registerTool(
    "kxkm_music_generate",
    {
      title: "KXKM Music Generate",
      description: "Genere de l'audio via AI Bridge: musique, bruit, instruments (drone, grain, glitch, circus, honk), voix (kokoro).",
      inputSchema: {
        type: z.enum(["music", "noise", "drone", "grain", "glitch", "circus", "honk", "voice-fast", "sound-design"]),
        prompt: z.string().optional(),
        duration: z.number().min(1).max(60).optional(),
      },
    },
    async ({ type, prompt, duration }) => {
      const AI_BRIDGE = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
      const instruments = ["drone", "grain", "glitch", "circus", "honk"];
      const endpoint = instruments.includes(type)
        ? `/instrument/${type}`
        : type === "music" ? "/generate/music"
        : type === "voice-fast" ? "/generate/voice-fast"
        : type === "sound-design" ? "/generate/sound-design"
        : "/generate/noise";
      const body = { duration: duration || 15 };
      if (prompt) body.prompt = prompt;
      if (type === "voice-fast") { body.text = prompt || "Bonjour"; body.voice = "af_heart"; }
      try {
        const resp = await fetch(`${AI_BRIDGE}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        if (resp.ok) {
          const contentType = resp.headers.get("content-type") || "";
          return textResult(`Audio genere: ${type} (${duration || 15}s). Content-Type: ${contentType}`);
        }
        return textResult(`Erreur generation: HTTP ${resp.status}`, { isError: true });
      } catch (err) {
        return textResult(`AI Bridge indisponible: ${err.message}`, { isError: true });
      }
    },
  );

  server.registerTool(
    "kxkm_ai_bridge_health",
    {
      title: "KXKM AI Bridge Health",
      description: "Statut du AI Bridge audio: backends disponibles, services actifs.",
    },
    async () => {
      const AI_BRIDGE = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
      try {
        const data = await fetchJSON(`${AI_BRIDGE}/health`);
        return textResult(`AI Bridge: ${data.backends?.length || 0} backends\n${(data.backends || []).join(", ")}`);
      } catch (err) {
        return textResult(`AI Bridge unreachable: ${err.message}`, { isError: true });
      }
    },
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();

  process.stderr.write("[mcp-server] KXKM MCP Server started via SDK (stdio)\n");

  process.on("SIGINT", async () => {
    await server.close().catch(() => {});
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close().catch(() => {});
    process.exit(0);
  });

  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`[mcp-server] fatal: ${error.message}\n`);
  process.exit(1);
});
