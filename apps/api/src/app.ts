import express, { type Response } from "express";
import {
  createInMemorySessionRepo,
  createInMemoryPersonaRepo,
  createInMemoryNodeGraphRepo,
  createInMemoryNodeRunRepo,
  createInMemoryPersonaSourceRepo,
  createInMemoryPersonaFeedbackRepo,
  createInMemoryPersonaProposalRepo,
  modelRegistry,
  readRouteParam,
  escapeForHtml,
  enqueueRunTransition,
  type PersonaRepo,
} from "./create-repos.js";
import { createSessionRoutes } from "./routes/session.js";
import { createPersonaRoutes } from "./routes/personas.js";
import { createNodeEngineRoutes } from "./routes/node-engine.js";
import { createChatHistoryRoutes } from "./routes/chat-history.js";
import mediaRoutes from "./routes/media.js";
import { bootstrapRepositories } from "./app-bootstrap.js";
import {
  createSessionMiddleware,
  createRequireSession,
  createRequirePermission,
  createAdminSubnetMiddleware,
  createPerfTracker,
} from "./app-middleware.js";

const COOKIE_NAME = "kxkm_v2_session";

function setSessionCookie(res: Response, sessionId: string): void {
  const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${sessionId}; HttpOnly; ${secure}SameSite=Strict; Path=/; Max-Age=3600`);
}

function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; ${secure}SameSite=Strict; Path=/; Max-Age=0`);
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export async function createApp(): Promise<{ app: express.Express; personaRepo: PersonaRepo }> {
  const {
    sessionRepo,
    personaRepo,
    graphRepo,
    runRepo,
    sourceRepo,
    feedbackRepo,
    proposalRepo,
    storageMode,
  } = await bootstrapRepositories({
    createSessionRepo: createInMemorySessionRepo,
    createPersonaRepo: createInMemoryPersonaRepo,
    createGraphRepo: createInMemoryNodeGraphRepo,
    createRunRepo: createInMemoryNodeRunRepo,
    createSourceRepo: createInMemoryPersonaSourceRepo,
    createFeedbackRepo: createInMemoryPersonaFeedbackRepo,
    createProposalRepo: createInMemoryPersonaProposalRepo,
  });

  const app = express();
  app.use(express.json({ limit: "50mb" })); // large limit for base64 image uploads
  app.use(createSessionMiddleware(sessionRepo));

  const requireSession = createRequireSession();
  const requirePermission = createRequirePermission;
  const subnetMiddleware = createAdminSubnetMiddleware(process.env.ADMIN_SUBNET);
  const perfTracker = createPerfTracker();

  if (subnetMiddleware) {
    app.use("/api/v2/admin", subnetMiddleware);
  }
  app.use(perfTracker.middleware);
  app.get("/api/v2/perf", perfTracker.route);

  // -----------------------------------------------------------------------
  // Routes (extracted to routes/ modules)
  // -----------------------------------------------------------------------

  app.use(createSessionRoutes({
    sessionRepo,
    personaRepo,
    graphRepo,
    runRepo,
    modelRegistry,
    storageMode,
    requireSession,
    requirePermission,
    setSessionCookie,
    clearSessionCookie,
  }));

  app.use(createPersonaRoutes({
    personaRepo,
    sourceRepo,
    feedbackRepo,
    proposalRepo,
    requireSession,
    requirePermission,
    readRouteParam,
  }));

  app.use(createNodeEngineRoutes({
    graphRepo,
    runRepo,
    modelRegistry,
    requirePermission,
    readRouteParam,
    enqueueRunTransition,
  }));

  app.use("/api/v2/media", mediaRoutes);

  app.use(createChatHistoryRoutes({
    personaRepo,
    feedbackRepo,
    runRepo,
    storageMode,
    requireSession,
    requirePermission,
    readRouteParam,
    escapeForHtml,
  }));

  return { app, personaRepo };
}
