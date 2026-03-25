import logger from "./logger.js";
import {
  loadDatabaseConfig,
  createPostgresPool,
  runMigrations,
  createSessionRepo,
  createPersonaRepo,
  createNodeGraphRepo,
  createNodeRunRepo,
  createPersonaSourceRepo,
  createPersonaFeedbackRepo,
  createPersonaProposalRepo,
} from "@kxkm/storage";
import { PERSONA_SEED_CATALOG, clonePersona, type PersonaRecord } from "@kxkm/persona-domain";

interface MemoryFactories<SessionRepo, PersonaRepo, GraphRepo, RunRepo, SourceRepo, FeedbackRepo, ProposalRepo> {
  createSessionRepo: () => SessionRepo;
  createPersonaRepo: () => PersonaRepo;
  createGraphRepo: () => GraphRepo;
  createRunRepo: () => RunRepo;
  createSourceRepo: () => SourceRepo;
  createFeedbackRepo: () => FeedbackRepo;
  createProposalRepo: () => ProposalRepo;
}

interface SeedablePersonaRepo {
  seedCatalog(catalog: PersonaRecord[]): Promise<void>;
}

export type StorageMode = "postgres" | "local";

export async function bootstrapRepositories<
  SessionRepo,
  PersonaRepo extends SeedablePersonaRepo,
  GraphRepo,
  RunRepo,
  SourceRepo,
  FeedbackRepo,
  ProposalRepo,
>(
  factories: MemoryFactories<SessionRepo, PersonaRepo, GraphRepo, RunRepo, SourceRepo, FeedbackRepo, ProposalRepo>,
): Promise<{
  sessionRepo: SessionRepo;
  personaRepo: PersonaRepo;
  graphRepo: GraphRepo;
  runRepo: RunRepo;
  sourceRepo: SourceRepo;
  feedbackRepo: FeedbackRepo;
  proposalRepo: ProposalRepo;
  storageMode: StorageMode;
}> {
  const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
  if (!process.env.DATABASE_URL && isProduction) {
    throw new Error("DATABASE_URL is required when NODE_ENV=production");
  }

  if (process.env.DATABASE_URL) {
    const dbConfig = loadDatabaseConfig();
    const pool = createPostgresPool(dbConfig);
    await runMigrations(pool);

    const sessionRepo = createSessionRepo(pool) as SessionRepo;
    const personaRepo = createPersonaRepo(pool) as unknown as PersonaRepo;
    const graphRepo = createNodeGraphRepo(pool) as GraphRepo;
    const runRepo = createNodeRunRepo(pool) as RunRepo;
    const sourceRepo = createPersonaSourceRepo(pool) as SourceRepo;
    const feedbackRepo = createPersonaFeedbackRepo(pool) as FeedbackRepo;
    const proposalRepo = createPersonaProposalRepo(pool) as ProposalRepo;

    await personaRepo.seedCatalog(PERSONA_SEED_CATALOG.map(clonePersona));

    return {
      sessionRepo,
      personaRepo,
      graphRepo,
      runRepo,
      sourceRepo,
      feedbackRepo,
      proposalRepo,
      storageMode: "postgres",
    };
  }

  logger.warn("[kxkm/api] DATABASE_URL not set — using local persona storage + in-memory runtime stores");

  return {
    sessionRepo: factories.createSessionRepo(),
    personaRepo: factories.createPersonaRepo(),
    graphRepo: factories.createGraphRepo(),
    runRepo: factories.createRunRepo(),
    sourceRepo: factories.createSourceRepo(),
    feedbackRepo: factories.createFeedbackRepo(),
    proposalRepo: factories.createProposalRepo(),
    storageMode: "local",
  };
}
