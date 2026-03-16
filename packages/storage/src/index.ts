import { Pool } from "pg";
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
// Session input type
// ---------------------------------------------------------------------------

export interface SessionCreateInput {
  username: string;
  role: UserRole;
  expiresAt?: string;
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
      const row = result.rows[0];
      return {
        id: row.id,
        username: row.username,
        role: row.role as UserRole,
        createdAt: (row.created_at as Date).toISOString(),
        expiresAt: (row.expires_at as Date).toISOString(),
      };
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
      return result.rows.map(rowToPersona);
    },

    async findById(id: string): Promise<PersonaRecord | null> {
      const result = await pool.query(
        `SELECT id, name, model, summary, editable FROM personas WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) return null;
      return rowToPersona(result.rows[0]);
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
      return rowToPersona(result.rows[0]);
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

function rowToPersona(row: Record<string, unknown>): PersonaRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    model: row.model as string,
    summary: row.summary as string,
    editable: Boolean(row.editable),
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
      return result.rows.map(rowToNodeGraph);
    },

    async findById(id: string): Promise<NodeGraphRecord | null> {
      const result = await pool.query(
        `SELECT id, name, description FROM node_graphs WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) return null;
      return rowToNodeGraph(result.rows[0]);
    },

    async create(graph: NodeGraphRecord): Promise<NodeGraphRecord> {
      const result = await pool.query(
        `INSERT INTO node_graphs (id, name, description, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, name, description`,
        [graph.id, graph.name, graph.description],
      );
      return rowToNodeGraph(result.rows[0]);
    },

    async update(id: string, patch: Partial<NodeGraphRecord>): Promise<NodeGraphRecord | null> {
      // Build SET clause dynamically from provided fields
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
      return rowToNodeGraph(result.rows[0]);
    },
  };
}

function rowToNodeGraph(row: Record<string, unknown>): NodeGraphRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
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
      return result.rows.map(rowToNodeRun);
    },

    async findById(id: string): Promise<NodeRunRecord | null> {
      const result = await pool.query(
        `SELECT id, graph_id, status, created_at FROM node_runs WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) return null;
      return rowToNodeRun(result.rows[0]);
    },

    async create(run: NodeRunRecord): Promise<NodeRunRecord> {
      const result = await pool.query(
        `INSERT INTO node_runs (id, graph_id, status, created_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, graph_id, status, created_at`,
        [run.id, run.graphId, run.status, run.createdAt],
      );
      return rowToNodeRun(result.rows[0]);
    },

    async updateStatus(id: string, status: RunStatus): Promise<void> {
      await pool.query(
        `UPDATE node_runs SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, id],
      );
    },

    /** Mark a run as cancel-requested (worker checks this during execution) */
    async requestCancel(id: string): Promise<void> {
      await pool.query(
        `UPDATE node_runs SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('queued', 'running')`,
        [id],
      );
    },

    /** Recover runs that were running when the worker crashed → re-queue them */
    async recoverStaleRuns(): Promise<NodeRunRecord[]> {
      const result = await pool.query(
        `UPDATE node_runs SET status = 'queued', updated_at = NOW()
         WHERE status = 'running'
         RETURNING id, graph_id, status, created_at`,
      );
      return result.rows.map(rowToNodeRun);
    },

    /** List runs by status */
    async listByStatus(status: RunStatus, limit = 50): Promise<NodeRunRecord[]> {
      const result = await pool.query(
        `SELECT id, graph_id, status, created_at FROM node_runs WHERE status = $1 ORDER BY created_at ASC LIMIT $2`,
        [status, limit],
      );
      return result.rows.map(rowToNodeRun);
    },

    /** Delete completed/failed/cancelled runs older than the given ISO date */
    async deleteOlderThan(date: string): Promise<number> {
      const result = await pool.query(
        `DELETE FROM node_runs WHERE status IN ('completed', 'failed', 'cancelled') AND created_at < $1`,
        [date],
      );
      return result.rowCount ?? 0;
    },
  };
}

function rowToNodeRun(row: Record<string, unknown>): NodeRunRecord {
  return {
    id: row.id as string,
    graphId: row.graph_id as string,
    status: row.status as RunStatus,
    createdAt: (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)),
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
      return rowToPersonaSource(result.rows[0]);
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
      return rowToPersonaSource(result.rows[0]);
    },
  };
}

function rowToPersonaSource(row: Record<string, unknown>): PersonaSourceRecord {
  return {
    personaId: row.persona_id as string,
    subjectName: row.subject_name as string,
    summary: row.summary as string,
    references: (row.references_ as string[]) || [],
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
      return result.rows.map(rowToPersonaFeedback);
    },

    async create(record: PersonaFeedbackRecord): Promise<PersonaFeedbackRecord> {
      const result = await pool.query(
        `INSERT INTO persona_feedback (id, persona_id, kind, message, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, persona_id, kind, message, created_at`,
        [record.id, record.personaId, record.kind, record.message, record.createdAt],
      );
      return rowToPersonaFeedback(result.rows[0]);
    },
  };
}

function rowToPersonaFeedback(row: Record<string, unknown>): PersonaFeedbackRecord {
  return {
    id: row.id as string,
    personaId: row.persona_id as string,
    kind: row.kind as PersonaFeedbackRecord["kind"],
    message: row.message as string,
    createdAt: (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)),
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
      return result.rows.map(rowToPersonaProposal);
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
      return rowToPersonaProposal(result.rows[0]);
    },

    async markApplied(id: string): Promise<void> {
      await pool.query(
        `UPDATE persona_proposals SET applied = true WHERE id = $1`,
        [id],
      );
    },
  };
}

function rowToPersonaProposal(row: Record<string, unknown>): PersonaProposalRecord {
  return {
    id: row.id as string,
    personaId: row.persona_id as string,
    before: row.before_snapshot as PersonaProposalRecord["before"],
    after: row.after_snapshot as PersonaProposalRecord["after"],
    reason: row.reason as string,
    applied: Boolean(row.applied),
    createdAt: (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)),
  };
}
