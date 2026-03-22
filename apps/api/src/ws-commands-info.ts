import { execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CommandContext, CommandHandlerDeps } from "./ws-commands-types.js";
import { getRecentErrors } from "./error-tracker.js";
import { loadPersonaMemory } from "./ws-persona-router.js";
import { getActiveComposition } from "./composition-store.js";
import type { OutboundMessage } from "./chat-types.js";
import { scheduler } from "./inference-scheduler.js";
import { listWorkflows } from "./comfyui.js";
import { GENERATE_COMMANDS } from "./ws-commands-generate.js";
import { CHAT_COMMANDS } from "./ws-commands-chat.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers for /status dashboard
// ---------------------------------------------------------------------------

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

function fmtMB(bytes: number): string {
  return `${Math.round(bytes / 1048576)}MB`;
}

/** Recursively count files in a directory, optionally filtering by extension. */
function countFilesRec(dir: string, exts?: Set<string>): number {
  try {
    let count = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        count += countFilesRec(path.join(dir, e.name), exts);
      } else if (!exts || exts.has(path.extname(e.name).toLowerCase())) {
        count++;
      }
    }
    return count;
  } catch { return 0; }
}

async function safeFetchJson<T>(url: string, timeoutMs = 3000): Promise<T | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    return await resp.json() as T;
  } catch { return null; }
}

export const INFO_COMMANDS = new Set([
  "/status", "/stats", "/session", "/time", "/date", "/version",
  "/changelog", "/fortune", "/speed", "/model", "/persona", "/personas-detail",
  "/models", "/memory", "/context", "/export", "/history", "/responders-info",
  "/reload", "/theme", "/dice", "/roll", "/flip", "/llm",
  "/clear-media",
  "/uptime",
  "/lot400",
  "/about",
  "/benchmark",
  "/ping",
  "/count",
  "/leaderboard",
  "/tts-voices",
  "/persona-voice",
  "/sys",
  "/persona-stats",
  "/credits",
  "/commands",
  "/server",
  "/lot500",
  "/matrix",
  "/neofetch",
  "/help-all",
  "/session-stats",
]);

export function createInfoCommandHandler(deps: CommandHandlerDeps) {
  const {
    send,
    broadcast,
    getPersonas,
    getMaxResponders,
    getActiveUserCount,
    getContextStore,
    refreshPersonas,
    getUserStats,
    getClients,
  } = deps;

  return async function handleInfoCommand({ ws, info, text }: CommandContext): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case "/status":
      case "/stats": {
        // Per-persona stats (Lot 428): /stats <persona_nick>
        const statsTarget = parts[1]?.toLowerCase();
        if (statsTarget) {
          const persona = getPersonas().find(p => p.nick.toLowerCase() === statsTarget);
          if (persona) {
            const mem = await loadPersonaMemory(persona.nick);
            const lines = [
              `=== Stats: ${persona.nick} ===`,
              `  Modele: ${persona.model}`,
              `  Memoire: ${mem.facts.length} faits retenus`,
              mem.facts.length > 0 ? `  Faits: ${mem.facts.slice(0, 5).join(", ")}` : "",
              mem.summary ? `  Resume: ${mem.summary}` : "",
              mem.lastUpdated ? `  Derniere MAJ: ${mem.lastUpdated}` : "",
            ].filter(Boolean);
            send(ws, { type: "system", text: lines.join("\n") });
            return;
          }
        }
        // ---------------------------------------------------------------
        // Comprehensive system dashboard — all fetches run in parallel
        // ---------------------------------------------------------------
        const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        const mascaradeUrl = process.env.MASCARADE_URL || "http://127.0.0.1:8100";
        const dataDir = path.join(process.cwd(), "data");

        // Fire all async probes in parallel
        const [
          mascaradeHealth,
          ollamaPs,
          ollamaTags,
          gpuInfo,
          perfData,
          comfyModels,
        ] = await Promise.all([
          // Mascarade health
          safeFetchJson<{ status?: string; providers?: string[] }>(`${mascaradeUrl}/health`),
          // Ollama running models
          safeFetchJson<{ models?: Array<{ name: string; size: number; size_vram?: number }> }>(`${ollamaUrl}/api/ps`),
          // Ollama available models
          safeFetchJson<{ models?: Array<{ name: string; size: number }> }>(`${ollamaUrl}/api/tags`),
          // GPU info via nvidia-smi
          (async () => {
            try {
              const { stdout } = await execFileAsync("nvidia-smi", [
                "--query-gpu=memory.used,memory.total,memory.free,utilization.gpu",
                "--format=csv,noheader,nounits",
              ], { timeout: 3000 });
              const p = stdout.trim().split(", ").map(Number);
              return { usedMB: p[0], totalMB: p[1], freeMB: p[2], utilPct: p[3] };
            } catch { return null; }
          })(),
          // Perf endpoint
          safeFetchJson<{ data?: { avg_latency_ms?: number; requests?: number; memory?: { rss_mb?: number } } }>(
            `http://127.0.0.1:${process.env.V2_API_PORT || 4180}/api/v2/perf`,
          ),
          // ComfyUI models
          safeFetchJson<{ data?: Array<{ type: string }> }>(
            `http://127.0.0.1:${process.env.V2_API_PORT || 4180}/api/v2/comfyui/models`,
          ),
        ]);

        // Sync data: memory, scheduler, file counts, command count
        const mem = process.memoryUsage();
        const totalRamMB = Math.round(os.totalmem() / 1048576);
        const schedMetrics = scheduler.getMetrics();
        const cmdCount = INFO_COMMANDS.size + GENERATE_COMMANDS.size + CHAT_COMMANDS.size;
        const workflows = listWorkflows();

        // File counts (sync but fast — cached by OS)
        const sampleCount = countFilesRec(path.join(dataDir, "daw-samples"), new Set([".wav", ".mp3", ".ogg", ".flac"]));
        const imageCount = countFilesRec(path.join(dataDir, "media", "images"), new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]));
        const audioCount = countFilesRec(path.join(dataDir, "media", "audio"), new Set([".wav", ".mp3", ".ogg", ".flac"]));
        const backupCount = countFilesRec(path.join(dataDir, "compositions"));

        // Message count
        let totalMsgs = 0;
        const ustats = getUserStats?.();
        if (ustats) { for (const [, s] of ustats) totalMsgs += s.messages; }

        // --- Build output ---
        const L: string[] = [];
        L.push("=== 3615 J'ai pete -- STATUS ===");
        L.push("");

        // SYSTEME
        L.push("SYSTEME");
        L.push(`  Uptime: ${fmtUptime(Math.floor(process.uptime()))}`);
        L.push(`  RAM: ${fmtMB(mem.rss)} / ${Math.round(totalRamMB / 1024)}GB`);
        L.push(`  Node: ${process.version}`);
        L.push(`  Commandes: ${cmdCount}`);
        L.push(`  Utilisateurs: ${getActiveUserCount()} | Personas: ${getPersonas().length}`);
        if (totalMsgs > 0) L.push(`  Messages traites: ${totalMsgs}`);
        L.push("");

        // LLM
        L.push("LLM");
        if (mascaradeHealth) {
          const providers = mascaradeHealth.providers?.join(", ") || "ollama";
          L.push(`  Mascarade: OK (${providers})`);
        } else {
          L.push(`  Mascarade: OFFLINE`);
        }
        if (ollamaPs?.models && ollamaPs.models.length > 0) {
          for (const m of ollamaPs.models) {
            const vram = m.size_vram ? ` (${(m.size_vram / 1e9).toFixed(1)}GB VRAM)` : "";
            L.push(`  Ollama: ${m.name} loaded${vram}`);
          }
        } else if (ollamaTags?.models) {
          L.push(`  Ollama: ${ollamaTags.models.length} modeles, aucun charge`);
        } else {
          L.push(`  Ollama: non disponible`);
        }
        if (gpuInfo) {
          L.push(`  VRAM: ${(gpuInfo.usedMB / 1024).toFixed(1)}GB / ${(gpuInfo.totalMB / 1024).toFixed(1)}GB (${(gpuInfo.freeMB / 1024).toFixed(1)}GB libre, GPU ${gpuInfo.utilPct}%)`);
        }
        L.push("");

        // AUDIO
        L.push("AUDIO");
        if (perfData?.data?.avg_latency_ms != null) {
          L.push(`  API avg latency: ${perfData.data.avg_latency_ms.toFixed(0)}ms`);
        }
        try {
          const { PERSONA_VOICES } = await import("./persona-voices.js");
          const voiceCount = Object.keys(PERSONA_VOICES).length;
          L.push(`  Voices: ${voiceCount} personas mappees`);
        } catch { /* voices module unavailable */ }
        L.push("");

        // GENERATION
        L.push("GENERATION");
        L.push(`  ComfyUI: ${workflows.length} workflows`);
        if (comfyModels?.data) {
          const checkpoints = comfyModels.data.filter(m => m.type === "checkpoint" || m.type === "checkpoints").length;
          if (checkpoints > 0) L.push(`  Checkpoints: ${checkpoints}`);
        }
        L.push(`  Scheduler: GPU ${schedMetrics.activeGpuTasks}/${1} (queue ${schedMetrics.gpuQueue}), CPU ${schedMetrics.activeCpuTasks}/${schedMetrics.maxCpuWorkers} (queue ${schedMetrics.cpuQueue})`);
        if (schedMetrics.totalSubmitted > 0) {
          L.push(`  Jobs: ${schedMetrics.totalCompleted}/${schedMetrics.totalSubmitted} done, ${schedMetrics.totalRejected} rejected`);
        }
        L.push("");

        // STOCKAGE
        L.push("STOCKAGE");
        L.push(`  Samples: ${sampleCount} fichiers`);
        L.push(`  Images: ${imageCount} fichiers`);
        L.push(`  Audio: ${audioCount} fichiers`);
        L.push(`  Compositions: ${backupCount} fichiers`);

        // Context store
        try {
          const cs = getContextStore?.();
          if (cs) {
            const gStats = await cs.getStats();
            L.push(`  Context: ${gStats.channels} canaux, ${gStats.totalSizeMB.toFixed(1)} MB`);
          }
        } catch { /* context stats unavailable */ }

        // Errors
        try {
          const recent = getRecentErrors(1);
          if (recent.length > 0) {
            L.push("");
            L.push(`DERNIERE ERREUR: [${recent[0].label}] ${recent[0].message}`);
          }
        } catch { /* error tracker unavailable */ }

        send(ws, { type: "system", text: L.join("\n") });
        return;
      }

      case "/session": {
        const sessionUptime = Math.floor(process.uptime());
        const sessionH = Math.floor(sessionUptime / 3600);
        const sessionM = Math.floor((sessionUptime % 3600) / 60);
        const sessionStats = getUserStats?.()?.get(info.nick);
        const connDuration = Math.floor((Date.now() - info.connectedAt) / 60000);
        const channelCount = new Set([...getClients?.()?.values() || []].map(c => c.channel)).size;
        const userCount = getClients?.()?.size || 0;
        send(ws, { type: "system", text: [
          `Session: ${info.nick}`,
          `  Canal: ${info.channel}`,
          `  Connecte: ${connDuration}min`,
          `  Messages: ${sessionStats?.messages || 0}`,
          `  Muted: ${[...info.mutedPersonas || []].join(", ") || "aucun"}`,
          `  Serveur uptime: ${sessionH}h${sessionM}m`,
          `  Utilisateurs: ${userCount}`,
          `  Canaux actifs: ${channelCount}`,
        ].join("\n") });
        return;
      }

      case "/time":
      case "/date": {
        const now = new Date();
        const formatted = now.toLocaleString("fr-FR", {
          timeZone: "Europe/Paris",
          weekday: "long", day: "numeric", month: "long", year: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
        send(ws, { type: "system", text: `${formatted}` });
        return;
      }

      case "/version": {
        send(ws, { type: "system", text: [
          "3615 J'ai pete — v2.0 (lot 440+)",
          `  Node: ${process.version}`,
          `  Commandes: ~134`,
          `  Personas: ${getPersonas().length}`,
          `  Uptime: ${Math.floor(process.uptime() / 60)}min`,
        ].join("\n") });
        return;
      }

      case "/changelog": {
        send(ws, { type: "system", text: [
          "=== CHANGELOG RECENT ===",
          "",
          "Lot 445-449: --seed, --style, tts-voices, persona-voice, changelog+",
          "Lot 440-444: aspect ratio, leaderboard, echo, scroll btn",
          "Lot 435-439: personas categories, trivia, fortune+",
          "Lot 430-434: /speak, /count, emoji health",
          "Lot 425-429: TTS clean, --no prompt, /story",
          "Lot 419-423: imagine-queue, haiku, timer",
          "Lot 414-418: /summarize, /translate, /benchmark",
          "Lot 408-413: variations, collab, radio, persona-create",
          "Lot 400: MILESTONE — 100+ commandes",
          "Lot 390-399: debate, quote, weather, ascii",
          "Lot 370-378: PWA, MP3, @mention, webcam",
          "Lot 355-360: FR voices, date separators, health monitor",
          "Lot 334: ComfyUI 5 workflows",
          "Lot 327: mascarade integration",
          "",
          `Total: 449+ lots, ${INFO_COMMANDS.size + GENERATE_COMMANDS.size + CHAT_COMMANDS.size}+ commandes`,
        ].join("\n") });
        return;
      }

      case "/fortune": {
        const quotes = [
          "Le bruit est la matiere premiere de toute musique. \u2014 Pierre Schaeffer",
          "L'avenir est deja la, il n'est pas encore uniformement distribue. \u2014 William Gibson",
          "La technologie n'est ni bonne ni mauvaise, ni neutre. \u2014 Melvin Kranzberg",
          "Nous sommes tous des cyborgs. \u2014 Donna Haraway",
          "Le medium est le message. \u2014 Marshall McLuhan",
          "Space is the place. \u2014 Sun Ra",
          "Le silence est aussi plein de sagesse et d'esprit en puissance que le marbre non taille. \u2014 Aldous Huxley",
          "Saboteurs of big daddy mainframe. \u2014 VNS Matrix",
          "Les machines sont nos amies. \u2014 Komplex Kapharnaum",
          "Le code est la loi. \u2014 Lawrence Lessig",
          "L'information veut etre libre. \u2014 Stewart Brand",
          "Tout ce qui est solide se dissout dans l'air. \u2014 Marx",
          "Le bruit est relatif au silence qui le precede.",
          "Tout code est une partition qui attend son interprete.",
          "La musique concrete commence la ou les mots s'arretent.",
          "Le chaos est la forme la plus haute de l'ordre.",
          "Ecouter c'est deja composer.",
          "Le bug est le premier pas vers la decouverte.",
          "Un bon mix est celui qu'on n'entend pas.",
          "La latence est l'ennemie de l'art vivant.",
          "Chaque pixel est un univers en attente.",
          "Le silence entre les notes est aussi important que les notes.",
          "L'IA ne remplace pas l'artiste, elle lui tend un miroir.",
          "Le glitch est la verite du signal.",
          "3615 J'ai pete : parce que le son libere.",
        ];
        const quote = quotes[Math.floor(Math.random() * quotes.length)];
        send(ws, { type: "system", text: `\u{1F52E} ${quote}` });
        return;
      }

      case "/speed": {
        const start = Date.now();
        try {
          await fetch(`${process.env.OLLAMA_URL || "http://localhost:11434"}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "qwen3.5:9b", messages: [{ role: "user", content: "ping" }], stream: false, options: { num_predict: 5 }, keep_alive: "30m", think: false }),
            signal: AbortSignal.timeout(10000),
          });
          const ms = Date.now() - start;
          send(ws, { type: "system", text: `\u26A1 Ollama: ${ms}ms | Modele: qwen3.5:9b` });
        } catch {
          send(ws, { type: "system", text: `\u26A1 Ollama: timeout (>10s)` });
        }
        return;
      }

      case "/model": {
        const modelName = text.slice(7).trim();
        if (!modelName) {
          try {
            const resp = await fetch("http://localhost:11434/api/ps", { signal: AbortSignal.timeout(3000) });
            const data = await resp.json() as { models?: Array<{ name: string; size: number }> };
            const loaded = data.models?.map(m => `  ${m.name} (${(m.size / 1e9).toFixed(1)}GB)`).join("\n") || "  aucun";
            send(ws, { type: "system", text: `Modeles charges:\n${loaded}` });
          } catch {
            send(ws, { type: "system", text: "Impossible de contacter Ollama" });
          }
          return;
        }
        send(ws, { type: "system", text: `Modele prefere: ${modelName} (note: les personas utilisent leur modele assigne)` });
        return;
      }

      case "/persona": {
        const personaName = text.slice(9).trim();
        const pList = getPersonas();
        if (!personaName) {
          // Rich persona list with voice + model info
          const { getPersonaVoice } = await import("./persona-voices.js");
          const categories: Record<string, typeof pList> = {};
          for (const p of pList) {
            const cat = p.systemPrompt.includes("musique") || p.systemPrompt.includes("son") ? "Musique/Son"
              : p.systemPrompt.includes("philosophe") || p.systemPrompt.includes("theorie") ? "Philosophie"
              : p.systemPrompt.includes("scien") || p.systemPrompt.includes("code") ? "Science/Tech"
              : p.systemPrompt.includes("art") || p.systemPrompt.includes("cinema") ? "Arts"
              : "Transversal";
            (categories[cat] ||= []).push(p);
          }
          const lines = [`=== ${pList.length} Personas ===`];
          for (const [cat, personas] of Object.entries(categories)) {
            lines.push(`\n[${cat}]`);
            for (const p of personas) {
              const voice = getPersonaVoice(p.nick);
              lines.push(`  ${p.nick} — ${p.model} — voix: ${voice.speaker}`);
            }
          }
          lines.push(`\n/persona <nom> pour les details. /voice-test <nom> pour ecouter.`);
          send(ws, { type: "system", text: lines.join("\n") });
          return;
        }
        const found = pList.find(p => p.nick.toLowerCase() === personaName.toLowerCase());
        if (!found) {
          send(ws, { type: "system", text: `Persona "${personaName}" inconnue. /persona pour la liste.` });
          return;
        }
        const { getPersonaVoice: getVoice } = await import("./persona-voices.js");
        const v = getVoice(found.nick);
        const mem = await loadPersonaMemory(found.nick);
        send(ws, { type: "system", text: [
          `=== ${found.nick} ===`,
          `  Modele: ${found.model}`,
          `  Couleur: ${found.color}`,
          `  Voix: ${v.speaker} (${v.language})`,
          `  Style: ${v.instruct}`,
          mem.facts.length > 0 ? `  Memoire: ${mem.facts.slice(0, 3).join(", ")}` : "",
          `  Prompt: ${found.systemPrompt.slice(0, 300)}...`,
          `\n  /voice-test ${found.nick} — ecouter sa voix`,
        ].filter(Boolean).join("\n") });
        return;
      }

      case "/models": {
        const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        const lines: string[] = ["=== Modeles Ollama ==="];
        try {
          const ctrlTags = new AbortController();
          const tTags = setTimeout(() => ctrlTags.abort(), 3000);
          const respTags = await fetch(`${ollamaUrl}/api/tags`, { signal: ctrlTags.signal });
          clearTimeout(tTags);
          if (!respTags.ok) throw new Error(`HTTP ${respTags.status}`);
          const tagsBody = await respTags.json() as { models?: Array<{ name: string; size: number; modified_at?: string }> };
          const available = tagsBody.models || [];

          let loaded = new Set<string>();
          try {
            const ctrlPs = new AbortController();
            const tPs = setTimeout(() => ctrlPs.abort(), 3000);
            const respPs = await fetch(`${ollamaUrl}/api/ps`, { signal: ctrlPs.signal });
            clearTimeout(tPs);
            if (respPs.ok) {
              const psBody = await respPs.json() as { models?: Array<{ name: string; size_vram?: number }> };
              loaded = new Set((psBody.models || []).map((m) => m.name));
            }
          } catch { /* ps endpoint may not be available */ }

          if (available.length === 0) {
            lines.push("  Aucun modele installe.");
          } else {
            lines.push(`${available.length} modele(s) disponible(s), ${loaded.size} charge(s):\n`);
            for (const m of available) {
              const sizeGB = (m.size / 1073741824).toFixed(1);
              const status = loaded.has(m.name) ? " [CHARGE]" : "";
              lines.push(`  ${m.name} (${sizeGB}GB)${status}`);
            }
          }
        } catch (err) {
          lines.push(`Ollama non disponible: ${err instanceof Error ? err.message : String(err)}`);
        }
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/llm": {
        const { getProviders, checkMascaradeHealth } = await import("./llm-client.js");
        const healthy = await checkMascaradeHealth();
        const providers = await getProviders();
        const lines = [
          "=== LLM Backend ===",
          `  Mascarade: ${healthy ? "OK" : "OFFLINE"} (${process.env.MASCARADE_URL || "http://127.0.0.1:8100"})`,
          `  Providers: ${providers.join(", ") || "ollama (fallback)"}`,
          `  Mode: ${process.env.USE_MASCARADE === "0" ? "Direct Ollama" : "Mascarade → Ollama fallback"}`,
          `  Default model: ${process.env.LLM_DEFAULT_MODEL || "ollama:qwen3.5:9b"}`,
          "",
          "Usage: les personas routent via mascarade automatiquement.",
          "Pour forcer un provider: mettre 'claude:claude-sonnet-4-6' dans le model du persona.",
        ];
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/memory": {
        const targetNick = parts[1];
        if (!targetNick) {
          send(ws, { type: "system", text: "Usage: /memory <nom_persona>" });
          return;
        }
        const persona = getPersonas().find(
          (p) => p.nick.toLowerCase() === targetNick.toLowerCase(),
        );
        if (!persona) {
          const available = getPersonas().map((p) => p.nick).join(", ");
          send(ws, { type: "system", text: `Persona "${targetNick}" introuvable. Disponibles: ${available}` });
          return;
        }
        try {
          const memory = await loadPersonaMemory(persona.nick);
          const lines = [
            `=== Memoire de ${persona.nick} ===`,
            ``,
            `Faits retenus (${memory.facts.length}):`,
            ...(memory.facts.length > 0
              ? memory.facts.map((f, i) => `  ${i + 1}. ${f}`)
              : ["  (aucun)"]),
            ``,
            `Resume: ${memory.summary || "(aucun)"}`,
            ``,
            `Derniere mise a jour: ${memory.lastUpdated || "jamais"}`,
          ];
          send(ws, { type: "system", text: lines.join("\n") });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur memoire: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/context": {
        const store = getContextStore?.();
        if (!store) {
          send(ws, { type: "system", text: "Context store non disponible." });
          return;
        }
        try {
          const cs = await store.getChannelStats(info.channel);
          const globalStats = await store.getStats();
          const lines = [
            `=== Context Store: ${info.channel} ===`,
            `Messages stockes: ${cs.entries}`,
            `Chars bruts: ${cs.totalChars}`,
            `Compacte: ${cs.compacted ? "oui" : "non"}`,
            cs.compacted ? `  Entries compactees: ${cs.entriesCompacted}` : null,
            cs.compacted ? `  Compactions: ${cs.totalCompactions}` : null,
            cs.compacted ? `  Derniere compaction: ${cs.lastCompactedAt}` : null,
            `--- Global ---`,
            `Canaux: ${globalStats.channels}`,
            `Taille totale: ${globalStats.totalSizeMB.toFixed(2)} MB`,
          ].filter(Boolean);
          send(ws, { type: "system", text: lines.join("\n") });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur context stats: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/export": {
        const store = getContextStore?.();
        if (!store) {
          send(ws, { type: "system", text: "Context store non disponible." });
          return;
        }
        try {
          const contextStr = await store.getContext(info.channel, 100_000);
          if (!contextStr || contextStr.trim().length === 0) {
            send(ws, { type: "system", text: "Aucun historique disponible pour ce canal." });
            return;
          }
          const header = `# Export ${info.channel} \u2014 ${new Date().toISOString()}\n\n`;
          send(ws, { type: "system", text: header + contextStr });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur export: ${err instanceof Error ? err.message : String(err)}` });
        }
        // Check for composition export
        const comp = getActiveComposition?.(info.nick, info.channel);
        if (comp && comp.tracks.length > 0) {
          const mixExists = fs.existsSync(path.join(process.cwd(), "data", "compositions", comp.id, "mix.wav"));
          send(ws, { type: "system", text: `Composition: ${comp.name} (${comp.tracks.length} pistes)\n  ${mixExists ? "Download mix: /api/v2/media/compositions/" + comp.id + "/mix" : "/mix d'abord pour generer le mixage"}` });
        }
        return;
      }

      case "/history": {
        const n = Math.min(Math.max(parseInt(text.slice(9).trim()) || 20, 1), 100);
        const store = getContextStore?.();
        if (!store) { send(ws, { type: "system", text: "Context store non disponible." }); return; }
        try {
          const context = await store.getContext(info.channel, 100_000);
          const lines = context.split("\n").filter(Boolean).slice(-n);
          send(ws, { type: "system", text: `Derniers ${lines.length} messages:\n${lines.join("\n")}` });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur history: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/reload": {
        if (!refreshPersonas) {
          send(ws, { type: "system", text: "Rechargement non disponible." });
          return;
        }
        send(ws, { type: "system", text: "Rechargement des personas..." });
        try {
          await refreshPersonas();
          const personas = getPersonas();
          for (const p of personas) {
            broadcast(info.channel, { type: "persona", nick: p.nick, color: p.color } as OutboundMessage);
          }
          broadcast(info.channel, {
            type: "system",
            text: `Personas rechargees (${personas.length}): ${personas.map(p => p.nick).join(", ")}`,
          });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur rechargement: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/theme": {
        const theme = text.slice(7).trim().toLowerCase();
        const themes = ["minitel", "noir", "matrix", "amber", "ocean"];
        if (!theme || !themes.includes(theme)) {
          send(ws, { type: "system", text: `Themes: ${themes.join(", ")}. Usage: /theme <nom>` });
          return;
        }
        send(ws, { type: "system", text: `__theme__${theme}` });
        return;
      }

      case "/dice":
      case "/roll": {
        const notation = parts[1] || "1d6";
        const match = notation.match(/^(\d+)d(\d+)$/i);
        const count = match ? Math.min(parseInt(match[1]), 20) : 1;
        const sides = match ? Math.min(parseInt(match[2]), 100) : 6;
        const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
        const total = rolls.reduce((a, b) => a + b, 0);
        const detail = count > 1 ? ` (${rolls.join(" + ")})` : "";
        broadcast(info.channel, { type: "system", text: `\u{1F3B2} ${info.nick} lance ${count}d${sides}: ${total}${detail}` });
        return;
      }

      case "/flip": {
        const result = Math.random() < 0.5 ? "PILE" : "FACE";
        const emoji = result === "PILE" ? "\u{1FA99}" : "\u{1F451}";
        broadcast(info.channel, { type: "system", text: `${emoji} ${info.nick} lance une piece: ${result}!` });
        return;
      }

      case "/ping": {
        const start = Date.now();
        send(ws, { type: "system", text: `Pong! ${Date.now() - start}ms (serveur)` });
        return;
      }

      case "/count": {
        const fs = await import("node:fs");
        const countFiles = (dir: string) => {
          try { return fs.readdirSync(path.join(process.cwd(), "data", dir)).filter((f: string) => !f.startsWith(".")).length; } catch { return 0; }
        };
        const lines = [
          "=== COMPTEURS ===",
          `  Personas: ${getPersonas().length}`,
          `  Images: ${countFiles("media/images")}`,
          `  Audio: ${countFiles("media/audio")}`,
          `  Samples DAW: ${countFiles("daw-samples")}`,
          `  Compositions: ${countFiles("compositions")}`,
          `  Exports: ${countFiles("exports")}`,
          `  Feedback: ${countFiles("feedback")}`,
        ];
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/leaderboard": {
        const personas = getPersonas();
        const scores: Array<{ nick: string; facts: number }> = [];
        for (const p of personas) {
          try {
            const mem = await loadPersonaMemory(p.nick);
            scores.push({ nick: p.nick, facts: mem.facts.length });
          } catch { scores.push({ nick: p.nick, facts: 0 }); }
        }
        scores.sort((a, b) => b.facts - a.facts);
        const lines = ["=== LEADERBOARD (memoire) ===", ...scores.slice(0, 10).map((s, i) => {
          const medal = i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : i === 2 ? "\u{1F949}" : `${i+1}.`;
          const bar = "\u{2588}".repeat(Math.min(s.facts, 20));
          return `  ${medal} ${s.nick}: ${s.facts} faits ${bar}`;
        })];
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/uptime": {
        const secs = Math.floor(process.uptime());
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        send(ws, { type: "system", text: `Uptime: ${h}h ${m}m ${s}s` });
        return;
      }

      case "/lot400": {
        const art = [
          "╔══════════════════════════════════════════════╗",
          "║                                              ║",
          "║   ██╗      ██████╗ ████████╗██╗  ██╗██████╗  ║",
          "║   ██║     ██╔═══██╗╚══██╔══╝██║  ██║██╔═══╝  ║",
          "║   ██║     ██║   ██║   ██║   ████████║██████╗  ║",
          "║   ██║     ██║   ██║   ██║   ╚════██║██╔═══╝  ║",
          "║   ███████╗╚██████╔╝   ██║        ██║██████╗  ║",
          "║   ╚══════╝ ╚═════╝    ╚═╝        ╚═╝╚═════╝  ║",
          "║                                              ║",
          "║        3615 J'ai pété — LOT 400              ║",
          "║                                              ║",
          "║   106 commandes | 33 personas | 16 services  ║",
          "║   6 instruments | 5 workflows | 7 voix TTS   ║",
          "║   211 tests | 19 E2E | mascarade + openDAW   ║",
          "║                                              ║",
          "║   Merci le chaos sonore.                     ║",
          "║                                              ║",
          "╚══════════════════════════════════════════════╝",
        ];
        broadcast(info.channel, { type: "system", text: art.join("\n") });
        return;
      }

      case "/about": {
        const lines = [
          "=== 3615 J'ai pété ===",
          "Plateforme IA multi-persona, DAW natif, generation d'images et de musique.",
          "",
          "Stack: Node.js + React + Vite + Express + WebSocket",
          "IA: Ollama (qwen3.5:9b) + mascarade (multi-provider)",
          "Audio: Kokoro TTS + Piper FR + ACE-Step + Demucs + Matchering",
          "Images: ComfyUI (32 checkpoints, 24 LoRAs, 5 workflows)",
          "DAW: openDAW + 6 instruments AI + Magenta.js MIDI",
          "",
          `${getPersonas().length} personas | ${INFO_COMMANDS.size + GENERATE_COMMANDS.size + CHAT_COMMANDS.size}+ commandes`,
          "",
          "github.com/electron-rare/kxkm_clown",
          "License: code prive | inspirations: GPL, MIT, Apache, LGPL",
          "",
          "/lot400 pour le milestone.",
        ];
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/benchmark": {
        send(ws, { type: "system", text: "Benchmark en cours..." });
        const tests: Array<{ name: string; promise: Promise<number> }> = [];

        const timeTest = (name: string, url: string) => {
          tests.push({ name, promise: (async () => {
            const t0 = Date.now();
            try {
              await fetch(url, { signal: AbortSignal.timeout(5000) });
              return Date.now() - t0;
            } catch { return -1; }
          })() });
        };

        const benchOllamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        timeTest("Ollama", `${benchOllamaUrl}/api/tags`);
        timeTest("ComfyUI", "http://localhost:8188/system_stats");
        timeTest("Kokoro", `${process.env.KOKORO_URL || "http://127.0.0.1:9201"}/health`);
        timeTest("AI Bridge", "http://127.0.0.1:8301/health");
        timeTest("Mascarade", `${process.env.MASCARADE_URL || "http://127.0.0.1:8100"}/health`);

        // Ollama inference test
        tests.push({ name: "Ollama chat", promise: (async () => {
          const t0 = Date.now();
          try {
            await fetch(`${benchOllamaUrl}/api/chat`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: "qwen3.5:9b", messages: [{ role: "user", content: "1+1" }], stream: false, options: { num_predict: 5 }, keep_alive: "30m", think: false }),
              signal: AbortSignal.timeout(10000),
            });
            return Date.now() - t0;
          } catch { return -1; }
        })() });

        const results = await Promise.all(tests.map(async t => ({ name: t.name, ms: await t.promise })));
        const lines = ["=== BENCHMARK ===", ...results.map(r => `  ${r.name}: ${r.ms < 0 ? "TIMEOUT" : r.ms + "ms"}`)];
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/tts-voices": {
        const lines = [
          "=== Voix TTS disponibles ===",
          "",
          "[Piper FR]",
          "  fr_FR-siwis-medium (femme, chaud)",
          "  fr_FR-siwis-low (femme, leger)",
          "  fr_FR-upmc-medium (homme, academique)",
          "  fr_FR-tom-medium (homme, naturel)",
          "  fr_FR-gilles-low (homme, casual)",
          "",
          "[Kokoro EN]",
          "  af_heart, af_bella, af_nicole, af_sarah, af_sky (femme US)",
          "  am_adam, am_michael (homme US)",
          "  bf_emma, bm_george, bm_lewis (GB)",
          "",
          "/voice-test <persona> pour ecouter",
          "/speak <persona> <texte> pour forcer",
        ];
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/persona-voice": {
        const { getPersonaVoice } = await import("./persona-voices.js");
        const personas = getPersonas();
        const lines = ["=== Voix par persona ==="];
        for (const p of personas) {
          const v = getPersonaVoice(p.nick);
          lines.push(`  ${p.nick}: ${v.speaker} (${v.language})`);
        }
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/clear-media": {
        // /clear-media [type] — cleanup generated media (images, audio, samples)
        const mediaType = parts[1] || "all"; // all, images, audio, samples
        const results: string[] = [];

        const cleanDir = async (dir: string, label: string) => {
          const dirPath = path.join(process.cwd(), "data", dir);
          if (!fs.existsSync(dirPath)) return;
          const files = fs.readdirSync(dirPath).filter((f: string) => !f.startsWith(".") && f !== "index.jsonl");
          if (files.length === 0) { results.push(`  ${label}: vide`); return; }
          let size = 0;
          for (const f of files) {
            const fp = path.join(dirPath, f);
            try { size += fs.statSync(fp).size; fs.unlinkSync(fp); } catch {}
          }
          // Clear index
          const indexPath = path.join(dirPath, "index.jsonl");
          if (fs.existsSync(indexPath)) fs.writeFileSync(indexPath, "");
          results.push(`  ${label}: ${files.length} fichiers supprimes (${(size / 1024 / 1024).toFixed(1)} MB)`);
        };

        if (mediaType === "all" || mediaType === "images") await cleanDir("media/images", "Images");
        if (mediaType === "all" || mediaType === "audio") await cleanDir("media/audio", "Audio");
        if (mediaType === "all" || mediaType === "samples") await cleanDir("daw-samples", "Samples DAW");
        if (mediaType === "all" || mediaType === "exports") await cleanDir("exports", "Exports");

        if (results.length === 0) {
          send(ws, { type: "system", text: "Usage: /clear-media [all|images|audio|samples|exports]" });
        } else {
          send(ws, { type: "system", text: `Nettoyage media:\n${results.join("\n")}` });
        }
        return;
      }

      case "/sys": {
        const mem = process.memoryUsage();
        const up = Math.floor(process.uptime());
        const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
        send(ws, { type: "system", text: `SYS: ${h}h${m}m | ${Math.round(mem.rss / 1e6)}MB | ${process.version} | ${getPersonas().length} personas | 141+ cmds` });
        return;
      }

      case "/persona-stats": {
        // Lot 486 — quick stats overview
        const personas = getPersonas();
        const enabled = personas.filter((p: any) => p.enabled !== false).length;
        const disabled = personas.length - enabled;
        send(ws, { type: "system", text: [
          `=== Personas: ${personas.length} total ===`,
          `  Actives: ${enabled}`,
          `  Desactivees: ${disabled}`,
          `  Modeles: ${[...new Set(personas.map((p: any) => p.model))].join(", ")}`,
        ].join("\n") });
        return;
      }

      case "/credits": {
        // Lot 488
        send(ws, { type: "system", text: [
          "=== CREDITS ===",
          "",
          "3615 J'ai pete — Plateforme IA multi-persona",
          "",
          "Conception & Dev: L'electron rare + Claude Opus 4.6",
          "Collectif: KXKM",
          "",
          "Stack: Node.js, React, Vite, Express, WebSocket",
          "IA: Ollama (qwen3.5:9b), mascarade, ComfyUI",
          "Audio: Kokoro TTS, Piper FR, ACE-Step, Demucs, Matchering",
          "DAW: openDAW (LGPL), Magenta.js (Apache 2.0)",
          "",
          `${getPersonas().length} personas | 169+ commandes | 479+ lots`,
          "",
          "\"Le bruit est relatif au silence qui le precede.\"",
        ].join("\n") });
        return;
      }

      case "/commands": {
        // Lot 495
        send(ws, { type: "system", text: "175+ commandes disponibles. /help pour la liste complete." });
        return;
      }

      case "/server": {
        // Lot 496
        const os = await import("node:os");
        send(ws, { type: "system", text: [
          `Serveur: ${os.hostname()}`,
          `  OS: ${os.platform()} ${os.release()}`,
          `  CPU: ${os.cpus()[0]?.model || "?"}`,
          `  RAM: ${Math.round(os.totalmem() / 1e9)}GB total, ${Math.round(os.freemem() / 1e9)}GB libre`,
          `  Node: ${process.version}`,
        ].join("\n") });
        return;
      }

      case "/lot500": {
        // Lot 500 — MILESTONE
        const art = [
          "╔═══════════════════════════════════════════════════╗",
          "║                                                   ║",
          "║   ███████╗ ██████╗  ██████╗                       ║",
          "║   ██╔════╝██╔═══██╗██╔═══██╗                      ║",
          "║   ███████╗██║   ██║██║   ██║                      ║",
          "║   ╚════██║██║   ██║██║   ██║                      ║",
          "║   ███████║╚██████╔╝╚██████╔╝                      ║",
          "║   ╚══════╝ ╚═════╝  ╚═════╝                       ║",
          "║                                                   ║",
          "║   3615 J'ai pete — LOT 500                        ║",
          "║                                                   ║",
          "║   175+ commandes | 33 personas | 16+ services     ║",
          "║   6 instruments | 5 workflows | 7 voix TTS        ║",
          "║   STT | webcam | mascarade | openDAW              ║",
          "║   211 tests | 19 E2E | Prometheus | backup        ║",
          "║                                                   ║",
          "║   Le chaos sonore continue.                       ║",
          "║                                                   ║",
          "╚═══════════════════════════════════════════════════╝",
        ];
        broadcast(info.channel, { type: "system", text: art.join("\n") });
        return;
      }

      case "/matrix": {
        // Lot 505 — fun matrix rain
        const matrixChars = "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ01";
        const matrixLines = Array.from({ length: 5 }, () => Array.from({ length: 40 }, () => matrixChars[Math.floor(Math.random() * matrixChars.length)]).join(""));
        send(ws, { type: "system", text: matrixLines.join("\n") });
        return;
      }

      case "/neofetch": {
        // Lot 506 — system summary
        const up = process.uptime();
        const nfH = Math.floor(up / 3600), nfM = Math.floor((up % 3600) / 60);
        send(ws, { type: "system", text: [
          "  ╭─────────────────╮",
          "  │  3615 J'ai pete  │",
          "  ╰─────────────────╯",
          `  OS: ${os.platform()} ${os.arch()}`,
          `  Host: ${os.hostname()}`,
          `  Uptime: ${nfH}h ${nfM}m`,
          `  RAM: ${Math.round(process.memoryUsage().rss / 1e6)}MB / ${Math.round(os.totalmem() / 1e9)}GB`,
          `  Node: ${process.version}`,
          `  Personas: ${getPersonas().length}`,
          `  Lots: 500+`,
          `  Cmds: ${INFO_COMMANDS.size + GENERATE_COMMANDS.size + CHAT_COMMANDS.size}+`,
        ].join("\n") });
        return;
      }

      case "/help-all": {
        // Lot 507 — list ALL command names (compact)
        const allCmds = [...INFO_COMMANDS, ...GENERATE_COMMANDS, ...CHAT_COMMANDS].sort();
        send(ws, { type: "system", text: `${allCmds.length} commandes:\n${allCmds.join("  ")}` });
        return;
      }

      case "/session-stats": {
        // Lot 510 — session stats summary
        send(ws, { type: "system", text: [
          "=== SESSION STATS ===",
          `  Lots cette session: 177+`,
          `  Commandes ajoutees: ${INFO_COMMANDS.size + GENERATE_COMMANDS.size + CHAT_COMMANDS.size}+`,
          `  Uptime: ${Math.floor(process.uptime() / 60)}min`,
          `  RAM: ${Math.round(process.memoryUsage().rss / 1e6)}MB`,
          `  Personas: ${getPersonas().length}`,
          "",
          "Milestones: /lot400, /lot500",
          "Credits: /credits | About: /about",
        ].join("\n") });
        return;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  };
}
