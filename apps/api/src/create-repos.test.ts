import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PersonaFeedbackRecord, PersonaProposalRecord, PersonaSourceRecord } from "@kxkm/persona-domain";
import {
  createLocalNodeGraphRepo,
  createLocalNodeRunRepo,
  createLocalPersonaFeedbackRepo,
  createLocalPersonaProposalRepo,
  createLocalPersonaRepo,
  createLocalPersonaSourceRepo,
  createLocalSessionRepo,
} from "./create-repos.js";

async function withTempLocalDataDir(run: (dir: string) => Promise<void>): Promise<void> {
  const prev = process.env.KXKM_LOCAL_DATA_DIR;
  const dir = await mkdtemp(path.join(os.tmpdir(), "kxkm-persona-runtime-"));
  process.env.KXKM_LOCAL_DATA_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) delete process.env.KXKM_LOCAL_DATA_DIR;
    else process.env.KXKM_LOCAL_DATA_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

describe("create-repos personas runtime", { concurrency: false }, () => {
  it("migrates legacy personas.json into per-person files on first load", async () => {
    await withTempLocalDataDir(async (dir) => {
      const legacyFile = path.join(dir, "personas.json");
      const legacy = [
        { id: "legacy_ada", name: "Legacy Ada", model: "qwen2.5:14b", summary: "legacy summary", editable: true },
      ];
      await writeFile(legacyFile, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

      const repo = createLocalPersonaRepo();
      const row = await repo.findById("legacy_ada");
      assert.ok(row);
      assert.equal(row.name, "Legacy Ada");

      const perPerson = path.join(dir, "personas", "legacy_ada.json");
      const persisted = JSON.parse(await readFile(perPerson, "utf8"));
      assert.equal(persisted.id, "legacy_ada");
      assert.equal(persisted.summary, "legacy summary");
    });
  });

  it("merges missing legacy personas into an existing per-person store", async () => {
    await withTempLocalDataDir(async (dir) => {
      await mkdir(path.join(dir, "personas"), { recursive: true });
      await writeFile(
        path.join(dir, "personas", "schaeffer.json"),
        `${JSON.stringify({ id: "schaeffer", name: "File Schaeffer", model: "qwen2.5:14b", summary: "per-file", editable: true }, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(dir, "personas.json"),
        `${JSON.stringify([
          { id: "schaeffer", name: "Legacy Schaeffer", model: "qwen2.5:14b", summary: "legacy", editable: true },
          { id: "legacy_batty", name: "Legacy Batty", model: "mistral:7b", summary: "legacy-batty", editable: true },
        ], null, 2)}\n`,
        "utf8",
      );

      const repo = createLocalPersonaRepo();
      const rows = await repo.list();
      assert.equal(rows.length, 2);

      const schaeffer = await repo.findById("schaeffer");
      assert.ok(schaeffer);
      assert.equal(schaeffer.summary, "per-file");

      const batty = await repo.findById("legacy_batty");
      assert.ok(batty);
      assert.equal(batty.summary, "legacy-batty");

      const migrated = JSON.parse(await readFile(path.join(dir, "personas", "legacy_batty.json"), "utf8"));
      assert.equal(migrated.id, "legacy_batty");
    });
  });

  it("retries a blocked legacy persona migration after the filesystem is fixed", async () => {
    await withTempLocalDataDir(async (dir) => {
      const blocker = path.join(dir, "personas");
      const migratedFile = path.join(dir, "personas", "legacy_ada.json");
      await writeFile(
        path.join(dir, "personas.json"),
        `${JSON.stringify([
          { id: "legacy_ada", name: "Legacy Ada", model: "qwen2.5:14b", summary: "legacy summary", editable: true },
        ], null, 2)}\n`,
        "utf8",
      );
      await writeFile(blocker, "blocked", "utf8");

      const repo = createLocalPersonaRepo();
      await assert.rejects(repo.findById("legacy_ada"));
      await rm(blocker, { force: true });

      const row = await repo.findById("legacy_ada");
      assert.ok(row);
      assert.equal(row.name, "Legacy Ada");

      const persisted = JSON.parse(await readFile(migratedFile, "utf8"));
      assert.equal(persisted.id, "legacy_ada");
    });
  });

  it("returns defensive clones from persona and source repos", async () => {
    await withTempLocalDataDir(async () => {
      const personaRepo = createLocalPersonaRepo();
      const sourceRepo = createLocalPersonaSourceRepo();

      const seeded = await personaRepo.findById("schaeffer");
      assert.ok(seeded);
      seeded.summary = "tampered-summary";

      const again = await personaRepo.findById("schaeffer");
      assert.ok(again);
      assert.notEqual(again.summary, "tampered-summary");

      const source: PersonaSourceRecord = {
        personaId: "schaeffer",
        subjectName: "Pierre Schaeffer",
        summary: "source summary",
        references: ["https://example.test/ref"],
      };
      await sourceRepo.upsert(source);
      const sourceRead = await sourceRepo.findByPersonaId("schaeffer");
      assert.ok(sourceRead);
      sourceRead.subjectName = "tampered-subject";

      const sourceAgain = await sourceRepo.findByPersonaId("schaeffer");
      assert.ok(sourceAgain);
      assert.equal(sourceAgain.subjectName, "Pierre Schaeffer");
    });
  });

  it("merges missing legacy persona sources into an existing per-person store", async () => {
    await withTempLocalDataDir(async (dir) => {
      await mkdir(path.join(dir, "persona-sources"), { recursive: true });
      await writeFile(
        path.join(dir, "persona-sources", "schaeffer.json"),
        `${JSON.stringify({
          personaId: "schaeffer",
          subjectName: "File Schaeffer",
          summary: "per-file",
          references: ["https://example.test/file"],
        }, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(dir, "persona-sources.json"),
        `${JSON.stringify({
          schaeffer: {
            personaId: "schaeffer",
            subjectName: "Legacy Schaeffer",
            summary: "legacy",
            references: ["https://example.test/legacy"],
          },
          legacy_batty: {
            personaId: "legacy_batty",
            subjectName: "Legacy Batty",
            summary: "legacy-batty",
            references: ["https://example.test/batty"],
          },
        }, null, 2)}\n`,
        "utf8",
      );

      const repo = createLocalPersonaSourceRepo();
      const schaeffer = await repo.findByPersonaId("schaeffer");
      assert.ok(schaeffer);
      assert.equal(schaeffer.subjectName, "File Schaeffer");

      const batty = await repo.findByPersonaId("legacy_batty");
      assert.ok(batty);
      assert.equal(batty.subjectName, "Legacy Batty");

      const migrated = JSON.parse(await readFile(path.join(dir, "persona-sources", "legacy_batty.json"), "utf8"));
      assert.equal(migrated.personaId, "legacy_batty");
    });
  });

  it("returns immutable snapshots for feedback and proposals lists", async () => {
    await withTempLocalDataDir(async () => {
      const feedbackRepo = createLocalPersonaFeedbackRepo();
      const proposalRepo = createLocalPersonaProposalRepo();

      const feedback: PersonaFeedbackRecord = {
        id: "feedback-1",
        personaId: "schaeffer",
        kind: "chat_signal",
        message: "orig-feedback",
        createdAt: "2026-03-25T00:00:00.000Z",
      };
      await feedbackRepo.create(feedback);

      const list1 = await feedbackRepo.listByPersonaId("schaeffer");
      assert.equal(list1.length, 1);
      list1[0].message = "tampered-feedback";
      list1.push({
        id: "feedback-2",
        personaId: "schaeffer",
        kind: "chat_signal",
        message: "injected",
        createdAt: "2026-03-25T00:01:00.000Z",
      });

      const list2 = await feedbackRepo.listByPersonaId("schaeffer");
      assert.equal(list2.length, 1);
      assert.equal(list2[0].message, "orig-feedback");

      const proposal: PersonaProposalRecord = {
        id: "proposal-1",
        personaId: "schaeffer",
        reason: "test",
        before: { name: "Schaeffer", model: "qwen2.5:14b", summary: "before" },
        after: { name: "Schaeffer", model: "qwen2.5:14b", summary: "after" },
        applied: false,
        createdAt: "2026-03-25T00:00:00.000Z",
      };
      await proposalRepo.create(proposal);

      const proposals1 = await proposalRepo.listByPersonaId("schaeffer");
      assert.equal(proposals1.length, 1);
      proposals1[0].applied = true;
      proposals1.push({
        ...proposal,
        id: "proposal-2",
      });

      const proposals2 = await proposalRepo.listByPersonaId("schaeffer");
      assert.equal(proposals2.length, 1);
      assert.equal(proposals2[0].applied, false);
    });
  });

  it("merges missing legacy feedback and proposals into an existing per-person store", async () => {
    await withTempLocalDataDir(async (dir) => {
      await mkdir(path.join(dir, "persona-feedback"), { recursive: true });
      await mkdir(path.join(dir, "persona-proposals"), { recursive: true });
      await writeFile(
        path.join(dir, "persona-feedback", "schaeffer.json"),
        `${JSON.stringify([
          {
            id: "feedback-file-1",
            personaId: "schaeffer",
            kind: "chat_signal",
            message: "per-file-feedback",
            createdAt: "2026-03-25T00:00:00.000Z",
          },
        ], null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(dir, "persona-proposals", "schaeffer.json"),
        `${JSON.stringify([
          {
            id: "proposal-file-1",
            personaId: "schaeffer",
            reason: "per-file",
            before: { name: "Schaeffer", model: "qwen2.5:14b", summary: "before-file" },
            after: { name: "Schaeffer", model: "qwen2.5:14b", summary: "after-file" },
            applied: false,
            createdAt: "2026-03-25T00:00:00.000Z",
          },
        ], null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(dir, "persona-feedback.json"),
        `${JSON.stringify([
          {
            id: "feedback-file-1",
            personaId: "schaeffer",
            kind: "chat_signal",
            message: "legacy-duplicate",
            createdAt: "2026-03-25T00:00:00.000Z",
          },
          {
            id: "feedback-legacy-2",
            personaId: "legacy_batty",
            kind: "chat_signal",
            message: "legacy-feedback",
            createdAt: "2026-03-25T00:01:00.000Z",
          },
        ], null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(dir, "persona-proposals.json"),
        `${JSON.stringify([
          {
            id: "proposal-file-1",
            personaId: "schaeffer",
            reason: "legacy-duplicate",
            before: { name: "Schaeffer", model: "qwen2.5:14b", summary: "before-legacy" },
            after: { name: "Schaeffer", model: "qwen2.5:14b", summary: "after-legacy" },
            applied: false,
            createdAt: "2026-03-25T00:00:00.000Z",
          },
          {
            id: "proposal-legacy-2",
            personaId: "legacy_batty",
            reason: "legacy",
            before: { name: "Batty", model: "mistral:7b", summary: "before-batty" },
            after: { name: "Batty", model: "mistral:7b", summary: "after-batty" },
            applied: false,
            createdAt: "2026-03-25T00:01:00.000Z",
          },
        ], null, 2)}\n`,
        "utf8",
      );

      const feedbackRepo = createLocalPersonaFeedbackRepo();
      const proposalRepo = createLocalPersonaProposalRepo();

      const schaefferFeedback = await feedbackRepo.listByPersonaId("schaeffer");
      assert.equal(schaefferFeedback.length, 1);
      assert.equal(schaefferFeedback[0].message, "per-file-feedback");

      const battyFeedback = await feedbackRepo.listByPersonaId("legacy_batty");
      assert.equal(battyFeedback.length, 1);
      assert.equal(battyFeedback[0].id, "feedback-legacy-2");

      const schaefferProposals = await proposalRepo.listByPersonaId("schaeffer");
      assert.equal(schaefferProposals.length, 1);
      assert.equal(schaefferProposals[0].reason, "per-file");

      const battyProposals = await proposalRepo.listByPersonaId("legacy_batty");
      assert.equal(battyProposals.length, 1);
      assert.equal(battyProposals[0].id, "proposal-legacy-2");

      const migratedFeedback = JSON.parse(await readFile(path.join(dir, "persona-feedback", "legacy_batty.json"), "utf8"));
      assert.equal(migratedFeedback.length, 1);
      assert.equal(migratedFeedback[0].id, "feedback-legacy-2");

      const migratedProposals = JSON.parse(await readFile(path.join(dir, "persona-proposals", "legacy_batty.json"), "utf8"));
      assert.equal(migratedProposals.length, 1);
      assert.equal(migratedProposals[0].id, "proposal-legacy-2");
    });
  });

  it("returns defensive clones from session, graph and run repos", async () => {
    const sessionRepo = createLocalSessionRepo();
    const graphRepo = createLocalNodeGraphRepo();
    const runRepo = createLocalNodeRunRepo();

    const session = await sessionRepo.create({ username: "alice", role: "admin" });
    session.username = "tampered";

    const storedSession = await sessionRepo.findById(session.id);
    assert.ok(storedSession);
    assert.equal(storedSession.username, "alice");

    await graphRepo.create({ id: "graph-1", name: "Graph 1", description: "baseline" });
    const graphs1 = await graphRepo.list();
    const graph1 = graphs1.find((entry) => entry.id === "graph-1");
    assert.ok(graph1);
    graph1.name = "tampered-graph";

    const graph2 = await graphRepo.findById("graph-1");
    assert.ok(graph2);
    assert.equal(graph2.name, "Graph 1");

    await runRepo.create({
      id: "run-1",
      graphId: "graph-1",
      status: "queued",
      createdAt: "2026-03-25T00:00:00.000Z",
    });
    const runs1 = await runRepo.list();
    assert.equal(runs1.length, 1);
    runs1[0].status = "failed";

    const run2 = await runRepo.findById("run-1");
    assert.ok(run2);
    assert.equal(run2.status, "queued");
  });
});
