import { execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { CommandContext, CommandHandlerDeps } from "./ws-commands-types.js";
import { getRecentErrors } from "./error-tracker.js";
import { loadPersonaMemory } from "./ws-persona-router.js";
import type { OutboundMessage } from "./chat-types.js";

const execFileAsync = promisify(execFile);

export const INFO_COMMANDS = new Set([
  "/status", "/stats", "/session", "/time", "/date", "/version",
  "/changelog", "/fortune", "/speed", "/model", "/persona", "/personas-detail",
  "/models", "/memory", "/context", "/export", "/history", "/responders-info",
  "/reload", "/theme", "/dice", "/roll", "/flip",
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

        const ustats = getUserStats?.();
        if (ustats) {
          let totalMsgs = 0;
          for (const [, s] of ustats) totalMsgs += s.messages;
          lines.push(`Messages traites: ${totalMsgs}`);
        }

        try {
          const cs = getContextStore?.();
          if (cs) {
            const gStats = await cs.getStats();
            lines.push(`Context store: ${gStats.channels} canaux, ${gStats.totalSizeMB.toFixed(2)} MB`);
          }
        } catch { /* context stats unavailable */ }

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

      case "/stats": {
        const stats = getUserStats?.()?.get(info.nick);
        const uptime = stats ? Math.floor((Date.now() - stats.firstSeen) / 60000) : 0;
        send(ws, { type: "system", text: `Stats ${info.nick}:\n  Messages: ${stats?.messages || 0}\n  Connecte: ${uptime}min` });
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
        send(ws, { type: "system", text: `KXKM_Clown ${pkg.version}\n  Ollama: v0.18.2\n  Node: ${process.version}\n  Commandes: 55\n  Personas: ${getPersonas().length}\n  Uptime: ${Math.floor(process.uptime()/3600)}h${Math.floor((process.uptime()%3600)/60)}m` });
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

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  };
}
