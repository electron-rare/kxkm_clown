const path = require("path");
const { MAX_UPLOAD_BYTES } = require("./attachment-pipeline");

function registerApiRoutes(app, {
  adminBootstrapToken,
  host,
  dataDir,
  networkPolicy,
  runtime,
  sessions,
  clients,
  channelUsers,
  listPersonas,
  listEditablePersonas,
  ollamaModels,
  ollamaLoadedModels,
  ollamaUrl,
  maxResponseTokens,
  maxGeneralResponders,
  readJsonlArray,
  listSavedSessions,
  setChannelTopic,
  searchHistory,
  getLogsSummary,
  buildHistoryHtml,
  getPersonaById,
  updatePersona,
  createPersonaFromSource,
  getPersonaSource,
  updatePersonaSource,
  listPersonaFeedback,
  recordPersonaFeedback,
  listPersonaProposals,
  recordAppliedChange,
  reinforcePersona,
  revertPersona,
  setPersonaEnabled,
  isPersonaEnabled,
  attachmentService,
  nodeEngineStore,
  nodeEngineRegistry,
}) {
  const accessMode = host === "127.0.0.1" || host === "::1" ? "loopback" : "lan_controlled";
  const requireAdminNetwork = createAdminNetworkGate(networkPolicy);
  const requireAdmin = requireLocalAdmin(adminBootstrapToken, requireAdminNetwork);

  function normalizeChannel(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.startsWith("#") ? text : `#${text}`;
  }

  function channelNameForModel(model) {
    return `#${String(model || "").split(":")[0].replace(/[^a-z0-9_-]/gi, "")}`;
  }

  function decodeHeaderValue(value, fallback = "") {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  function readRequestBuffer(req, maxBytes = MAX_UPLOAD_BYTES) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      let settled = false;

      req.on("data", (chunk) => {
        if (settled) return;
        total += chunk.length;
        if (total > maxBytes) {
          settled = true;
          const error = new Error(`Fichier trop volumineux (> ${Math.round(maxBytes / 1024 / 1024)} Mo)`);
          error.statusCode = 413;
          reject(error);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });

      req.on("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });

      req.on("aborted", () => {
        if (settled) return;
        settled = true;
        const error = new Error("Upload interrompu");
        error.statusCode = 499;
        reject(error);
      });
    });
  }

  function getChannelSnapshot(channelName) {
    const normalized = normalizeChannel(channelName);
    const snapshot = runtime.listChannels().find((channel) => channel.name === normalized);
    return snapshot || {
      name: normalized,
      model: null,
      type: "dynamic",
      topic: "KXKM_Clown - Local LLM Chat",
      topicUpdatedAt: null,
      topicUpdatedBy: null,
    };
  }

  function collectAdminChannels() {
    const channels = typeof runtime.listAdminChannels === "function"
      ? runtime.listAdminChannels()
      : runtime.listChannels();

    return channels.map((channel) => {
      const liveClients = [];
      for (const [, info] of clients) {
        if (info.channel !== channel.name) continue;
        const session = sessions.get(info.sessionId) || null;
        const selectedPersona = session?.persona
          ? runtime.getRuntimePersonaById?.(session.persona) || getPersonaById(session.persona)
          : null;

        liveClients.push({
          nick: info.nick,
          sessionId: info.sessionId,
          lastActivity: info.lastActivity || null,
          model: session?.model || channel.model || null,
          persona: selectedPersona?.name || null,
          personaId: selectedPersona?.id || session?.persona || null,
        });
      }

      return {
        ...channel,
        users: typeof channelUsers === "function" ? channelUsers(channel.name) : [],
        userCount: liveClients.length,
        liveClients,
      };
    });
  }

  function pushChannelInfo(channelName) {
    for (const [ws, info] of clients) {
      if (info.channel !== channelName || ws.readyState !== 1) continue;
      const session = sessions.get(info.sessionId) || { model: null, persona: null };
      const selectedPersona = session.persona
        ? runtime.getRuntimePersonaById?.(session.persona) || getPersonaById(session.persona)
        : null;
      ws.send(JSON.stringify(runtime.buildChannelInfo(
        info.channel,
        session.model,
        selectedPersona?.name || null,
        selectedPersona?.id || session.persona || null
      )));
    }
  }

  async function applyPersonaRuntimeState(personaId, enabled, actor = "admin_api") {
    const persona = getPersonaById(personaId);
    if (!persona) {
      const error = new Error(`Persona inconnue: ${personaId}`);
      error.statusCode = 404;
      throw error;
    }

    if (!enabled) {
      const remainingForModel = runtime.getRuntimePersonasByModel(persona.model)
        .filter((entry) => entry.id !== persona.id);
      if (!remainingForModel.length) {
        const error = new Error(`Impossible de désactiver la dernière persona active pour ${persona.model}`);
        error.statusCode = 409;
        throw error;
      }
    }

    if (typeof setPersonaEnabled === "function") {
      setPersonaEnabled(persona.id, enabled, actor);
    }
    await runtime.refreshChannelMap();

    if (!enabled) {
      for (const [, session] of sessions) {
        if (session.persona !== persona.id) continue;
        const fallback = session.model ? runtime.getDefaultRuntimePersonaForModel?.(session.model) : null;
        session.persona = fallback?.id || null;
      }
    }

    pushChannelInfo("#general");
    pushChannelInfo("#admin");
    if (persona.model) pushChannelInfo(channelNameForModel(persona.model));

    return {
      id: persona.id,
      name: persona.name,
      model: persona.model,
      runtimeEnabled: typeof isPersonaEnabled === "function" ? isPersonaEnabled(persona.id) : enabled,
      activePersonas: runtime.getGeneralPersonasActive().map((item) => item.id),
    };
  }

  app.get("/api/personas", (req, res) => {
    res.json(
      listPersonas().map((persona) => ({
        id: persona.id,
        name: persona.name,
        model: persona.model,
        color: persona.color,
        desc: persona.desc,
        priority: persona.priority,
        generalEnabled: persona.generalEnabled,
        runtimeEnabled: typeof isPersonaEnabled === "function" ? isPersonaEnabled(persona.id) : true,
        defaultForModel: Boolean(persona.routing?.defaultForModel),
      }))
    );
  });

  app.post("/api/chat/attachments", async (req, res) => {
    try {
      if (!attachmentService) {
        return res.status(503).json({ error: "attachments not configured" });
      }

      const sessionId = String(req.get("x-chat-session-id") || "").trim();
      const uploadToken = String(req.get("x-chat-upload-token") || "").trim();
      const fileName = decodeHeaderValue(req.get("x-file-name"), "attachment.bin");
      const mime = String(req.get("x-file-mime") || req.get("content-type") || "application/octet-stream")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const buffer = await readRequestBuffer(req, MAX_UPLOAD_BYTES);

      const attachment = await attachmentService.ingestAttachment({
        sessionId,
        uploadToken,
        fileName,
        mime,
        buffer,
      });

      res.status(201).json({ ok: true, attachment });
    } catch (error) {
      const statusCode = error.statusCode === 499 ? 400 : (error.statusCode || 500);
      res.status(statusCode).json({ error: error.message });
    }
  });

  app.get("/api/chat/attachments/:id", (req, res) => {
    if (!attachmentService) {
      return res.status(503).json({ error: "attachments not configured" });
    }

    const attachment = attachmentService.getClientAttachment(req.params.id);
    if (!attachment) {
      return res.status(404).json({ error: "attachment not found" });
    }

    res.json(attachment);
  });

  app.get("/api/chat/attachments/:id/blob", (req, res) => {
    if (!attachmentService) {
      return res.status(503).json({ error: "attachments not configured" });
    }

    const attachment = attachmentService.getAttachment(req.params.id);
    if (!attachment) {
      return res.status(404).json({ error: "attachment not found" });
    }

    const buffer = attachmentService.readAttachmentBuffer(req.params.id);
    if (!buffer) {
      return res.status(404).json({ error: "attachment file not found" });
    }

    const safeName = String(attachment.originalName || `${attachment.id}.bin`).replace(/"/g, "'");
    res.setHeader("content-type", attachment.mime || "application/octet-stream");
    res.setHeader("content-length", String(buffer.length));
    res.setHeader("content-disposition", `inline; filename="${safeName}"`);
    res.send(buffer);
  });

  app.get("/api/admin/personas", requireAdmin, (req, res) => {
    res.json(listEditablePersonas().map((persona) => ({
      ...persona,
      runtimeEnabled: typeof isPersonaEnabled === "function" ? isPersonaEnabled(persona.id) : true,
      disabled: typeof isPersonaEnabled === "function" ? !isPersonaEnabled(persona.id) : false,
    })));
  });

  app.put("/api/admin/personas/:id", requireAdmin, async (req, res) => {
    try {
      const beforePersona = getPersonaById(req.params.id);
      const persona = updatePersona(req.params.id, {
        name: req.body?.name,
        model: req.body?.model,
        style: req.body?.style,
      });
      recordAppliedChange(req.params.id, {
        before: {
          name: beforePersona.name,
          model: beforePersona.model,
          style: beforePersona.style,
        },
        after: {
          name: persona.name,
          model: persona.model,
          style: persona.style,
        },
        proposer: "admin",
        mode: "manual_edit",
        reason: req.body?.reason || "admin_update",
      });
      await runtime.refreshChannelMap();
      res.json({
        ok: true,
        persona: {
          id: persona.id,
          name: persona.name,
          model: persona.model,
          desc: persona.desc,
          style: persona.style,
          color: persona.color,
          runtimeEnabled: typeof isPersonaEnabled === "function" ? isPersonaEnabled(persona.id) : true,
        },
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/admin/personas/from-source", requireAdmin, async (req, res) => {
    try {
      const result = createPersonaFromSource(req.body || {});
      const source = updatePersonaSource(result.persona.id, {
        subjectName: req.body?.subjectName || req.body?.name || result.persona.name,
        query: req.body?.query,
        preferredName: req.body?.name || result.persona.name,
        preferredModel: req.body?.targetModel || req.body?.model || result.persona.model,
        tone: req.body?.tone,
        facts: req.body?.facts,
        themes: req.body?.themes,
        lexicon: req.body?.lexicon,
        quotes: req.body?.quotes,
        notes: req.body?.notes || req.body?.summary,
        sources: req.body?.sources,
      });
      await runtime.refreshChannelMap();
      res.status(201).json({
        ok: true,
        persona: {
          id: result.persona.id,
          name: result.persona.name,
          model: result.persona.model,
          desc: result.persona.desc,
          style: result.persona.style,
          color: result.persona.color,
          runtimeEnabled: typeof isPersonaEnabled === "function" ? isPersonaEnabled(result.persona.id) : true,
        },
        source,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/personas/:id/source", requireAdmin, (req, res) => {
    try {
      res.json(getPersonaSource(req.params.id));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.put("/api/admin/personas/:id/source", requireAdmin, (req, res) => {
    try {
      const source = updatePersonaSource(req.params.id, req.body || {});
      res.json({ ok: true, source });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/personas/:id/feedback", requireAdmin, (req, res) => {
    try {
      res.json(listPersonaFeedback(req.params.id));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/admin/personas/:id/feedback", requireAdmin, (req, res) => {
    try {
      const feedback = recordPersonaFeedback(req.params.id, {
        kind: req.body?.kind || "drift_report",
        actor: req.body?.actor || "admin",
        channel: req.body?.channel || "#admin",
        reason: req.body?.reason || req.body?.note || "note_admin_locale",
        sourceRef: req.body?.sourceRef,
        payload: req.body?.payload || (req.body?.note ? { note: req.body.note } : {}),
      });
      res.status(201).json({ ok: true, feedback });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/personas/:id/proposals", requireAdmin, (req, res) => {
    try {
      res.json(listPersonaProposals(req.params.id));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/admin/personas/:id/reinforce", requireAdmin, async (req, res) => {
    try {
      const result = await reinforcePersona(req.params.id, {
        actor: "pharmacius",
        autoApply: req.body?.autoApply !== false,
      });
      await runtime.refreshChannelMap();
      res.json({
        ok: true,
        changed: result.changed,
        persona: {
          id: result.persona.id,
          name: result.persona.name,
          model: result.persona.model,
          style: result.persona.style,
        },
        proposal: result.proposal,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/admin/personas/:id/revert", requireAdmin, async (req, res) => {
    try {
      const result = revertPersona(req.params.id, req.body?.proposalId, { actor: "admin" });
      await runtime.refreshChannelMap();
      res.json({
        ok: true,
        persona: {
          id: result.persona.id,
          name: result.persona.name,
          model: result.persona.model,
          style: result.persona.style,
        },
        revertedProposal: result.revertedProposal,
        revertEntry: result.revertEntry,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/admin/personas/:id/disable", requireAdmin, async (req, res) => {
    try {
      const result = await applyPersonaRuntimeState(req.params.id, false, req.body?.actor || "admin_disable");
      res.json({ ok: true, disabled: true, ...result });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/admin/personas/:id/enable", requireAdmin, async (req, res) => {
    try {
      const result = await applyPersonaRuntimeState(req.params.id, true, req.body?.actor || "admin_enable");
      res.json({ ok: true, disabled: false, ...result });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/admin/personas/:id/runtime", requireAdmin, async (req, res) => {
    try {
      const enabled = req.body?.enabled !== false && req.body?.disabled !== true;
      const result = await applyPersonaRuntimeState(req.params.id, enabled, req.body?.actor || "admin_runtime");
      res.json({ ok: true, disabled: !enabled, ...result });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/models", async (req, res) => {
    try {
      res.json(await ollamaModels());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/channels", async (req, res) => {
    await runtime.refreshChannelMap();
    res.json(runtime.listChannels());
  });

  app.get("/api/status", (req, res) => {
    res.json({
      name: "KXKM_Clown",
      version: "0.3.0",
      host,
      accessMode,
      clients: clients.size,
      sessions: sessions.size,
      channels: Object.keys(runtime.getChannelModels()).length,
      personas: runtime.getGeneralPersonasActive().length,
      models: runtime.getAllModels().length,
      ollama: ollamaUrl,
      maxResponseTokens,
      generalResponders: runtime.generalResponderCount(),
      generalRespondersMode: maxGeneralResponders === 0 ? "all" : "bounded",
      disabledPersonas: typeof runtime.getDisabledPersonaIds === "function" ? runtime.getDisabledPersonaIds().length : 0,
    });
  });

  app.get("/api/admin/runtime", requireAdmin, async (req, res) => {
    try {
      await runtime.refreshChannelMap();
      const [availableModels, loadedModels] = await Promise.all([
        ollamaModels(),
        typeof ollamaLoadedModels === "function" ? ollamaLoadedModels() : Promise.resolve([]),
      ]);

      const channels = collectAdminChannels();

      res.json({
        name: "KXKM_Clown",
        version: "0.3.0",
        ollama: ollamaUrl,
        maxResponseTokens,
        maxGeneralResponders,
        clients: clients.size,
        sessions: sessions.size,
        savedSessions: typeof listSavedSessions === "function" ? listSavedSessions(30) : [],
        channels,
        runtime: typeof runtime.getRuntimeStatus === "function" ? runtime.getRuntimeStatus() : null,
        generalPersonas: runtime.getGeneralPersonasActive().map((persona) => ({
          id: persona.id,
          name: persona.name,
          model: persona.model,
        })),
        network: {
          host,
          accessMode,
          adminPagesPublic: true,
          adminApiProtection: "token + allowlist réseau",
          adminAllowedSubnets: typeof networkPolicy?.getAdminAllowedSubnets === "function"
            ? networkPolicy.getAdminAllowedSubnets()
            : [],
        },
        disabledPersonaIds: typeof runtime.getDisabledPersonaIds === "function" ? runtime.getDisabledPersonaIds() : [],
        modelsAvailable: availableModels,
        modelsLoaded: loadedModels,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/runtime/status", requireAdmin, async (req, res) => {
    try {
      await runtime.refreshChannelMap();
      const [availableModels, loadedModels] = await Promise.all([
        ollamaModels(),
        typeof ollamaLoadedModels === "function" ? ollamaLoadedModels() : Promise.resolve([]),
      ]);

      res.json({
        name: "KXKM_Clown",
        version: "0.3.0",
        uptimeMs: Math.round(process.uptime() * 1000),
        ollama: ollamaUrl,
        maxResponseTokens,
        maxGeneralResponders,
        clients: clients.size,
        sessions: sessions.size,
        savedSessions: typeof listSavedSessions === "function" ? listSavedSessions(30) : [],
        runtime: typeof runtime.getRuntimeStatus === "function" ? runtime.getRuntimeStatus() : null,
        network: {
          host,
          accessMode,
          adminPagesPublic: true,
          adminApiProtection: "token + allowlist réseau",
          adminAllowedSubnets: typeof networkPolicy?.getAdminAllowedSubnets === "function"
            ? networkPolicy.getAdminAllowedSubnets()
            : [],
        },
        disabledPersonaIds: typeof runtime.getDisabledPersonaIds === "function" ? runtime.getDisabledPersonaIds() : [],
        modelsAvailable: availableModels,
        modelsLoaded: loadedModels,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/channels", requireAdmin, async (req, res) => {
    try {
      await runtime.refreshChannelMap();
      res.json(collectAdminChannels());
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/runtime/channels", requireAdmin, async (req, res) => {
    try {
      await runtime.refreshChannelMap();
      res.json(collectAdminChannels());
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.put("/api/admin/channels/:id/topic", requireAdmin, async (req, res) => {
    try {
      if (typeof setChannelTopic !== "function") {
        return res.status(503).json({ error: "channel topics not configured" });
      }
      const channel = req.params.id.startsWith("#")
        ? req.params.id
        : `#${req.params.id}`;
      const topic = setChannelTopic(channel, req.body?.topic, req.body?.updatedBy || "admin");
      await runtime.refreshChannelMap();
      pushChannelInfo(channel);
      res.json({ ok: true, topic, channel });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/runtime/topic", requireAdmin, async (req, res) => {
    try {
      await runtime.refreshChannelMap();
      const channel = normalizeChannel(req.query.channel);
      if (!channel) {
        return res.status(400).json({ error: "channel query parameter required" });
      }
      res.json(getChannelSnapshot(channel));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.put("/api/admin/runtime/topic", requireAdmin, async (req, res) => {
    try {
      if (typeof setChannelTopic !== "function") {
        return res.status(503).json({ error: "channel topics not configured" });
      }
      const channel = normalizeChannel(req.body?.channel);
      if (!channel) {
        return res.status(400).json({ error: "channel body field required" });
      }
      const topic = setChannelTopic(channel, req.body?.topic, req.body?.updatedBy || "admin");
      await runtime.refreshChannelMap();
      pushChannelInfo(channel);
      res.json({ ok: true, topic, channel });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/history/search", requireAdmin, (req, res) => {
    try {
      const entries = typeof searchHistory === "function"
        ? searchHistory({
            q: req.query.q,
            channel: normalizeChannel(req.query.channel),
            nick: req.query.nick,
            limit: req.query.limit,
            before: req.query.before,
            after: req.query.after,
          })
        : [];
      res.json(entries);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/export/html", requireAdmin, (req, res) => {
    try {
      if (typeof buildHistoryHtml !== "function" || typeof searchHistory !== "function") {
        return res.status(503).type("text/plain").send("HTML export not configured");
      }
      const entries = searchHistory({
        q: req.query.q,
        channel: normalizeChannel(req.query.channel),
        nick: req.query.nick,
        limit: req.query.limit || 200,
        before: req.query.before,
        after: req.query.after,
      }).reverse();
      const titleParts = ["Export KXKM_Clown"];
      if (req.query.channel) titleParts.push(String(req.query.channel));
      if (req.query.q) titleParts.push(`recherche "${String(req.query.q)}"`);
      res.type("html").send(buildHistoryHtml({
        entries,
        title: titleParts.join(" · "),
      }));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/history/export.html", requireAdmin, (req, res) => {
    try {
      if (typeof buildHistoryHtml !== "function" || typeof searchHistory !== "function") {
        return res.status(503).type("text/plain").send("HTML export not configured");
      }
      const entries = searchHistory({
        q: req.query.q,
        channel: normalizeChannel(req.query.channel),
        nick: req.query.nick,
        limit: req.query.limit || 200,
        before: req.query.before,
        after: req.query.after,
      }).reverse();

      const titleParts = ["Historique KXKM_Clown"];
      if (req.query.channel) titleParts.push(String(req.query.channel));
      if (req.query.nick) titleParts.push(`nick:${String(req.query.nick)}`);
      if (req.query.q) titleParts.push(`recherche "${String(req.query.q)}"`);
      const title = titleParts.join(" · ");
      const fileName = title
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gi, "_")
        .replace(/^_+|_+$/g, "") || "history_kxkm_clown";

      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${fileName}.html"`);
      res.send(buildHistoryHtml({ entries, title }));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/logs/summary", requireAdmin, (req, res) => {
    try {
      const summary = typeof getLogsSummary === "function"
        ? getLogsSummary({
            channel: normalizeChannel(req.query.channel),
            limit: Math.max(1, Math.min(Number(req.query.limit) || 12, 50)),
          })
        : [];
      res.json(summary);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/node-engine/overview", requireAdmin, (req, res) => {
    if (!nodeEngineStore || !nodeEngineRegistry) {
      return res.status(503).json({ error: "node engine not configured" });
    }

    try {
      res.json(nodeEngineStore.getOverview());
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/node-engine/node-types", requireAdmin, (req, res) => {
    if (!nodeEngineRegistry) {
      return res.status(503).json({ error: "node engine not configured" });
    }

    try {
      res.json({
        families: nodeEngineRegistry.listFamilies(),
        nodeTypes: nodeEngineRegistry.listNodeTypes(),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/node-engine/graphs", requireAdmin, (req, res) => {
    if (!nodeEngineStore) {
      return res.status(503).json({ error: "node engine not configured" });
    }

    try {
      res.json(nodeEngineStore.listGraphs());
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/admin/node-engine/graphs", requireAdmin, (req, res) => {
    if (!nodeEngineStore) {
      return res.status(503).json({ error: "node engine not configured" });
    }

    try {
      const graph = nodeEngineStore.createGraph(req.body || {});
      res.status(201).json({ ok: true, graph });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/node-engine/graphs/:id", requireAdmin, (req, res) => {
    if (!nodeEngineStore) {
      return res.status(503).json({ error: "node engine not configured" });
    }

    try {
      res.json(nodeEngineStore.getGraph(req.params.id));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.put("/api/admin/node-engine/graphs/:id", requireAdmin, (req, res) => {
    if (!nodeEngineStore) {
      return res.status(503).json({ error: "node engine not configured" });
    }

    try {
      const graph = nodeEngineStore.saveGraph(req.params.id, req.body || {});
      res.json({ ok: true, graph });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/node-engine/runs", requireAdmin, (req, res) => {
    if (!nodeEngineStore) {
      return res.status(503).json({ error: "node engine not configured" });
    }

    try {
      const limit = Math.max(1, Math.min(Number.parseInt(req.query.limit || "20", 10) || 20, 100));
      res.json(nodeEngineStore.listRuns(limit));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/admin/node-engine/runs/:id", requireAdmin, (req, res) => {
    if (!nodeEngineStore) {
      return res.status(503).json({ error: "node engine not configured" });
    }

    try {
      res.json(nodeEngineStore.getRun(req.params.id));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post("/api/admin/node-engine/graphs/:id/run", requireAdmin, (req, res) => {
    if (!nodeEngineStore) {
      return res.status(503).json({ error: "node engine not configured" });
    }

    try {
      const run = nodeEngineStore.runGraph(req.params.id, {
        actor: req.body?.actor || "admin",
      });
      res.status(201).json({ ok: true, run });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/api/dpo/export", requireAdmin, (req, res) => {
    const dpoFile = path.join(dataDir, "dpo", "pairs.jsonl");
    res.json(readJsonlArray(dpoFile));
  });

  app.get("/api/training/export", requireAdmin, (req, res) => {
    const trainingFile = path.join(dataDir, "training", "conversations.jsonl");
    res.json(readJsonlArray(trainingFile));
  });
}

function createAdminNetworkGate(networkPolicy) {
  return (req, res, next) => {
    if (networkPolicy?.isAdminNetworkAllowed?.(req)) return next();
    const ip = typeof networkPolicy?.getRequestIp === "function"
      ? networkPolicy.getRequestIp(req)
      : req.socket?.remoteAddress || req.connection?.remoteAddress || "";
    res.status(403).json({ error: "admin network not allowed", ip });
  };
}

function requireLocalAdmin(adminBootstrapToken, requireAdminNetwork) {
  return (req, res, next) => {
    requireAdminNetwork(req, res, () => {
      if (!adminBootstrapToken) {
        return res.status(503).json({ error: "admin bootstrap token not configured" });
      }

      const token = req.get("x-admin-bootstrap-token");
      if (token !== adminBootstrapToken) {
        return res.status(403).json({ error: "invalid admin bootstrap token" });
      }

      next();
    });
  };
}

module.exports = {
  registerApiRoutes,
};
