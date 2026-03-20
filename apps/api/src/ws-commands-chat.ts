import type { WebSocket } from "ws";
import type { OutboundMessage } from "./chat-types.js";
import type { CommandContext, CommandHandlerDeps } from "./ws-commands-types.js";
import { searchWeb } from "./web-search.js";

export const CHAT_COMMANDS = new Set([
  "/help", "/nick", "/who", "/clear", "/join", "/channels", "/topic",
  "/pin", "/dm", "/msg", "/whisper", "/w", "/search", "/react",
  "/mute", "/unmute", "/ban", "/unban", "/invite", "/personas",
  "/web", "/responders",
]);

export function createChatCommandHandler(deps: CommandHandlerDeps) {
  const {
    send,
    broadcast,
    broadcastUserlist,
    channelUsers,
    listConnectedNicks,
    listChannelCounts,
    routeToPersonas,
    getPersonas,
    getChannelTopics,
    getClients,
    getMaxResponders,
    setMaxResponders,
    getContextStore,
    refreshPersonas,
    getChannelPins,
    getUserStats,
    bannedNicks,
  } = deps;

  return async function handleChatCommand({ ws, info, text }: CommandContext): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case "/help":
        send(ws, {
          type: "system",
          text: [
            "=== Commandes disponibles ===",
            "/help                              \u2014 cette aide",
            "/clear                             \u2014 efface le chat",
            "/nick <pseudo>                     \u2014 change ton pseudo",
            "/who                               \u2014 utilisateurs connectes",
            "/personas                          \u2014 personas actives",
            "/web <recherche>                   \u2014 recherche web via SearXNG",
            "/imagine <prompt>                  \u2014 genere une image",
            "/imagine-models                    \u2014 modeles ComfyUI disponibles",
            "/compose <prompt>, <style>, <duree>s \u2014 compose de la musique",
            "/comp new <nom> | list             \u2014 gerer les compositions multi-pistes",
            "/layer <description musicale>      \u2014 ajouter une piste a la composition",
            "/mix                               \u2014 mixer toutes les pistes (ffmpeg)",
            '/voice <persona> "texte" [Ns]     \u2014 piste voix TTS persona',
            "/fx <effet> [param]                \u2014 effets audio (volume/fade/reverse/reverb/pitch/speed/echo/distortion)",
            "/noise <type> [duree]              \u2014 bruit: white/pink/brown/sine/drone",
            "/ambient <desc> | off              \u2014 fond sonore persistant pour le canal",
            "/remix <numero piste>              \u2014 re-generer une piste avec le meme prompt",
            "/tracks                            \u2014 afficher les pistes de la composition",
            "/undo                              \u2014 supprimer la derniere piste",
            "/solo <piste#>                     \u2014 solo: muter toutes les autres pistes",
            "/unsolo                            \u2014 restaurer le volume de toutes les pistes",
            "/rename <nom>                      \u2014 renommer la composition active",
            "/dup <piste#>                      \u2014 dupliquer une piste",
            "/bpm <20-300>                      \u2014 tempo de la composition",
            "/clear-comp                        \u2014 vider toutes les pistes",
            "/status                            \u2014 etat du systeme (VRAM, modeles, perf)",
            "/responders <1-5>                  \u2014 nombre de personas qui repondent",
            "/model                             \u2014 modele actif",
            "/persona                           \u2014 persona active",
            "/context                           \u2014 stats du contexte conversationnel",
            "/export                            \u2014 exporter l'historique du canal",
            "/memory <persona>                  \u2014 memoire persistante d'une persona",
            "/models                            \u2014 modeles Ollama disponibles/charges",
            "/join #canal                       \u2014 rejoindre un canal",
            "/channels                          \u2014 liste les canaux actifs",
            "/dm <pseudo> <message>            \u2014 message prive",
            "/topic <texte>                    \u2014 definir le sujet du canal",
            "/reload                            \u2014 recharger les personas depuis la DB",
            "/pin <message>                     \u2014 epingler un message (vide = voir les pins)",
            "/stats                             \u2014 tes stats personnelles",
            "/mute <persona>                    \u2014 muter une persona pour toi",
            "/unmute <persona>                  \u2014 demuter une persona",
            "/ban <pseudo>                      \u2014 bannir un utilisateur (admin)",
            "/unban <pseudo>                    \u2014 debannir un utilisateur (admin)",
            "/whisper <persona> <msg>           \u2014 message prive a une persona",
            "/history <n>                       \u2014 derniers N messages du canal",
            "@NomPersona                        \u2014 interpeller une persona directement",
            "/invite <persona>                  \u2014 inviter une persona dans le canal",
            "/time                              \u2014 heure et date actuelles",
            "/date                              \u2014 heure et date actuelles",
            "/session                           \u2014 infos de ta session",
            "/search <mot-cle>                  \u2014 chercher dans l'historique",
            "/react <emoji>                     \u2014 reagir au dernier message",
            "/dice <NdS>                       \u2014 lancer des des (ex: 2d20)",
            "/flip                              \u2014 pile ou face",
            "/changelog                         \u2014 10 derniers commits",
            "/version                           \u2014 version et infos systeme",
            '/theme <nom>                       \u2014 changer le theme couleur (minitel, noir, matrix, amber, ocean)',
            "/speed                              \u2014 mesurer la latence Ollama",
            "/fortune                            \u2014 citation aleatoire",
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
            .map((persona) => `  ${persona.nick} (${persona.model}) \u2014 ${persona.systemPrompt.slice(0, 60)}...`)
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
            text: `R\u00e9sultats pour "${query}":\n${results}`,
          });
          await routeToPersonas(
            info.channel,
            `L'utilisateur a cherch\u00e9 "${query}" sur le web. R\u00e9sultats:\n${results}\n\nCommente ces r\u00e9sultats.`,
          );
        } catch (err) {
          send(ws, {
            type: "system",
            text: `Recherche \u00e9chou\u00e9e: ${err instanceof Error ? err.message : String(err)}`,
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

      case "/clear":
        broadcast(info.channel, { type: "system", text: "__clear__" });
        return;

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
        send(ws, { type: "system", text: `[DM \u2192 ${dmTarget}] ${dmText}` });
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

      case "/pin": {
        const pinText = text.slice(5).trim();
        if (pinText.length > 200) { send(ws, { type: "system", text: "Pin trop long (max 200 chars)" }); return; }
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

      case "/whisper":
      case "/w": {
        const wMatch = text.match(/^\/(?:whisper|w)\s+(\S+)\s+(.*)/s);
        if (!wMatch) { send(ws, { type: "system", text: "Usage: /whisper <persona> <message>" }); return; }
        const [, targetPersona, whisperText] = wMatch;
        const personas = getPersonas();
        const persona = personas.find(p => p.nick.toLowerCase() === targetPersona.toLowerCase());
        if (!persona) { send(ws, { type: "system", text: `Persona ${targetPersona} inconnue` }); return; }
        send(ws, { type: "system", text: `[Whisper \u2192 ${persona.nick}] ${whisperText}` });
        routeToPersonas(info.channel, `@${persona.nick} ${whisperText}`).catch(() => {});
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

      case "/invite": {
        const target = text.slice(8).trim();
        if (!target) { send(ws, { type: "system", text: "Usage: /invite <persona>" }); return; }
        const invitePersona = getPersonas().find(p => p.nick.toLowerCase() === target.toLowerCase());
        if (!invitePersona) { send(ws, { type: "system", text: `Persona ${target} inconnue` }); return; }
        broadcast(info.channel, { type: "system", text: `${invitePersona.nick} a ete invite par ${info.nick}` });
        broadcast(info.channel, { type: "join", nick: invitePersona.nick, channel: info.channel, text: `${invitePersona.nick} rejoint ${info.channel}` } as OutboundMessage);
        return;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  };
}
