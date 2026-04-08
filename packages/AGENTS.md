# AGENTS.md — packages/

<!-- Parent: ../AGENTS.md -->

8 shared packages in npm workspace. Exported as `@kxkm/*` scope.

## core — Shared Types & Constants (2 TS files)

| File | Purpose |
|------|---------|
| `index.ts` | Persona IDs, channel constants, permission levels, errors |
| `index.test.ts` | Type checks, constant validation |

Core IDs: 33 personas (Pharmacius, Sherlock, Turing, Ikeda, Schaeffer, Merzbow, Pina, etc.). Permissions: read, write, admin.

**Used by**: all packages and apps.

## auth — Authentication & RBAC (2 TS files)

| File | Purpose |
|------|---------|
| `index.ts` | RBAC middleware, session validation, JWT verify, guest mode |
| `index.test.ts` | Auth flow, token expiry, guest access |

Session storage: PostgreSQL (sessionRepo). Guest mode: read-only routes. RBAC: 3 levels (guest, user, admin).

**Used by**: apps/api (middleware), apps/web (session hooks).

## chat-domain — Message & Command Types (2 TS files)

| File | Purpose |
|------|---------|
| `index.ts` | ChatMessage union, Channel, Command registry, slash command definitions |
| `index.test.ts` | Message validation, command parsing |

43 slash commands: /chat, /imagine, /compose, /help, /speed, etc. Message types: text, image, audio, error, system.

**Used by**: apps/api (ws-chat), apps/web (UI).

## persona-domain — Persona Definitions & Memory (4 TS files)

| File | Purpose |
|------|---------|
| `index.ts` | Persona model, memoryMode (auto/explicit/off), corpus[], relations[], DPO pair definitions |
| `editorial.ts` | Editorial pipeline: persona proposal, feedback collection, DPO training triggers |
| `pharmacius.ts` | Pharmacius persona specialization (meta-reflection, composability) |
| `index.test.ts` | Persona validation, memory mode tests |

33 personas with per-persona: memory mode, corpus URLs, related personas (depth-3 relay), voice sample. DPO pair collection: user feedback → training pipeline → Unsloth fine-tuning.

**Used by**: apps/api (ws-chat, persona-runtime), packages/node-engine (training).

## node-engine — DAG Execution & Job Queue (6 TS files)

| File | Purpose |
|------|---------|
| `index.ts` | Node registry, DAG validator, run executor |
| `registry.ts` | 15+ node types: text_generation, image_generation, music_generation, audio_effects, voice_clone, document_extraction, sql_query, etc. |
| `sandbox.ts` | Isolated node execution, timeout, resource limits |
| `training.ts` | Training job: DPO pair collection, Unsloth adapter, registry update |
| `registry.test.ts` | Node type validation |
| `index.test.ts` | DAG execution, queue, run state machine |

GPU-aware queue: submits to `inference-scheduler.ts` for LLM nodes. Training nodes: trigger via worker.

**Used by**: apps/api (routes/node-engine), apps/worker (job executor), packages/storage (run persistence).

## storage — PostgreSQL Persistence (8 TS files)

| File | Purpose |
|------|---------|
| `index.ts` | Repo factory, migration runner |
| `config.test.ts` | DB connection, pool, transaction tests |
| `migration.test.ts` | Schema versioning |
| `session-repo.test.ts` | Session CRUD, expiry cleanup |
| `persona-repo.test.ts` | Persona memory, feedback store |
| `node-engine-repo.test.ts` | Run state, output, logs |
| `test-helpers.ts` | Test DB setup, fixtures |

Repos: SessionRepo (auth), PersonaRepo (memory, DPO feedback), NodeEngineRepo (DAG runs, training jobs). Migrations: auto-run on startup.

**Used by**: apps/api (all routes), apps/worker (job persistence).

## tui — Terminal UI Utilities (3 TS files)

| File | Purpose |
|------|---------|
| `index.ts` | CLI argument parsing, color codes, progress bars, table format |
| `index.test.ts` | Formatter tests |

Used by scripts: health-check.sh, deep-audit.js, ops-tui.sh. Outputs JSON + ANSI colors for logs.

**Used by**: scripts/, ops/ (monitoring).

## ui — Experimental React Components (2 TS files)

| File | Purpose |
|------|---------|
| `index.ts` | Button, Input, Select, Modal, Spinner components (unstyled, Tailwind-ready) |
| `index.test.ts` | Component render tests |

Minimal, reusable. Not currently used in apps/web (which has inline components).

## Package Dependencies

```
core                           (no deps, baseline types)
auth                           → core
chat-domain                    → core
persona-domain                 → core, chat-domain
node-engine                    → core, persona-domain
storage                        → core, auth, chat-domain, persona-domain, node-engine
tui                            → core
ui                             → core
```

## Build & Test

```bash
npm run -w @kxkm/core build
npm run -w @kxkm/auth test
npm run -w @kxkm/chat-domain test
npm run -w @kxkm/persona-domain test
npm run -w @kxkm/node-engine test
npm run -w @kxkm/storage test
npm run -w @kxkm/tui test
npm run -w @kxkm/ui test
```

## Export Pattern

Each package exports:
- TypeScript types (.ts)
- CommonJS build (dist/index.js)
- Type declarations (dist/index.d.ts)

```typescript
import { Persona, PersonaMemoryMode } from '@kxkm/persona-domain';
import { Node, DAGRun } from '@kxkm/node-engine';
import { Session } from '@kxkm/auth';
```
