const fs = require("fs");
const path = require("path");

function cleanText(value, maxLength = 4000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 16, maxLength = 240) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanText(item, maxLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => cleanText(item, maxLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  return [];
}

function cleanSourceRefs(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const url = cleanText(entry.url, 600);
      if (!url) return null;

      return {
        url,
        title: cleanText(entry.title, 300),
        publishedAt: cleanText(entry.publishedAt, 80),
        accessedAt: cleanText(entry.accessedAt, 80),
        notes: cleanText(entry.notes, 600),
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createPersonaStore({
  dataDir,
  getPersonaById,
  updatePersona,
  generatePersonaPatch,
}) {
  const sourcesDir = path.join(dataDir, "persona-sources");
  const feedbackDir = path.join(dataDir, "persona-feedback");
  const proposalsDir = path.join(dataDir, "persona-proposals");
  const trainingFile = path.join(dataDir, "training", "conversations.jsonl");
  const dpoFile = path.join(dataDir, "dpo", "pairs.jsonl");

  for (const dir of [sourcesDir, feedbackDir, proposalsDir]) {
    fs.mkdirSync(dir, { recursive: true });
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

  function safeFsId(id) {
    return String(id || "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
  }

  function sourcePath(id) {
    return path.join(sourcesDir, `${safeFsId(id)}.json`);
  }

  function feedbackPath(id) {
    return path.join(feedbackDir, `${safeFsId(id)}.jsonl`);
  }

  function proposalsPath(id) {
    return path.join(proposalsDir, `${safeFsId(id)}.jsonl`);
  }

  function createEmptySource(persona) {
    const now = new Date().toISOString();
    return {
      id: persona.id,
      subjectName: persona.name,
      query: "",
      preferredName: persona.name,
      preferredModel: persona.model,
      tone: "",
      facts: [],
      themes: [],
      lexicon: [],
      quotes: [],
      notes: "",
      sources: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  function readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return fallback;
    }
  }

  function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  function readJsonl(file) {
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

  function readRecentJsonl(file, limit = 200) {
    return readJsonl(file).slice(-limit);
  }

  function writeJsonl(file, entries) {
    const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
    fs.writeFileSync(file, content ? `${content}\n` : "");
  }

  function appendJsonl(file, entry) {
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  }

  function snapshotPersona(persona) {
    return {
      name: persona.name,
      model: persona.model,
      style: persona.style,
    };
  }

  function sourcesSummaryCount(source) {
    return (
      (source.facts?.length || 0) +
      (source.themes?.length || 0) +
      (source.lexicon?.length || 0) +
      (source.quotes?.length || 0) +
      (source.sources?.length || 0)
    );
  }

  function relevantModelsForPersona(persona, source) {
    return [...new Set([
      cleanText(persona?.model, 120),
      cleanText(source?.preferredModel, 120),
    ].filter(Boolean))];
  }

  function summarizeTrainingSignals(persona, source, limit = 6) {
    const relevantModels = relevantModelsForPersona(persona, source);
    if (!relevantModels.length) return [];

    return readRecentJsonl(trainingFile, 160)
      .filter((entry) => relevantModels.includes(cleanText(entry?.model, 120)))
      .slice(-limit)
      .reverse()
      .map((entry) => {
        const messages = Array.isArray(entry?.messages) ? entry.messages : [];
        const lastUser = messages.filter((item) => item?.role === "user").slice(-1)[0];
        const lastAssistant = messages.filter((item) => item?.role === "assistant").slice(-1)[0];
        return {
          ts: cleanText(entry?.timestamp, 80),
          channel: cleanText(entry?.channel, 80),
          nick: cleanText(entry?.nick, 80),
          model: cleanText(entry?.model, 120),
          user: cleanText(lastUser?.content, 220),
          assistant: cleanText(lastAssistant?.content, 220),
        };
      });
  }

  function summarizeDpoSignals(persona, source, limit = 6) {
    const relevantModels = relevantModelsForPersona(persona, source);
    if (!relevantModels.length) return [];

    return readRecentJsonl(dpoFile, 160)
      .filter((entry) => {
        const chosenModel = cleanText(entry?.chosen?.model, 120);
        const rejectedModel = cleanText(entry?.rejected?.model, 120);
        return relevantModels.includes(chosenModel) || relevantModels.includes(rejectedModel);
      })
      .slice(-limit)
      .reverse()
      .map((entry) => ({
        ts: cleanText(entry?.timestamp, 80),
        nick: cleanText(entry?.nick, 80),
        chosenModel: cleanText(entry?.chosen?.model, 120),
        rejectedModel: cleanText(entry?.rejected?.model, 120),
        prompt: cleanText(entry?.prompt, 240),
        chosen: cleanText(entry?.chosen?.content, 220),
        rejected: cleanText(entry?.rejected?.content, 220),
      }));
  }

  function buildRuntimeSignals(persona, source) {
    const relevantModels = relevantModelsForPersona(persona, source);
    const training = summarizeTrainingSignals(persona, source);
    const dpo = summarizeDpoSignals(persona, source);

    return {
      relevantModels,
      training,
      dpo,
      counts: {
        training: training.length,
        dpo: dpo.length,
      },
    };
  }

  function getPersonaSource(id) {
    const persona = assertPersona(id);
    const existing = readJson(sourcePath(id), null);
    if (!existing) return createEmptySource(persona);

    const defaults = createEmptySource(persona);

    return {
      ...defaults,
      ...existing,
      id: persona.id,
      subjectName: cleanText(existing.subjectName, 120) || persona.name,
      preferredName: cleanText(existing.preferredName, 20) || persona.name,
      preferredModel: cleanText(existing.preferredModel, 120) || persona.model,
      query: cleanText(existing.query, 400),
      tone: cleanText(existing.tone, 500),
      facts: cleanList(existing.facts, 16, 240),
      themes: cleanList(existing.themes, 16, 120),
      lexicon: cleanList(existing.lexicon, 16, 80),
      quotes: cleanList(existing.quotes, 10, 220),
      notes: cleanText(existing.notes, 1200),
      sources: cleanSourceRefs(existing.sources),
      createdAt: cleanText(existing.createdAt, 80) || defaults.createdAt,
      updatedAt: cleanText(existing.updatedAt, 80) || defaults.updatedAt,
    };
  }

  function updatePersonaSource(id, patch) {
    const current = getPersonaSource(id);
    const next = {
      ...current,
      subjectName: patch.subjectName === undefined ? current.subjectName : cleanText(patch.subjectName, 120),
      query: patch.query === undefined ? current.query : cleanText(patch.query, 400),
      preferredName: patch.preferredName === undefined ? current.preferredName : cleanText(patch.preferredName, 20),
      preferredModel: patch.preferredModel === undefined ? current.preferredModel : cleanText(patch.preferredModel, 120),
      tone: patch.tone === undefined ? current.tone : cleanText(patch.tone, 500),
      facts: patch.facts === undefined ? current.facts : cleanList(patch.facts, 16, 240),
      themes: patch.themes === undefined ? current.themes : cleanList(patch.themes, 16, 120),
      lexicon: patch.lexicon === undefined ? current.lexicon : cleanList(patch.lexicon, 16, 80),
      quotes: patch.quotes === undefined ? current.quotes : cleanList(patch.quotes, 10, 220),
      notes: patch.notes === undefined ? current.notes : cleanText(patch.notes, 1200),
      sources: patch.sources === undefined ? current.sources : cleanSourceRefs(patch.sources),
      updatedAt: new Date().toISOString(),
    };

    if (!next.subjectName) next.subjectName = current.subjectName;
    if (!next.preferredName) next.preferredName = current.preferredName;
    if (!next.preferredModel) next.preferredModel = current.preferredModel;

    writeJson(sourcePath(id), next);
    return next;
  }

  function listPersonaFeedback(id, limit = 50) {
    assertPersona(id);
    return readJsonl(feedbackPath(id)).slice(-limit).reverse();
  }

  function recordPersonaFeedback(id, entry) {
    assertPersona(id);

    const nextEntry = {
      id: randomId("feedback"),
      ts: new Date().toISOString(),
      personaId: id,
      kind: cleanText(entry.kind, 40) || "chat_signal",
      actor: cleanText(entry.actor, 80),
      channel: cleanText(entry.channel, 80),
      reason: cleanText(entry.reason, 400),
      sourceRef: cleanText(entry.sourceRef, 120),
      payload: clone(entry.payload) || {},
    };

    appendJsonl(feedbackPath(id), nextEntry);
    return nextEntry;
  }

  function readProposalEntries(id) {
    assertPersona(id);
    return readJsonl(proposalsPath(id));
  }

  function writeProposalEntries(id, entries) {
    assertPersona(id);
    writeJsonl(proposalsPath(id), entries);
  }

  function listPersonaProposals(id, limit = 20) {
    return readProposalEntries(id).slice(-limit).reverse();
  }

  function appendProposal(id, entry) {
    assertPersona(id);
    appendJsonl(proposalsPath(id), entry);
    return entry;
  }

  function hasRealChange(before, after) {
    return before.name !== after.name || before.model !== after.model || before.style !== after.style;
  }

  function recordAppliedChange(id, {
    before,
    after,
    proposer = "admin",
    mode = "manual_edit",
    reason = "",
    feedbackKind = "admin_edit",
    metadata = {},
  }) {
    if (!hasRealChange(before, after)) {
      return null;
    }

    const proposal = appendProposal(id, {
      id: randomId("proposal"),
      ts: new Date().toISOString(),
      personaId: id,
      proposer,
      mode,
      reason: cleanText(reason, 400) || mode,
      before,
      after,
      applied: true,
      revertedAt: null,
      metadata: clone(metadata) || {},
    });

    recordPersonaFeedback(id, {
      kind: feedbackKind,
      actor: proposer,
      reason: cleanText(reason, 400) || mode,
      payload: {
        before,
        after,
      },
    });

    return proposal;
  }

  async function reinforcePersona(id, {
    actor = "pharmacius",
    autoApply = true,
  } = {}) {
    const currentPersona = assertPersona(id);
    const before = snapshotPersona(currentPersona);
    const source = getPersonaSource(id);
    const feedback = listPersonaFeedback(id, 50).reverse();
    const proposals = listPersonaProposals(id, 20);
    const runtimeSignals = buildRuntimeSignals(currentPersona, source);

    const generated = typeof generatePersonaPatch === "function"
      ? await generatePersonaPatch({
        persona: currentPersona,
        source,
        feedback,
        proposals,
        runtimeSignals,
      })
      : before;

    const patch = {
      name: generated.name || before.name,
      model: generated.model || before.model,
      style: generated.style || before.style,
    };

    const willChange = hasRealChange(before, patch);
    const reason = cleanText(generated.reason, 400)
      || `reinforce:${source.subjectName || currentPersona.name}`;

    let persona = currentPersona;
    if (autoApply && willChange) {
      persona = updatePersona(id, patch);
    }

    const proposal = appendProposal(id, {
      id: randomId("proposal"),
      ts: new Date().toISOString(),
      personaId: id,
      proposer: actor,
      mode: autoApply && willChange ? "auto_applied" : "proposal",
      reason,
      before,
      after: willChange ? patch : before,
      applied: Boolean(autoApply && willChange),
      revertedAt: null,
      metadata: {
        generator: cleanText(generated.generator, 80) || "runtime",
        sourceSignals: sourcesSummaryCount(source),
        feedbackSignals: feedback.length,
        trainingSignals: runtimeSignals.counts.training,
        dpoSignals: runtimeSignals.counts.dpo,
        relevantModels: runtimeSignals.relevantModels,
      },
    });

    if (autoApply && willChange) {
      recordPersonaFeedback(id, {
        kind: "auto_apply",
        actor,
        reason,
        payload: {
          before,
          after: patch,
          generator: cleanText(generated.generator, 80) || "runtime",
        },
      });
    }

    return {
      persona: autoApply && willChange ? persona : currentPersona,
      proposal,
      changed: willChange,
      source,
      feedbackCount: feedback.length,
      runtimeSignals,
    };
  }

  function revertPersona(id, proposalId, { actor = "admin" } = {}) {
    const proposals = readProposalEntries(id);
    const target = proposalId
      ? proposals.find((entry) => entry.id === proposalId)
      : [...proposals].reverse().find((entry) => entry.applied && !entry.revertedAt && entry.mode !== "revert");

    if (!target) {
      const error = new Error("Aucune proposition applicable à annuler");
      error.statusCode = 404;
      throw error;
    }

    const currentPersona = assertPersona(id);
    const before = snapshotPersona(currentPersona);
    const persona = updatePersona(id, target.before);
    const after = snapshotPersona(persona);

    const nextEntries = proposals.map((entry) => (
      entry.id === target.id
        ? {
          ...entry,
          revertedAt: new Date().toISOString(),
          revertedBy: actor,
        }
        : entry
    ));
    writeProposalEntries(id, nextEntries);

    const revertEntry = appendProposal(id, {
      id: randomId("proposal"),
      ts: new Date().toISOString(),
      personaId: id,
      proposer: actor,
      mode: "revert",
      reason: `revert:${target.id}`,
      before,
      after,
      applied: true,
      revertedAt: null,
      metadata: {
        targetProposalId: target.id,
      },
    });

    recordPersonaFeedback(id, {
      kind: "admin_edit",
      actor,
      reason: `revert:${target.id}`,
      payload: {
        before,
        after,
      },
    });

    return {
      persona,
      revertedProposal: { ...target, revertedAt: new Date().toISOString(), revertedBy: actor },
      revertEntry,
    };
  }

  return {
    getPersonaSource,
    updatePersonaSource,
    listPersonaFeedback,
    recordPersonaFeedback,
    listPersonaProposals,
    recordAppliedChange,
    reinforcePersona,
    revertPersona,
  };
}

module.exports = {
  createPersonaStore,
};
