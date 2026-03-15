function createCommandHandler({
  adminBootstrapToken,
  admins,
  appendToMemory,
  appendPersonaFeedback,
  broadcast,
  broadcastAll,
  buildChannelInfo,
  channelUsers,
  claimOwnerNick,
  clients,
  formatStats,
  generalResponderLabel,
  getActivePersonaCount,
  getAllPersonas,
  getChannelModel,
  getChannelTopic,
  getDefaultPersonaNameForModel,
  getPersonaById,
  getPersonaByNick,
  getPersonasByModel,
  getSession,
  listSessionIds,
  loadSavedSession,
  loadMemory,
  saveSession,
  logByNick,
  logDPOPair,
  isAdminNetworkAllowed,
  ollamaAllModels,
  ollamaChat,
  ollamaModels,
  searchWeb,
  fetchWebPage,
  ops,
  lastRoundResponses,
  replayHistory,
  setChannelTopic,
  send,
  buildUploadCapability,
}) {
  const WEB_PERSONA_ID = "mistral";

  function pushChannelInfo(ws, info) {
    const session = getSession(info.sessionId);
    const selectedPersona = session.persona ? getPersonaById(session.persona) : null;
    ws.send(JSON.stringify(buildChannelInfo(
      info.channel,
      session.model,
      selectedPersona?.name || null,
      selectedPersona?.id || session.persona || null
    )));
    if (typeof buildUploadCapability === "function") {
      ws.send(JSON.stringify(buildUploadCapability(info, session)));
    }
  }

  function broadcastChannelInfo(channel) {
    for (const [clientWs, clientInfo] of clients) {
      if (clientInfo.channel !== channel || clientWs.readyState !== 1) continue;
      pushChannelInfo(clientWs, clientInfo);
    }
  }

  function readTopic(channel) {
    if (typeof getChannelTopic !== "function") {
      return {
        topic: "KXKM_Clown - Local LLM Chat",
        updatedAt: null,
        updatedBy: null,
      };
    }

    const currentTopic = getChannelTopic(channel);
    if (currentTopic && typeof currentTopic === "object") return currentTopic;

    return {
      topic: currentTopic || "KXKM_Clown - Local LLM Chat",
      updatedAt: null,
      updatedBy: null,
    };
  }

  function resolvePersonaChoice(personas, rawChoice) {
    const index = Number.parseInt(rawChoice, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= personas.length) {
      return personas[index - 1];
    }

    const lowerChoice = rawChoice.toLowerCase();
    return (
      personas.find((persona) => persona.id.toLowerCase() === lowerChoice) ||
      personas.find((persona) => persona.name.toLowerCase() === lowerChoice) ||
      personas.find((persona) => persona.name.toLowerCase().includes(lowerChoice)) ||
      null
    );
  }

  function getSelectedPersona(session) {
    if (session.persona) return getPersonaById(session.persona);
    if (!session.model) return null;
    return getPersonasByModel(session.model)[0] || null;
  }

  function resolvePersonaForModel(model, rawPersona) {
    if (!model) return null;
    const personas = getPersonasByModel(model);
    if (!personas.length) return null;
    if (!rawPersona) return personas[0];

    const normalized = String(rawPersona).trim().toLowerCase();
    return (
      personas.find((persona) => persona.id.toLowerCase() === normalized)
      || personas.find((persona) => persona.name.toLowerCase() === normalized)
      || personas[0]
    );
  }

  function restoreSnapshotIntoSession(info, snapshot) {
    const session = getSession(info.sessionId);
    const channelModel = getChannelModel(info.channel);

    if (session._abortController) {
      try {
        session._abortController.abort();
      } catch {}
    }

    session._abort = false;
    session._abortController = null;
    session.messages = Array.isArray(snapshot.messages) ? snapshot.messages.slice() : [];
    session.created = Date.now();

    if (channelModel === "ADMIN") {
      session.model = snapshot.model || null;
      session.persona = session.model
        ? resolvePersonaForModel(session.model, snapshot.persona)?.id || null
        : null;
      return {
        session,
        scope: "admin",
      };
    }

    if (channelModel) {
      session.model = channelModel;
      session.persona = resolvePersonaForModel(channelModel, snapshot.persona)?.id || null;
      return {
        session,
        scope: "dedicated",
      };
    }

    session.model = null;
    session.persona = null;
    return {
      session,
      scope: "general",
    };
  }

  function requireWebPersona(ws, info) {
    if (info.channel === "#general") {
      send(ws, "system", "*** Les outils web sont réservés aux sessions single-model. Va sur #admin puis choisis Mistral.");
      return null;
    }

    const session = getSession(info.sessionId);
    if (!session.model) {
      send(ws, "system", "*** Aucun modèle sélectionné — utilise /model puis /persona Mistral.");
      return null;
    }

    const persona = getSelectedPersona(session);
    if (!persona || persona.id !== WEB_PERSONA_ID) {
      send(ws, "system", "*** Cette commande est réservée à la persona Mistral. Passe sur #admin, puis /model mistral:7b et /persona Mistral.");
      return null;
    }

    return { session, persona };
  }

  async function streamToolPersonaResponse({
    info,
    session,
    persona,
    userText,
    systemContext,
  }) {
    const model = session.model || persona.model;
    const botNick = persona.name;

    const priorMessages = session.messages
      .filter((message) => message.role !== "system")
      .slice(-6);

    const messages = [
      {
        role: "system",
        content: [
          `Tu es ${botNick} (${persona.desc}).`,
          persona.style,
          "Tu es ici un agent admin, critique et orchestrateur.",
          "Tu peux utiliser des résultats web frais fournis par le runtime.",
          "Tu réponds toujours en français, de manière concise, opérationnelle, avec des points de vigilance concrets.",
          systemContext,
        ].filter(Boolean).join("\n"),
      },
      ...priorMessages,
      { role: "user", content: userText },
    ];

    session._abort = false;
    session._abortController = new AbortController();

    broadcastAll(info.channel, { type: "persona", nick: botNick, color: persona.color });
    broadcastAll(info.channel, { type: "stream_start", nick: botNick });

    try {
      const response = await ollamaChat(
        model,
        messages,
        (token, done, stats) => {
          if (!done && token) {
            broadcastAll(info.channel, { type: "stream_token", nick: botNick, text: token });
          }
          if (done) {
            broadcastAll(info.channel, { type: "stream_end", nick: botNick, stats: formatStats(stats) });
          }
        },
        session._abortController.signal
      );

      if (!response) return;

      session.messages.push({ role: "user", content: userText });
      session.messages.push({ role: "assistant", content: response });
      logByNick(info.nick, info.channel, botNick, response);
      appendToMemory(info.nick, info.channel, model, userText, response);
      saveSession(info.sessionId, session);
    } catch (error) {
      broadcastAll(info.channel, { type: "stream_end", nick: botNick, stats: " [erreur]" });
      send({ send: info.send }, "system", `*** Erreur ${botNick}: ${error.message}`);
    }
  }

  function renderSearchContext(query, results) {
    return [
      `=== RECHERCHE WEB ===`,
      `Requête: ${query}`,
      ...results.map((item, index) => [
        `[${index + 1}] ${item.title}`,
        `URL: ${item.url}`,
        `Extrait: ${item.snippet || "(aucun extrait)"}`,
      ].join("\n")),
      "=== FIN RECHERCHE ===",
    ].join("\n\n");
  }

  return async function handleCommand(ws, info, text) {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case "/nick": {
        if (!args[0]) return send(ws, "system", "Usage: /nick <pseudo>");
        const sanitized = args[0].replace(/[^a-z0-9_-]/gi, "_").slice(0, 20);

        if (isReservedNick(sanitized) && info.nick.toLowerCase() !== sanitized.toLowerCase()) {
          const hint = adminBootstrapToken
            ? " Utilise /saisail <token> si tu es sur un reseau admin autorise."
            : "";
          return send(ws, "system", `*** "${sanitized}" est un pseudo reserve.${hint}`);
        }

        if (isNickTaken(sanitized, ws)) {
          return send(ws, "system", `*** 433 ERR_NICKNAMEINUSE: "${sanitized}" est deja pris. Choisis un autre pseudo.`);
        }

        const oldNick = info.nick;
        info.nick = sanitized;
        send(ws, "system", `*** Tu es maintenant ${info.nick}`);
        ws.send(JSON.stringify({ type: "nick_change", nick: info.nick }));
        broadcast(info.channel, { type: "system", text: `*** ${oldNick} est maintenant ${info.nick}` }, ws);
        broadcastAll(info.channel, { type: "userlist", users: channelUsers(info.channel) });
        break;
      }

      case "/join": {
        if (!args[0]) return send(ws, "system", "Usage: /join #canal");
        const newChan = args[0].startsWith("#") ? args[0] : `#${args[0]}`;

        broadcast(info.channel, { type: "part", nick: info.nick, text: `${info.nick} a quitte ${info.channel}` });
        broadcastAll(info.channel, { type: "userlist", users: channelUsers(info.channel).filter((u) => u !== info.nick) });

        info.channel = newChan;
        info.sessionId = `sess_${newChan}_${Date.now()}`;
        const newSession = getSession(info.sessionId);
        const chanModel = getChannelModel(newChan);

        if (chanModel && chanModel !== "ADMIN") {
          newSession.model = chanModel;
          newSession.persona = getPersonasByModel(chanModel)[0]?.id || null;
          const selectedPersona = newSession.persona ? getPersonaById(newSession.persona) : null;
          const personaHint = selectedPersona?.name ? ` | persona: ${selectedPersona.name}` : "";
          const disabledHint = !selectedPersona ? " | aucune persona active sur ce modèle" : "";
          send(ws, "system", `*** Modele auto: ${newSession.model}${personaHint}${disabledHint}`);
        } else if (chanModel === "ADMIN") {
          send(ws, "system", "*** Canal admin - utilise /model et /persona pour choisir ton agent");
        } else if (newChan === "#general") {
          newSession.model = null;
          newSession.persona = null;
          send(ws, "system", `*** #general - ${generalResponderLabel()}`);
        }

        broadcast(info.channel, { type: "join", nick: info.nick, text: `${info.nick} a rejoint ${info.channel}` }, ws);
        send(ws, "system", `*** Tu es maintenant sur ${info.channel}`);
        broadcastAll(info.channel, { type: "userlist", users: channelUsers(info.channel) });
        pushChannelInfo(ws, info);
        replayHistory(ws, newChan);
        break;
      }

      case "/model":
      case "/m": {
        const isAdminChan = getChannelModel(info.channel) === "ADMIN";
        if (!isAdminChan && info.channel !== "#general") {
          return send(ws, "system", "*** Canal dedie - modele fixe. Va sur #admin pour choisir.");
        }
        if (!args[0]) {
          try {
            const models = isAdminChan ? await ollamaAllModels() : await ollamaModels();
            const session = getSession(info.sessionId);
            const current = session.model || "(aucun)";
            const currentPersona = session.persona ? getPersonaById(session.persona)?.name || "(introuvable)" : "(aucune)";
            let modelText = `*** Modele actif: ${current} | persona: ${currentPersona}\n*** Modeles disponibles:\n`;
            models.forEach((m, i) => {
              modelText += `***   ${i + 1}. ${m.name} [${m.size}] (${m.family})\n`;
            });
            modelText += "*** Usage: /model <nom> ou /model <numero>";
            send(ws, "system", modelText);
          } catch (e) {
            send(ws, "system", `*** Erreur Ollama: ${e.message}`);
          }
          return;
        }
        try {
          const models = isAdminChan ? await ollamaAllModels() : await ollamaModels();
          let modelName;
          const num = parseInt(args[0], 10);
          if (!Number.isNaN(num) && num >= 1 && num <= models.length) {
            modelName = models[num - 1].name;
          } else {
            modelName = models.find((m) => m.name.includes(args[0]))?.name || args[0];
          }
          const session = getSession(info.sessionId);
          session.model = modelName;
          const personas = getPersonasByModel(modelName);
          const currentPersona = session.persona ? personas.find((persona) => persona.id === session.persona) : null;
          session.persona = currentPersona?.id || personas[0]?.id || null;

          const selectedPersona = session.persona ? getPersonaById(session.persona) : null;
          const personaHint = selectedPersona?.name
            ? ` | persona: ${selectedPersona.name}`
            : " | aucune persona active sur ce modèle";
          send(ws, "system", `*** Modele change: ${modelName}${personaHint}`);
          broadcast(info.channel, {
            type: "system",
            text: `*** ${info.nick} utilise maintenant ${modelName}${personaHint}`,
          }, ws);
          pushChannelInfo(ws, info);
        } catch (e) {
          send(ws, "system", `*** Erreur: ${e.message}`);
        }
        break;
      }

      case "/persona":
      case "/p": {
        if (info.channel === "#general") {
          return send(ws, "system", "*** #general utilise les personas actives du salon. Choisis une persona sur #admin ou un canal dédié.");
        }

        const session = getSession(info.sessionId);
        if (!session.model) {
          return send(ws, "system", "*** Aucun modèle sélectionné — tape /model pour en choisir un");
        }

        const personas = getPersonasByModel(session.model);
        if (!personas.length) {
          return send(ws, "system", `*** Aucune persona déclarée pour ${session.model}`);
        }

        if (!args[0]) {
          const currentPersonaId = session.persona || getPersonasByModel(session.model)[0]?.id || null;
          const currentPersona = currentPersonaId ? getPersonaById(currentPersonaId)?.name || "(introuvable)" : "(aucune)";
          let personaText = `*** Persona active: ${currentPersona}\n*** Personas disponibles pour ${session.model}:\n`;
          personas.forEach((persona, index) => {
            const flags = [];
            if (persona.id === currentPersonaId) flags.push("active");
            if (index === 0) flags.push("defaut");
            const suffix = flags.length ? ` [${flags.join(", ")}]` : "";
            personaText += `***   ${index + 1}. ${persona.name} — ${persona.desc}${suffix}\n`;
          });
          personaText += "*** Usage: /persona <nom> ou /persona <numero>";
          return send(ws, "system", personaText);
        }

        const chosenPersona = resolvePersonaChoice(personas, args[0]);
        if (!chosenPersona) {
          return send(ws, "system", `*** Persona inconnue pour ${session.model}: ${args[0]}`);
        }

        session.persona = chosenPersona.id;
        send(ws, "system", `*** Persona changee: ${chosenPersona.name} (${chosenPersona.model})`);
        broadcast(info.channel, {
          type: "system",
          text: `*** ${info.nick} utilise maintenant la persona ${chosenPersona.name}`,
        }, ws);
        pushChannelInfo(ws, info);
        break;
      }

      case "/clear": {
        const session = getSession(info.sessionId);
        session.messages = [];
        send(ws, "system", "*** Historique efface");
        break;
      }

      case "/system":
      case "/sys": {
        if (!args.length) return send(ws, "system", "Usage: /system <prompt systeme>");
        const session = getSession(info.sessionId);
        session.messages = session.messages.filter((m) => m.role !== "system");
        session.messages.unshift({ role: "system", content: args.join(" ") });
        send(ws, "system", `*** Prompt systeme defini: "${args.join(" ").slice(0, 100)}..."`);
        break;
      }

      case "/who": {
        const users = channelUsers(info.channel);
        const humanUsers = [];
        const botUsers = [];
        const allPersonas = getAllPersonas();
        for (const user of users) {
          if (allPersonas[user]) botUsers.push(user);
          else humanUsers.push(user);
        }
        let whoText = `*** Utilisateurs sur ${info.channel}:\n`;
        if (humanUsers.length) whoText += `***   Humains: ${humanUsers.join(", ")}\n`;
        if (botUsers.length) whoText += `***   Agents IA: ${botUsers.join(", ")}`;
        send(ws, "system", whoText);
        break;
      }

      case "/memory":
      case "/mem": {
        const mem = loadMemory(info.nick);
        if (!mem.conversations.length) {
          send(ws, "system", "*** Aucune memoire enregistree pour toi");
        } else {
          let memoryText = `*** Memoire de ${info.nick} (${mem.conversations.length} echanges)\n`;
          const recent = mem.conversations.slice(-5);
          for (const c of recent) {
            memoryText += `***   [${c.ts.slice(0, 16)}] ${c.channel} - ${c.user.slice(0, 60)}...\n`;
          }
          send(ws, "system", memoryText);
        }
        break;
      }

      case "/web": {
        if (!args.length) {
          return send(ws, "system", "*** Usage: /web <requête>");
        }
        if (typeof searchWeb !== "function") {
          return send(ws, "system", "*** Outil web non configuré côté serveur");
        }

        const ready = requireWebPersona(ws, info);
        if (!ready) break;

        const query = args.join(" ").trim();
        send(ws, "system", `*** Recherche web en cours: ${query}`);

        try {
          const results = await searchWeb(query, 5);
          if (!results.length) {
            return send(ws, "system", `*** Aucun résultat web exploitable pour: ${query}`);
          }

          appendPersonaFeedback(ready.persona.id, {
            kind: "web_search",
            actor: info.nick,
            channel: info.channel,
            reason: query,
            payload: {
              query,
              results: results.slice(0, 3),
            },
          });

          broadcastAll(info.channel, {
            type: "system",
            text: `*** Web ${ready.persona.name}: ${results.length} résultat(s) pour "${query}"`,
          });

          await streamToolPersonaResponse({
            info,
            session: ready.session,
            persona: ready.persona,
            userText: `Réponds à cette recherche web: ${query}\nFais une synthèse courte, critique si nécessaire, puis termine par "Sources:" et la liste des URLs utiles.`,
            systemContext: renderSearchContext(query, results),
          });
        } catch (error) {
          send(ws, "system", `*** Erreur web: ${error.message}`);
        }
        break;
      }

      case "/fetch": {
        if (!args[0]) {
          return send(ws, "system", "*** Usage: /fetch <url>");
        }
        if (typeof fetchWebPage !== "function") {
          return send(ws, "system", "*** Outil fetch web non configuré côté serveur");
        }

        const ready = requireWebPersona(ws, info);
        if (!ready) break;

        const url = args[0];
        send(ws, "system", `*** Lecture web en cours: ${url}`);

        try {
          const page = await fetchWebPage(url);

          appendPersonaFeedback(ready.persona.id, {
            kind: "web_fetch",
            actor: info.nick,
            channel: info.channel,
            reason: page.url,
            payload: {
              url: page.url,
              title: page.title,
            },
          });

          broadcastAll(info.channel, {
            type: "system",
            text: `*** Web ${ready.persona.name}: page chargée ${page.title ? `- ${page.title}` : page.url}`,
          });

          await streamToolPersonaResponse({
            info,
            session: ready.session,
            persona: ready.persona,
            userText: `Analyse cette page web: ${page.url}\nRésume ce qu'elle apporte, critique sa fiabilité si besoin, et indique ce qui est utile pour l'admin ou l'orchestration.`,
            systemContext: [
              "=== PAGE WEB ===",
              `URL: ${page.url}`,
              page.title ? `Titre: ${page.title}` : null,
              `Type: ${page.contentType || "inconnu"}`,
              page.text,
              "=== FIN PAGE ===",
            ].filter(Boolean).join("\n"),
          });
        } catch (error) {
          send(ws, "system", `*** Erreur fetch: ${error.message}`);
        }
        break;
      }

      case "/sessions":
      case "/list": {
        if (args[0]?.toLowerCase() === "restore") {
          if (!args[1]) {
            return send(ws, "system", "*** Usage: /sessions restore <id>");
          }

          if (typeof loadSavedSession !== "function") {
            return send(ws, "system", "*** Restauration de snapshot indisponible côté serveur");
          }

          const snapshot = loadSavedSession(args[1]);
          if (!snapshot) {
            return send(ws, "system", `*** Snapshot introuvable: ${args[1]}`);
          }

          const { session, scope } = restoreSnapshotIntoSession(info, snapshot);
          const selectedPersona = session.persona ? getPersonaById(session.persona) : null;
          const modeLabel = scope === "general"
            ? "#general conserve son mode multi-personas"
            : `modele=${session.model || "(aucun)"}${selectedPersona ? ` | persona=${selectedPersona.name}` : ""}`;
          saveSession(info.sessionId, session);
          pushChannelInfo(ws, info);
          return send(
            ws,
            "system",
            `*** Snapshot restauré: ${args[1]} | messages=${session.messages.length} | ${modeLabel}`
          );
        }

        const sessionIds = listSessionIds();
        if (!sessionIds.length) return send(ws, "system", "*** Aucune session sauvegardee");
        let sessionText = "*** Sessions sauvegardees:\n";
        sessionIds.forEach((id) => { sessionText += `***   ${id}\n`; });
        sessionText += "*** Usage: /sessions restore <id>";
        send(ws, "system", sessionText);
        break;
      }

      case "/vote": {
        if (!args[0]) {
          const round = lastRoundResponses.get(info.channel);
          if (!round || !round.length) return send(ws, "system", "*** Aucune reponse a voter");
          let voteText = "*** Vote pour la meilleure reponse:\n";
          round.forEach((r, i) => { voteText += `***   ${i + 1}. ${r.botNick}\n`; });
          voteText += "*** Usage: /vote <nom> ou /vote <numero>";
          return send(ws, "system", voteText);
        }
        const round = lastRoundResponses.get(info.channel);
        if (!round || !round.length) return send(ws, "system", "*** Aucune reponse a voter");

        let chosen;
        const num = parseInt(args[0], 10);
        if (!Number.isNaN(num) && num >= 1 && num <= round.length) {
          chosen = round[num - 1];
        } else {
          chosen = round.find((r) => r.botNick.toLowerCase().includes(args[0].toLowerCase()));
        }
        if (!chosen) return send(ws, "system", `*** Bot inconnu: ${args[0]}`);

        const rejected = round.filter((r) => r !== chosen);
        const chosenPersona = getPersonaByNick(chosen.botNick);
        for (const rej of rejected) {
          const rejectedPersona = getPersonaByNick(rej.botNick);
          logDPOPair(info.nick, chosen.prompt, chosen.response, rej.response, chosen.model, rej.model);
          if (rejectedPersona) {
            appendPersonaFeedback(rejectedPersona.id, {
              kind: "vote",
              channel: info.channel,
              actor: info.nick,
              payload: {
                direction: "down",
                via: "explicit_vote",
                prompt: chosen.prompt,
                counterparty: chosen.botNick,
              },
            });
          }
        }
        if (chosenPersona) {
          appendPersonaFeedback(chosenPersona.id, {
            kind: "vote",
            channel: info.channel,
            actor: info.nick,
            payload: {
              direction: "up",
              via: "explicit_vote",
              prompt: chosen.prompt,
              competitors: rejected.map((item) => item.botNick),
            },
          });
        }
        send(ws, "system", `*** Vote enregistre pour ${chosen.botNick} - ${rejected.length} paire(s) DPO logguee(s)`);
        broadcastAll(info.channel, { type: "system", text: `*** ${info.nick} a vote pour ${chosen.botNick} [winner]` });
        break;
      }

      case "/msg": {
        if (args.length < 2) return send(ws, "system", "Usage: /msg <nick> <message>");
        const targetNick = args[0];
        const pmText = args.slice(1).join(" ");
        let targetWs = null;
        for (const [tws, tinfo] of clients) {
          if (tinfo.nick === targetNick && tws.readyState === 1) {
            targetWs = tws;
            break;
          }
        }
        const botPersona = getPersonaByNick(targetNick);

        if (targetWs) {
          targetWs.send(JSON.stringify({ type: "pm", from: info.nick, text: pmText }));
          send(ws, "pm_sent", `-> ${targetNick}: ${pmText}`, info.nick);
          logByNick(info.nick, "PM", info.nick, `-> ${targetNick}: ${pmText}`);
          logByNick(targetNick, "PM", info.nick, pmText);
        } else if (botPersona) {
          send(ws, "pm_sent", `-> ${targetNick}: ${pmText}`, info.nick);
          const model = botPersona.model;
          if (model) {
            const pmSession = getSession(`pm_${info.nick}_${targetNick}_${Date.now()}`);
            pmSession.model = model;
            pmSession.messages = [
              { role: "system", content: `Tu es ${targetNick} (${botPersona.desc}). ${botPersona.style}\nConversation privee avec ${info.nick}. Concis (2-3 phrases, ~500 chars max). TOUJOURS en francais.` },
              { role: "user", content: pmText },
            ];
            pmSession._abort = false;
            pmSession._abortController = new AbortController();

            try {
              const response = await ollamaChat(model, pmSession.messages, (token, done, stats) => {
                if (!done && token) {
                  ws.send(JSON.stringify({ type: "pm_token", from: targetNick, text: token }));
                }
                if (done) {
                  ws.send(JSON.stringify({ type: "pm_end", from: targetNick, stats: formatStats(stats) }));
                }
              }, pmSession._abortController.signal);
              logByNick(info.nick, "PM", targetNick, response);
              appendToMemory(info.nick, "PM", model, pmText, response);
            } catch (e) {
              send(ws, "system", `*** Erreur PM ${targetNick}: ${e.message}`);
            }
          }
        } else {
          send(ws, "system", `*** ${targetNick} n'est pas connecte`);
        }
        break;
      }

      case "/stop": {
        const session = getSession(info.sessionId);
        session._abort = true;
        if (session._abortController) {
          session._abortController.abort();
        }
        send(ws, "system", "*** Generation interrompue");
        break;
      }

      case "/kick": {
        if (!ops.has(info.nick)) return send(ws, "system", "*** 482 ERR_CHANOPRIVSNEEDED: Tu n'es pas operateur");
        if (!args[0]) return send(ws, "system", "Usage: /kick <nick> [raison]");
        const reason = args.slice(1).join(" ") || "Kicked by operator";
        let kicked = false;
        for (const [tws, tinfo] of clients) {
          if (tinfo.nick === args[0] && tinfo.channel === info.channel) {
            send(tws, "system", `*** Tu as ete kicke par ${info.nick}: ${reason}`);
            tinfo.channel = "#general";
            broadcastAll(info.channel, { type: "system", text: `*** ${args[0]} a ete kicke par @${info.nick} (${reason})` });
            kicked = true;
            break;
          }
        }
        if (!kicked) send(ws, "system", `*** ${args[0]} non trouve sur ${info.channel}`);
        break;
      }

      case "/op": {
        if (!admins.has(info.nick)) return send(ws, "system", "*** Permission refusee - admin uniquement");
        if (!args[0]) return send(ws, "system", "Usage: /op <nick>");
        ops.add(args[0]);
        broadcastAll(info.channel, { type: "system", text: `*** ${args[0]} est maintenant operateur (+o) par ${info.nick}` });
        break;
      }

      case "/deop": {
        if (!admins.has(info.nick)) return send(ws, "system", "*** Permission refusee - admin uniquement");
        if (!args[0]) return send(ws, "system", "Usage: /deop <nick>");
        ops.delete(args[0]);
        broadcastAll(info.channel, { type: "system", text: `*** ${args[0]} n'est plus operateur (-o) par ${info.nick}` });
        break;
      }

      case "/whois": {
        if (!args[0]) return send(ws, "system", "Usage: /whois <nick>");
        const target = args[0];
        let found = false;
        for (const [, tinfo] of clients) {
          if (tinfo.nick === target) {
            const isAdmin = admins.has(target) ? " [ADMIN]" : "";
            const isOp = ops.has(target) ? " [OP]" : "";
            send(ws, "system", `*** WHOIS ${target}: canal=${tinfo.channel}${isAdmin}${isOp}`);
            found = true;
            break;
          }
        }
        const botPersona = getPersonaByNick(target);
        if (botPersona) {
          send(ws, "system", `*** WHOIS ${target}: agent IA, modele=${botPersona.model}, ${botPersona.desc}`);
          found = true;
        }
        if (!found) send(ws, "system", `*** ${target} inconnu`);
        break;
      }

      case "/topic": {
        if (!args.length) {
          const currentTopic = readTopic(info.channel);
          const suffix = currentTopic.updatedBy
            ? ` (maj: ${currentTopic.updatedBy}${currentTopic.updatedAt ? ` @ ${currentTopic.updatedAt}` : ""})`
            : "";
          return send(ws, "system", `*** Topic de ${info.channel}: ${currentTopic.topic}${suffix}`);
        }

        if (typeof setChannelTopic !== "function") {
          return send(ws, "system", "*** Gestion des topics indisponible côté serveur");
        }

        if (!admins.has(info.nick) && !ops.has(info.nick)) {
          return send(ws, "system", "*** 482 ERR_CHANOPRIVSNEEDED: Topic reserve aux ops/admins");
        }

        const nextTopic = args.join(" ").trim().slice(0, 240);
        const topic = setChannelTopic(info.channel, nextTopic, info.nick);
        send(ws, "system", `*** Topic mis a jour pour ${info.channel}: ${topic.topic}`);
        broadcastAll(info.channel, {
          type: "system",
          text: `*** Topic de ${info.channel} mis à jour par ${info.nick}: ${topic.topic}`,
        });
        broadcastChannelInfo(info.channel);
        break;
      }

      case "/notice": {
        if (args.length < 2) return send(ws, "system", "Usage: /notice <nick> <message>");
        const target = args[0];
        const noticeText = args.slice(1).join(" ");
        for (const [tws, tinfo] of clients) {
          if (tinfo.nick === target && tws.readyState === 1) {
            tws.send(JSON.stringify({ type: "system", text: `*** NOTICE de ${info.nick}: ${noticeText}` }));
          }
        }
        send(ws, "system", `*** NOTICE envoye a ${target}`);
        break;
      }

      case "/quit": {
        send(ws, "system", "*** Au revoir!");
        ws.close();
        break;
      }

      case "/help": {
        const helpLines = [
          "*** ========== KXKM_Clown v0.3.0 ==========",
          "*** /nick <pseudo>      - Changer de pseudo (unique)",
          "*** /join #canal        - Rejoindre un canal",
          "*** /model [nom|num]    - Voir/changer le modele (#admin)",
          "*** /persona [nom|num] - Choisir la persona du modele courant",
          "*** /msg <nick> <texte> - Message prive (humain ou IA)",
          "*** /notice <nick> <txt>- Notice (pas d'auto-reponse)",
          "*** /system <prompt>    - Definir le prompt systeme",
          "*** /clear              - Effacer l'historique",
          "*** /who                - Liste des utilisateurs",
          "*** /web <requête>      - Recherche web avec Mistral (#admin)",
          "*** /fetch <url>        - Lire une page web avec Mistral (#admin)",
          "*** /memory             - Voir ta memoire",
          "*** /sessions           - Lister les snapshots locaux",
          "*** /sessions restore <id> - Restaurer un snapshot local sur la session courante",
          "*** /vote [nom|num]     - Voter la meilleure reponse (DPO)",
          "*** /stop               - Arreter la generation",
          "*** /topic [texte]      - Voir ou changer le topic du canal",
          "*** /quit               - Quitter",
          "*** /help               - Cette aide",
          "*** ========================================",
          "*** @nick dans un message pour mentionner quelqu'un",
          `*** Canaux: #general (${generalResponderLabel()}), #admin (choix libre)`,
          "*** + 1 canal dedie par modele",
          "*** Donnees locales persistees dans data/",
          "***",
          `*** === AGENTS (${getActivePersonaCount()} actifs) ===`,
          ...Object.entries(getAllPersonas()).map(([name, persona]) => `***   ● ${name} - ${persona.desc}`),
        ];
        if (adminBootstrapToken) {
          helpLines.splice(17, 0, "*** /saisail <token>    - Bootstrap admin (token + reseau autorise)");
        }
        send(ws, "system", helpLines.join("\n"));
        break;
      }

      case "/saisail": {
        if (!adminBootstrapToken) {
          return send(ws, "system", "*** Bootstrap admin desactive cote serveur");
        }
        if (!args[0]) {
          return send(ws, "system", "*** Usage: /saisail <token>");
        }
        if (typeof isAdminNetworkAllowed === "function" && !isAdminNetworkAllowed(info.clientIp)) {
          return send(ws, "system", "*** Bootstrap admin refuse depuis ce reseau");
        }
        if (args[0] !== adminBootstrapToken) {
          return send(ws, "system", "*** Token admin invalide");
        }
        claimOwnerNick(ws, info);
        break;
      }

      default:
        send(ws, "system", `*** Commande inconnue: ${cmd} - tape /help`);
    }
  };

  function isReservedNick(nick) {
    const lower = nick.toLowerCase();
    if (admins.has(nick) || admins.has(lower)) return true;
    return lower === "saisail";
  }

  function isNickTaken(nick, excludeWs = null) {
    const lower = nick.toLowerCase();
    for (const [ws, info] of clients) {
      if (info.nick.toLowerCase() === lower && ws !== excludeWs) return true;
    }
    for (const name of Object.keys(getAllPersonas())) {
      if (name.toLowerCase() === lower) return true;
    }
    return false;
  }
}

module.exports = {
  createCommandHandler,
};
