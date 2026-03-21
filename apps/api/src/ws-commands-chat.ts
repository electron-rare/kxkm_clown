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
  "/collab",
  "/persona-create",
  "/radio",
  "/summarize",
  "/mood",
  "/haiku",
  "/timer",
  "/story",
  "/speak",
  "/trivia",
  "/echo",
  "/color",
  "/whoami",
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
            "=== 3615 J'ai pete -- 112 commandes ===",
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
            "  /collab [sujet]     5 personas collaborent",
            "  /persona-create <nom> <model> <desc>  Creer une persona",
            "  /radio [on|off]     Radio auto (persona toutes les 30s)",
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
            "  /summarize          Resume de la conversation",
            "  /mood               Analyse de l'ambiance du canal",
            "  /haiku [sujet]      Haiku d'une persona aleatoire",
            "  /timer <sec> [msg]  Timer avec notification",
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

      case "/who": {
        const whoUsers = channelUsers(info.channel);
        const whoPersonas = getPersonas().filter(p => (p as any).enabled !== false);
        const personaLines = whoPersonas.map(p => `  ${p.nick} [${p.model}]${(p as any).voice ? ` voice:${(p as any).voice}` : ""}`).join("\n");
        send(ws, { type: "userlist", users: whoUsers });
        send(ws, { type: "system", text: `Utilisateurs: ${whoUsers.join(", ")}\n\nPersonas actives (${whoPersonas.length}):\n${personaLines}` });
        return;
      }

      case "/personas": {
        const personas = getPersonas();
        const categories: Record<string, typeof personas> = {};
        for (const p of personas) {
          const sp = p.systemPrompt.toLowerCase();
          const cat = sp.includes("musique") || sp.includes("son") || sp.includes("compositr") ? "Musique/Son"
            : sp.includes("philoso") || sp.includes("theori") || sp.includes("pensee") ? "Philosophie"
            : sp.includes("scien") || sp.includes("code") || sp.includes("logic") ? "Science/Tech"
            : sp.includes("art") || sp.includes("cinema") || sp.includes("visual") ? "Arts"
            : sp.includes("scene") || sp.includes("theatre") || sp.includes("cirque") || sp.includes("danse") ? "Scene/Corps"
            : "Transversal";
          (categories[cat] ||= []).push(p);
        }
        const lines = [`=== ${personas.length} Personas ===`];
        for (const [cat, ps] of Object.entries(categories)) {
          lines.push(`\n[${cat}] (${ps.length})`);
          for (const p of ps) lines.push(`  ${p.nick} \u2014 ${p.model}`);
        }
        send(ws, { type: "system", text: lines.join("\n") });
        return;
      }

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
        send(ws, { type: "system", text: "__clear__" });
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

      case "/collab": {
        // /collab [topic] — all personas respond to same topic (max 5)
        const collabTopic = text.slice(8).trim() || "Qu'est-ce que l'art aujourd'hui ?";
        const collabPersonas = getPersonas().filter(p => (p as any).enabled !== false);
        const selected = [...collabPersonas].sort(() => Math.random() - 0.5).slice(0, 5);

        broadcast(info.channel, { type: "system", text: `=== COLLAB: ${selected.map(p => p.nick).join(", ")} ===\nSujet: "${collabTopic}"` });

        if (typeof routeToPersonas === "function") {
          const mentions = selected.map(p => `@${p.nick}`).join(" ");
          await routeToPersonas(info.channel, `${mentions} ${collabTopic}`);
        }
        return;
      }

      case "/persona-create": {
        // /persona-create <name> <model> <description>
        const pcArgs = text.slice(16).trim();
        const pcMatch = pcArgs.match(/^(\S+)\s+(\S+)\s+(.+)$/);
        if (!pcMatch) {
          send(ws, { type: "system", text: "Usage: /persona-create <nom> <modele> <description>\nEx: /persona-create Mozart qwen3.5:9b Compositeur classique viennois" });
          return;
        }
        const [, pcName, pcModel, pcDescription] = pcMatch;

        const existingPersona = getPersonas().find(p => p.nick.toLowerCase() === pcName!.toLowerCase());
        if (existingPersona) {
          send(ws, { type: "system", text: `Persona "${pcName}" existe deja.` });
          return;
        }

        const pcSystemPrompt = `Tu es ${pcName}. ${pcDescription} Tu reponds en francais.`;

        const fsPC = await import("node:fs/promises");
        const pathPC = await import("node:path");
        const customFile = pathPC.join(process.cwd(), "data", "persona-memory", `_custom_${pcName!.toLowerCase()}.json`);
        await fsPC.writeFile(customFile, JSON.stringify({ nick: pcName, model: pcModel, systemPrompt: pcSystemPrompt, color: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"), custom: true }));

        broadcast(info.channel, { type: "system", text: `Persona "${pcName}" creee (${pcModel}). Elle sera active au prochain /reload.` });
        return;
      }

      case "/radio": {
        // /radio [on|off] — continuous random persona quotes every 30s
        const radioAction = parts[1] || "on";
        if (radioAction === "off") {
          const existing = (globalThis as any).__radioTimers?.get(info.channel);
          if (existing) { clearInterval(existing); (globalThis as any).__radioTimers.delete(info.channel); }
          broadcast(info.channel, { type: "system", text: "Radio OFF." });
          return;
        }

        if (!(globalThis as any).__radioTimers) (globalThis as any).__radioTimers = new Map();
        const existingTimer = (globalThis as any).__radioTimers.get(info.channel);
        if (existingTimer) { send(ws, { type: "system", text: "Radio deja active. /radio off pour arreter." }); return; }

        broadcast(info.channel, { type: "system", text: "Radio ON — une persona aleatoire s'exprime toutes les 30s. /radio off pour arreter." });

        const radioTimer = setInterval(async () => {
          const radioPersonas = getPersonas().filter(p => (p as any).enabled !== false);
          const rp = radioPersonas[Math.floor(Math.random() * radioPersonas.length)];
          if (!rp || typeof routeToPersonas !== "function") return;
          const topics = ["la beaute du chaos", "le silence", "la revolution", "le son comme matiere", "l'avenir de l'art", "la memoire collective", "le corps et la machine"];
          const radioTopic = topics[Math.floor(Math.random() * topics.length)];
          try {
            await routeToPersonas(info.channel, `@${rp.nick} En une phrase, parle de ${radioTopic}.`);
          } catch {}
        }, 30000);

        (globalThis as any).__radioTimers.set(info.channel, radioTimer);
        return;
      }

      case "/summarize": {
        const store = getContextStore?.();
        if (!store) { send(ws, { type: "system", text: "Context store indisponible." }); return; }
        try {
          const context = await store.getContext(info.channel, 10000);
          if (!context || context.length < 20) { send(ws, { type: "system", text: "Pas assez d'historique." }); return; }

          send(ws, { type: "system", text: "Resume en cours..." });
          const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
          const resp = await fetch(`${ollamaUrl}/api/chat`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "qwen3.5:9b",
              messages: [
                { role: "system", content: "Tu resumes les conversations de maniere concise. Bullet points. Maximum 10 points." },
                { role: "user", content: `Resume cette conversation:\n\n${context.slice(-5000)}` },
              ],
              stream: false, options: { num_predict: 500 }, keep_alive: "30m", think: false,
            }),
            signal: AbortSignal.timeout(20_000),
          });
          if (resp.ok) {
            const data = await resp.json() as { message?: { content?: string } };
            const summary = data.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
            send(ws, { type: "system", text: `=== RESUME ===\n${summary || "(vide)"}` });
          }
        } catch { send(ws, { type: "system", text: "Erreur resume." }); }
        return;
      }

      case "/mood": {
        const hour = new Date().getHours();
        let mood = "";
        if (hour >= 6 && hour < 12) mood = "MATINAL — energique et frais";
        else if (hour >= 12 && hour < 14) mood = "MIDI — detendu et gourmand";
        else if (hour >= 14 && hour < 18) mood = "APRES-MIDI — concentre et productif";
        else if (hour >= 18 && hour < 22) mood = "SOIREE — philosophe et contemplatif";
        else mood = "NUIT — mystique et onirique";
        send(ws, { type: "system", text: `Humeur actuelle: ${mood}\nLes personas adaptent leur ton selon l'heure.` });
        return;
      }

      case "/haiku": {
        const haikuTopic = text.slice(7).trim() || "le son et le silence";
        const haikuPersonas = getPersonas().filter(p => (p as any).enabled !== false);
        const hp = haikuPersonas[Math.floor(Math.random() * haikuPersonas.length)];
        if (!hp) return;
        const haikuOllamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        try {
          const resp = await fetch(`${haikuOllamaUrl}/api/chat`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: hp.model,
              messages: [
                { role: "system", content: hp.systemPrompt },
                { role: "user", content: `Ecris un haiku (5-7-5 syllabes) sur: ${haikuTopic}. Reponds UNIQUEMENT avec le haiku, 3 lignes, rien d'autre.` },
              ],
              stream: false, options: { num_predict: 100 }, keep_alive: "30m", think: false,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (resp.ok) {
            const data = await resp.json() as { message?: { content?: string } };
            const haiku = data.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
            if (haiku) {
              broadcast(info.channel, { type: "message", nick: hp.nick, text: `\n${haiku}\n\n— ${hp.nick}, haiku sur "${haikuTopic}"`, color: hp.color });
              return;
            }
          }
        } catch {}
        send(ws, { type: "system", text: "Haiku indisponible." });
        return;
      }

      case "/timer": {
        const seconds = parseInt(parts[1]) || 0;
        if (seconds <= 0 || seconds > 3600) { send(ws, { type: "system", text: "Usage: /timer <secondes> (1-3600)" }); return; }
        send(ws, { type: "system", text: `Timer: ${seconds}s demarre...` });
        setTimeout(() => {
          broadcast(info.channel, { type: "system", text: `Timer de ${info.nick}: ${seconds}s ecoule!` });
        }, seconds * 1000);
        return;
      }

      case "/story": {
        // /story [theme] — 3 personas each write a paragraph continuing a story (Lot 427)
        const theme = text.slice(7).trim() || "un voyage dans un monde sonore inconnu";
        const storyPersonas = getPersonas().filter(p => (p as any).enabled !== false);
        if (storyPersonas.length < 3) { send(ws, { type: "system", text: "Pas assez de personas (min 3)." }); return; }
        const storytellers = [...storyPersonas].sort(() => Math.random() - 0.5).slice(0, 3);

        broadcast(info.channel, { type: "system", text: `=== HISTOIRE COLLABORATIVE ===\nTheme: "${theme}"\nConteurs: ${storytellers.map(p => p.nick).join(", ")}` });

        await routeToPersonas(
          info.channel,
          `@${storytellers[0].nick} Ecris le premier paragraphe d'une histoire courte sur: ${theme}. @${storytellers[1].nick} continuera apres toi, puis @${storytellers[2].nick} conclura. Maximum 3 phrases.`,
        );
        return;
      }

      case "/trivia": {
        const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        try {
          const resp = await fetch(`${ollamaUrl}/api/chat`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "qwen3.5:9b",
              messages: [{ role: "user", content: "Pose une question de culture generale interessante avec 4 choix (A, B, C, D) et donne la reponse. Format:\nQuestion: ...\nA) ...\nB) ...\nC) ...\nD) ...\nReponse: X" }],
              stream: false, options: { num_predict: 300 }, keep_alive: "30m", think: false,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          if (resp.ok) {
            const data = await resp.json() as { message?: { content?: string } };
            const trivia = data.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
            broadcast(info.channel, { type: "system", text: `\u{1F9E0} TRIVIA\n${trivia || "Indisponible."}` });
          }
        } catch { broadcast(info.channel, { type: "system", text: "Trivia indisponible." }); }
        return;
      }

      case "/echo": {
        const echoText = text.slice(6).trim();
        if (!echoText) { send(ws, { type: "system", text: "Usage: /echo <message>" }); return; }
        broadcast(info.channel, { type: "system", text: echoText });
        return;
      }

      case "/speak": {
        // /speak <persona> <texte> — force TTS for text as persona
        const speakMatch = text.match(/^\/speak\s+(\S+)\s+(.+)$/);
        if (!speakMatch) { send(ws, { type: "system", text: "Usage: /speak <persona> <texte>" }); return; }
        const [, speakNick, speakText] = speakMatch;
        const persona = getPersonas().find(p => p.nick.toLowerCase() === speakNick.toLowerCase());
        if (!persona) { send(ws, { type: "system", text: `Persona "${speakNick}" inconnue.` }); return; }

        const { synthesizeTTS } = await import("./ws-multimodal.js");
        await synthesizeTTS(persona.nick, speakText, info.channel, broadcast);
        return;
      }

      case "/color": {
        // /color <hex> — cosmetic nick color confirmation (Lot 452)
        const hex = parts[1]?.replace("#", "") || "";
        if (!/^[0-9a-f]{6}$/i.test(hex)) {
          send(ws, { type: "system", text: "Usage: /color <hex> (ex: /color ff6600)" });
          return;
        }
        send(ws, { type: "system", text: `Couleur changee: #${hex}` });
        return;
      }

      case "/whoami": {
        // /whoami — show current session info (Lot 453)
        send(ws, { type: "system", text: `Nick: ${info.nick}\nCanal: ${info.channel}\nRole: ${(info as any).role || "viewer"}\nSession: ${(info as any).sessionId || "N/A"}` });
        return;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  };
}
