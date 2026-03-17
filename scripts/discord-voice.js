#!/usr/bin/env node
/**
 * Discord Voice Bot — Pharmacius rejoint un salon vocal Discord
 *
 * Architecture:
 *   Discord Voice Channel → Bot capture audio → PCM buffer
 *   → faster-whisper STT → KXKM WebSocket (persona routing)
 *   → Ollama response → piper-tts TTS → PCM audio → Discord playback
 *
 * Setup:
 *   DISCORD_BOT_TOKEN     — Discord bot token
 *   DISCORD_VOICE_CHANNEL — Voice channel ID to join
 *   KXKM_WS_URL           — KXKM WebSocket (default: ws://localhost:3333/ws)
 *   PYTHON_BIN             — Python with faster-whisper + piper-tts
 *
 * Usage: node scripts/discord-voice.js
 */

const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioReceiveStream,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const { Transform } = require("node:stream");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const VOICE_CHANNEL = process.env.DISCORD_VOICE_CHANNEL || process.env.DISCORD_VOICE_CHANNEL_ID_2;
const KXKM_WS_URL = process.env.KXKM_WS_URL || "ws://localhost:3333/ws";
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(__dirname);

if (!TOKEN || !VOICE_CHANNEL) {
  console.error(`
Discord Voice Bot — Pharmacius
================================
Requires:
  DISCORD_BOT_TOKEN        — Bot token
  DISCORD_VOICE_CHANNEL    — Voice channel ID

Optional:
  KXKM_WS_URL              — WebSocket URL (default: ws://localhost:3333/ws)
  PYTHON_BIN                — Python binary (default: python3)
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// KXKM WebSocket
// ---------------------------------------------------------------------------

let kxkmWs = null;
let kxkmConnected = false;
let pendingResponse = null; // resolve callback for current response

function connectKXKM() {
  kxkmWs = new WebSocket(KXKM_WS_URL);
  kxkmWs.on("open", () => { kxkmConnected = true; console.log("[kxkm] Connected"); });
  kxkmWs.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "message" && msg.nick && msg.text && msg.color && pendingResponse) {
        // Persona response received
        const resolve = pendingResponse;
        pendingResponse = null;
        resolve({ nick: msg.nick, text: msg.text });
      }
    } catch {}
  });
  kxkmWs.on("close", () => {
    kxkmConnected = false;
    console.log("[kxkm] Disconnected, reconnecting...");
    setTimeout(connectKXKM, 5000);
  });
  kxkmWs.on("error", () => {});
}

function askKXKM(text) {
  return new Promise((resolve) => {
    if (!kxkmConnected) { resolve(null); return; }
    pendingResponse = resolve;
    kxkmWs.send(JSON.stringify({ type: "message", text }));
    // Timeout after 30s
    setTimeout(() => {
      if (pendingResponse === resolve) {
        pendingResponse = null;
        resolve(null);
      }
    }, 30_000);
  });
}

// ---------------------------------------------------------------------------
// STT: audio buffer → text via faster-whisper
// ---------------------------------------------------------------------------

async function transcribe(pcmBuffer) {
  const tmpFile = path.join("/tmp", `discord-voice-${Date.now()}.wav`);
  try {
    // Write WAV header + PCM data (16kHz, 16-bit, mono)
    const header = createWavHeader(pcmBuffer.length, 48000, 16, 2);
    fs.writeFileSync(tmpFile, Buffer.concat([header, pcmBuffer]));

    const scriptPath = path.join(SCRIPTS_DIR, "transcribe_audio.py");
    const { stdout } = await execFileAsync(PYTHON_BIN, [
      scriptPath, "--input", tmpFile, "--language", "fr",
    ], { timeout: 30_000 });

    const lastLine = stdout.trim().split("\n").pop() || "{}";
    const result = JSON.parse(lastLine);
    return result.transcript || null;
  } catch (err) {
    console.error(`[stt] Error: ${err.message}`);
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function createWavHeader(dataLength, sampleRate, bitsPerSample, channels) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

// ---------------------------------------------------------------------------
// TTS: text → audio WAV via piper-tts
// ---------------------------------------------------------------------------

async function synthesize(text, nick) {
  const tmpFile = path.join("/tmp", `discord-tts-${Date.now()}.wav`);
  try {
    const scriptPath = path.join(SCRIPTS_DIR, "tts_synthesize.py");
    const voice = nick ? nick.toLowerCase().replace(/[^a-z]/g, "") : "schaeffer";
    await execFileAsync(PYTHON_BIN, [
      scriptPath, "--text", text.slice(0, 500), "--voice", voice, "--output", tmpFile,
    ], { timeout: 30_000 });
    return tmpFile;
  } catch (err) {
    console.error(`[tts] Error: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Discord client + voice
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const player = createAudioPlayer();
let connection = null;

client.once("ready", async () => {
  console.log(`[discord] Logged in as ${client.user.tag}`);

  // Find voice channel
  const channel = await client.channels.fetch(VOICE_CHANNEL);
  if (!channel?.isVoiceBased()) {
    console.error(`[discord] Channel ${VOICE_CHANNEL} is not a voice channel`);
    process.exit(1);
  }

  // Join voice channel
  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  connection.subscribe(player);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    console.log(`[discord] Joined voice channel: ${channel.name}`);
  } catch {
    console.error("[discord] Failed to join voice channel");
    process.exit(1);
  }

  // Listen for users speaking
  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    console.log(`[voice] User ${userId} started speaking`);

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1500 },
    });

    const chunks = [];
    audioStream.on("data", (chunk) => chunks.push(chunk));

    audioStream.on("end", async () => {
      if (chunks.length === 0) return;
      const pcmBuffer = Buffer.concat(chunks);
      console.log(`[voice] Captured ${(pcmBuffer.length / 1024).toFixed(0)} KB audio from ${userId}`);

      // STT
      const transcript = await transcribe(pcmBuffer);
      if (!transcript || transcript.length < 3) {
        console.log("[voice] No transcript, skipping");
        return;
      }
      console.log(`[stt] "${transcript}"`);

      // Ask KXKM personas
      const response = await askKXKM(transcript);
      if (!response) {
        console.log("[voice] No persona response");
        return;
      }
      console.log(`[persona] ${response.nick}: ${response.text.slice(0, 80)}`);

      // TTS
      const wavFile = await synthesize(response.text, response.nick);
      if (!wavFile) return;

      // Play audio in voice channel
      try {
        const resource = createAudioResource(wavFile);
        player.play(resource);
        console.log(`[tts] Playing response from ${response.nick}`);
      } catch (err) {
        console.error(`[play] Error: ${err.message}`);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log("╔══════════════════════════════════╗");
console.log("║  Pharmacius Discord Voice Bot    ║");
console.log("║  STT → Personas → TTS           ║");
console.log("╚══════════════════════════════════╝");
console.log(`  Voice Channel: ${VOICE_CHANNEL}`);
console.log(`  KXKM WS: ${KXKM_WS_URL}`);
console.log("");

connectKXKM();
client.login(TOKEN);

process.on("SIGINT", () => {
  console.log("\n[bot] Shutting down...");
  if (connection) connection.destroy();
  if (kxkmWs) kxkmWs.close();
  client.destroy();
  process.exit(0);
});
