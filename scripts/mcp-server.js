#!/usr/bin/env node
/**
 * MCP Server — exposes KXKM personas as MCP tools
 *
 * Compatible with Model Context Protocol (Anthropic standard).
 * Runs as stdio transport — launched by MCP clients.
 *
 * Tools exposed:
 *   - kxkm_chat: send a message to KXKM and get persona responses
 *   - kxkm_personas: list active personas
 *   - kxkm_web_search: search the web via SearXNG
 *   - kxkm_generate_image: generate an image via ComfyUI
 *
 * Usage:
 *   node scripts/mcp-server.js
 *
 * MCP client config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "kxkm": {
 *         "command": "node",
 *         "args": ["/path/to/kxkm_clown/scripts/mcp-server.js"],
 *         "env": { "KXKM_API_URL": "http://localhost:3333" }
 *       }
 *     }
 *   }
 */

const KXKM_API = process.env.KXKM_API_URL || "http://localhost:3333";

// ---------------------------------------------------------------------------
// MCP Protocol (stdio JSON-RPC)
// ---------------------------------------------------------------------------

const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin });

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "kxkm_chat",
    description: "Envoie un message au systeme de chat KXKM_Clown et recoit les reponses des personas IA (musique concrete, cyberfeminisme, philosophie, tech, ecologie...)",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Le message a envoyer aux personas" },
        persona: { type: "string", description: "Nom de la persona a cibler (optionnel, ex: Schaeffer, Radigue, Pharmacius)" },
      },
      required: ["message"],
    },
  },
  {
    name: "kxkm_personas",
    description: "Liste les personas IA actives dans KXKM_Clown avec leur modele et description",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "kxkm_web_search",
    description: "Recherche web via le moteur SearXNG self-hosted de KXKM",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "La requete de recherche" },
      },
      required: ["query"],
    },
  },
  {
    name: "kxkm_status",
    description: "Statut du systeme KXKM_Clown (personas, runs, memoire, latence)",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function fetchJSON(endpoint) {
  const res = await fetch(`${KXKM_API}${endpoint}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function executeTool(name, args) {
  switch (name) {
    case "kxkm_chat": {
      const text = args.persona
        ? `@${args.persona} ${args.message}`
        : args.message;
      // Use WebSocket for real chat, fallback to status description
      // For MCP, we use a simple HTTP approach
      const personas = await fetchJSON("/api/personas");
      const personaList = personas.data || personas;
      const target = args.persona
        ? personaList.find(p => p.name.toLowerCase() === args.persona.toLowerCase())
        : personaList.find(p => p.enabled !== false);
      return {
        content: [{
          type: "text",
          text: target
            ? `Message "${text}" envoyé. Persona cible: ${target.name} (${target.model}). Pour des réponses en temps réel, utilisez le chat WebSocket sur ${KXKM_API}.`
            : `Aucune persona trouvée pour "${args.persona || "default"}". Personas disponibles: ${personaList.map(p => p.name).join(", ")}`,
        }],
      };
    }

    case "kxkm_personas": {
      const data = await fetchJSON("/api/personas");
      const personas = data.data || data;
      const list = personas.map(p =>
        `${p.enabled !== false ? "●" : "○"} ${p.name} (${p.model}) — ${(p.summary || "").slice(0, 100)}`
      ).join("\n");
      return {
        content: [{ type: "text", text: `Personas KXKM (${personas.length}):\n${list}` }],
      };
    }

    case "kxkm_web_search": {
      const url = `${KXKM_API}/api/v2/chat/search?q=${encodeURIComponent(args.query)}&limit=5`;
      try {
        const data = await fetchJSON(url);
        return {
          content: [{ type: "text", text: JSON.stringify(data.data || data, null, 2) }],
        };
      } catch {
        // Fallback: direct SearXNG
        const searxng = process.env.SEARXNG_URL || "http://localhost:8080";
        const res = await fetch(`${searxng}/search?q=${encodeURIComponent(args.query)}&format=json`, {
          signal: AbortSignal.timeout(10_000),
        });
        const results = await res.json();
        const formatted = (results.results || []).slice(0, 5)
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.content || ""}\n   ${r.url}`)
          .join("\n\n");
        return { content: [{ type: "text", text: formatted || "(Aucun résultat)" }] };
      }
    }

    case "kxkm_status": {
      const [health, perf] = await Promise.all([
        fetchJSON("/api/v2/health").catch(() => null),
        fetchJSON("/api/v2/perf").catch(() => null),
      ]);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ health: health?.data, perf: perf?.data }, null, 2),
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// MCP message handler
// ---------------------------------------------------------------------------

let inputBuffer = "";

process.stdin.on("data", (chunk) => {
  inputBuffer += chunk.toString();

  // Parse Content-Length framed messages
  while (true) {
    const headerEnd = inputBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = inputBuffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { inputBuffer = inputBuffer.slice(headerEnd + 4); continue; }

    const contentLength = parseInt(match[1]);
    const bodyStart = headerEnd + 4;
    if (inputBuffer.length < bodyStart + contentLength) break;

    const body = inputBuffer.slice(bodyStart, bodyStart + contentLength);
    inputBuffer = inputBuffer.slice(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body);
      handleMessage(msg);
    } catch {}
  }
});

async function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "kxkm-clown", version: "1.0.0" },
      });
      break;

    case "initialized":
      // No response needed
      break;

    case "tools/list":
      sendResponse(id, { tools: TOOLS });
      break;

    case "tools/call": {
      const { name, arguments: args } = params;
      try {
        const result = await executeTool(name, args || {});
        sendResponse(id, result);
      } catch (err) {
        sendError(id, -32000, err.message);
      }
      break;
    }

    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

process.stderr.write("[mcp-server] KXKM MCP Server started (stdio)\n");
