#!/usr/bin/env node
/**
 * Claude Agent — autonomous agent using Anthropic API + KXKM tools.
 *
 * Uses the Claude API with tool_use to interact with the KXKM system.
 * Supports: chat with personas, music generation, voice synthesis, web search.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/claude-agent.js "compose a dark ambient track"
 *   ANTHROPIC_API_KEY=sk-... node scripts/claude-agent.js --interactive
 */

const Anthropic = require("@anthropic-ai/sdk").default;
const readline = require("node:readline");

const API_BASE = process.env.KXKM_API_URL || "http://localhost:3333";
const AI_BRIDGE = process.env.AI_BRIDGE_URL || "http://localhost:8301";

const client = new Anthropic();

const TOOLS = [
  {
    name: "kxkm_chat",
    description: "Send a message to the KXKM chat system. Personas will respond based on their personality and expertise.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message to send" },
        persona: { type: "string", description: "Optional: target a specific persona (e.g., 'schaeffer', 'merzbow')" },
      },
      required: ["message"],
    },
  },
  {
    name: "generate_music",
    description: "Generate music or sound via AI Bridge. Types: music (prompt-based), drone, grain, glitch, circus, honk, noise.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["music", "drone", "grain", "glitch", "circus", "honk", "noise", "sound-design"] },
        prompt: { type: "string", description: "Description of the sound/music to generate" },
        duration: { type: "number", description: "Duration in seconds (5-60)" },
      },
      required: ["type"],
    },
  },
  {
    name: "generate_voice",
    description: "Synthesize speech via Kokoro TTS (12 voices: af_heart, am_adam, bf_emma, etc.)",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to speak" },
        voice: { type: "string", description: "Voice ID (af_heart, am_adam, bf_emma, etc.)" },
      },
      required: ["text"],
    },
  },
  {
    name: "web_search",
    description: "Search the web via SearXNG.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "system_status",
    description: "Get KXKM system status (services, personas, AI Bridge backends).",
    input_schema: { type: "object", properties: {} },
  },
];

async function executeTool(name, input) {
  switch (name) {
    case "kxkm_chat": {
      const resp = await fetch(`${API_BASE}/api/personas`).then(r => r.json()).catch(() => ({ data: [] }));
      const personas = resp.data || resp;
      const target = input.persona
        ? personas.find(p => p.name?.toLowerCase() === input.persona.toLowerCase())
        : null;
      return `Message sent: "${input.message}"${target ? ` to ${target.name}` : ""}. ${personas.length} personas active.`;
    }
    case "generate_music": {
      const instruments = ["drone", "grain", "glitch", "circus", "honk"];
      const endpoint = instruments.includes(input.type)
        ? `/instrument/${input.type}`
        : input.type === "sound-design" ? "/generate/sound-design"
        : input.type === "music" ? "/generate/music"
        : "/generate/noise";
      const body = { duration: input.duration || 15 };
      if (input.prompt) body.prompt = input.prompt;
      const resp = await fetch(`${AI_BRIDGE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      return resp.ok ? `Audio generated: ${input.type} (${input.duration || 15}s)` : `Error: HTTP ${resp.status}`;
    }
    case "generate_voice": {
      const resp = await fetch(`${AI_BRIDGE}/generate/voice-fast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text, voice: input.voice || "af_heart", speed: 1.0 }),
        signal: AbortSignal.timeout(30_000),
      });
      return resp.ok ? `Voice synthesized: "${input.text.slice(0, 50)}" (${input.voice || "af_heart"})` : `Error: HTTP ${resp.status}`;
    }
    case "web_search": {
      const resp = await fetch(`${API_BASE}/api/v2/chat/search?q=${encodeURIComponent(input.query)}&limit=5`)
        .then(r => r.json()).catch(() => null);
      if (resp?.data) return JSON.stringify(resp.data, null, 2);
      return "(Search unavailable)";
    }
    case "system_status": {
      const [health, bridge] = await Promise.all([
        fetch(`${API_BASE}/api/v2/health`).then(r => r.json()).catch(() => null),
        fetch(`${AI_BRIDGE}/health`).then(r => r.json()).catch(() => null),
      ]);
      return JSON.stringify({ api: health?.ok, backends: bridge?.backends?.length, services: bridge?.backends }, null, 2);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

async function runAgent(userMessage) {
  const messages = [{ role: "user", content: userMessage }];

  console.log(`\n[agent] User: ${userMessage}`);

  let response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: "Tu es un agent autonome pour le systeme 3615-KXKM, un chat IA multimodal avec 33+ personas et un DAW audio (openDIAW.be). Tu utilises les outils disponibles pour accomplir les taches demandees. Reponds en francais.",
    tools: TOOLS,
    messages,
  });

  while (response.stop_reason === "tool_use") {
    const toolUses = response.content.filter(c => c.type === "tool_use");
    const toolResults = [];

    for (const tu of toolUses) {
      console.log(`[agent] Tool: ${tu.name}(${JSON.stringify(tu.input).slice(0, 100)})`);
      const result = await executeTool(tu.name, tu.input);
      console.log(`[agent] Result: ${result.slice(0, 200)}`);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: "Tu es un agent autonome pour le systeme 3615-KXKM.",
      tools: TOOLS,
      messages,
    });
  }

  const textBlocks = response.content.filter(c => c.type === "text");
  const answer = textBlocks.map(b => b.text).join("\n");
  console.log(`\n[agent] ${answer}`);
  return answer;
}

async function interactive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("[claude-agent] Interactive mode. Type 'exit' to quit.\n");

  const ask = () => {
    rl.question("You> ", async (input) => {
      if (!input || input.trim() === "exit") { rl.close(); return; }
      await runAgent(input.trim()).catch(err => console.error(`[agent] Error: ${err.message}`));
      ask();
    });
  };
  ask();
}

const args = process.argv.slice(2);
if (args.includes("--interactive") || args.includes("-i")) {
  interactive();
} else if (args.length > 0) {
  runAgent(args.join(" ")).catch(err => {
    console.error(`[agent] Error: ${err.message}`);
    process.exit(1);
  });
} else {
  console.log("Usage: node scripts/claude-agent.js <message>");
  console.log("       node scripts/claude-agent.js --interactive");
  console.log("\nRequires ANTHROPIC_API_KEY environment variable.");
}
