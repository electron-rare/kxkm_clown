import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  clearPersonaMemoryCache,
  loadPersonaMemory,
  loadPersonaMemoryGlobal,
  resetPersonaMemory,
  savePersonaMemory,
} from "./persona-memory-store.js";
import { normalizePersonaMemoryPolicy } from "./persona-memory-policy.js";
import type { PersonaMemory } from "./chat-types.js";

describe("persona-memory-store", () => {
  let tmpRoot = "";
  let localDir = "";
  let legacyDir = "";

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "kxkm-persona-memory-"));
    localDir = path.join(tmpRoot, "v2-local");
    legacyDir = path.join(tmpRoot, "legacy-persona-memory");
    process.env.KXKM_LOCAL_DATA_DIR = localDir;
    process.env.KXKM_PERSONA_MEMORY_LEGACY_DIR = legacyDir;
    clearPersonaMemoryCache();
  });

  afterEach(async () => {
    clearPersonaMemoryCache();
    delete process.env.KXKM_LOCAL_DATA_DIR;
    delete process.env.KXKM_PERSONA_MEMORY_LEGACY_DIR;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("migrates a legacy memory file into the v2-local per-persona store", async () => {
    const legacyFile = path.join(legacyDir, "Schaeffer.json");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(legacyFile, JSON.stringify({
      nick: "Schaeffer",
      facts: ["Utilisateur aime la musique concrete", "Projet Arduino en cours"],
      summary: "Discussion electroacoustique recente",
      lastUpdated: "2026-03-20T10:00:00.000Z",
    }));

    const memory = await loadPersonaMemory("schaeffer", "_anonymous", "Schaeffer");
    assert.equal(memory.nick, "Schaeffer");
    assert.equal(memory.personaId, "schaeffer");
    assert.deepEqual(memory.facts, [
      "Utilisateur aime la musique concrete",
      "Projet Arduino en cours",
    ]);
    assert.equal(memory.summary, "Discussion electroacoustique recente");
    assert.equal(memory.version, 2);

    const v2Record = JSON.parse(await readFile(path.join(localDir, "persona-memory", "schaeffer", "_anonymous.json"), "utf8")) as {
      version: number;
      personaId: string;
      personaNick: string;
      compat: { facts: string[]; summary: string };
    };
    assert.equal(v2Record.version, 2);
    assert.equal(v2Record.personaId, "schaeffer");
    assert.equal(v2Record.personaNick, "Schaeffer");
    assert.deepEqual(v2Record.compat.facts, memory.facts);
    assert.equal(v2Record.compat.summary, memory.summary);
  });

  it("writes v2 memory records and mirrors the compat legacy file", async () => {
    const memory: PersonaMemory = {
      personaId: "schaeffer",
      nick: "Schaeffer",
      facts: ["Ecoute attentive", "Analyse spectrale"],
      summary: "Conversation recente sur la matiere sonore",
      lastUpdated: "",
      version: 2,
      workingMemory: {
        facts: ["Ecoute attentive", "Analyse spectrale"],
        summary: "Conversation recente sur la matiere sonore",
        lastSourceMessages: ["message 1", "message 2"],
      },
      archivalMemory: {
        facts: [],
        summaries: [],
      },
    };

    await savePersonaMemory(memory, "_anonymous");

    const v2Record = JSON.parse(await readFile(path.join(localDir, "persona-memory", "schaeffer", "_anonymous.json"), "utf8")) as {
      workingMemory: { facts: string[]; lastSourceMessages: string[] };
      archivalMemory: { facts: Array<{ text: string }>; summaries: Array<{ text: string }> };
      compat: { facts: string[]; summary: string };
    };
    const legacyRecord = JSON.parse(await readFile(path.join(legacyDir, "Schaeffer.json"), "utf8")) as PersonaMemory;

    assert.deepEqual(v2Record.workingMemory.facts, ["Ecoute attentive", "Analyse spectrale"]);
    assert.deepEqual(v2Record.workingMemory.lastSourceMessages, ["message 1", "message 2"]);
    assert.equal(v2Record.archivalMemory.facts.length, 2);
    assert.equal(v2Record.archivalMemory.summaries.length, 1);
    assert.deepEqual(legacyRecord.facts, ["Ecoute attentive", "Analyse spectrale"]);
    assert.equal(legacyRecord.summary, "Conversation recente sur la matiere sonore");
    assert.equal(v2Record.compat.summary, legacyRecord.summary);
  });

  it("can resolve an existing v2 record by nick when personaId is not provided", async () => {
    await savePersonaMemory({
      personaId: "schaeffer",
      nick: "Schaeffer",
      facts: ["Memoire conservee"],
      summary: "Resume stable",
      lastUpdated: "",
    }, "_anonymous");
    clearPersonaMemoryCache();

    const memory = await loadPersonaMemory("Schaeffer", "_anonymous");
    assert.equal(memory.personaId, "schaeffer");
    assert.deepEqual(memory.facts, ["Memoire conservee"]);
    assert.equal(memory.summary, "Resume stable");
  });

  it("creates a fresh per-user memory with the canonical persona nick", async () => {
    const memory = await loadPersonaMemory("schaeffer", "alice", "Schaeffer");

    assert.equal(memory.nick, "Schaeffer");
    assert.equal(memory.personaId, "schaeffer");
    assert.deepEqual(memory.facts, []);
    assert.equal(memory.summary, "");
  });

  it("resetPersonaMemory empties both the v2 and compat legacy projections", async () => {
    await savePersonaMemory({
      personaId: "schaeffer",
      nick: "Schaeffer",
      facts: ["Ancien fait"],
      summary: "Ancien resume",
      lastUpdated: "",
    }, "_anonymous");

    const reset = await resetPersonaMemory("schaeffer", "_anonymous");
    assert.deepEqual(reset.facts, []);
    assert.equal(reset.summary, "");
    assert.equal(reset.personaId, "schaeffer");

    const v2Record = JSON.parse(await readFile(path.join(localDir, "persona-memory", "schaeffer", "_anonymous.json"), "utf8")) as {
      compat: { facts: string[]; summary: string };
    };
    const legacyRecord = JSON.parse(await readFile(path.join(legacyDir, "Schaeffer.json"), "utf8")) as PersonaMemory;

    assert.deepEqual(v2Record.compat.facts, []);
    assert.equal(v2Record.compat.summary, "");
    assert.deepEqual(legacyRecord.facts, []);
    assert.equal(legacyRecord.summary, "");
  });

  it("aggregates per-user records in the global memory view", async () => {
    await savePersonaMemory({
      personaId: "schaeffer",
      nick: "Schaeffer",
      facts: ["Alice aime Xenakis"],
      summary: "Alice parle de musique concrete",
      lastUpdated: "",
      version: 2,
      workingMemory: {
        facts: ["Alice aime Xenakis"],
        summary: "Alice parle de musique concrete",
        lastSourceMessages: ["alice-1"],
      },
      archivalMemory: {
        facts: [{ text: "Alice aime Xenakis", firstSeenAt: "2026-03-20T10:00:00.000Z", lastSeenAt: "2026-03-20T10:00:00.000Z", source: "chat" }],
        summaries: [{ text: "Alice parle de musique concrete", createdAt: "2026-03-20T10:00:00.000Z" }],
      },
    }, "alice");

    await savePersonaMemory({
      personaId: "schaeffer",
      nick: "Schaeffer",
      facts: ["Bob construit un synth modulaire", "Alice aime Xenakis"],
      summary: "Bob parle de synthese modulaire",
      lastUpdated: "",
      version: 2,
      workingMemory: {
        facts: ["Bob construit un synth modulaire", "Alice aime Xenakis"],
        summary: "Bob parle de synthese modulaire",
        lastSourceMessages: ["bob-1"],
      },
      archivalMemory: {
        facts: [{ text: "Bob construit un synth modulaire", firstSeenAt: "2026-03-21T10:00:00.000Z", lastSeenAt: "2026-03-21T10:00:00.000Z", source: "chat" }],
        summaries: [{ text: "Bob parle de synthese modulaire", createdAt: "2026-03-21T10:00:00.000Z" }],
      },
    }, "bob");

    const globalMemory = await loadPersonaMemoryGlobal({ personaId: "schaeffer", nick: "Schaeffer" });

    assert.equal(globalMemory.nick, "Schaeffer");
    assert.equal(globalMemory.personaId, "schaeffer");
    assert.deepEqual(globalMemory.facts, ["Alice aime Xenakis", "Bob construit un synth modulaire"]);
    assert.equal(globalMemory.summary, "Bob parle de synthese modulaire");
    assert.equal(globalMemory.lastUpdated.length > 0, true);
    assert.deepEqual(globalMemory.workingMemory?.facts, ["Alice aime Xenakis", "Bob construit un synth modulaire"]);
    assert.equal(globalMemory.archivalMemory?.facts.length, 2);
    assert.equal(globalMemory.archivalMemory?.summaries.length, 2);
  });

  it("applies configurable pruning limits when persisting v2 memory", async () => {
    const policy = normalizePersonaMemoryPolicy({
      pruning: {
        workingFactsLimit: 3,
        workingSourceMessagesLimit: 2,
        archivalFactsLimit: 4,
        archivalSummariesLimit: 2,
        compatFactsLimit: 2,
      },
    });

    await savePersonaMemory({
      personaId: "schaeffer",
      nick: "Schaeffer",
      facts: ["fait 1", "fait 2", "fait 3", "fait 4"],
      summary: "resume courant",
      lastUpdated: "",
      version: 2,
      workingMemory: {
        facts: ["fait 1", "fait 2", "fait 3", "fait 4"],
        summary: "resume courant",
        lastSourceMessages: ["message 1", "message 2", "message 3"],
      },
      archivalMemory: {
        facts: [
          { text: "archive 1", firstSeenAt: "2026-03-20T10:00:00.000Z", lastSeenAt: "2026-03-20T10:00:00.000Z", source: "chat" },
          { text: "archive 2", firstSeenAt: "2026-03-20T10:00:00.000Z", lastSeenAt: "2026-03-20T10:00:00.000Z", source: "chat" },
          { text: "archive 3", firstSeenAt: "2026-03-20T10:00:00.000Z", lastSeenAt: "2026-03-20T10:00:00.000Z", source: "chat" },
        ],
        summaries: [
          { text: "resume archive 1", createdAt: "2026-03-20T10:00:00.000Z" },
          { text: "resume archive 2", createdAt: "2026-03-21T10:00:00.000Z" },
        ],
      },
    }, "_anonymous", policy);

    const v2Record = JSON.parse(await readFile(path.join(localDir, "persona-memory", "schaeffer", "_anonymous.json"), "utf8")) as {
      workingMemory: { facts: string[]; lastSourceMessages: string[] };
      archivalMemory: { facts: Array<{ text: string }>; summaries: Array<{ text: string }> };
      compat: { facts: string[] };
    };

    assert.deepEqual(v2Record.workingMemory.facts, ["fait 2", "fait 3", "fait 4"]);
    assert.deepEqual(v2Record.workingMemory.lastSourceMessages, ["message 2", "message 3"]);
    assert.equal(v2Record.archivalMemory.facts.length, 4);
    assert.equal(v2Record.archivalMemory.summaries.length, 2);
    assert.deepEqual(v2Record.compat.facts, ["fait 3", "fait 4"]);
  });
});
