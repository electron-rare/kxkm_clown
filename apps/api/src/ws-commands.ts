import { promises as fsp } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WebSocket } from "ws";
import { generateImage } from "./comfyui.js";
import { searchWeb } from "./web-search.js";
import { saveImage, saveAudio } from "./media-store.js";
import { loadPersonaMemory } from "./ws-persona-router.js";
import type { ChatPersona, ClientInfo, OutboundMessage, ChatLogEntry } from "./chat-types.js";
import type { ContextStore } from "./context-store.js";
import { getRecentErrors } from "./error-tracker.js";

const execFileAsync = promisify(execFile);
interface CommandContext {
  ws: WebSocket;
  info: ClientInfo;
  text: string;
}

interface CommandHandlerDeps {
  send: (ws: WebSocket, msg: OutboundMessage) => void;
  broadcast: (channel: string, msg: OutboundMessage, exclude?: WebSocket) => void;
  broadcastUserlist: (channel: string) => void;
  channelUsers: (channel: string) => string[];
  listConnectedNicks: () => string[];
  listChannelCounts: () => Map<string, number>;
  routeToPersonas: (channel: string, text: string) => Promise<void>;
  logChatMessage: (entry: ChatLogEntry) => void;
  getPersonas: () => ChatPersona[];
  getChannelTopics?: () => Map<string, string>;
  getClients?: () => Map<any, { nick: string; channel: string }>;
  getMaxResponders: () => number;
  setMaxResponders: (n: number) => void;
  getActiveUserCount: () => number;
  getContextStore?: () => ContextStore | undefined;
  refreshPersonas?: () => Promise<void>;
  getChannelPins?: () => Map<string, string[]>;
  getUserStats?: () => Map<string, { messages: number; firstSeen: number }>;
  bannedNicks?: Set<string>;
}

export function createCommandHandler(deps: CommandHandlerDeps) {
  const {
    send,
    broadcast,
    broadcastUserlist,
    channelUsers,
    listConnectedNicks,
    listChannelCounts,
    routeToPersonas,
    logChatMessage,
    getPersonas,
    getChannelTopics,
    getClients,
    getMaxResponders,
    setMaxResponders,
    getActiveUserCount,
    getContextStore,
    refreshPersonas,
    getChannelPins,
    getUserStats,
    bannedNicks,
  } = deps;

  return async function handleCommand({ ws, info, text }: CommandContext): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case "/help":
        send(ws, {
          type: "system",
          text: [
            "=== Commandes disponibles ===",
            "/help                              — cette aide",
            "/clear                             — efface le chat",
            "/nick <pseudo>                     — change ton pseudo",
            "/who                               — utilisateurs connectes",
            "/personas                          — personas actives",
            "/web <recherche>                   — recherche web via SearXNG",
            "/imagine <prompt>                  — genere une image",
            "/imagine-models                    — modeles ComfyUI disponibles",
            "/compose <prompt>, <style>, <duree>s — compose de la musique",
            "/status                            — etat du systeme (VRAM, modeles, perf)",
            "/responders <1-5>                  — nombre de personas qui repondent",
            "/model                             — modele actif",
            "/persona                           — persona active",
            "/context                           — stats du contexte conversationnel",
            "/export                            — exporter l'historique du canal",
            "/memory <persona>                  — memoire persistante d'une persona",
            "/models                            — modeles Ollama disponibles/charges",
            "/join #canal                       — rejoindre un canal",
            "/channels                          — liste les canaux actifs",
            "/dm <pseudo> <message>            — message prive",
            "/topic <texte>                    — definir le sujet du canal",
            "/reload                            — recharger les personas depuis la DB",
            "/pin <message>                     — epingler un message (vide = voir les pins)",
            "/stats                             — tes stats personnelles",
            "/mute <persona>                    — muter une persona pour toi",
            "/unmute <persona>                  — demuter une persona",
            "/ban <pseudo>                      — bannir un utilisateur (admin)",
            "/unban <pseudo>                    — debannir un utilisateur (admin)",
            "/whisper <persona> <msg>           — message prive a une persona",
            "/history <n>                       — derniers N messages du canal",
            "@NomPersona                        — interpeller une persona directement",
            "/invite <persona>                  — inviter une persona dans le canal",
            "/time                              — heure et date actuelles",
            "/date                              — heure et date actuelles",
            "/session                           — infos de ta session",
            "/search <mot-cle>                  — chercher dans l'historique",
            "/react <emoji>                     — reagir au dernier message",
            "/dice <NdS>                       — lancer des des (ex: 2d20)",
            "/flip                              — pile ou face",
            "/changelog                         — 10 derniers commits",
            "/version                           — version et infos systeme",
            "/theme <nom>                       — changer le theme couleur (minitel, noir, matrix, amber, ocean)",
            "/speed                              — mesurer la latence Ollama",
            "/fortune                            — citation aleatoire",
          ].join("\n"),
        });
        return;

      case "/nick": {
        const newNick = parts[1];
        if (!newNick || newNick.length < 2 || newNick.length > 24) {
          send(ws, { type: "system", text: "Usage: /nick <nom> (2-24 caracteres)" });
          return;
        }
        const users = listConnectedNicks().map((nick) => nick.toLowerCase());
        if (users.includes(newNick.toLowerCase()) && info.nick.toLowerCase() !== newNick.toLowerCase()) {
          send(ws, { type: "system", text: `Le pseudo "${newNick}" est deja utilise.` });
          return;
        }
        const oldNick = info.nick;
        info.nick = newNick;
        broadcast(info.channel, {
          type: "system",
          text: `${oldNick} est maintenant connu(e) comme ${newNick}`,
        });
        broadcastUserlist(info.channel);
        return;
      }

      case "/who":
        send(ws, {
          type: "userlist",
          users: channelUsers(info.channel),
        });
        return;

      case "/personas":
        send(ws, {
          type: "system",
          text: getPersonas()
            .map((persona) => `  ${persona.nick} (${persona.model}) — ${persona.systemPrompt.slice(0, 60)}...`)
            .join("\n"),
        });
        return;

      case "/web": {
        const query = text.slice(4).trim();
        if (!query) {
          send(ws, { type: "system", text: "Usage: /web <recherche>" });
          return;
        }
        send(ws, { type: "system", text: `Recherche: ${query}...` });
        try {
          const results = await searchWeb(query);
          broadcast(info.channel, {
            type: "system",
            text: `Résultats pour "${query}":\n${results}`,
          });
          await routeToPersonas(
            info.channel,
            `L'utilisateur a cherché "${query}" sur le web. Résultats:\n${results}\n\nCommente ces résultats.`,
          );
        } catch (err) {
          send(ws, {
            type: "system",
            text: `Recherche échouée: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }

      case "/join": {
        const newChannel = parts[1] || "";
        if (!newChannel.startsWith("#") || newChannel.length < 2 || newChannel.length > 30) {
          send(ws, { type: "system", text: "Usage: /join #nom-du-canal (2-30 chars, commence par #)" });
          return;
        }
        if (!/^#[a-zA-Z0-9_-]+$/.test(newChannel)) {
          send(ws, { type: "system", text: "Nom de canal invalide (lettres, chiffres, - et _ uniquement)" });
          return;
        }
        const oldChannel = info.channel;
        info.channel = newChannel;
        broadcast(oldChannel, { type: "part", nick: info.nick, channel: oldChannel, text: `${info.nick} a quitte ${oldChannel}` });
        broadcastUserlist(oldChannel);
        broadcast(newChannel, { type: "join", nick: info.nick, channel: newChannel, text: `${info.nick} a rejoint ${newChannel}` });
        broadcastUserlist(newChannel);
        send(ws, { type: "channelInfo", channel: newChannel });
        send(ws, { type: "system", text: `Canal change: ${newChannel}` });
        return;
      }

      case "/channels": {
        const counts = listChannelCounts();
        const list = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([channel, count]) => `  ${channel} (${count} connecte${count > 1 ? "s" : ""})`)
          .join("\n");
        send(ws, { type: "system", text: `Canaux actifs:\n${list || "  (aucun)"}` });
        return;
      }

      case "/compose":
        await handleComposeCommand({ ws, info, text, broadcast, send, logChatMessage });
        return;

      case "/imagine":
        await handleImagineCommand({ ws, info, text, broadcast, send, logChatMessage });
        return;

      case "/imagine-models": {
        const { getComfyUIModels } = await import("./comfyui-models.js");
        const models = await getComfyUIModels();
        const checkpoints = models.filter(m => m.type === "checkpoint");
        const loras = models.filter(m => m.type === "lora");
        const lines = [
          `=== ComfyUI Models ===`,
          `  Checkpoints (${checkpoints.length}):`,
          ...checkpoints.map(m => `    ${m.name}`),
          `  LoRAs (${loras.length}):`,
          ...loras.map(m => `    ${m.name}`),
        ];
        if (models.length === 0) lines.push("  (ComfyUI non disponible ou aucun modele trouve)");
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/responders": {
        const n = parseInt(parts[1] || "", 10);
        if (isNaN(n) || n < 1 || n > 5) {
          send(ws, { type: "system", text: `Usage: /responders <1-5> (actuel: ${getMaxResponders()})` });
          return;
        }
        setMaxResponders(n);
        broadcast(info.channel, {
          type: "system",
          text: `${info.nick} a change le nombre de repondeurs: ${n} persona(s) max`,
        });
        return;
      }

      case "/status": {
        const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        const lines: string[] = ["=== Statut serveur ==="];

        const uptimeSec = Math.floor(process.uptime());
        lines.push(`Uptime: ${Math.floor(uptimeSec / 3600)}h${Math.floor((uptimeSec % 3600) / 60)}m${uptimeSec % 60}s`);
        lines.push(`Utilisateurs connectes: ${getActiveUserCount()}`);
        lines.push(`Personas actives: ${getPersonas().length}`);
        lines.push(`Max repondeurs: ${getMaxResponders()}`);

        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2000);
          const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: ctrl.signal });
          clearTimeout(t);
          if (resp.ok) {
            const body = await resp.json() as { models?: Array<{ name: string; size: number }> };
            if (body.models) {
              lines.push(`Modeles charges: ${body.models.length}`);
              for (const m of body.models.slice(0, 8)) {
                lines.push(`  - ${m.name} (${Math.round(m.size / 1073741824 * 10) / 10}GB)`);
              }
            }
          }
        } catch { lines.push("Ollama: non disponible"); }

        try {
          const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"], { timeout: 2000 });
          const gpuParts = stdout.trim().split(", ");
          if (gpuParts.length >= 3) {
            lines.push(`VRAM: ${gpuParts[0]}MB / ${gpuParts[1]}MB (GPU util: ${gpuParts[2]}%)`);
          }
        } catch { /* nvidia-smi not available */ }

        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2000);
          const resp = await fetch(`http://127.0.0.1:${process.env.V2_API_PORT || 4180}/api/v2/perf`, { signal: ctrl.signal });
          clearTimeout(t);
          if (resp.ok) {
            const perfData = await resp.json() as { data?: { avg_latency_ms?: number; max_latency_ms?: number; requests?: number; memory?: { rss_mb?: number } } };
            if (perfData.data) {
              const d = perfData.data;
              lines.push(`Requetes HTTP: ${d.requests || 0} (avg ${d.avg_latency_ms?.toFixed(1) || "?"}ms, max ${d.max_latency_ms?.toFixed(1) || "?"}ms)`);
              if (d.memory?.rss_mb) lines.push(`Memoire RSS: ${d.memory.rss_mb}MB`);
            }
          }
        } catch { /* perf endpoint not available */ }

        // Messages processed
        const ustats = getUserStats?.();
        if (ustats) {
          let totalMsgs = 0;
          for (const [, s] of ustats) totalMsgs += s.messages;
          lines.push(`Messages traites: ${totalMsgs}`);
        }

        // Context store stats
        try {
          const cs = getContextStore?.();
          if (cs) {
            const gStats = await cs.getStats();
            lines.push(`Context store: ${gStats.channels} canaux, ${gStats.totalSizeMB.toFixed(2)} MB`);
          }
        } catch { /* context stats unavailable */ }

        // Last error
        try {
          const recent = getRecentErrors(1);
          if (recent.length > 0) {
            const e = recent[0];
            lines.push(`Derniere erreur: [${e.label}] ${e.message} (${e.timestamp})`);
          } else {
            lines.push("Derniere erreur: aucune");
          }
        } catch { /* error tracker unavailable */ }

        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

      case "/clear":
        broadcast(info.channel, { type: "system", text: "__clear__" });
        return;

      case "/export": {
        const store = getContextStore?.();
        if (!store) {
          send(ws, { type: "system", text: "Context store non disponible." });
          return;
        }
        try {
          // Use getContext with a generous char budget for the export
          const contextStr = await store.getContext(info.channel, 100_000);
          if (!contextStr || contextStr.trim().length === 0) {
            send(ws, { type: "system", text: "Aucun historique disponible pour ce canal." });
            return;
          }
          const header = `# Export ${info.channel} — ${new Date().toISOString()}\n\n`;
          send(ws, { type: "system", text: header + contextStr });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur export: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/memory": {
        const targetNick = parts[1];
        if (!targetNick) {
          send(ws, { type: "system", text: "Usage: /memory <nom_persona>" });
          return;
        }
        // Check if persona exists
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

      case "/models": {
        const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        const lines: string[] = ["=== Modeles Ollama ==="];
        try {
          // Fetch available models
          const ctrlTags = new AbortController();
          const tTags = setTimeout(() => ctrlTags.abort(), 3000);
          const respTags = await fetch(`${ollamaUrl}/api/tags`, { signal: ctrlTags.signal });
          clearTimeout(tTags);
          if (!respTags.ok) throw new Error(`HTTP ${respTags.status}`);
          const tagsBody = await respTags.json() as { models?: Array<{ name: string; size: number; modified_at?: string }> };
          const available = tagsBody.models || [];

          // Fetch loaded (running) models
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

      case "/dm":
      case "/msg": {
        const dmMatch = text.match(/^\/(?:dm|msg)\s+(\S+)\s+(.*)/s);
        if (!dmMatch) {
          send(ws, { type: "system", text: "Usage: /dm <pseudo> <message>" });
          return;
        }
        const dmTarget = dmMatch[1];
        const dmText = dmMatch[2];
        let targetWs: WebSocket | undefined;
        if (getClients) {
          for (const [cws, cinfo] of getClients()) {
            if (cinfo.nick === dmTarget) { targetWs = cws as WebSocket; break; }
          }
        }
        if (!targetWs) {
          send(ws, { type: "system", text: `${dmTarget} n'est pas connecte` });
          return;
        }
        send(targetWs, { type: "message", nick: info.nick, text: `[DM] ${dmText}`, color: "#ff69b4" });
        send(ws, { type: "system", text: `[DM → ${dmTarget}] ${dmText}` });
        return;
      }

      case "/topic": {
        const topic = text.slice(7).trim();
        const topics = getChannelTopics?.();
        if (!topic) {
          send(ws, { type: "system", text: `Topic: ${topics?.get(info.channel) || "(aucun)"}` });
          return;
        }
        topics?.set(info.channel, topic);
        broadcast(info.channel, { type: "system", text: `Topic: ${topic} (par ${info.nick})` });
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
          // Re-broadcast persona colors to all clients in channel
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

      case "/pin": {
        const pinText = text.slice(5).trim();
        if (!pinText) {
          const pins = getChannelPins?.()?.get(info.channel) || [];
          send(ws, { type: "system", text: pins.length ? `Pins:\n${pins.map((p: string, i: number) => `  ${i + 1}. ${p}`).join("\n")}` : "Aucun pin" });
          return;
        }
        const pinsMap = getChannelPins?.();
        const current = pinsMap?.get(info.channel) || [];
        current.push(`${info.nick}: ${pinText}`);
        if (current.length > 10) current.shift();
        pinsMap?.set(info.channel, current);
        broadcast(info.channel, { type: "system", text: `\u{1F4CC} Pin: ${pinText} (par ${info.nick})` });
        return;
      }

      case "/stats": {
        const stats = getUserStats?.()?.get(info.nick);
        const uptime = stats ? Math.floor((Date.now() - stats.firstSeen) / 60000) : 0;
        send(ws, { type: "system", text: `Stats ${info.nick}:\n  Messages: ${stats?.messages || 0}\n  Connecte: ${uptime}min` });
        return;
      }

      case "/ban": {
        const target = text.slice(5).trim();
        if (!target) { send(ws, { type: "system", text: "Usage: /ban <pseudo>" }); return; }
        if (!bannedNicks) { send(ws, { type: "system", text: "Moderation non disponible." }); return; }
        bannedNicks.add(target.toLowerCase());
        if (getClients) {
          for (const [cws, cinfo] of getClients()) {
            if (cinfo.nick.toLowerCase() === target.toLowerCase()) {
              send(cws as WebSocket, { type: "system", text: "Tu as ete banni." });
              (cws as WebSocket).close();
            }
          }
        }
        broadcast(info.channel, { type: "system", text: `${target} a ete banni par ${info.nick}` });
        return;
      }

      case "/unban": {
        const target = text.slice(7).trim();
        if (!target) { send(ws, { type: "system", text: "Usage: /unban <pseudo>" }); return; }
        if (!bannedNicks) { send(ws, { type: "system", text: "Moderation non disponible." }); return; }
        bannedNicks.delete(target.toLowerCase());
        send(ws, { type: "system", text: `${target} debanni` });
        return;
      }

      case "/mute": {
        const target = text.slice(6).trim();
        if (!target) { send(ws, { type: "system", text: "Usage: /mute <persona>" }); return; }
        info.mutedPersonas = info.mutedPersonas || new Set();
        info.mutedPersonas.add(target.toLowerCase());
        send(ws, { type: "system", text: `${target} mute pour toi` });
        return;
      }

      case "/unmute": {
        const target = text.slice(8).trim();
        info.mutedPersonas?.delete(target.toLowerCase());
        send(ws, { type: "system", text: `${target} demute` });
        return;
      }

      case "/search": {
        const query = text.slice(8).trim().toLowerCase();
        if (!query) { send(ws, { type: "system", text: "Usage: /search <mot-cle>" }); return; }
        const store = getContextStore?.();
        if (!store) { send(ws, { type: "system", text: "Context store non disponible." }); return; }
        try {
          const context = await store.getContext(info.channel, 100_000);
          const lines = context.split("\n").filter((l: string) => l.toLowerCase().includes(query));
          if (lines.length === 0) {
            send(ws, { type: "system", text: `Aucun resultat pour "${query}"` });
            return;
          }
          send(ws, { type: "system", text: `Resultats pour "${query}" (${lines.length}):\n${lines.slice(-10).join("\n")}` });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur recherche: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      case "/react": {
        const emoji = text.slice(7).trim();
        if (!emoji) { send(ws, { type: "system", text: "Usage: /react <emoji>" }); return; }
        broadcast(info.channel, { type: "system", text: `${info.nick} reagit: ${emoji}` });
        return;
      }

      case "/dice":
      case "/roll": {
        const match = text.match(/(\d+)?d(\d+)/i);
        const count = Math.min(parseInt(match?.[1] || "1"), 10);
        const sides = Math.min(parseInt(match?.[2] || "6"), 100);
        const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
        const total = rolls.reduce((a, b) => a + b, 0);
        broadcast(info.channel, { type: "system", text: `🎲 ${info.nick} lance ${count}d${sides}: [${rolls.join(", ")}] = ${total}` });
        return;
      }


      case "/changelog": {
        try {
          const { execFileSync } = await import("node:child_process");
          const log = execFileSync("git", ["log", "--oneline", "-10"], { cwd: process.cwd(), timeout: 5000 }).toString().trim();
          send(ws, { type: "system", text: `Changelog:\n${log}` });
        } catch {
          send(ws, { type: "system", text: "Changelog indisponible" });
        }
        return;
      }

      case "/version": {
        const pkg = { version: "2.0.0", name: "@kxkm/api" };
        send(ws, { type: "system", text: `KXKM_Clown ${pkg.version}\n  Ollama: v0.18.2\n  Node: ${process.version}\n  Commandes: 43\n  Personas: ${getPersonas().length}\n  Uptime: ${Math.floor(process.uptime()/3600)}h${Math.floor((process.uptime()%3600)/60)}m` });
        return;
      }

      case "/flip": {
        const result = Math.random() < 0.5 ? "pile" : "face";
        broadcast(info.channel, { type: "system", text: `🪙 ${info.nick}: ${result}!` });
        return;
      }

      case "/whisper":
      case "/w": {
        const wMatch = text.match(/^\/(?:whisper|w)\s+(\S+)\s+(.*)/s);
        if (!wMatch) { send(ws, { type: "system", text: "Usage: /whisper <persona> <message>" }); return; }
        const [, targetPersona, whisperText] = wMatch;
        const personas = getPersonas();
        const persona = personas.find(p => p.nick.toLowerCase() === targetPersona.toLowerCase());
        if (!persona) { send(ws, { type: "system", text: `Persona ${targetPersona} inconnue` }); return; }
        send(ws, { type: "system", text: `[Whisper → ${persona.nick}] ${whisperText}` });
        // Route only to this specific persona, response sent only to this user
        routeToPersonas(info.channel, `@${persona.nick} ${whisperText}`).catch(() => {});
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

      case "/invite": {
        const target = text.slice(8).trim();
        if (!target) { send(ws, { type: "system", text: "Usage: /invite <persona>" }); return; }
        const invitePersona = getPersonas().find(p => p.nick.toLowerCase() === target.toLowerCase());
        if (!invitePersona) { send(ws, { type: "system", text: `Persona ${target} inconnue` }); return; }
        broadcast(info.channel, { type: "system", text: `${invitePersona.nick} a ete invite par ${info.nick}` });
        broadcast(info.channel, { type: "join", nick: invitePersona.nick, channel: info.channel, text: `${invitePersona.nick} rejoint ${info.channel}` } as OutboundMessage);
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

      case "/persona": {
        const personaName = text.slice(9).trim();
        const pList = getPersonas();
        if (!personaName) {
          const list = pList.map(p => `  ${p.nick} (${p.model})`).join("\n");
          send(ws, { type: "system", text: `Personas actives (${pList.length}):\n${list}` });
          return;
        }
        const found = pList.find(p => p.nick.toLowerCase() === personaName.toLowerCase());
        if (!found) {
          send(ws, { type: "system", text: `Persona "${personaName}" inconnue. /personas pour la liste.` });
          return;
        }
        send(ws, { type: "system", text: `${found.nick}\n  Modele: ${found.model}\n  Couleur: ${found.color}\n  Prompt: ${found.systemPrompt.slice(0, 200)}...` });
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

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  };
}

async function handleComposeCommand({
  ws,
  info,
  text,
  broadcast,
  send,
  logChatMessage,
}: {
  ws: WebSocket;
  info: ClientInfo;
  text: string;
  broadcast: (channel: string, msg: OutboundMessage, exclude?: WebSocket) => void;
  send: (ws: WebSocket, msg: OutboundMessage) => void;
  logChatMessage: (entry: ChatLogEntry) => void;
}): Promise<void> {
  const rawPrompt = text.slice(9).trim();
  // Parse duration from prompt (e.g., "ambient drone, 60s")
  const durationMatch = rawPrompt.match(/(\d+)s\s*$/);
  const duration = durationMatch ? Math.min(Math.max(parseInt(durationMatch[1], 10), 5), 120) : 30;
  let musicPrompt = durationMatch ? rawPrompt.replace(/,?\s*\d+s\s*$/, '').trim() : rawPrompt;
  
  // Extract style keyword if present and enhance prompt
  const styleKeywords = [
    "ambient", "drone", "noise", "glitch", "industrial", "techno", "house",
    "jazz", "free-jazz", "experimental", "electroacoustique", "concrete",
    "classical", "orchestral", "cinematic", "epic", "dark", "minimal",
    "hip-hop", "trap", "lo-fi", "chillwave", "synthwave", "vaporwave",
    "metal", "punk", "post-rock", "shoegaze", "dream-pop",
    "world", "african", "arabic", "indian", "gamelan", "folk",
    "acousmatic", "granular", "spectral", "field-recording",
  ];
  const detectedStyles = styleKeywords.filter(s => musicPrompt.toLowerCase().includes(s));
  // If no style detected, add "experimental" as default
  if (detectedStyles.length === 0 && !musicPrompt.toLowerCase().includes("style")) {
    musicPrompt += ", experimental style";
  }
  if (!musicPrompt) {
    send(ws, { type: "system", text: [
      "Usage: /compose <description>, <style>, <duree>s",
      "",
      "Styles disponibles:",
      "  ambient, drone, noise, glitch, industrial, techno, house",
      "  jazz, free-jazz, experimental, electroacoustique, concrete",
      "  classical, orchestral, cinematic, epic, dark, minimal",
      "  hip-hop, trap, lo-fi, chillwave, synthwave, vaporwave",
      "  metal, punk, post-rock, shoegaze, dream-pop",
      "  world, african, arabic, indian, gamelan, folk",
      "  acousmatic, granular, spectral, field-recording",
      "",
      "Exemples:",
      "  /compose ambient drone with deep bass, experimental, 30s",
      "  /compose dark industrial noise, glitch, 60s",
      "  /compose lo-fi hip-hop beats, chill, 120s",
      "  /compose musique concrete avec sons metalliques, acousmatic, 30s",
    ].join("\n") });
    return;
  }

  broadcast(info.channel, {
    type: "system",
    text: `${info.nick} compose: "${musicPrompt}" (${duration}s)... generation en cours`,
  });

  const ttsUrl = process.env.TTS_URL || "http://127.0.0.1:9100";
  const startTime = Date.now();

  // Progress ticker — send updates every 5s while waiting
  const progressInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    // Smooth elapsed-based progress (no percentage — we don't know when it'll finish)
    const dots = "·".repeat(Math.min(elapsed, 30));
    const spinner = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"][elapsed % 10];
    broadcast(info.channel, { type: "system", text: `🎵 ${spinner} Composition en cours ${dots} ${elapsed}s` });
  }, 5000);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);

    const resp = await fetch(`${ttsUrl}/compose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: musicPrompt, duration }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    clearInterval(progressInterval);

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      send(ws, { type: "system", text: `Composition echouee (${elapsed}s): ${body.error || "unknown"}` });
      return;
    }

    const audioBuffer = Buffer.from(await resp.arrayBuffer());
    if (audioBuffer.length > 50 * 1024 * 1024) {
      send(ws, { type: "system", text: "Audio trop volumineux (>50MB) — essaie une duree plus courte." });
      return;
    }
    const audioBase64 = audioBuffer.toString("base64");

    broadcast(info.channel, {
      type: "music",
      nick: info.nick,
      text: `[Musique: "${musicPrompt}" — ${elapsed}s]`,
      audioData: audioBase64,
      audioMime: "audio/wav",
    } as OutboundMessage);

    saveAudio({ base64: audioBase64, prompt: musicPrompt, nick: info.nick, channel: info.channel }).catch(() => {});

    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "system",
      text: `[Musique generee: "${musicPrompt}" (${elapsed}s)]`,
    });
  } catch (err) {
    clearInterval(progressInterval);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("timeout");
    send(ws, {
      type: "system",
      text: isTimeout
        ? `Composition timeout apres ${elapsed}s — la generation a pris trop de temps.`
        : `Erreur composition (${elapsed}s): ${msg}`,
    });
  }
}

async function handleImagineCommand({
  ws,
  info,
  text,
  broadcast,
  send,
  logChatMessage,
}: {
  ws: WebSocket;
  info: ClientInfo;
  text: string;
  broadcast: (channel: string, msg: OutboundMessage, exclude?: WebSocket) => void;
  send: (ws: WebSocket, msg: OutboundMessage) => void;
  logChatMessage: (entry: ChatLogEntry) => void;
}): Promise<void> {
  const imagePrompt = text.slice(9).trim();
  if (!imagePrompt) {
    send(ws, { type: "system", text: "Usage: /imagine <description de l'image>" });
    return;
  }

  broadcast(info.channel, {
    type: "system",
    text: `${info.nick} genere une image: "${imagePrompt}"... (generation ~10-30s)`,
  });

  const startTime = Date.now();
  const progressInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const spinnerImg = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"][elapsed % 10];
    const dotsImg = "·".repeat(Math.min(elapsed, 20));
    broadcast(info.channel, { type: "system", text: `🎨 ${spinnerImg} Generation image ${dotsImg} ${elapsed}s` });
  }, 5000);

  try {
    const result = await generateImage(imagePrompt);
    clearInterval(progressInterval);
    if (!result) {
      broadcast(info.channel, { type: "system", text: "🎨 Generation echouee — verifiez ComfyUI" });
      return;
    }

    broadcast(info.channel, {
      type: "image",
      nick: info.nick,
      text: `[Image generee: "${imagePrompt}" seed:${result.seed}${result.model ? ` model:${result.model}` : ""}${result.lora ? ` lora:${result.lora}` : ""}]`,
      imageData: result.imageBase64,
      imageMime: "image/png",
    } as OutboundMessage);

    // Persist to media store
    saveImage({ base64: result.imageBase64, prompt: imagePrompt, nick: info.nick, channel: info.channel, seed: result.seed }).catch(() => {});

    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "system",
      text: `[Image generee: "${imagePrompt}"]`,
    });
  } catch (err) {
    send(ws, {
      type: "system",
      text: `Erreur ComfyUI: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
