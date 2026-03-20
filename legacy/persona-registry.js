const fs = require("fs");
const path = require("path");

const {
  PERSONA_DEFINITIONS,
  MANIFESTE_REGISTER_DEFINITIONS,
  buildPersonaRecord,
  createUnknownPersona,
} = require("./personas");

const RESERVED_PERSONA_NAMES = new Set(["saisail"]);
const FEEDBACK_KINDS = new Set(["vote", "admin_edit", "chat_signal", "drift_report", "implicit_positive", "implicit_negative"]);

function sanitizePersonaName(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9_-]/gi, "_")
    .slice(0, 20);
}

function sanitizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeLineList(value, { maxItems = 20, maxLength = 240 } = {}) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];

  return source
    .map((item) => sanitizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeSerializable(value, depth = 0) {
  if (depth > 3) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return sanitizeText(value, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeSerializable(item, depth + 1))
      .filter((item) => item !== null);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, 20);
    const out = {};
    for (const [key, item] of entries) {
      const next = sanitizeSerializable(item, depth + 1);
      if (next !== null) out[sanitizeText(key, 40)] = next;
    }
    return out;
  }
  return null;
}

function sanitizeSourceEntries(value) {
  const source = Array.isArray(value) ? value : [];
  const entries = [];

  for (const item of source.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const entry = {
      url: sanitizeText(item.url, 400),
      title: sanitizeText(item.title, 200),
      publishedAt: sanitizeText(item.publishedAt, 40),
      accessedAt: sanitizeText(item.accessedAt, 40),
      notes: sanitizeText(item.notes, 500),
    };
    if (entry.url || entry.title || entry.notes) entries.push(entry);
  }

  return entries;
}

function sanitizeOverrideEntry(value) {
  const entry = {};
  if (typeof value?.name === "string") {
    const name = sanitizePersonaName(value.name);
    if (name) entry.name = name;
  }
  if (typeof value?.model === "string") {
    const model = value.model.trim();
    if (model) entry.model = model;
  }
  if (typeof value?.style === "string") {
    const style = value.style.trim();
    if (style) entry.style = style;
  }
  return entry;
}

function sanitizeCustomPersonaEntry(value) {
  if (!value || typeof value !== "object") return null;

  const id = sanitizePersonaName(value.id);
  const name = sanitizePersonaName(value.name);
  const model = sanitizeText(value.model, 200);
  const style = sanitizeText(value.style, 12000);

  if (!id || !name || !model || !style) return null;

  return {
    id,
    name,
    model,
    style,
    desc: sanitizeText(value.desc, 240) || `${name} — persona locale sourcée`,
    color: sanitizeText(value.color, 40) || "cyan",
    tags: sanitizeLineList(value.tags, { maxItems: 12, maxLength: 40 }),
    priority: Number.isFinite(value.priority) ? value.priority : 0,
    generalEnabled: value.generalEnabled !== false,
    defaultForModel: Boolean(value.defaultForModel),
    custom: true,
  };
}

function normalizeOverrides(raw) {
  const container = raw && typeof raw === "object" ? raw : {};
  const source = container.personas && typeof container.personas === "object"
    ? container.personas
    : container;
  const customSource = container.customPersonas && typeof container.customPersonas === "object"
    ? container.customPersonas
    : {};

  const personas = {};
  for (const definition of Object.values(PERSONA_DEFINITIONS)) {
    const override = sanitizeOverrideEntry(source[definition.id]);
    if (Object.keys(override).length > 0) personas[definition.id] = override;
  }

  const customPersonas = {};
  for (const [id, entry] of Object.entries(customSource)) {
    const custom = sanitizeCustomPersonaEntry({ ...entry, id });
    if (custom) customPersonas[custom.id] = custom;
  }

  return { personas, customPersonas };
}

function reserveUniqueName(candidate, fallback, usedNames) {
  const preferred = sanitizePersonaName(candidate) || fallback;
  const base = sanitizePersonaName(fallback) || "persona";

  if (!RESERVED_PERSONA_NAMES.has(preferred.toLowerCase()) && !usedNames.has(preferred.toLowerCase())) {
    usedNames.add(preferred.toLowerCase());
    return preferred;
  }

  if (!RESERVED_PERSONA_NAMES.has(base.toLowerCase()) && !usedNames.has(base.toLowerCase())) {
    usedNames.add(base.toLowerCase());
    return base;
  }

  for (let index = 2; index <= 99; index++) {
    const suffix = String(index);
    const candidateName = `${base.slice(0, Math.max(1, 20 - suffix.length - 1))}_${suffix}`;
    if (!RESERVED_PERSONA_NAMES.has(candidateName.toLowerCase()) && !usedNames.has(candidateName.toLowerCase())) {
      usedNames.add(candidateName.toLowerCase());
      return candidateName;
    }
  }

  throw new Error(`Impossible de reserver un nom unique pour ${fallback}`);
}

function createPersonaRegistry({ dataDir }) {
  const overridesPath = path.join(dataDir, "personas.overrides.json");
  const sourcesDir = path.join(dataDir, "persona-sources");
  const feedbackDir = path.join(dataDir, "persona-feedback");
  const proposalsDir = path.join(dataDir, "persona-proposals");
  const manifesteRegisters = Object.freeze(
    MANIFESTE_REGISTER_DEFINITIONS.map((register) => Object.freeze({ ...register }))
  );

  fs.mkdirSync(sourcesDir, { recursive: true });
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.mkdirSync(proposalsDir, { recursive: true });

  let overrides = loadOverridesFromDisk();
  let state = buildState(overrides);

  function buildCustomDefinition(entry) {
    return {
      id: entry.id,
      model: entry.model,
      ui: { color: entry.color || "cyan" },
      routing: {
        defaultForModel: Boolean(entry.defaultForModel),
        generalPriority: Number.isFinite(entry.priority) ? entry.priority : 0,
        generalEnabled: entry.generalEnabled !== false,
      },
      identity: {
        desc: entry.desc || `${entry.name} — persona locale sourcée`,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
      },
      prompt: {
        style: entry.style,
      },
    };
  }

  function getBasePersona(id) {
    return Object.entries(PERSONA_DEFINITIONS).find(([, definition]) => definition.id === id) || [];
  }

  function getCustomPersona(id) {
    return overrides.customPersonas[id] || null;
  }

  function safeFsId(id) {
    return String(id || "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
  }

  function getSourcePath(id) {
    return path.join(sourcesDir, `${safeFsId(id)}.json`);
  }

  function getFeedbackPath(id) {
    return path.join(feedbackDir, `${safeFsId(id)}.jsonl`);
  }

  function getProposalPath(id) {
    return path.join(proposalsDir, `${safeFsId(id)}.jsonl`);
  }

  function loadOverridesFromDisk() {
    try {
      const raw = JSON.parse(fs.readFileSync(overridesPath, "utf-8"));
      return normalizeOverrides(raw);
    } catch {
      return { personas: {}, customPersonas: {} };
    }
  }

  function writeOverridesToDisk(nextOverrides) {
    fs.writeFileSync(
      overridesPath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          personas: nextOverrides.personas,
          customPersonas: nextOverrides.customPersonas,
        },
        null,
        2
      )
    );
  }

  function readJsonFile(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return fallback;
    }
  }

  function writeJsonFile(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  }

  function readJsonlArray(file) {
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, "utf-8").trim();
    if (!content) return [];
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function writeJsonlArray(file, entries) {
    const lines = entries.map((entry) => JSON.stringify(entry));
    fs.writeFileSync(file, lines.length ? `${lines.join("\n")}\n` : "");
  }

  function appendJsonlEntry(file, entry) {
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  }

  function buildState(sourceOverrides) {
    const usedNames = new Set();
    const personas = [];
    const byId = {};
    const byLowerName = {};
    const allPersonas = {};
    const namesByModel = {};
    const defaultNamesByModel = {};

    for (const [baseName, definition] of Object.entries(PERSONA_DEFINITIONS)) {
      const override = sourceOverrides.personas[definition.id] || {};
      const mergedName = reserveUniqueName(override.name || baseName, baseName, usedNames);
      const mergedDefinition = {
        ...definition,
        model: override.model || definition.model,
        ui: { ...definition.ui },
        routing: { ...definition.routing },
        identity: { ...definition.identity },
        prompt: {
          ...definition.prompt,
          style: override.style || definition.prompt.style,
        },
      };

      const record = Object.freeze({
        name: mergedName,
        baseName,
        ...buildPersonaRecord(mergedName, mergedDefinition),
      });

      personas.push(record);
      byId[record.id] = record;
      byLowerName[record.name.toLowerCase()] = record;
      allPersonas[record.name] = record;

      if (!namesByModel[record.model]) namesByModel[record.model] = [];
      namesByModel[record.model].push(record.name);

      if (record.routing.defaultForModel && !defaultNamesByModel[record.model]) {
        defaultNamesByModel[record.model] = record.name;
      }
    }

    for (const custom of Object.values(sourceOverrides.customPersonas || {})) {
      const definition = buildCustomDefinition(custom);
      const mergedName = reserveUniqueName(custom.name, custom.name, usedNames);
      const record = Object.freeze({
        name: mergedName,
        baseName: custom.name,
        custom: true,
        ...buildPersonaRecord(mergedName, definition),
      });

      personas.push(record);
      byId[record.id] = record;
      byLowerName[record.name.toLowerCase()] = record;
      allPersonas[record.name] = record;

      if (!namesByModel[record.model]) namesByModel[record.model] = [];
      namesByModel[record.model].push(record.name);

      if (record.routing.defaultForModel && !defaultNamesByModel[record.model]) {
        defaultNamesByModel[record.model] = record.name;
      }
    }

    return {
      personas: Object.freeze(personas),
      byId: Object.freeze(byId),
      byLowerName: Object.freeze(byLowerName),
      allPersonas: Object.freeze(allPersonas),
      namesByModel: Object.freeze(namesByModel),
      defaultNamesByModel: Object.freeze(defaultNamesByModel),
    };
  }

  function refresh() {
    overrides = loadOverridesFromDisk();
    state = buildState(overrides);
    return state;
  }

  function getAllPersonas() {
    return state.allPersonas;
  }

  function listPersonas() {
    return state.personas;
  }

  function listEditablePersonas() {
    return state.personas.map((persona) => ({
      id: persona.id,
      name: persona.name,
      baseName: persona.baseName,
      isCustom: Boolean(persona.custom),
      model: persona.model,
      desc: persona.desc,
      style: persona.style,
      color: persona.color,
      tags: persona.tags,
      priority: persona.priority,
      generalEnabled: persona.generalEnabled,
      defaultForModel: Boolean(persona.routing.defaultForModel),
    }));
  }

  function assertPersona(id) {
    const persona = getPersonaById(id);
    if (!persona) {
      const error = new Error(`Persona inconnue: ${id}`);
      error.statusCode = 404;
      throw error;
    }
    return persona;
  }

  function getPersonaById(id) {
    if (!id) return null;
    return state.byId[id] || state.byLowerName[String(id).toLowerCase()] || null;
  }

  function getPersonaByNick(nick) {
    return nick ? state.byLowerName[String(nick).toLowerCase()] || null : null;
  }

  function getPersonasByModel(model) {
    const names = state.namesByModel[model] || [];
    return names
      .map((name) => getPersonaByNick(name))
      .filter(Boolean);
  }

  function getDefaultPersonaNameForModel(model) {
    return state.defaultNamesByModel[model] || state.namesByModel[model]?.[0] || null;
  }

  function getDefaultPersonaForModel(model) {
    const name = getDefaultPersonaNameForModel(model);
    return name ? getPersonaByNick(name) : createUnknownPersona(model);
  }

  function getPersonaByModel(model) {
    return getDefaultPersonaForModel(model);
  }

  function getPersonaSnapshot(persona) {
    return {
      name: persona.name,
      model: persona.model,
      style: persona.style,
    };
  }

  function createDefaultSource(persona) {
    return {
      id: persona.id,
      subjectName: persona.name,
      query: "",
      preferredName: "",
      preferredModel: "",
      tone: "",
      facts: [],
      themes: [],
      lexicon: [],
      quotes: [],
      notes: "",
      sources: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function normalizeSource(value, persona, current = null) {
    const source = value && typeof value === "object" ? value : {};
    const base = current || createDefaultSource(persona);
    return {
      id: persona.id,
      subjectName: sanitizeText(source.subjectName ?? base.subjectName, 120) || persona.name,
      query: sanitizeText(source.query ?? base.query, 400),
      preferredName: sanitizePersonaName(source.preferredName ?? base.preferredName),
      preferredModel: sanitizeText(source.preferredModel ?? base.preferredModel, 200),
      tone: sanitizeText(source.tone ?? base.tone, 400),
      facts: sanitizeLineList(source.facts ?? base.facts, { maxItems: 20, maxLength: 240 }),
      themes: sanitizeLineList(source.themes ?? base.themes, { maxItems: 20, maxLength: 120 }),
      lexicon: sanitizeLineList(source.lexicon ?? base.lexicon, { maxItems: 30, maxLength: 80 }),
      quotes: sanitizeLineList(source.quotes ?? base.quotes, { maxItems: 12, maxLength: 240 }),
      notes: sanitizeText(source.notes ?? base.notes, 4000),
      sources: sanitizeSourceEntries(source.sources ?? base.sources),
      createdAt: sanitizeText(base.createdAt || source.createdAt || new Date().toISOString(), 40),
      updatedAt: new Date().toISOString(),
    };
  }

  function getPersonaSource(id) {
    const persona = assertPersona(id);
    const file = getSourcePath(persona.id);
    const raw = readJsonFile(file, null);
    return normalizeSource(raw || {}, persona, raw ? null : createDefaultSource(persona));
  }

  function updatePersonaSource(id, patch) {
    const persona = assertPersona(id);
    const current = getPersonaSource(persona.id);
    const next = normalizeSource({ ...current, ...(patch || {}) }, persona, current);
    writeJsonFile(getSourcePath(persona.id), next);
    return next;
  }

  function listPersonaFeedback(id, limit = 50) {
    const persona = assertPersona(id);
    return readJsonlArray(getFeedbackPath(persona.id)).slice(-limit).reverse();
  }

  function recordPersonaFeedback(id, entry = {}) {
    const persona = assertPersona(id);
    const kind = FEEDBACK_KINDS.has(entry.kind) ? entry.kind : "chat_signal";
    const event = {
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      personaId: persona.id,
      kind,
      channel: sanitizeText(entry.channel, 80),
      actor: sanitizeText(entry.actor, 40),
      text: sanitizeText(entry.text, 1000),
      score: Number.isFinite(entry.score) ? entry.score : null,
      sourceRef: sanitizeText(entry.sourceRef, 200),
      payload: sanitizeSerializable(entry.payload),
    };
    appendJsonlEntry(getFeedbackPath(persona.id), event);
    return event;
  }

  function listPersonaProposals(id, limit = 50) {
    const persona = assertPersona(id);
    return readJsonlArray(getProposalPath(persona.id)).slice(-limit).reverse();
  }

  function appendProposal(id, proposal = {}) {
    const persona = assertPersona(id);
    const entry = {
      id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      personaId: persona.id,
      proposer: sanitizeText(proposal.proposer, 40) || "admin",
      mode: sanitizeText(proposal.mode, 40) || "manual_edit",
      reason: sanitizeText(proposal.reason, 2000),
      before: sanitizeSerializable(proposal.before),
      after: sanitizeSerializable(proposal.after),
      applied: Boolean(proposal.applied),
      sourceSummary: sanitizeText(proposal.sourceSummary, 2000),
      feedbackSummary: sanitizeText(proposal.feedbackSummary, 2000),
      targetProposalId: sanitizeText(proposal.targetProposalId, 80),
      revertedAt: null,
    };
    appendJsonlEntry(getProposalPath(persona.id), entry);
    return entry;
  }

  function markProposalReverted(id, proposalId, revertedAt) {
    const persona = assertPersona(id);
    const file = getProposalPath(persona.id);
    const proposals = readJsonlArray(file);
    let found = false;

    const next = proposals.map((proposal) => {
      if (proposal.id !== proposalId) return proposal;
      found = true;
      return {
        ...proposal,
        revertedAt,
      };
    });

    if (!found) {
      const error = new Error(`Proposal inconnue: ${proposalId}`);
      error.statusCode = 404;
      throw error;
    }

    writeJsonlArray(file, next);
  }

  function applyPersonaPatch(id, patch, options = {}) {
    const current = assertPersona(id);
    const customBase = getCustomPersona(id);
    const [baseName, baseDefinition] = customBase
      ? [customBase.name, buildCustomDefinition(customBase)]
      : getBasePersona(id);

    if (!baseDefinition) {
      const error = new Error(`Base persona introuvable: ${id}`);
      error.statusCode = 500;
      throw error;
    }

    const nextName = patch.name === undefined ? current.name : sanitizePersonaName(patch.name);
    const nextModel = patch.model === undefined ? current.model : String(patch.model || "").trim();
    const nextStyle = patch.style === undefined ? current.style : String(patch.style || "").trim();

    if (!nextName) {
      const error = new Error("Le nom de persona est obligatoire");
      error.statusCode = 400;
      throw error;
    }
    if (RESERVED_PERSONA_NAMES.has(nextName.toLowerCase())) {
      const error = new Error(`Le nom "${nextName}" est réservé`);
      error.statusCode = 400;
      throw error;
    }
    if (!nextModel) {
      const error = new Error("Le modèle est obligatoire");
      error.statusCode = 400;
      throw error;
    }
    if (!nextStyle) {
      const error = new Error("La personnalité est obligatoire");
      error.statusCode = 400;
      throw error;
    }

    for (const persona of state.personas) {
      if (persona.id === id) continue;
      if (persona.name.toLowerCase() === nextName.toLowerCase()) {
        const error = new Error(`Le nom "${nextName}" est déjà utilisé par ${persona.baseName}`);
        error.statusCode = 400;
        throw error;
      }
    }

    const before = getPersonaSnapshot(current);
    const after = { name: nextName, model: nextModel, style: nextStyle };
    const changed = before.name !== after.name || before.model !== after.model || before.style !== after.style;

    if (changed) {
      const nextOverrides = {
        personas: {
          ...overrides.personas,
        },
        customPersonas: {
          ...overrides.customPersonas,
        },
      };

      if (customBase) {
        nextOverrides.customPersonas[id] = sanitizeCustomPersonaEntry({
          ...customBase,
          id,
          name: nextName,
          model: nextModel,
          style: nextStyle,
        });
      } else {
        const nextOverride = {};
        if (nextName !== baseName) nextOverride.name = nextName;
        if (nextModel !== baseDefinition.model) nextOverride.model = nextModel;
        if (nextStyle !== baseDefinition.prompt.style) nextOverride.style = nextStyle;

        if (Object.keys(nextOverride).length > 0) nextOverrides.personas[id] = nextOverride;
        else delete nextOverrides.personas[id];
      }

      writeOverridesToDisk(nextOverrides);
      overrides = nextOverrides;
      state = buildState(overrides);
    }

    const persona = getPersonaById(id);
    const proposal = options.skipProposal
      ? null
      : appendProposal(id, {
          proposer: options.proposer,
          mode: options.mode || "manual_edit",
          reason: options.reason || (changed ? "Mise à jour de persona" : "Aucun changement effectif"),
          before,
          after: getPersonaSnapshot(persona),
          applied: options.applied !== false && changed,
          sourceSummary: options.sourceSummary,
          feedbackSummary: options.feedbackSummary,
          targetProposalId: options.targetProposalId,
        });

    if (options.recordFeedbackKind) {
      recordPersonaFeedback(id, {
        kind: options.recordFeedbackKind,
        actor: options.actor || options.proposer || "admin",
        channel: options.channel || "#admin",
        text: options.reason || "",
        payload: {
          mode: options.mode || "manual_edit",
          before,
          after: getPersonaSnapshot(persona),
          proposalId: proposal?.id || null,
        },
      });
    }

    return {
      persona,
      proposal,
      changed,
    };
  }

  function buildSourceBackedStyle(payload = {}) {
    const sections = [];
    if (payload.style) sections.push(sanitizeText(payload.style, 12000));
    if (payload.tone) sections.push(`Tonalité: ${sanitizeText(payload.tone, 300)}.`);
    const themes = sanitizeLineList(payload.themes, { maxItems: 8, maxLength: 120 });
    if (themes.length) sections.push(`Thèmes dominants: ${themes.join(", ")}.`);
    const facts = sanitizeLineList(payload.facts, { maxItems: 8, maxLength: 180 });
    if (facts.length) sections.push(`Faits stables: ${facts.join(" | ")}.`);
    const quotes = sanitizeLineList(payload.quotes, { maxItems: 4, maxLength: 180 });
    if (quotes.length) sections.push(`Références de formulation: ${quotes.join(" | ")}.`);
    if (payload.notes) sections.push(`Notes éditoriales: ${sanitizeText(payload.notes, 800)}.`);
    return sections.filter(Boolean).join("\n\n").trim();
  }

  function createPersonaFromSource(payload = {}) {
    const preferredId = sanitizePersonaName(payload.id || payload.name || payload.subjectName || "persona");
    const idBase = preferredId || "persona";
    let id = idBase;

    for (let index = 2; state.byId[id]; index++) {
      const suffix = String(index);
      id = `${idBase.slice(0, Math.max(1, 20 - suffix.length - 1))}_${suffix}`;
    }

    const requestedName = sanitizePersonaName(payload.name || payload.subjectName || id);
    const usedNames = new Set(state.personas.map((persona) => persona.name.toLowerCase()));
    const name = reserveUniqueName(requestedName || id, requestedName || id, usedNames);
    const model = sanitizeText(payload.targetModel || payload.model || PERSONA_DEFINITIONS.Pharmacius.model, 200);
    const style = buildSourceBackedStyle(payload);

    if (!style) {
      const error = new Error("Impossible de créer une persona sans personnalité initiale");
      error.statusCode = 400;
      throw error;
    }

    const customEntry = sanitizeCustomPersonaEntry({
      id,
      name,
      model,
      style,
      desc: sanitizeText(payload.summary || payload.notes || `${name} — persona locale sourcée`, 240),
      color: sanitizeText(payload.color, 40) || "cyan",
      tags: sanitizeLineList(payload.themes || payload.tags, { maxItems: 12, maxLength: 40 }),
      priority: 0,
      generalEnabled: payload.generalEnabled === true,
      defaultForModel: false,
    });

    const nextOverrides = {
      personas: {
        ...overrides.personas,
      },
      customPersonas: {
        ...overrides.customPersonas,
        [id]: customEntry,
      },
    };

    writeOverridesToDisk(nextOverrides);
    overrides = nextOverrides;
    state = buildState(overrides);

    return {
      persona: getPersonaById(id),
      created: true,
    };
  }

  function updatePersona(id, patch, options = {}) {
    return applyPersonaPatch(id, patch, options).persona;
  }

  function revertPersona(id, proposalId = null, options = {}) {
    const persona = assertPersona(id);
    const proposals = readJsonlArray(getProposalPath(persona.id));
    const target = proposalId
      ? proposals.find((proposal) => proposal.id === proposalId)
      : [...proposals].reverse().find((proposal) => proposal.applied && !proposal.revertedAt);

    if (!target) {
      const error = new Error("Aucune proposal applicable à revert");
      error.statusCode = 404;
      throw error;
    }
    if (!target.before || typeof target.before !== "object") {
      const error = new Error(`Proposal ${target.id} invalide pour revert`);
      error.statusCode = 400;
      throw error;
    }
    if (target.revertedAt) {
      const error = new Error(`Proposal ${target.id} déjà revert`);
      error.statusCode = 400;
      throw error;
    }

    const applied = applyPersonaPatch(id, target.before, {
      proposer: options.proposer || "admin",
      mode: "revert",
      reason: options.reason || `Revert ${target.id}`,
      targetProposalId: target.id,
      recordFeedbackKind: "admin_edit",
      actor: options.actor || "admin",
      channel: options.channel || "#admin",
    });

    markProposalReverted(id, target.id, applied.proposal?.ts || new Date().toISOString());
    return {
      persona: applied.persona,
      proposal: applied.proposal,
      revertedProposal: target,
    };
  }

  return {
    overridesPath,
    refresh,
    getAllPersonas,
    listPersonas,
    listEditablePersonas,
    getPersonaById,
    getPersonaByNick,
    getPersonasByModel,
    getDefaultPersonaNameForModel,
    getDefaultPersonaForModel,
    getPersonaByModel,
    getManifesteRegisters: () => manifesteRegisters,
    getPersonaSource,
    updatePersonaSource,
    listPersonaFeedback,
    recordPersonaFeedback,
    listPersonaProposals,
    appendProposal,
    applyPersonaPatch,
    updatePersona,
    createPersonaFromSource,
    revertPersona,
  };
}

module.exports = {
  createPersonaRegistry,
};
