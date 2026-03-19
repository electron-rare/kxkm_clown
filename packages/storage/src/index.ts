import { Pool } from "pg";
import { z } from "zod";
import type { AuthSession, UserRole } from "@kxkm/core";
import { createId, createIsoTimestamp } from "@kxkm/core";
import type { PersonaRecord, PersonaSourceRecord, PersonaFeedbackRecord, PersonaProposalRecord } from "@kxkm/persona-domain";
import type { NodeGraphRecord, NodeRunRecord, RunStatus } from "@kxkm/node-engine";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DatabaseConfig {
  connectionString: string;
  schema: string;
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return {
    connectionString: env.DATABASE_URL || "postgres://localhost:5432/kxkm_clown_v2",
    schema: env.DATABASE_SCHEMA || "public",
  };
}

export function createPostgresPool(config = loadDatabaseConfig()): Pool {
  return new Pool({
    connectionString: config.connectionString,
  });
}

// ---------------------------------------------------------------------------
// Schema SQL
// ---------------------------------------------------------------------------

export const CORE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const PERSONA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS personas (
  id VARCHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  summary TEXT NOT NULL,
  editable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
`;

export const NODE_ENGINE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS node_graphs (
  id VARCHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS node_runs (
  id VARCHAR(36) PRIMARY KEY,
  graph_id VARCHAR(36) NOT NULL REFERENCES node_graphs(id),
  status TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
`;

export const PERSONA_SUBSTORES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS persona_sources (
  persona_id VARCHAR(36) PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
  subject_name TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  references_ JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS persona_feedback (
  id VARCHAR(36) PRIMARY KEY,
  persona_id VARCHAR(36) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  kind VARCHAR(30) NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_persona_feedback_persona ON persona_feedback(persona_id);

CREATE TABLE IF NOT EXISTS persona_proposals (
  id VARCHAR(36) PRIMARY KEY,
  persona_id VARCHAR(36) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  before_snapshot JSONB,
  after_snapshot JSONB,
  reason TEXT NOT NULL DEFAULT '',
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_persona_proposals_persona ON persona_proposals(persona_id);
`;

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(CORE_SCHEMA_SQL);
    await client.query(PERSONA_SCHEMA_SQL);
    await client.query(PERSONA_SUBSTORES_SCHEMA_SQL);
    await client.query(NODE_ENGINE_SCHEMA_SQL);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Validation logger (lightweight, no external dep)
// ---------------------------------------------------------------------------

const validationLogger = {
  warn(ctx: { repo: string; errors: z.ZodIssue[] }, msg: string) {
    console.warn(`[storage] ${msg}`, JSON.stringify({ repo: ctx.repo, errors: ctx.errors }));
  },
};

// ---------------------------------------------------------------------------
// Zod schemas for DB row validation
// ---------------------------------------------------------------------------

const sessionRowSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.string(),
  created_at: z.coerce.date(),
  expires_at: z.coerce.date(),
});

const personaRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  summary: z.string(),
  editable: z.union([z.boolean(), z.number()]).transform(Boolean),
});

const nodeGraphRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});

const nodeRunRowSchema = z.object({
  id: z.string(),
  graph_id: z.string(),
  status: z.string(),
  created_at: z.union([z.date(), z.string()]),
});

const personaSourceRowSchema = z.object({
  persona_id: z.string(),
  subject_name: z.string(),
  summary: z.string(),
  references_: z.unknown().transform((v) => (Array.isArray(v) ? v : [])),
});

const personaFeedbackRowSchema = z.object({
  id: z.string(),
  persona_id: z.string(),
  kind: z.string(),
  message: z.string(),
  created_at: z.union([z.date(), z.string()]),
});

const personaProposalRowSchema = z.object({
  id: z.string(),
  persona_id: z.string(),
  before_snapshot: z.unknown().nullable(),
  after_snapshot: z.unknown().nullable(),
  reason: z.string(),
  applied: z.union([z.boolean(), z.number()]).transform(Boolean),
  created_at: z.union([z.date(), z.string()]),
});

// ---------------------------------------------------------------------------
// Session input type
// ---------------------------------------------------------------------------

export interface SessionCreateInput {
  username: string;
  role: UserRole;
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Validated row mappers
// ---------------------------------------------------------------------------

function mapSessionRow(row: unknown): AuthSession | null {
  const result = sessionRowSchema.safeParse(row);
  if (!result.success) {
    validationLogger.warn({ repo: "session", errors: result.error.issues }, "Invalid session row");
    return null;
  }
  return {
    id: result.data.id,
    username: result.data.username,
    role: result.data.role as UserRole,
    createdAt: result.data.created_at.toISOString(),
    expiresAt: result.data.expires_at.toISOString(),
  };
}

function mapPersonaRow(row: unknown): PersonaRecord | null {
  const result = personaRowSchema.safeParse(row);
  if (!result.success) {
    validationLogger.warn({ repo: "persona", errors: result.error.issues }, "Invalid persona row");
    return null;
  }
  return {
    id: result.data.id,
    name: result.data.name,
    model: result.data.model,
    summary: result.data.summary,
    editable: result.data.editable,
  };
}

function mapNodeGraphRow(row: unknown): NodeGraphRecord | null {
  const result = nodeGraphRowSchema.safeParse(row);
  if (!result.success) {
    validationLogger.warn({ repo: "nodeGraph", errors: result.error.issues }, "Invalid node_graph row");
    return null;
  }
  return {
    id: result.data.id,
    name: result.data.name,
    description: result.data.description,
  };
}

function mapNodeRunRow(row: unknown): NodeRunRecord | null {
  const result = nodeRunRowSchema.safeParse(row);
  if (!result.success) {
    validationLogger.warn({ repo: "nodeRun", errors: result.error.issues }, "Invalid node_run row");
    return null;
  }
  const ca = result.data.created_at;
  return {
    id: result.data.id,
    graphId: result.data.graph_id,
    status: result.data.status as RunStatus,
    createdAt: ca instanceof Date ? ca.toISOString() : String(ca),
  };
}

function mapPersonaSourceRow(row: unknown): PersonaSourceRecord | null {
  const result = personaSourceRowSchema.safeParse(row);
  if (!result.success) {
    validationLogger.warn({ repo: "personaSource", errors: result.error.issues }, "Invalid persona_source row");
    return null;
  }
  return {
    personaId: result.data.persona_id,
    subjectName: result.data.subject_name,
    summary: result.data.summary,
    references: result.data.references_ as string[],
  };
}

function mapPersonaFeedbackRow(row: unknown): PersonaFeedbackRecord | null {
  const result = personaFeedbackRowSchema.safeParse(row);
  if (!result.success) {
    validationLogger.warn({ repo: "personaFeedback", errors: result.error.issues }, "Invalid persona_feedback row");
    return null;
  }
  const ca = result.data.created_at;
  return {
    id: result.data.id,
    personaId: result.data.persona_id,
    kind: result.data.kind as PersonaFeedbackRecord["kind"],
    message: result.data.message,
    createdAt: ca instanceof Date ? ca.toISOString() : String(ca),
  };
}

function mapPersonaProposalRow(row: unknown): PersonaProposalRecord | null {
  const result = personaProposalRowSchema.safeParse(row);
  if (!result.success) {
    validationLogger.warn({ repo: "personaProposal", errors: result.error.issues }, "Invalid persona_proposal row");
    return null;
  }
  const ca = result.data.created_at;
  return {
    id: result.data.id,
    personaId: result.data.persona_id,
    before: result.data.before_snapshot as PersonaProposalRecord["before"],
    after: result.data.after_snapshot as PersonaProposalRecord["after"],
    reason: result.data.reason,
    applied: result.data.applied,
    createdAt: ca instanceof Date ? ca.toISOString() : String(ca),
  };
}

/** Filter null results from validated row mapping */
function filterValid<T>(rows: unknown[], mapper: (row: unknown) => T | null): T[] {
  const results: T[] = [];
  for (const row of rows) {
    const mapped = mapper(row);
    if (mapped !== null) results.push(mapped);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Session repository
// ---------------------------------------------------------------------------

export function createSessionRepo(pool: Pool) {
  return {
    async create(input: SessionCreateInput): Promise<AuthSession> {
      const id = createId("session");
      const now = createIsoTimestamp();
      const expiresAt = input.expiresAt || createIsoTimestamp(new Date(Date.now() + 3600_000));

      await pool.query(
        `INSERT INTO sessions (id, username, role, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, input.username, input.role, expiresAt, now],
      );

      return { id, username: input.username, role: input.role, createdAt: now, expiresAt };
    },

    async findById(id: string): Promise<AuthSession | null> {
      const result = await pool.query(
        `SELECT id, username, role, created_at, expires_at FROM sessions WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) return null;
      return mapSessionRow(result.rows[0]);
    },

    async deleteById(id: string): Promise<void> {
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
    },

    async deleteExpired(): Promise<number> {
      const result = await pool.query(
        `DELETE FROM sessions WHERE expires_at < NOW()`,
      );
      return result.rowCount ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Persona repository
// ---------------------------------------------------------------------------

export function createPersonaRepo(pool: Pool) {
  return {
    async list(): Promise<PersonaRecord[]> {
      const result = await pool.query(
        `SELECT id, name, model, summary, editable FROM personas ORDER BY name`,
      );
      return filterValid(result.rows, mapPersonaRow);
    },

    async findById(id: string): Promise<PersonaRecord | null> {
      const result = await pool.query(
        `SELECT id, name, model, summary, editable FROM personas WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) return null;
      return mapPersonaRow(result.rows[0]);
    },

    async upsert(persona: PersonaRecord): Promise<PersonaRecord> {
      const result = await pool.query(
        `INSERT INTO personas (id, name, model, summary, editable, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           model = EXCLUDED.model,
           summary = EXCLUDED.summary,
           editable = EXCLUDED.editable,
           updated_at = NOW()
         RETURNING id, name, model, summary, editable`,
        [persona.id, persona.name, persona.model, persona.summary, persona.editable],
      );
      const mapped = mapPersonaRow(result.rows[0]);
      if (!mapped) throw new Error("Persona upsert returned invalid row");
      return mapped;
    },

    async seedCatalog(catalog: PersonaRecord[]): Promise<void> {
      if (catalog.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const persona of catalog) {
          await client.query(
            `INSERT INTO personas (id, name, model, summary, editable, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [persona.id, persona.name, persona.model, persona.summary, persona.editable],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Node Graph repository
// ---------------------------------------------------------------------------

export function createNodeGraphRepo(pool: Pool) {
  return {
    async list(): Promise<NodeGraphRecord[]> {
      const result = await pool.query(
        `SELECT id, name, description FROM node_graphs ORDER BY created_at DESC`,
      );
      return filterValid(result.rows, mapNodeGraphRow);
    },

    async findById(id: string): Promise<NodeGraphRecord | null> {
      const result = await pool.query(
        `SELECT id, name, description FROM node_graphs WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) return null;
      return mapNodeGraphRow(result.rows[0]);
    },

    async create(graph: NodeGraphRecord): Promise<NodeGraphRecord> {
      const result = await pool.query(
        `INSERT INTO node_graphs (id, name, description, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, name, description`,
        [graph.id, graph.name, graph.description],
      );
      const mapped = mapNodeGraphRow(result.rows[0]);
      if (!mapped) throw new Error("NodeGraph create returned invalid row");
      return mapped;
    },

    async update(id: string, patch: Partial<NodeGraphRecord>): Promise<NodeGraphRecord | null> {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (patch.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        values.push(patch.name);
      }
      if (patch.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(patch.description);
      }

      if (setClauses.length === 0) {
        return this.findById(id);
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(id);

      const result = await pool.query(
        `UPDATE node_graphs SET ${setClauses.join(", ")} WHERE id = $${paramIndex}
         RETURNING id, name, description`,
        values,
      );
      if (result.rows.length === 0) return null;
      return mapNodeGraphRow(result.rows[0]);
    },
  };
}

// ---------------------------------------------------------------------------
// Node Run repository
// ---------------------------------------------------------------------------

export function createNodeRunRepo(pool: Pool) {
  return {
    async list(): Promise<NodeRunRecord[]> {
      const result = await pool.query(
        `SELECT id, graph_id, status, created_at FROM node_runs ORDER BY created_at DESC`,
      );
      return filterValid(result.rows, mapNodeRunRow);
    },

    async findById(id: string): Promise<NodeRunRecord | null> {
      const result = await pool.query(
        `SELECT id, graph_id, status, created_at FROM node_runs WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) return null;
      return mapNodeRunRow(result.rows[0]);
    },

    async create(run: NodeRunRecord): Promise<NodeRunRecord> {
      const result = await pool.query(
        `INSERT INTO node_runs (id, graph_id, status, created_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, graph_id, status, created_at`,
        [run.id, run.graphId, run.status, run.createdAt],
      );
      const mapped = mapNodeRunRow(result.rows[0]);
      if (!mapped) throw new Error("NodeRun create returned invalid row");
      return mapped;
    },

    async updateStatus(id: string, status: RunStatus): Promise<void> {
      await pool.query(
        `UPDATE node_runs SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, id],
      );
    },

    async requestCancel(id: string): Promise<void> {
      await pool.query(
        `UPDATE node_runs SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('queued', 'running')`,
        [id],
      );
    },

    async recoverStaleRuns(): Promise<NodeRunRecord[]> {
      const result = await pool.query(
        `UPDATE node_runs SET status = 'queued', updated_at = NOW()
         WHERE status = 'running'
         RETURNING id, graph_id, status, created_at`,
      );
      return filterValid(result.rows, mapNodeRunRow);
    },

    async listByStatus(status: RunStatus, limit = 50): Promise<NodeRunRecord[]> {
      const result = await pool.query(
        `SELECT id, graph_id, status, created_at FROM node_runs WHERE status = $1 ORDER BY created_at ASC LIMIT $2`,
        [status, limit],
      );
      return filterValid(result.rows, mapNodeRunRow);
    },

    async deleteOlderThan(date: string): Promise<number> {
      const result = await pool.query(
        `DELETE FROM node_runs WHERE status IN ('completed', 'failed', 'cancelled') AND created_at < $1`,
        [date],
      );
      return result.rowCount ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Persona Source repository
// ---------------------------------------------------------------------------

export function createPersonaSourceRepo(pool: Pool) {
  return {
    async findByPersonaId(personaId: string): Promise<PersonaSourceRecord | null> {
      const result = await pool.query(
        `SELECT persona_id, subject_name, summary, references_ FROM persona_sources WHERE persona_id = $1`,
        [personaId],
      );
      if (result.rows.length === 0) return null;
      return mapPersonaSourceRow(result.rows[0]);
    },

    async upsert(source: PersonaSourceRecord): Promise<PersonaSourceRecord> {
      const result = await pool.query(
        `INSERT INTO persona_sources (persona_id, subject_name, summary, references_)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (persona_id) DO UPDATE SET
           subject_name = EXCLUDED.subject_name,
           summary = EXCLUDED.summary,
           references_ = EXCLUDED.references_
         RETURNING persona_id, subject_name, summary, references_`,
        [source.personaId, source.subjectName, source.summary, JSON.stringify(source.references)],
      );
      const mapped = mapPersonaSourceRow(result.rows[0]);
      if (!mapped) throw new Error("PersonaSource upsert returned invalid row");
      return mapped;
    },
  };
}

// ---------------------------------------------------------------------------
// Persona Feedback repository
// ---------------------------------------------------------------------------

export function createPersonaFeedbackRepo(pool: Pool) {
  return {
    async listByPersonaId(personaId: string): Promise<PersonaFeedbackRecord[]> {
      const result = await pool.query(
        `SELECT id, persona_id, kind, message, created_at FROM persona_feedback WHERE persona_id = $1 ORDER BY created_at`,
        [personaId],
      );
      return filterValid(result.rows, mapPersonaFeedbackRow);
    },

    async create(record: PersonaFeedbackRecord): Promise<PersonaFeedbackRecord> {
      const result = await pool.query(
        `INSERT INTO persona_feedback (id, persona_id, kind, message, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, persona_id, kind, message, created_at`,
        [record.id, record.personaId, record.kind, record.message, record.createdAt],
      );
      const mapped = mapPersonaFeedbackRow(result.rows[0]);
      if (!mapped) throw new Error("PersonaFeedback create returned invalid row");
      return mapped;
    },
  };
}

// ---------------------------------------------------------------------------
// Persona Proposal repository
// ---------------------------------------------------------------------------

export function createPersonaProposalRepo(pool: Pool) {
  return {
    async listByPersonaId(personaId: string): Promise<PersonaProposalRecord[]> {
      const result = await pool.query(
        `SELECT id, persona_id, before_snapshot, after_snapshot, reason, applied, created_at
         FROM persona_proposals WHERE persona_id = $1 ORDER BY created_at`,
        [personaId],
      );
      return filterValid(result.rows, mapPersonaProposalRow);
    },

    async create(record: PersonaProposalRecord): Promise<PersonaProposalRecord> {
      const result = await pool.query(
        `INSERT INTO persona_proposals (id, persona_id, before_snapshot, after_snapshot, reason, applied, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, persona_id, before_snapshot, after_snapshot, reason, applied, created_at`,
        [
          record.id,
          record.personaId,
          JSON.stringify(record.before),
          JSON.stringify(record.after),
          record.reason,
          record.applied,
          record.createdAt,
        ],
      );
      const mapped = mapPersonaProposalRow(result.rows[0]);
      if (!mapped) throw new Error("PersonaProposal create returned invalid row");
      return mapped;
    },

    async markApplied(id: string): Promise<void> {
      await pool.query(
        `UPDATE persona_proposals SET applied = true WHERE id = $1`,
        [id],
      );
    },
  };
}
