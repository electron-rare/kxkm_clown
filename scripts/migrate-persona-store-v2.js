import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile, access } from "node:fs/promises";

const require = createRequire(import.meta.url);
let DRY_RUN = false;

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  if (DRY_RUN) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonl(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function readJsonFiles(directory) {
  let entries = [];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    out.push(path.join(directory, entry));
  }
  return out;
}

async function readJsonlFiles(directory) {
  let entries = [];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    out.push(path.join(directory, entry));
  }
  return out;
}

function safePersonaFileName(personaId) {
  const safe = String(personaId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe || "persona"}.json`;
}

function personaFilePath(directory, personaId) {
  return path.join(directory, safePersonaFileName(personaId));
}

function chooseText(...values) {
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) return text;
  }
  return "";
}

function chooseArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function mapLegacySourceToV2(source, personaId) {
  const refsRaw = Array.isArray(source?.sources) ? source.sources : [];
  const references = refsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const url = chooseText(entry.url);
      const title = chooseText(entry.title);
      if (!url && !title) return "";
      return title && url ? `${title} | ${url}` : (url || title);
    })
    .filter(Boolean);

  const chunks = [];
  const tone = chooseText(source?.tone);
  if (tone) chunks.push(`Tone: ${tone}`);
  const notes = chooseText(source?.notes);
  if (notes) chunks.push(`Notes: ${notes}`);
  const facts = chooseArray(source?.facts).map((x) => String(x).trim()).filter(Boolean);
  if (facts.length) chunks.push(`Facts: ${facts.join(" | ")}`);
  const themes = chooseArray(source?.themes).map((x) => String(x).trim()).filter(Boolean);
  if (themes.length) chunks.push(`Themes: ${themes.join(" | ")}`);
  const quotes = chooseArray(source?.quotes).map((x) => String(x).trim()).filter(Boolean);
  if (quotes.length) chunks.push(`Quotes: ${quotes.join(" | ")}`);

  return {
    personaId: chooseText(source?.id, personaId),
    subjectName: chooseText(source?.subjectName, source?.preferredName, personaId),
    summary: chunks.join("\n\n"),
    references,
  };
}

function mapLegacyFeedbackToV2(row, personaId) {
  const message = chooseText(
    row?.message,
    row?.note,
    row?.reason,
    row?.payload?.response,
    row?.payload?.prompt,
    row?.sourceRef,
  );
  return {
    id: chooseText(row?.id, `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    personaId: chooseText(row?.personaId, personaId),
    kind: chooseText(row?.kind, "chat_signal"),
    message,
    createdAt: chooseText(row?.createdAt, row?.ts, new Date().toISOString()),
  };
}

function mapLegacyProposalToV2(row, personaId) {
  const before = row?.before || {};
  const after = row?.after || {};
  return {
    id: chooseText(row?.id, `proposal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    personaId: chooseText(row?.personaId, personaId),
    reason: chooseText(row?.reason, row?.mode, "legacy_migration"),
    before: {
      name: chooseText(before?.name),
      model: chooseText(before?.model),
      summary: chooseText(before?.desc, before?.style),
      systemPrompt: chooseText(before?.style),
    },
    after: {
      name: chooseText(after?.name),
      model: chooseText(after?.model),
      summary: chooseText(after?.desc, after?.style),
      systemPrompt: chooseText(after?.style),
    },
    applied: Boolean(row?.applied),
    createdAt: chooseText(row?.createdAt, row?.ts, new Date().toISOString()),
  };
}

function mergeArrayById(existing, incoming) {
  const map = new Map();
  for (const row of existing || []) {
    if (!row?.id) continue;
    map.set(row.id, row);
  }
  for (const row of incoming || []) {
    if (!row?.id) continue;
    map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

async function migrateLegacyV2GlobalFiles(storeDir) {
  const legacy = {
    personas: path.join(storeDir, "personas.json"),
    sources: path.join(storeDir, "persona-sources.json"),
    feedback: path.join(storeDir, "persona-feedback.json"),
    proposals: path.join(storeDir, "persona-proposals.json"),
  };
  const next = {
    personas: path.join(storeDir, "personas"),
    sources: path.join(storeDir, "persona-sources"),
    feedback: path.join(storeDir, "persona-feedback"),
    proposals: path.join(storeDir, "persona-proposals"),
  };

  const stats = { storeDir, legacyFound: 0, personas: 0, sources: 0, feedbackBuckets: 0, proposalBuckets: 0 };

  if (await exists(legacy.personas)) {
    stats.legacyFound++;
    const personas = await readJson(legacy.personas, []);
    if (Array.isArray(personas)) {
      for (const persona of personas) {
        if (!persona?.id) continue;
        await writeJson(personaFilePath(next.personas, persona.id), persona);
        stats.personas++;
      }
    }
  }

  if (await exists(legacy.sources)) {
    stats.legacyFound++;
    const sources = await readJson(legacy.sources, {});
    const rows = Array.isArray(sources) ? sources : Object.values(sources || {});
    for (const source of rows) {
      const personaId = chooseText(source?.personaId, source?.id);
      if (!personaId) continue;
      await writeJson(personaFilePath(next.sources, personaId), source);
      stats.sources++;
    }
  }

  if (await exists(legacy.feedback)) {
    stats.legacyFound++;
    const feedback = await readJson(legacy.feedback, []);
    const grouped = new Map();
    for (const row of Array.isArray(feedback) ? feedback : []) {
      const personaId = chooseText(row?.personaId);
      if (!personaId) continue;
      const list = grouped.get(personaId) || [];
      list.push(row);
      grouped.set(personaId, list);
    }
    for (const [personaId, rows] of grouped.entries()) {
      await writeJson(personaFilePath(next.feedback, personaId), rows);
      stats.feedbackBuckets++;
    }
  }

  if (await exists(legacy.proposals)) {
    stats.legacyFound++;
    const proposals = await readJson(legacy.proposals, []);
    const grouped = new Map();
    for (const row of Array.isArray(proposals) ? proposals : []) {
      const personaId = chooseText(row?.personaId);
      if (!personaId) continue;
      const list = grouped.get(personaId) || [];
      list.push(row);
      grouped.set(personaId, list);
    }
    for (const [personaId, rows] of grouped.entries()) {
      await writeJson(personaFilePath(next.proposals, personaId), rows);
      stats.proposalBuckets++;
    }
  }

  return stats;
}

async function migrateLegacyV1Data(legacyDataDir, targetStoreDir) {
  const personasDir = path.join(targetStoreDir, "personas");
  const sourcesDir = path.join(targetStoreDir, "persona-sources");
  const feedbackDir = path.join(targetStoreDir, "persona-feedback");
  const proposalsDir = path.join(targetStoreDir, "persona-proposals");

  const stats = {
    legacyDataDir,
    targetStoreDir,
    personas: 0,
    sources: 0,
    feedbackBuckets: 0,
    feedbackRows: 0,
    proposalBuckets: 0,
    proposalRows: 0,
    skipped: 0,
  };

  const legacyPersonas = require(path.resolve(process.cwd(), "legacy/personas.js"));
  const allLegacy = legacyPersonas.ALL_PERSONAS || {};
  const overrides = await readJson(path.join(legacyDataDir, "personas.overrides.json"), { personas: {}, customPersonas: {} });
  const runtimeAdmin = await readJson(path.join(legacyDataDir, "runtime-admin.json"), { disabledPersonaIds: [] });
  const disabledSet = new Set(Array.isArray(runtimeAdmin?.disabledPersonaIds) ? runtimeAdmin.disabledPersonaIds : []);

  const merged = new Map();
  for (const [name, persona] of Object.entries(allLegacy)) {
    merged.set(persona.id, {
      id: persona.id,
      name,
      model: chooseText(persona.model, "qwen3.5:9b"),
      summary: chooseText(persona.desc, persona.style, `${name} persona legacy`),
      systemPrompt: chooseText(persona.style),
      editable: true,
      enabled: !disabledSet.has(persona.id),
    });
  }

  const baseOverrides = overrides?.personas && typeof overrides.personas === "object" ? overrides.personas : {};
  for (const [personaId, patch] of Object.entries(baseOverrides)) {
    const current = merged.get(personaId) || {
      id: personaId,
      name: personaId,
      model: "qwen3.5:9b",
      summary: "",
      systemPrompt: "",
      editable: true,
      enabled: !disabledSet.has(personaId),
    };
    merged.set(personaId, {
      ...current,
      name: chooseText(patch?.name, current.name),
      model: chooseText(patch?.model, current.model),
      summary: chooseText(patch?.desc, patch?.style, current.summary),
      systemPrompt: chooseText(patch?.style, current.systemPrompt),
    });
  }

  const custom = overrides?.customPersonas && typeof overrides.customPersonas === "object" ? overrides.customPersonas : {};
  for (const [personaId, entry] of Object.entries(custom)) {
    merged.set(personaId, {
      id: personaId,
      name: chooseText(entry?.name, personaId),
      model: chooseText(entry?.model, "qwen3.5:9b"),
      summary: chooseText(entry?.desc, entry?.style, `${personaId} persona custom legacy`),
      systemPrompt: chooseText(entry?.style),
      editable: true,
      enabled: entry?.generalEnabled !== false && !disabledSet.has(personaId),
    });
  }

  for (const [personaId, legacyPersona] of merged.entries()) {
    const outPath = personaFilePath(personasDir, personaId);
    const existing = await readJson(outPath, null);
    const next = {
      id: personaId,
      name: chooseText(existing?.name, legacyPersona.name),
      model: chooseText(existing?.model, legacyPersona.model, "qwen3.5:9b"),
      summary: chooseText(existing?.summary, legacyPersona.summary),
      systemPrompt: chooseText(existing?.systemPrompt, legacyPersona.systemPrompt),
      editable: typeof existing?.editable === "boolean" ? existing.editable : true,
      enabled: typeof existing?.enabled === "boolean" ? existing.enabled : legacyPersona.enabled,
    };
    await writeJson(outPath, next);
    stats.personas++;
  }

  const sourceFiles = await readJsonFiles(path.join(legacyDataDir, "persona-sources"));
  for (const sourceFile of sourceFiles) {
    const legacySource = await readJson(sourceFile, null);
    if (!legacySource) {
      stats.skipped++;
      continue;
    }
    const personaId = chooseText(legacySource.id, path.basename(sourceFile, ".json"));
    const mapped = mapLegacySourceToV2(legacySource, personaId);
    const outPath = personaFilePath(sourcesDir, personaId);
    const existing = await readJson(outPath, null);
    const next = existing && typeof existing === "object" ? {
      personaId,
      subjectName: chooseText(existing.subjectName, mapped.subjectName),
      summary: chooseText(existing.summary, mapped.summary),
      references: chooseArray(existing.references, mapped.references),
    } : mapped;
    await writeJson(outPath, next);
    stats.sources++;
  }

  const feedbackFiles = await readJsonlFiles(path.join(legacyDataDir, "persona-feedback"));
  for (const feedbackFile of feedbackFiles) {
    const personaId = path.basename(feedbackFile, ".jsonl");
    const legacyRows = await readJsonl(feedbackFile);
    const mappedRows = legacyRows.map((row) => mapLegacyFeedbackToV2(row, personaId));
    const outPath = personaFilePath(feedbackDir, personaId);
    const existing = await readJson(outPath, []);
    const mergedRows = mergeArrayById(Array.isArray(existing) ? existing : [], mappedRows);
    await writeJson(outPath, mergedRows);
    stats.feedbackBuckets++;
    stats.feedbackRows += mappedRows.length;
  }

  const proposalFiles = await readJsonlFiles(path.join(legacyDataDir, "persona-proposals"));
  for (const proposalFile of proposalFiles) {
    const personaId = path.basename(proposalFile, ".jsonl");
    const legacyRows = await readJsonl(proposalFile);
    const mappedRows = legacyRows.map((row) => mapLegacyProposalToV2(row, personaId));
    const outPath = personaFilePath(proposalsDir, personaId);
    const existing = await readJson(outPath, []);
    const mergedRows = mergeArrayById(Array.isArray(existing) ? existing : [], mappedRows);
    await writeJson(outPath, mergedRows);
    stats.proposalBuckets++;
    stats.proposalRows += mappedRows.length;
  }

  return stats;
}

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [k, v] = token.replace(/^--/, "").split("=");
    args[k] = v === undefined ? "1" : v;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(process.cwd(), args["target-dir"] || "data/v2-local");
  const legacyDataDir = path.resolve(process.cwd(), args["legacy-data-dir"] || "data");
  DRY_RUN = args["dry-run"] === "1" || args["dry-run"] === "true";

  const reports = [];
  reports.push({
    type: "v2_global",
    ...(await migrateLegacyV2GlobalFiles(targetDir)),
  });

  reports.push({
    type: "legacy_v1",
    ...(await migrateLegacyV1Data(legacyDataDir, targetDir)),
  });

  const summary = reports.reduce((acc, item) => {
    for (const [k, v] of Object.entries(item)) {
      if (typeof v !== "number") continue;
      acc[k] = (acc[k] || 0) + v;
    }
    return acc;
  }, {});

  console.log(JSON.stringify({ ok: true, dryRun: DRY_RUN, targetDir, legacyDataDir, summary, reports }, null, 2));
}

main().catch((error) => {
  console.error("[migrate-persona-store-v2] failed:", error?.message || String(error));
  process.exitCode = 1;
});
