import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response, type NextFunction } from "express";
import {
  asApiData,
  createId,
  type AuthSession,
  type Permission,
} from "@kxkm/core";
import {
  createFeedback,
  createProposal,
  type PersonaFeedbackRecord,
  type PersonaProposalRecord,
  type PersonaRecord,
  type PersonaSourceRecord,
} from "@kxkm/persona-domain";
import { resolveVoiceSamplePath, resolveVoiceSamplesRoot } from "../voice-samples.js";

interface SessionRequest extends Request {
  session?: AuthSession;
}

type PersonaRepo = {
  list(): Promise<PersonaRecord[]>;
  findById(id: string): Promise<PersonaRecord | null>;
  upsert(persona: PersonaRecord): Promise<PersonaRecord>;
};

type SourceRepo = {
  findByPersonaId(personaId: string): Promise<PersonaSourceRecord | null>;
  upsert(source: PersonaSourceRecord): Promise<PersonaSourceRecord>;
};

type FeedbackRepo = {
  listByPersonaId(personaId: string): Promise<PersonaFeedbackRecord[]>;
  create(record: PersonaFeedbackRecord): Promise<PersonaFeedbackRecord>;
};

type ProposalRepo = {
  listByPersonaId(personaId: string): Promise<PersonaProposalRecord[]>;
  create(record: PersonaProposalRecord): Promise<PersonaProposalRecord>;
  markApplied(id: string): Promise<void>;
};

interface PersonaRouteDeps {
  personaRepo: PersonaRepo;
  sourceRepo: SourceRepo;
  feedbackRepo: FeedbackRepo;
  proposalRepo: ProposalRepo;
  requireSession: (req: SessionRequest, res: Response, next: NextFunction) => void;
  requirePermission: (permission: Permission) => (req: SessionRequest, res: Response, next: NextFunction) => void;
  readRouteParam: (value: string | string[] | undefined) => string;
}

function defaultPersonaSource(personaId: string, personaName: string): PersonaSourceRecord {
  return {
    personaId,
    subjectName: personaName || personaId,
    summary: "Aucune source structuree pour le moment.",
    references: [],
  };
}

export function createPersonaRoutes(deps: PersonaRouteDeps): Router {
  const {
    personaRepo,
    sourceRepo,
    feedbackRepo,
    proposalRepo,
    requireSession,
    requirePermission,
    readRouteParam,
  } = deps;

  const router = Router();

  router.get("/api/personas", requireSession, async (_req, res) => {
    const list = await personaRepo.list();
    res.json(asApiData(list));
  });

  router.get("/api/personas/:id", requireSession, async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }
    res.json(asApiData(persona));
  });

  router.post("/api/admin/personas", requirePermission("persona:write"), async (req: SessionRequest, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, error: "name_required" });
      return;
    }
    const persona: PersonaRecord = {
      id: createId("persona"),
      name,
      model: String(req.body?.model || "qwen3:8b"),
      summary: String(req.body?.summary || ""),
      editable: true,
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : true,
    };
    await personaRepo.upsert(persona);

    await feedbackRepo.create(
      createFeedback(persona.id, "admin_edit", `Persona creee par ${req.session?.username || "unknown"}`),
    );

    res.status(201).json(asApiData(persona));
  });

  router.put("/api/admin/personas/:id", requirePermission("persona:write"), async (req: SessionRequest, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }

    persona.name = String(req.body?.name || persona.name);
    persona.model = String(req.body?.model || persona.model);
    persona.summary = String(req.body?.summary || persona.summary);
    if (req.body?.enabled !== undefined) {
      (persona as unknown as Record<string, unknown>).enabled = Boolean(req.body.enabled);
    }

    await personaRepo.upsert(persona);

    await feedbackRepo.create(
      createFeedback(persona.id, "admin_edit", `Persona editee par ${req.session?.username || "unknown"}`),
    );

    res.json(asApiData(persona));
  });

  router.post("/api/admin/personas/:id/toggle", requirePermission("persona:write"), async (req: SessionRequest, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }

    const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !(persona as unknown as { enabled?: boolean }).enabled;
    (persona as unknown as Record<string, unknown>).enabled = enabled;
    await personaRepo.upsert(persona);

    await feedbackRepo.create(
      createFeedback(persona.id, "admin_edit", `Persona ${enabled ? "activee" : "desactivee"} par ${req.session?.username || "unknown"}`),
    );

    res.json(asApiData(persona));
  });

  router.get("/api/admin/personas/:id/source", requirePermission("persona:read"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    const source = await sourceRepo.findByPersonaId(personaId);
    res.json(asApiData(source || defaultPersonaSource(personaId, persona?.name || personaId)));
  });

  router.put("/api/admin/personas/:id/source", requirePermission("persona:write"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const source: PersonaSourceRecord = {
      personaId,
      subjectName: String(req.body?.subjectName || personaId),
      summary: String(req.body?.summary || ""),
      references: Array.isArray(req.body?.references) ? req.body.references.map(String) : [],
    };
    const saved = await sourceRepo.upsert(source);
    res.json(asApiData(saved));
  });

  router.get("/api/admin/personas/:id/feedback", requirePermission("persona:read"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const list = await feedbackRepo.listByPersonaId(personaId);
    res.json(asApiData(list));
  });

  router.get("/api/admin/personas/:id/proposals", requirePermission("persona:read"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const list = await proposalRepo.listByPersonaId(personaId);
    res.json(asApiData(list));
  });

  router.post("/api/admin/personas/:id/reinforce", requirePermission("persona:write"), async (req: SessionRequest, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }

    const existingFeedback = await feedbackRepo.listByPersonaId(persona.id);
    const suffix = existingFeedback.length ? " affinee par feedback" : " calibree par source";
    const after = {
      name: String(req.body?.name || persona.name),
      model: String(req.body?.model || persona.model),
      summary: String(req.body?.summary || `${persona.summary}${suffix}`),
    };
    const apply = Boolean(req.body?.apply);
    const proposal = createProposal(persona, after, "reinforce_v2", apply);

    if (apply) {
      persona.name = after.name;
      persona.model = after.model;
      persona.summary = after.summary;
      await personaRepo.upsert(persona);
    }

    const saved = await proposalRepo.create(proposal);
    res.json(asApiData(saved));
  });

  router.post("/api/admin/personas/:id/revert", requirePermission("persona:write"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    const personaProposals = await proposalRepo.listByPersonaId(personaId);
    const lastApplied = [...personaProposals].reverse().find((proposal) => proposal.applied);

    if (!persona || !lastApplied) {
      res.status(404).json({ ok: false, error: "proposal_not_found" });
      return;
    }

    persona.name = lastApplied.before.name;
    persona.model = lastApplied.before.model;
    persona.summary = lastApplied.before.summary;
    await personaRepo.upsert(persona);

    res.json(asApiData(persona));
  });

  // Voice sample upload for XTTS-v2 cloning
  router.post("/api/admin/personas/:id/voice-sample", requirePermission("persona:write"), async (req: SessionRequest, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }

    const audioB64 = req.body?.audio as string | undefined;
    if (!audioB64 || typeof audioB64 !== "string") {
      res.status(400).json({ ok: false, error: "audio_required (base64 field 'audio')" });
      return;
    }

    // Decode and validate size (max 10 MB)
    const buffer = Buffer.from(audioB64, "base64");
    if (buffer.length > 10 * 1024 * 1024) {
      res.status(400).json({ ok: false, error: "file_too_large (max 10 MB)" });
      return;
    }

    const voiceSamplesDir = resolveVoiceSamplesRoot();
    await mkdir(voiceSamplesDir, { recursive: true });

    const samplePath = resolveVoiceSamplePath(persona.name, voiceSamplesDir);
    if (!samplePath) {
      res.status(400).json({ ok: false, error: "invalid_persona_name" });
      return;
    }

    await writeFile(samplePath, buffer);

    res.json({ ok: true, data: { personaId, samplePath: path.relative(process.cwd(), samplePath), size: buffer.length } });
  });

  router.delete("/api/admin/personas/:id/voice-sample", requirePermission("persona:write"), async (req: SessionRequest, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }

    const voiceSamplesDir2 = resolveVoiceSamplesRoot();
    const samplePath = resolveVoiceSamplePath(persona.name, voiceSamplesDir2);
    if (!samplePath) {
      res.status(400).json({ ok: false, error: "invalid_persona_name" });
      return;
    }

    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(samplePath);
      res.json({ ok: true, data: { deleted: true } });
    } catch {
      res.status(404).json({ ok: false, error: "sample_not_found" });
    }
  });

  router.get("/api/admin/personas/:id/voice-sample", requirePermission("persona:read"), async (req, res) => {
    const personaId = readRouteParam(req.params.id);
    const persona = await personaRepo.findById(personaId);
    if (!persona) {
      res.status(404).json({ ok: false, error: "persona_not_found" });
      return;
    }

    const voiceSamplesDir3 = resolveVoiceSamplesRoot();
    const samplePath2 = resolveVoiceSamplePath(persona.name, voiceSamplesDir3);
    if (!samplePath2) {
      res.json({ ok: true, data: { hasVoiceSample: false } });
      return;
    }

    try {
      await stat(samplePath2);
      res.json({ ok: true, data: { hasVoiceSample: true, samplePath: path.relative(process.cwd(), samplePath2) } });
    } catch {
      res.json({ ok: true, data: { hasVoiceSample: false } });
    }
  });

  return router;
}
