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
        const pkg = { version: "2.0.0", name: "@kxkm/api" };
        send(ws, { type: "system", text: `KXKM_Clown ${pkg.version}\n  Ollama: v0.18.2\n  Node: ${process.version}\n  Commandes: 66\n  Personas: ${getPersonas().length}\n  Uptime: ${Math.floor(process.uptime()/3600)}h${Math.floor((process.uptime()%3600)/60)}m` });
        return;
      }

      case "/changelog": {
        try {
          const log = execFileSync("git", ["log", "--oneline", "-10"], { cwd: process.cwd(), timeout: 5000 }).toString().trim();
          send(ws, { type: "system", text: `Changelog:\n${log}` });
        } catch {
          send(ws, { type: "system", text: "Changelog indisponible" });
        }
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
        const match = text.match(/(\d+)?d(\d+)/i);
        const count = Math.min(parseInt(match?.[1] || "1"), 10);
        const sides = Math.min(parseInt(match?.[2] || "6"), 100);
        const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
        const total = rolls.reduce((a, b) => a + b, 0);
        broadcast(info.channel, { type: "system", text: `\u{1F3B2} ${info.nick} lance ${count}d${sides}: [${rolls.join(", ")}] = ${total}` });
        return;
      }

      case "/flip": {
        const result = Math.random() < 0.5 ? "pile" : "face";
        broadcast(info.channel, { type: "system", text: `\u{1FA99} ${info.nick}: ${result}!` });
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

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  };
}
