import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
