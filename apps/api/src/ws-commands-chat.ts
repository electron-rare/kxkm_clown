import type { WebSocket } from "ws";
import type { OutboundMessage } from "./chat-types.js";
import type { CommandContext, CommandHandlerDeps } from "./ws-commands-types.js";
import { searchWeb } from "./web-search.js";

export const CHAT_COMMANDS = new Set([
  "/help", "/nick", "/who", "/clear", "/join", "/channels", "/topic",
  "/pin", "/dm", "/msg", "/whisper", "/w", "/search", "/react",
  "/mute", "/unmute", "/ban", "/unban", "/invite", "/personas",
  "/web", "/responders", "/voice-test", "/history-export",
  "/random-persona",
  "/debate",
  "/quote",
  "/weather",
  "/ascii",
  "/translate",
  "/tr",
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
            "=== 3615 J'ai pete -- 105 commandes ===",
            "",
            "CHAT",
            "  /nick <nom>        Changer de pseudo",
            "  /who                Liste des utilisateurs",
            "  /channels           Liste des canaux",
            "  /join <canal>       Rejoindre un canal",
            "  /mute <persona>     Couper une persona",
            "  /unmute <persona>   Reactiver une persona",
            "  /clear              Effacer le chat",
            "  /personas           Personas actives",
            "  /responders <1-5>   Nombre de repondeurs",
            "  /dm <pseudo> <msg>  Message prive",
            "  /whisper <persona>  Message prive a une persona",
            "  /topic <texte>      Sujet du canal",
            "  /pin <message>      Epingler un message",
            "  /invite <persona>   Inviter une persona",
            "  /ban <pseudo>       Bannir (admin)",
            "  /unban <pseudo>     Debannir (admin)",
            "  /react <emoji>      Reagir au dernier message",
            "  /random-persona [sujet]  Invoquer une persona au hasard",
            "  /debate [sujet]     Debat entre 2 personas au hasard",
            "  @NomPersona         Interpeller une persona",
            "",
            "GENERATION IMAGES (F5)",
            "  /imagine <prompt>   Generer une image",
            "  /imagine-models     Lister les modeles ComfyUI",
            "",
            "COMPOSITION (F4)",
            "  /comp new|list|save|load|delete   Gerer les compositions",
            "  /layer <prompt>     Ajouter une piste musicale",
            '  /voice <persona> "texte"  Ajouter une voix',
            "  /noise <type> <dur> Ajouter du bruit (white/pink/brown/sine/drone)",
            "  /ambient <prompt>   Fond sonore",
            "  /compose <prompt>   Composer de la musique",
            "  /mix                Mixer les pistes",
            "  /master [ref#]      Masteriser (AI ref ou ffmpeg)",
            "  /bounce             Exporter le mix",
            "  /remix <piste#>     Re-generer une piste",
            "  /randomize [duree]  Composition aleatoire",
            "  /clear-comp         Vider toutes les pistes",
            "  /undo               Supprimer la derniere piste",
            "  /silence [duree]    Inserer un silence",
            "  /concat <a> <b>     Concatener deux pistes",
            "  /loop <piste#> <x>  Boucler une piste",
            "  /snapshot [label]   Sauvegarder un snapshot",
            "  /marker <label>     Marqueur timeline",
            "  /metronome [BPM]    Click track",
            "  /preview <piste#>   Ecouter une piste seule",
            "",
            "EFFETS AUDIO",
            "  /fx [piste#] <effet> [param]  Appliquer un effet",
            "    volume, fade-in, fade-out, reverse, reverb, pitch, speed, echo, distortion",
            "  /normalize [piste#] Normaliser",
            "  /crossfade <piste#> [dur]  Crossfade entre pistes",
            "  /trim <piste#> <debut> <fin>  Couper",
            "  /stutter <piste#> [rep]  Stutter",
            "  /glitch <piste#>    Glitch",
            "  /stretch <piste#> <factor>  Time stretch",
            "",
            "PISTES",
            "  /tracks             Lister les pistes",
            "  /solo <piste#>      Solo",
            "  /unsolo <piste#>    Unsolo",
            "  /delete <piste#>    Supprimer",
            "  /rename <piste#> <nom>  Renommer",
            "  /duplicate <piste#> Dupliquer",
            "  /gain <piste#> <dB> Ajuster le gain",
            "  /pan <piste#> <L-R> Panoramique",
            "  /swap <a> <b>       Echanger deux pistes",
            "  /bpm <valeur>       Changer le tempo",
            "  /info <piste#>      Details d'une piste",
            "",
            "INSTRUMENTS AI",
            "  /drone [dur] [note] Drone/pad (C2, saw, 5 voix)",
            "  /grain [dur] [src]  Granulaire (noise/tone/voice)",
            "  /circus [dur] [notes] Orgue de barbarie",
            "  /honk [dur] [mode]  Klaxon/siren/horn",
            "  /kokoro [voix] texte  TTS rapide Kokoro (12 voix)",
            "",
            "IA / STEMS",
            "  /stem [piste#]      Separer en stems (Demucs)",
            "  /suggest            Suggestion IA",
            "  /template <style>   Charger un template",
            "",
            "OUTILS",
            "  /status             Etat du systeme",
            "  /models             Modeles Ollama",
            "  /llm                Backend LLM (mascarade)",
            "  /memory <persona>   Memoire d'une persona",
            "  /speed              Latence",
            "  /search <query>     Recherche web",
            "  /web <query>        Recherche web SearXNG",
            "  /help               Cette aide",
            "  /version            Version et infos",
            "  /changelog          10 derniers commits",
            "  /stats              Stats personnelles",
            "  /session            Infos de session",
            "  /history <n>        Derniers N messages",
            "  /context            Stats du contexte",
            "  /export             Exporter l'historique",
            "  /reload             Recharger les personas",
            "  /model              Modele actif",
            "  /persona            Persona active",
            "  /theme <nom>        Theme couleur",
            "  /time               Heure et date",
            "  /fortune            Citation aleatoire",
            "  /dice <NdS>         Lancer des des",
            "  /flip               Pile ou face",
            "  /quote              Citation aleatoire d'une persona",
            "  /weather [ville]    Meteo (wttr.in)",
            "  /ascii <texte>      Texte en gros blocs",
            "  /tr <texte>         Traduction FR↔EN auto",
            "",
            "  F1=Chat F2=Voice F3=Personas F4=Compose F5=Images",
            "  F6=Media F7=Admin F8=DAW AI F9=Instruments",
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
        // /search <query> — searches conversation history + web (SearXNG)
        const query = text.slice(8).trim();
        if (!query) { send(ws, { type: "system", text: "Usage: /search <query> — cherche dans l'historique + web" }); return; }

        const sections: string[] = [`=== Recherche: "${query}" ===`];

        // 1. Search conversation context
        const store = getContextStore?.();
        if (store) {
          try {
            const context = await store.getContext(info.channel, 100_000);
            const lines = context.split("\n").filter((l: string) => l.toLowerCase().includes(query.toLowerCase()));
            if (lines.length > 0) {
              sections.push(`\n[Historique chat] (${lines.length} resultats)`);
              sections.push(lines.slice(-5).join("\n"));
            }
          } catch { /* silent */ }
        }

        // 2. Search web via SearXNG
        try {
          const webResults = await searchWeb(query);
          if (webResults && webResults.length > 10) {
            sections.push(`\n[Web]`);
            sections.push(webResults.slice(0, 500));
          }
        } catch { /* silent */ }

        if (sections.length === 1) {
          sections.push("Aucun resultat.");
        }

        send(ws, { type: "system", text: sections.join("\n") });
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

      case "/voice-test": {
        // /voice-test [persona] [texte] — preview a persona's TTS voice
        const testNick = parts[1] || "Pharmacius";
        const testText = parts.slice(2).join(" ") || `Bonjour, je suis ${testNick}. Ma voix est unique dans ce collectif.`;

        if (testText.length < 10) {
          send(ws, { type: "system", text: "Usage: /voice-test <persona> [texte a prononcer]" });
          return;
        }

        // Find persona
        const personas = getPersonas();
        const persona = personas.find(p => p.nick.toLowerCase() === testNick.toLowerCase());
        if (!persona) {
          send(ws, { type: "system", text: `Persona "${testNick}" introuvable. /who pour la liste.` });
          return;
        }

        send(ws, { type: "system", text: `Test voix: ${persona.nick} — "${testText.slice(0, 50)}..."` });

        // Import and call synthesizeTTS directly
        const { synthesizeTTS } = await import("./ws-multimodal.js");
        await synthesizeTTS(persona.nick, testText, info.channel, broadcast);
        return;
      }

      case "/random-persona": {
        const topic = text.slice(16).trim() || "la vie, l'art et le chaos";
        const personas = getPersonas().filter(p => (p as any).enabled !== false);
        const random = personas[Math.floor(Math.random() * personas.length)];
        if (!random) { send(ws, { type: "system", text: "Aucune persona disponible." }); return; }
        broadcast(info.channel, { type: "system", text: `${random.nick} est invoque sur: "${topic}"` });
        await routeToPersonas(info.channel, `@${random.nick} ${topic}`);
        return;
      }

      case "/debate": {
        // /debate [topic] — two random personas debate a topic
        const debateTopic = text.slice(8).trim() || "l'art et la technologie";
        const debatePersonas = getPersonas().filter(p => (p as any).enabled !== false);
        if (debatePersonas.length < 2) { send(ws, { type: "system", text: "Pas assez de personas." }); return; }

        // Pick 2 different random personas
        const shuffled = [...debatePersonas].sort(() => Math.random() - 0.5);
        const p1 = shuffled[0], p2 = shuffled[1];

        broadcast(info.channel, { type: "system", text: `=== DEBAT: ${p1.nick} vs ${p2.nick} ===\nSujet: "${debateTopic}"` });

        // Trigger first persona
        await routeToPersonas(info.channel, `@${p1.nick} Debat avec @${p2.nick} sur: ${debateTopic}. Prends position et argumente.`);
        return;
      }

      case "/quote": {
        // /quote — random inspirational quote from a persona's domain
        const personas = getPersonas().filter(p => (p as any).enabled !== false);
        const p = personas[Math.floor(Math.random() * personas.length)];
        if (!p) return;

        // Ask the persona for a quote via Ollama
        const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        try {
          const resp = await fetch(`${ollamaUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: p.model,
              messages: [
                { role: "system", content: p.systemPrompt },
                { role: "user", content: "Donne une seule citation inspirante ou provocante dans ton domaine. Format: juste la citation entre guillemets, suivie de ton nom. Maximum 2 phrases." },
              ],
              stream: false,
              options: { num_predict: 150 },
              keep_alive: "30m",
            }),
            signal: AbortSignal.timeout(15_000),
          });
          if (resp.ok) {
            const data = await resp.json() as { message?: { content?: string } };
            const quote = data.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
            if (quote) {
              broadcast(info.channel, { type: "message", nick: p.nick, text: quote, color: p.color });
              return;
            }
          }
        } catch {}
        send(ws, { type: "system", text: "Citation indisponible." });
        return;
      }

      case "/weather": {
        // /weather [ville] — weather via wttr.in
        const city = text.slice(9).trim() || "Paris";
        try {
          const resp = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3&lang=fr`, {
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            const weather = await resp.text();
            send(ws, { type: "system", text: weather.trim() });
          } else {
            send(ws, { type: "system", text: `Meteo indisponible pour "${city}"` });
          }
        } catch {
          send(ws, { type: "system", text: "Service meteo indisponible." });
        }
        return;
      }

      case "/ascii": {
        // /ascii <texte> — render text as ASCII art (simple block letters)
        const asciiText = text.slice(7).trim().toUpperCase().slice(0, 20);
        if (!asciiText) { send(ws, { type: "system", text: "Usage: /ascii <texte>" }); return; }
        // Simple figlet-style with block chars
        const big = asciiText.split("").map(c => `[${c}]`).join(" ");
        broadcast(info.channel, { type: "system", text: `\n  ${"\u2588".repeat(asciiText.length * 4 + 2)}\n  \u2588 ${big} \u2588\n  ${"\u2588".repeat(asciiText.length * 4 + 2)}` });
        return;
      }

      case "/translate":
      case "/tr": {
        const trInput = text.replace(/^\/(translate|tr)\s*/i, "").trim();
        if (!trInput) { send(ws, { type: "system", text: "Usage: /tr <texte> — traduit FR↔EN automatiquement" }); return; }

        const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        try {
          const resp = await fetch(`${ollamaUrl}/api/chat`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "qwen3.5:9b",
              messages: [
                { role: "system", content: "Tu es un traducteur. Si le texte est en francais, traduis en anglais. Si en anglais, traduis en francais. Reponds UNIQUEMENT avec la traduction, rien d'autre." },
                { role: "user", content: trInput },
              ],
              stream: false,
              options: { num_predict: 500 },
              keep_alive: "30m",
              think: false,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          if (resp.ok) {
            const data = await resp.json() as { message?: { content?: string } };
            const translation = data.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
            send(ws, { type: "system", text: `${trInput}\n→ ${translation || "(traduction echouee)"}` });
          } else {
            send(ws, { type: "system", text: "Erreur traduction." });
          }
        } catch {
          send(ws, { type: "system", text: "Service de traduction indisponible." });
        }
        return;
      }

      case "/history-export": {
        const store = getContextStore?.();
        if (!store) { send(ws, { type: "system", text: "Context store non disponible." }); return; }
        try {
          const context = await store.getContext(info.channel, 500_000);
          if (!context || context.length < 10) {
            send(ws, { type: "system", text: "Historique vide." });
            return;
          }
          // Format as markdown
          const lines = context.split("\n");
          const md = [
            `# Historique ${info.channel}`,
            `> Exporte le ${new Date().toLocaleString("fr-FR")}`,
            `> ${lines.length} lignes`,
            "",
            "---",
            "",
            ...lines.map((l: string) => {
              const match = l.match(/^(.+?):\s*(.+)$/);
              if (match) return `**${match[1]}**: ${match[2]}`;
              return l;
            }),
          ].join("\n");

          // Save to file and send download link
          const fsExport = await import("node:fs");
          const pathExport = await import("node:path");
          const filename = `history-${info.channel.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}.md`;
          const filepath = pathExport.join(process.cwd(), "data", "exports", filename);
          fsExport.mkdirSync(pathExport.dirname(filepath), { recursive: true });
          fsExport.writeFileSync(filepath, md);

          send(ws, { type: "system", text: `Historique exporte: /api/v2/media/exports/${filename}\n${lines.length} lignes, ${(md.length / 1024).toFixed(1)} KB` });
        } catch (err) {
          send(ws, { type: "system", text: `Erreur export: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  };
}
