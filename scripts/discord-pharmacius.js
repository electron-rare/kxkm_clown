#!/usr/bin/env node
/**
 * Discord Pharmacius Bot — bridges KXKM chat ↔ Discord
 *
 * Architecture:
 *   Discord ← → Bot ← → KXKM WebSocket (ws://localhost:3333/ws)
 *
 * Features:
 *   - Forwards Discord messages to KXKM chat as user messages
 *   - Forwards KXKM persona responses back to Discord
 *   - Pharmacius orchestrator routes to appropriate personas
 *   - Supports @persona mentions in Discord → direct persona routing
 *   - Status presence shows online personas count
 *
 * Setup:
 *   1. Create a Discord bot at https://discord.com/developers/applications
 *   2. Enable Message Content Intent
 *   3. Set DISCORD_BOT_TOKEN in .env
 *   4. Set DISCORD_CHANNEL_ID for the target channel
 *   5. Run: node scripts/discord-pharmacius.js
 *
 * Env vars:
 *   DISCORD_BOT_TOKEN  — Discord bot token (required)
 *   DISCORD_CHANNEL_ID — Discord channel to bridge (required)
 *   KXKM_WS_URL        — KXKM WebSocket URL (default: ws://localhost:3333/ws)
 *   DISCORD_PREFIX      — Command prefix (default: !)
 */

const WebSocket = require("ws");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL = process.env.DISCORD_CHANNEL_ID;
const DISCORD_CHANNEL_2 = process.env.DISCORD_CHANNEL_ID_2;
const KXKM_WS_URL = process.env.KXKM_WS_URL || "ws://localhost:3333/ws";
const PREFIX = process.env.DISCORD_PREFIX || "!";

// All bridged text channels
const BRIDGED_CHANNELS = new Set([DISCORD_CHANNEL, DISCORD_CHANNEL_2].filter(Boolean));

if (!DISCORD_TOKEN || !DISCORD_CHANNEL) {
  console.error(`
Discord Pharmacius Bot
======================
Requires:
  DISCORD_BOT_TOKEN   — Your Discord bot token
  DISCORD_CHANNEL_ID  — Channel ID to bridge

Optional:
  KXKM_WS_URL         — WebSocket URL (default: ws://localhost:3333/ws)
  DISCORD_PREFIX       — Command prefix (default: !)

Example:
  DISCORD_BOT_TOKEN=xxx DISCORD_CHANNEL_ID=123 node scripts/discord-pharmacius.js
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// KXKM WebSocket connection
// ---------------------------------------------------------------------------

let kxkmWs = null;
let kxkmConnected = false;
const pendingMessages = [];

function connectKXKM() {
  console.log(`[kxkm] Connecting to ${KXKM_WS_URL}...`);
  kxkmWs = new WebSocket(KXKM_WS_URL);

  kxkmWs.on("open", () => {
    kxkmConnected = true;
    console.log("[kxkm] Connected");
    // Drain pending messages
    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift();
      kxkmWs.send(JSON.stringify(msg));
    }
  });

  kxkmWs.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleKXKMMessage(msg);
    } catch { /* ignore malformed */ }
  });

  kxkmWs.on("close", () => {
    kxkmConnected = false;
    console.log("[kxkm] Disconnected, reconnecting in 5s...");
    setTimeout(connectKXKM, 5000);
  });

  kxkmWs.on("error", (err) => {
    console.error(`[kxkm] Error: ${err.message}`);
  });
}

function sendToKXKM(msg) {
  if (kxkmConnected && kxkmWs?.readyState === WebSocket.OPEN) {
    kxkmWs.send(JSON.stringify(msg));
  } else {
    pendingMessages.push(msg);
  }
}

// ---------------------------------------------------------------------------
// Discord Gateway (minimal, no discord.js dependency)
// ---------------------------------------------------------------------------

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

let discordWs = null;
let heartbeatInterval = null;
let lastSequence = null;
let botUserId = null;

function connectDiscord() {
  console.log("[discord] Connecting to gateway...");
  discordWs = new WebSocket(DISCORD_GATEWAY);

  discordWs.on("open", () => {
    console.log("[discord] Gateway connected");
  });

  discordWs.on("message", (data) => {
    const payload = JSON.parse(data.toString());
    lastSequence = payload.s;

    switch (payload.op) {
      case 10: // Hello
        heartbeatInterval = setInterval(() => {
          discordWs.send(JSON.stringify({ op: 1, d: lastSequence }));
        }, payload.d.heartbeat_interval);

        // Identify
        discordWs.send(JSON.stringify({
          op: 2,
          d: {
            token: DISCORD_TOKEN,
            intents: 1 << 9 | 1 << 15, // GUILD_MESSAGES | MESSAGE_CONTENT
            properties: { os: "linux", browser: "kxkm", device: "pharmacius" },
            presence: {
              status: "online",
              activities: [{ name: "3615 KXKM", type: 0 }],
            },
          },
        }));
        break;

      case 11: // Heartbeat ACK
        break;

      case 0: // Dispatch
        handleDiscordDispatch(payload.t, payload.d);
        break;
    }
  });

  discordWs.on("close", (code) => {
    console.log(`[discord] Disconnected (${code}), reconnecting in 5s...`);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    setTimeout(connectDiscord, 5000);
  });

  discordWs.on("error", (err) => {
    console.error(`[discord] Error: ${err.message}`);
  });
}

function handleDiscordDispatch(event, data) {
  switch (event) {
    case "READY":
      botUserId = data.user.id;
      console.log(`[discord] Logged in as ${data.user.username}#${data.user.discriminator}`);
      break;

    case "MESSAGE_CREATE":
      // Ignore bot's own messages
      if (data.author.id === botUserId) return;
      // Only process messages in the target channel
      if (!BRIDGED_CHANNELS.has(data.channel_id)) return;

      handleDiscordMessage(data);
      break;
  }
}

async function sendToDiscord(content, channelId) {
  const targetChannel = channelId || DISCORD_CHANNEL;
  try {
    await fetch(`${DISCORD_API}/channels/${targetChannel}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
    });
  } catch (err) {
    console.error(`[discord] Send failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

function handleDiscordMessage(data) {
  const text = data.content.trim();
  const nick = data.author.username;
  const srcChannel = data.channel_id;

  // Commands
  if (text.startsWith(PREFIX)) {
    const cmd = text.slice(PREFIX.length).trim();
    if (cmd === "help") {
      sendToDiscord([
        "**Pharmacius — 3615 KXKM**",
        "`!personas` — Liste des personas actives",
        "`!status` — Statut du systeme",
        "`@PersonaName message` — Parler a une persona specifique",
        "Tout autre message est route par Pharmacius vers les personas.",
      ].join("\n"));
      return;
    }
    if (cmd === "personas" || cmd === "who") {
      sendToKXKM({ type: "message", text: "/personas" });
      return;
    }
    if (cmd === "status") {
      sendToKXKM({ type: "message", text: "/status" });
      return;
    }
  }

  // Forward to KXKM
  console.log(`[discord→kxkm] ${nick}: ${text.slice(0, 80)}`);
  sendToKXKM({ type: "message", text: `${nick}: ${text}` });
}

function handleKXKMMessage(msg) {
  // Forward persona responses to Discord
  if (msg.type === "message" && msg.nick && msg.text) {
    // Skip user echo (messages from Discord users forwarded back)
    if (msg.text.includes(": ") && !msg.color) return;

    const formatted = `**${msg.nick}**: ${msg.text}`;
    console.log(`[kxkm→discord] ${msg.nick}: ${msg.text.slice(0, 80)}`);
    sendToDiscord(formatted);
    return;
  }

  if (msg.type === "system" && msg.text) {
    // Forward system messages (typing indicators, search results, etc.)
    if (msg.text.includes("est en train d'ecrire")) return; // Skip typing
    sendToDiscord(`*${msg.text}*`);
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log("╔══════════════════════════════════╗");
console.log("║  Pharmacius Discord Bot          ║");
console.log("║  Bridge KXKM ↔ Discord          ║");
console.log("╚══════════════════════════════════╝");
console.log(`  KXKM WS: ${KXKM_WS_URL}`);
console.log(`  Discord Channel: ${DISCORD_CHANNEL}`);
console.log(`  Prefix: ${PREFIX}`);
console.log("");

connectKXKM();
connectDiscord();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[bot] Shutting down...");
  if (kxkmWs) kxkmWs.close();
  if (discordWs) discordWs.close();
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (kxkmWs) kxkmWs.close();
  if (discordWs) discordWs.close();
  process.exit(0);
});
