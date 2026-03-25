import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PersonaFeedbackRecord, PersonaProposalRecord, PersonaSourceRecord } from "@kxkm/persona-domain";
import {
  createLocalPersonaFeedbackRepo,
  createLocalPersonaProposalRepo,
  createLocalPersonaRepo,
  createLocalPersonaSourceRepo,
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
});
