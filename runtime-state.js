const fs = require("fs");
const path = require("path");

function ensureDataDirs(dataDir) {
  for (const dir of [
    "sessions",
    "logs",
    "training",
    "memory",
    "dpo",
    "persona-sources",
    "persona-feedback",
    "persona-proposals",
    "uploads",
    "uploads-meta",
    "node-engine",
    "node-engine/graphs",
    "node-engine/runs",
    "node-engine/artifacts",
    "node-engine/cache",
  ]) {
    fs.mkdirSync(path.join(dataDir, dir), { recursive: true });
  }
}

function createRuntimeState({
  dataDir,
  getAllPersonas,
  manifesteRegisters,
  ollamaModels,
  maxGeneralResponders,
  getChannelTopic,
  loadRuntimeAdminState,
  saveRuntimeAdminState,
}) {
  const manifestePath = path.join(dataDir, "manifeste.md");
  let manifeste = "";

  try {
    manifeste = fs.readFileSync(manifestePath, "utf-8");
  } catch {
    console.warn("[warn] manifeste.md not found");
  }

  const manifesteChunks = [];
  if (manifeste) {
    const sections = manifeste.split(/^###\s+/m).filter(Boolean);
    for (const section of sections) {
      const trimmed = section.trim().slice(0, 500);
      if (trimmed.length > 20) manifesteChunks.push(trimmed);
    }
  }
  console.log(`[manifeste] ${manifesteChunks.length} sections extraites`);

  const personaRegisterIndex = {};
  const personaManifestIndex = {};
  const persistedAdminState = typeof loadRuntimeAdminState === "function"
    ? loadRuntimeAdminState()
    : { disabledPersonaIds: [], updatedAt: null, updatedBy: null };
  const disabledPersonaIds = new Set(persistedAdminState.disabledPersonaIds || []);
  let runtimeAdminMeta = {
    updatedAt: persistedAdminState.updatedAt || null,
    updatedBy: persistedAdminState.updatedBy || null,
  };
  let allModels = [];
  let channelModels = {};
  let generalPersonasActive = [];

  function getAllPersonaRecords() {
    return Object.values(getAllPersonas());
  }

  function readTopic(channel) {
    if (typeof getChannelTopic !== "function") {
      return {
        channel,
        topic: "KXKM_Clown - Local LLM Chat",
        updatedAt: null,
        updatedBy: null,
      };
    }

    const stored = getChannelTopic(channel);
    if (stored && typeof stored === "object") {
      return {
        channel,
        topic: stored.topic || "KXKM_Clown - Local LLM Chat",
        updatedAt: stored.updatedAt || null,
        updatedBy: stored.updatedBy || null,
      };
    }

    return {
      channel,
      topic: stored || "KXKM_Clown - Local LLM Chat",
      updatedAt: null,
      updatedBy: null,
    };
  }

  function isPersonaEnabled(personaId) {
    return Boolean(personaId) && !disabledPersonaIds.has(personaId);
  }

  function findRuntimePersonaById(personaId) {
    if (!personaId) return null;
    const persona = getAllPersonaRecords().find((entry) => entry.id === personaId) || null;
    if (!persona || !isPersonaEnabled(persona.id)) return null;
    return persona;
  }

  function findRuntimePersonaByNick(nick) {
    if (!nick) return null;
    return getRuntimePersonas().find((persona) => persona.name.toLowerCase() === String(nick).toLowerCase()) || null;
  }

  function getRuntimePersonas() {
    return getAllPersonaRecords().filter((persona) => isPersonaEnabled(persona.id));
  }

  function getRuntimePersonasByModel(model) {
    return getRuntimePersonas().filter((persona) => persona.model === model);
  }

  function getDefaultRuntimePersonaForModel(model) {
    const personas = getRuntimePersonasByModel(model);
    return personas.find((persona) => persona.routing?.defaultForModel) || personas[0] || null;
  }

  function getRuntimePersonaMap() {
    const map = {};
    for (const persona of getRuntimePersonas()) {
      map[persona.name] = persona;
    }
    return map;
  }

  function getNextRegister(personaName) {
    if (!manifesteRegisters.length) return null;
    if (!(personaName in personaRegisterIndex)) {
      personaRegisterIndex[personaName] = Math.floor(Math.random() * manifesteRegisters.length);
    }
    const index = personaRegisterIndex[personaName] % manifesteRegisters.length;
    personaRegisterIndex[personaName] = index + 1;
    return manifesteRegisters[index];
  }

  function getNextManifestChunk(personaName) {
    if (!manifesteChunks.length) return "";
    if (!(personaName in personaManifestIndex)) {
      personaManifestIndex[personaName] = Math.floor(Math.random() * manifesteChunks.length);
    }
    const index = personaManifestIndex[personaName] % manifesteChunks.length;
    personaManifestIndex[personaName] = index + 1;
    return `\n=== EXTRAIT MANIFESTE ===\n${manifesteChunks[index]}\n=== FIN ===`;
  }

  function persistRuntimeAdminState(actor = "runtime") {
    runtimeAdminMeta = {
      updatedAt: new Date().toISOString(),
      updatedBy: String(actor || "runtime").trim().slice(0, 40) || "runtime",
    };

    if (typeof saveRuntimeAdminState === "function") {
      saveRuntimeAdminState({
        disabledPersonaIds: Array.from(disabledPersonaIds),
        ...runtimeAdminMeta,
      });
    }
  }

  function recomputeDerivedState(availableModelNames = allModels.map((model) => model.name)) {
    const allPersonas = getAllPersonas();

    generalPersonasActive = Object.entries(allPersonas)
      .filter(([, persona]) =>
        isPersonaEnabled(persona.id) &&
        persona.generalEnabled !== false &&
        availableModelNames.includes(persona.model)
      )
      .map(([name, persona]) => ({ ...persona, name }));

    channelModels = { "#general": null, "#admin": "ADMIN" };
    for (const model of allModels) {
      const channelName = `#${model.name.split(":")[0].replace(/[^a-z0-9_-]/gi, "")}`;
      channelModels[channelName] = model.name;
    }
  }

  async function refreshChannelMap() {
    try {
      allModels = await ollamaModels();
      recomputeDerivedState(allModels.map((model) => model.name));

      console.log(`[channels] ${Object.keys(channelModels).length}: ${Object.keys(channelModels).join(", ")}`);
      console.log(`[personas] ${generalPersonasActive.length} active: ${generalPersonasActive.map((persona) => persona.name).join(", ")}`);
    } catch (error) {
      console.error("[error] refreshChannelMap:", error.message);
    }
  }

  function generalResponderCount() {
    return maxGeneralResponders === 0
      ? generalPersonasActive.length
      : Math.min(maxGeneralResponders, generalPersonasActive.length);
  }

  function generalResponderLabel() {
    return maxGeneralResponders === 0
      ? `toutes les personas actives (${generalPersonasActive.length})`
      : `${generalResponderCount()} personas max par message`;
  }

  function buildChannelInfo(channel, sessionModel = null, sessionPersona = null, sessionPersonaId = null) {
    const channelModel = channelModels[channel];
    const channelType = !channelModel ? "general" : channelModel === "ADMIN" ? "admin" : "dedicated";
    const topicInfo = readTopic(channel);
    const effectiveModel = channelModel && channelModel !== "ADMIN" ? channelModel : sessionModel || null;
    const selectedPersona = findRuntimePersonaById(sessionPersonaId)
      || findRuntimePersonaByNick(sessionPersona)
      || (effectiveModel ? getDefaultRuntimePersonaForModel(effectiveModel) : null);
    return {
      type: "channel_info",
      channel,
      model: effectiveModel,
      persona: selectedPersona?.name || null,
      personaId: selectedPersona?.id || null,
      channelType,
      topic: topicInfo.topic,
      topicUpdatedAt: topicInfo.updatedAt,
      topicUpdatedBy: topicInfo.updatedBy,
      generalResponders: channelType === "general" ? generalResponderCount() : null,
      generalRespondersMode: channelType === "general"
        ? maxGeneralResponders === 0 ? "all" : "bounded"
        : null,
    };
  }

  function listChannels() {
    return Object.entries(channelModels).map(([name, model]) => ({
      name,
      model: model === "ADMIN" ? null : model,
      type: model === null ? "general" : model === "ADMIN" ? "admin" : "dedicated",
      ...readTopic(name),
      responders: model === null ? generalResponderCount() : null,
      respondersMode: model === null ? (maxGeneralResponders === 0 ? "all" : "bounded") : null,
    }));
  }

  function listAdminChannels() {
    return listChannels().map((channel) => ({
      ...channel,
      runtimePersonaCount: channel.model
        ? getRuntimePersonasByModel(channel.model).length
        : generalPersonasActive.length,
      runtimePersonas: channel.model
        ? getRuntimePersonasByModel(channel.model).map((persona) => ({
          id: persona.id,
          name: persona.name,
          model: persona.model,
        }))
        : generalPersonasActive.map((persona) => ({
          id: persona.id,
          name: persona.name,
          model: persona.model,
        })),
    }));
  }

  function getRuntimeStatus() {
    const configuredTopics = listChannels().filter(
      (channel) => channel.topicUpdatedAt || channel.topic !== "KXKM_Clown - Local LLM Chat"
    ).length;

    return {
      disabledPersonaIds: Array.from(disabledPersonaIds),
      disabledPersonaCount: disabledPersonaIds.size,
      runtimeAdminUpdatedAt: runtimeAdminMeta.updatedAt,
      runtimeAdminUpdatedBy: runtimeAdminMeta.updatedBy,
      totalPersonas: getAllPersonaRecords().length,
      enabledPersonaCount: getRuntimePersonas().length,
      activeGeneralPersonaCount: generalPersonasActive.length,
      topicCount: configuredTopics,
      models: allModels.length,
      channels: Object.keys(channelModels).length,
      generalResponders: generalResponderCount(),
      generalRespondersMode: maxGeneralResponders === 0 ? "all" : "bounded",
    };
  }

  function setPersonaEnabled(id, enabled, actor = "admin") {
    if (!id) return false;
    if (enabled === false) {
      disabledPersonaIds.add(id);
    } else {
      disabledPersonaIds.delete(id);
    }
    persistRuntimeAdminState(actor);
    recomputeDerivedState();
    return isPersonaEnabled(id);
  }

  return {
    refreshChannelMap,
    generalResponderCount,
    generalResponderLabel,
    buildChannelInfo,
    listChannels,
    listAdminChannels,
    getRuntimeStatus,
    getChannelModel: (channel) => channelModels[channel],
    getChannelModels: () => channelModels,
    getAllModels: () => allModels,
    getGeneralPersonasActive: () => generalPersonasActive,
    getRuntimePersonas: () => getRuntimePersonas(),
    getRuntimePersonasByModel,
    getDefaultRuntimePersonaForModel,
    getRuntimePersonaMap,
    getRuntimePersonaById: findRuntimePersonaById,
    getRuntimePersonaByNick: findRuntimePersonaByNick,
    isPersonaEnabled,
    setPersonaEnabled,
    getDisabledPersonaIds: () => Array.from(disabledPersonaIds),
    getNextRegister,
    getNextManifestChunk,
  };
}

module.exports = {
  ensureDataDirs,
  createRuntimeState,
};
