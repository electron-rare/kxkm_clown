function createChatRouter({
  admins,
  contextMaxMessages,
  contextKeepRecent,
  maxGeneralResponders,
  maxMessageLength,
  getGeneralPersonasActive,
  getNextRegister,
  getNextManifestChunk,
  getPersonaByModel,
  getPersonaById,
  getPersonaByNick,
  getPersonasByModel,
  isPersonaEnabled,
  getSession,
  saveSession,
  getMemoryContext,
  appendToMemory,
  appendPersonaFeedback,
  updateUserStats,
  logByNick,
  logDPOPair,
  logTrainingTurn,
  ollamaChat,
  broadcastAll,
  send,
}) {
  const MAX_CHANNEL_HISTORY = 200;
  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const RATE_LIMIT_MAX = 20;

  const lastRoundResponses = new Map();
  const channelHistory = new Map();
  const userRateLimits = new Map();
  const channelQueues = new Map();
  let lastGeneralResponders = [];

  function getPersonaPriority(persona) {
    return Number.isFinite(persona?.priority) ? persona.priority : 0;
  }

  function sortPersonasByPriority(personas) {
    return [...personas].sort((left, right) => getPersonaPriority(right) - getPersonaPriority(left));
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function detectImplicitPreference(text, channel) {
    const round = lastRoundResponses.get(channel);
    if (!round || round.length < 2) return null;

    const positivePatterns = /bien vu|exactement|merci|bravo|oui|correct|t'as raison|bien dit|parfait|yes|nice|good/i;
    const negativePatterns = /non|faux|n'importe quoi|nawak|wrong|pas du tout|incorrect/i;

    for (const response of round) {
      const nameMentioned = text.toLowerCase().includes(response.botNick.toLowerCase());
      if (nameMentioned && positivePatterns.test(text)) {
        return { chosen: response, type: "implicit_positive" };
      }
      if (nameMentioned && negativePatterns.test(text)) {
        return { rejected: response, type: "implicit_negative" };
      }
    }
    return null;
  }

  async function compactContext(session, model) {
    if (session.messages.length <= contextMaxMessages) return;

    const systemMessage = session.messages.find((message) => message.role === "system");
    const toSummarize = session.messages
      .filter((message) => message.role !== "system")
      .slice(0, -contextKeepRecent);

    if (toSummarize.length < 5) return;

    console.log(`[compact] Summarizing ${toSummarize.length} messages for session`);

    const summaryMessages = [
      {
        role: "system",
        content: "Résume cette conversation en 5-10 lignes concises. Garde les points clés, décisions, et contexte important. Réponds uniquement avec le résumé, rien d'autre.",
      },
      {
        role: "user",
        content: toSummarize.map((message) => `${message.role}: ${message.content}`).join("\n"),
      },
    ];

    try {
      const summary = await ollamaChat(model, summaryMessages, () => {});
      const recent = session.messages
        .filter((message) => message.role !== "system")
        .slice(-contextKeepRecent);

      session.messages = [];
      if (systemMessage) session.messages.push(systemMessage);
      session.messages.push({
        role: "assistant",
        content: `[résumé de la conversation précédente]\n${summary}`,
      });
      session.messages.push(...recent);

      console.log(`[compact] Done: ${session.messages.length} messages remaining`);
    } catch (error) {
      console.error("[compact] Failed:", error.message);
    }
  }

  function pushChannelHistory(channel, entry) {
    if (!channelHistory.has(channel)) channelHistory.set(channel, []);
    const history = channelHistory.get(channel);
    history.push({ ...entry, ts: Date.now() });
    while (history.length > MAX_CHANNEL_HISTORY) history.shift();
  }

  function rememberAttachmentUpload(channel, attachment) {
    pushChannelHistory(channel, {
      type: "attachment_uploaded",
      attachment,
    });
  }

  function rememberAttachmentAnalysis(channel, attachment, orchestrated = {}) {
    pushChannelHistory(channel, {
      type: "attachment_analysis",
      attachment,
      summary: orchestrated.summary || "",
      generator: orchestrated.generator || "heuristic",
      warnings: Array.isArray(orchestrated.warnings) ? orchestrated.warnings : [],
    });
  }

  function rememberAttachmentFailure(channel, attachment, error) {
    pushChannelHistory(channel, {
      type: "attachment_failed",
      attachment,
      error: String(error || "").trim().slice(0, 300),
    });
  }

  function replayHistory(ws, channel) {
    const history = channelHistory.get(channel);
    if (!history || !history.length) return;

    ws.send(JSON.stringify({ type: "system", text: `*** ═══ Historique ${channel} (${history.length} messages) ═══` }));
    for (const entry of history) {
      const time = new Date(entry.ts).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      });

      if (entry.type === "message") {
        ws.send(JSON.stringify({ type: "history_msg", nick: entry.nick, text: entry.text, time }));
      } else if (entry.type === "system") {
        ws.send(JSON.stringify({ type: "system", text: entry.text }));
      } else if (entry.type === "bot_response") {
        ws.send(JSON.stringify({ type: "history_msg", nick: entry.nick, text: entry.text, time, bot: true }));
      } else if (entry.type === "attachment_uploaded") {
        ws.send(JSON.stringify({
          type: "attachment_uploaded",
          attachment: entry.attachment,
          replayed: true,
          time,
        }));
      } else if (entry.type === "attachment_analysis") {
        ws.send(JSON.stringify({
          type: "attachment_analysis",
          attachment: entry.attachment,
          summary: entry.summary,
          generator: entry.generator,
          warnings: entry.warnings || [],
          replayed: true,
          time,
        }));
      } else if (entry.type === "attachment_failed") {
        ws.send(JSON.stringify({
          type: "attachment_failed",
          attachment: entry.attachment,
          error: entry.error || "Échec d'analyse",
          replayed: true,
          time,
        }));
      }
    }
    ws.send(JSON.stringify({ type: "system", text: "*** ═══ Fin historique ═══" }));
  }

  function buildAttachmentClientPayload(attachment, analysis) {
    return {
      id: attachment.id,
      nick: attachment.nick,
      channel: attachment.channel,
      kind: attachment.kind || analysis?.kind || "unknown",
      mime: attachment.mime,
      originalName: attachment.originalName,
      sizeBytes: attachment.sizeBytes,
      status: attachment.status,
      createdAt: attachment.createdAt,
      updatedAt: attachment.updatedAt,
      analysis: analysis ? {
        kind: analysis.kind,
        title: analysis.title,
        sourceSummary: analysis.sourceSummary,
        caption: analysis.caption || "",
        transcript: analysis.transcript || "",
        extractedText: analysis.extractedText || "",
        tags: Array.isArray(analysis.tags) ? analysis.tags : [],
        warnings: Array.isArray(analysis.warnings) ? analysis.warnings : [],
        adapter: analysis.adapter || "none",
      } : null,
      error: attachment.error || null,
      downloadUrl: `/api/chat/attachments/${encodeURIComponent(attachment.id)}/blob`,
    };
  }

  function buildAttachmentTurnText(attachment, analysis, orchestrated) {
    const parts = [
      `[pièce jointe ${attachment.kind || analysis?.kind || "unknown"}] ${attachment.originalName || attachment.id}`,
      `Canal: ${attachment.channel}`,
      `Auteur: ${attachment.nick}`,
    ];

    if (analysis?.sourceSummary) {
      parts.push(`Résumé: ${analysis.sourceSummary}`);
    }
    if (analysis?.caption) {
      parts.push(`Légende: ${analysis.caption}`);
    }
    if (analysis?.transcript) {
      parts.push(`Transcription:\n${analysis.transcript}`);
    }
    if (analysis?.extractedText) {
      parts.push(`Texte extrait:\n${analysis.extractedText}`);
    }
    if (Array.isArray(orchestrated?.warnings) && orchestrated.warnings.length) {
      parts.push(`Avertissements: ${orchestrated.warnings.join(" | ")}`);
    }
    if (orchestrated?.prompt) {
      parts.push(orchestrated.prompt);
    }

    return parts.join("\n\n").slice(0, maxMessageLength);
  }

  async function runSessionTurn(info, session, userText) {
    const isGeneral = info.channel === "#general";

    if (!isGeneral && !session.model) {
      broadcastAll(info.channel, {
        type: "system",
        text: "*** Aucun modèle sélectionné — tape /model pour en choisir un",
      });
      return;
    }

    session.messages.push({ role: "user", content: userText });
    session._abort = false;
    session._abortController = new AbortController();

    const compactModel = isGeneral
      ? getGeneralPersonasActive()[0]?.model || null
      : session.model;
    if (compactModel) {
      await compactContext(session, compactModel);
    }

    const memoryContext = getMemoryContext(info.nick);
    if (isGeneral) {
      await handleGeneralChannel(info, session, userText, memoryContext);
    } else {
      await handleSingleModel(info, session, userText, memoryContext);
    }
  }

  function checkRateLimit(nick) {
    if (admins.has(nick)) return true;

    const now = Date.now();
    let bucket = userRateLimits.get(nick);
    if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
      bucket = { count: 0, windowStart: now };
      userRateLimits.set(nick, bucket);
    }

    // Prune stale rate-limit entries to prevent unbounded growth
    if (userRateLimits.size > 200) {
      for (const [key, entry] of userRateLimits) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
          userRateLimits.delete(key);
        }
      }
    }

    // Hard cap: if still above 500 after stale pruning, evict oldest entries
    if (userRateLimits.size > 500) {
      const sorted = [...userRateLimits.entries()]
        .sort((a, b) => a[1].windowStart - b[1].windowStart);
      const toRemove = sorted.slice(0, userRateLimits.size - 500);
      for (const [key] of toRemove) {
        userRateLimits.delete(key);
      }
    }

    bucket.count++;
    return bucket.count <= RATE_LIMIT_MAX;
  }

  function enqueueChannel(channel, fn) {
    const previous = channelQueues.get(channel) || Promise.resolve();
    const next = previous.then(fn).catch((error) => {
      console.error(`[queue ${channel}]`, error.message);
    });
    channelQueues.set(channel, next);
    return next;
  }

  function formatStats(stats) {
    if (!stats?.eval_count) return "";
    const seconds = (stats.eval_duration / 1e9).toFixed(1);
    const tokensPerSecond = (stats.eval_count / (stats.eval_duration / 1e9)).toFixed(0);
    return ` [${stats.eval_count}tok, ${seconds}s, ${tokensPerSecond}t/s]`;
  }

  function pickGeneralResponders(count) {
    const activePersonas = getGeneralPersonasActive();
    if (activePersonas.length <= count) {
      return sortPersonasByPriority(activePersonas);
    }

    const modelGroups = new Map();
    for (const persona of activePersonas) {
      if (!modelGroups.has(persona.model)) modelGroups.set(persona.model, []);
      modelGroups.get(persona.model).push(persona);
    }

    const selected = [];

    const priorityPersonas = sortPersonasByPriority(
      activePersonas.filter((persona) => getPersonaPriority(persona) > 0)
    );
    for (const persona of priorityPersonas) {
      if (selected.length < count) selected.push(persona);
    }

    for (const [, personas] of modelGroups) {
      if (selected.some((selectedPersona) => personas.includes(selectedPersona))) continue;
      const pool = personas.filter((persona) => !lastGeneralResponders.includes(persona.name));
      const pick = pool.length > 0
        ? pool[Math.floor(Math.random() * pool.length)]
        : personas[Math.floor(Math.random() * personas.length)];
      if (selected.length < count) selected.push(pick);
    }

    const remaining = activePersonas.filter(
      (persona) => !selected.includes(persona) && !lastGeneralResponders.includes(persona.name)
    );
    while (selected.length < count && remaining.length > 0) {
      const index = Math.floor(Math.random() * remaining.length);
      selected.push(remaining.splice(index, 1)[0]);
    }

    if (selected.length < count) {
      const rest = activePersonas.filter((persona) => !selected.includes(persona));
      while (selected.length < count && rest.length > 0) {
        const index = Math.floor(Math.random() * rest.length);
        selected.push(rest.splice(index, 1)[0]);
      }
    }

    lastGeneralResponders = selected.map((persona) => persona.name);
    return selected;
  }

  function buildManifestContext(persona) {
    const register = typeof getNextRegister === "function" ? getNextRegister(persona.name) : null;
    const manifestChunk = typeof getNextManifestChunk === "function" ? getNextManifestChunk(persona.name) : "";
    const lines = [];

    if (register?.name || register?.inject) {
      lines.push("=== REGISTRE MANIFESTE ===");
      if (register.name) lines.push(register.name);
      if (register.inject) lines.push(register.inject);
      lines.push("=== FIN REGISTRE ===");
    }

    if (manifestChunk) lines.push(manifestChunk);
    return lines.join("\n");
  }

  async function handleGeneralChannel(info, session, userText, memoryContext) {
    const round = lastRoundResponses.get(info.channel);
    const preference = detectImplicitPreference(userText, info.channel);
    if (round && preference) {
      if (preference.chosen) {
        const chosenPersona = getPersonaByNick(preference.chosen.botNick);
        const rejected = round.filter((response) => response !== preference.chosen);
        for (const item of rejected) {
          const rejectedPersona = getPersonaByNick(item.botNick);
          logDPOPair(
            info.nick,
            preference.chosen.prompt,
            preference.chosen.response,
            item.response,
            preference.chosen.model,
            item.model
          );
          if (rejectedPersona) {
            appendPersonaFeedback(rejectedPersona.id, {
              kind: preference.type,
              channel: info.channel,
              actor: info.nick,
              payload: {
                direction: "down",
                via: preference.type,
                prompt: preference.chosen.prompt,
                counterparty: preference.chosen.botNick,
              },
            });
          }
        }
        if (chosenPersona) {
          appendPersonaFeedback(chosenPersona.id, {
            kind: preference.type,
            channel: info.channel,
            actor: info.nick,
            payload: {
              direction: "up",
              via: preference.type,
              prompt: preference.chosen.prompt,
              competitors: rejected.map((item) => item.botNick),
            },
          });
        }
        broadcastAll(info.channel, { type: "system", text: `*** 🎯 Préférence implicite détectée → ${preference.chosen.botNick}` });
      }

      if (preference.rejected) {
        const rejectedPersona = getPersonaByNick(preference.rejected.botNick);
        const chosen = round.filter((response) => response !== preference.rejected);
        for (const item of chosen) {
          const chosenPersona = getPersonaByNick(item.botNick);
          logDPOPair(
            info.nick,
            item.prompt,
            item.response,
            preference.rejected.response,
            item.model,
            preference.rejected.model
          );
          if (chosenPersona) {
            appendPersonaFeedback(chosenPersona.id, {
              kind: preference.type,
              channel: info.channel,
              actor: info.nick,
              payload: {
                direction: "up",
                via: preference.type,
                prompt: item.prompt,
                counterparty: preference.rejected.botNick,
              },
            });
          }
        }
        if (rejectedPersona) {
          appendPersonaFeedback(rejectedPersona.id, {
            kind: preference.type,
            channel: info.channel,
            actor: info.nick,
            payload: {
              direction: "down",
              via: preference.type,
              prompt: chosen[0]?.prompt || "",
              competitors: chosen.map((item) => item.botNick),
            },
          });
        }
        broadcastAll(info.channel, { type: "system", text: `*** 🎯 Préférence implicite détectée → rejet de ${preference.rejected.botNick}` });
      }
    }

    const activePersonas = getGeneralPersonasActive();
    const mentioned = activePersonas.filter((persona) =>
      new RegExp(`@${escapeRegExp(persona.name)}\\b`, "i").test(userText)
    );

    const responders = mentioned.length > 0
      ? mentioned
      : (maxGeneralResponders === 0
          ? sortPersonasByPriority(activePersonas)
          : pickGeneralResponders(maxGeneralResponders));

    const responderNames = responders.map((persona) => persona.name).join(", ");
    broadcastAll(info.channel, { type: "system", text: `*** 🎲 ${responderNames} prennent la parole` });

    const roundResponses = [];

    for (const persona of responders) {
      if (session._abort) break;

      const botNick = persona.name;
      const systemPrompt = [
        `Tu es ${botNick} (${persona.desc}).`,
        persona.style,
        "Tu participes au salon IRC #general de KXKM_Clown.",
        "Règles: concis (2-3 phrases MAX, ~500 caractères), personnalité assumée, TOUJOURS en français.",
        "IMPORTANT: tu ne cites JAMAIS d'autre IA. Tu ne continues JAMAIS la phrase d'un autre. Tu réponds UNIQUEMENT au message de l'utilisateur. Pas de \"[Nom]\" ni de dialogue entre IA.",
        buildManifestContext(persona),
        memoryContext,
      ].join("\n");

      const userOnlyMessages = session.messages.filter(
        (message) => message.role === "user" || message.role === "system"
      );
      const modelMessages = [
        { role: "system", content: systemPrompt },
        ...userOnlyMessages,
      ];

      broadcastAll(info.channel, { type: "persona", nick: botNick, color: persona.color });

      const response = await streamModel(persona.model, botNick, modelMessages, info.channel, session);
      if (!response) continue;

      session.messages.push({ role: "assistant", content: `[${botNick}] ${response}` });
      logByNick(info.nick, info.channel, botNick, response);
      logTrainingTurn(info.channel, info.nick, persona.model, session.messages);
      appendToMemory(info.nick, info.channel, persona.model, userText, response);
      appendPersonaFeedback(persona.id, {
        kind: "chat_signal",
        channel: info.channel,
        actor: info.nick,
        reason: "general_turn",
        payload: {
          prompt: userText.slice(0, 240),
          response: response.slice(0, 240),
          modelSuggestion: persona.model,
          direction: "observed",
        },
      });
      roundResponses.push({ model: persona.model, botNick, response, prompt: userText });
      pushChannelHistory(info.channel, { type: "bot_response", nick: botNick, text: response });
    }

    if (roundResponses.length > 0) {
      lastRoundResponses.set(info.channel, roundResponses);
    }

    saveSession(info.sessionId, getSession(info.sessionId));
  }

  async function handleSingleModel(info, session, userText, memoryContext) {
    const selectedPersona = session.persona ? getPersonaById(session.persona) : null;
    const runtimePersonas = typeof getPersonasByModel === "function"
      ? getPersonasByModel(session.model)
      : [];
    const persona = selectedPersona &&
      selectedPersona.model === session.model &&
      (typeof isPersonaEnabled !== "function" || isPersonaEnabled(selectedPersona.id))
      ? selectedPersona
      : (runtimePersonas[0] || getPersonaByModel(session.model));

    if (!persona) {
      broadcastAll(info.channel, {
        type: "system",
        text: `*** Aucune persona active n'est disponible pour ${session.model}`,
      });
      return;
    }

    if (persona?.id && session.persona !== persona.id) {
      session.persona = persona.id;
    }

    const botNick = persona.name;
    const systemContent = [
      `Tu es ${botNick} (${persona.desc}).`,
      persona.style,
      `Canal: ${info.channel} de KXKM_Clown. Concis (2-3 phrases MAX, ~500 chars), TOUJOURS en français.`,
      buildManifestContext(persona),
      memoryContext,
    ].join("\n");

    const systemIndex = session.messages.findIndex((message) => message.role === "system");
    if (systemIndex >= 0) {
      session.messages[systemIndex].content = systemContent;
    } else {
      session.messages.unshift({ role: "system", content: systemContent });
    }

    broadcastAll(info.channel, { type: "persona", nick: botNick, color: persona.color });
    const response = await streamModel(session.model, botNick, session.messages, info.channel, session);
    if (!response) return;

    session.messages.push({ role: "assistant", content: response });
    logByNick(info.nick, info.channel, botNick, response);
    logTrainingTurn(info.channel, info.nick, session.model, session.messages);
    appendToMemory(info.nick, info.channel, session.model, userText, response);
    appendPersonaFeedback(persona.id, {
      kind: "chat_signal",
      channel: info.channel,
      actor: info.nick,
      reason: "single_model_turn",
      payload: {
        prompt: userText.slice(0, 240),
        response: response.slice(0, 240),
        modelSuggestion: session.model,
        direction: "observed",
      },
    });
    saveSession(info.sessionId, getSession(info.sessionId));
    pushChannelHistory(info.channel, { type: "bot_response", nick: botNick, text: response });
  }

  async function streamModel(model, botNick, messages, channel, session) {
    broadcastAll(channel, { type: "stream_start", nick: botNick });

    try {
      const fullResponse = await ollamaChat(
        model,
        messages,
        (token, done, stats) => {
          if (session._abort) return;
          if (!done && token) {
            broadcastAll(channel, { type: "stream_token", nick: botNick, text: token });
          }
          if (done) {
            broadcastAll(channel, { type: "stream_end", nick: botNick, stats: formatStats(stats) });
          }
        },
        session._abortController?.signal
      );

      return session._abort ? null : fullResponse;
    } catch (error) {
      if (error.name !== "AbortError") {
        broadcastAll(channel, { type: "system", text: `*** Erreur ${botNick}: ${error.message}` });
      }
      broadcastAll(channel, { type: "stream_end", nick: botNick, stats: " [erreur]" });
      return null;
    }
  }

  async function handleMessage(ws, info, text) {
    const session = getSession(info.sessionId);
    const isGeneral = info.channel === "#general";

    if (!isGeneral && !session.model) {
      send(ws, "system", "*** Aucun modèle sélectionné — tape /model pour en choisir un");
      return;
    }

    text = text.slice(0, maxMessageLength);

    if (!checkRateLimit(info.nick)) {
      send(ws, "system", "*** Rate limit dépassé (20 msg/min). Attends un peu.");
      return;
    }

    logByNick(info.nick, info.channel, info.nick, text);
    broadcastAll(info.channel, { type: "message", nick: info.nick, text });
    pushChannelHistory(info.channel, { type: "message", nick: info.nick, text });
    updateUserStats(info.nick, info.channel);
    await runSessionTurn(info, session, text);
  }

  async function handleAttachmentAnalysis(info, attachment, analysis, orchestrated = {}) {
    const session = getSession(info.sessionId);
    const markerText = `[attachment:${attachment.kind || analysis?.kind || "unknown"}] ${attachment.originalName || attachment.id} — ${analysis?.sourceSummary || "pièce jointe locale"}`;

    logByNick(info.nick, info.channel, info.nick, markerText);
    updateUserStats(info.nick, info.channel);

    await runSessionTurn(info, session, buildAttachmentTurnText(attachment, analysis, orchestrated));
  }

  return {
    enqueueChannel,
    handleMessage,
    handleAttachmentAnalysis,
    replayHistory,
    formatStats,
    lastRoundResponses,
    rememberAttachmentUpload,
    rememberAttachmentAnalysis,
    rememberAttachmentFailure,
  };
}

module.exports = {
  createChatRouter,
};
