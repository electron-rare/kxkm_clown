const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");

const {
  PORT,
  HOST,
  OLLAMA_URL,
  ADMIN_BOOTSTRAP_TOKEN,
  ADMIN_ALLOWED_SUBNETS,
  DATA_DIR,
  WEB_SEARCH_API_BASE,
  WEB_TOOL_TIMEOUT_MS,
  CONTEXT_MAX_MESSAGES,
  CONTEXT_KEEP_RECENT,
  MAX_RESPONSE_TOKENS,
  MAX_RESPONSE_TOKENS_SMALL,
  MAX_RESPONSE_CHARS,
  MAX_GENERAL_RESPONDERS,
  SESSION_TTL_MS,
  INACTIVITY_TIMEOUT_MS,
  MAX_MESSAGE_LENGTH,
  MEMORY_MAX_CONVERSATIONS,
  PERSISTED_SESSION_RETENTION_MS,
  LOG_RETENTION_MS,
  RETENTION_SWEEP_MS,
  NODE_ENGINE_MAX_CONCURRENCY,
  OWNER_NICK,
  HIDDEN_MODEL_PREFIX,
  ADMINS,
  OPS,
} = require("./config");
const { createNetworkPolicy } = require("./network-policy");
const { createAdminSessionManager } = require("./admin-session");
const { createPersonaRegistry } = require("./persona-registry");
const { createPersonaStore } = require("./persona-store");
const { createNodeEngineRegistry } = require("./node-engine-registry");
const { createNodeEngineStore } = require("./node-engine-store");
const { createNodeEngineRunner } = require("./node-engine-runner");
const { createNodeEngineRuntimes } = require("./node-engine-runtimes");
const { createNodeEngineQueue } = require("./node-engine-queue");
const {
  createPharmaciusGenerator,
  createPharmaciusAttachmentOrchestrator,
} = require("./pharmacius");
const { createWebTools } = require("./web-tools");
const { createOllamaClient } = require("./ollama");
const { createStorage } = require("./storage");
const { createAttachmentStore } = require("./attachment-store");
const { createAttachmentService } = require("./attachment-service");
const { createCommandHandler } = require("./commands");
const { ensureDataDirs, createRuntimeState } = require("./runtime-state");
const { createClientRegistry } = require("./client-registry");
const { createSessionManager } = require("./sessions");
const { createChatRouter } = require("./chat-routing");
const { registerApiRoutes } = require("./http-api");
const { attachWebSocketHandlers } = require("./websocket");
const { createAuditLogger } = require("./audit-log");

ensureDataDirs(DATA_DIR);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const networkPolicy = createNetworkPolicy({
  adminAllowedSubnets: ADMIN_ALLOWED_SUBNETS,
});
const adminSessions = createAdminSessionManager();
const auditLog = createAuditLogger({ dataDir: DATA_DIR });

const { ollamaModels, ollamaAllModels, ollamaLoadedModels, ollamaChat } = createOllamaClient({
  ollamaUrl: OLLAMA_URL,
  hiddenModelPrefix: HIDDEN_MODEL_PREFIX,
  maxResponseTokens: MAX_RESPONSE_TOKENS,
  maxResponseTokensSmall: MAX_RESPONSE_TOKENS_SMALL,
  maxResponseChars: MAX_RESPONSE_CHARS,
});

const storage = createStorage(DATA_DIR, {
  memoryMaxConversations: MEMORY_MAX_CONVERSATIONS,
});
const attachmentStore = createAttachmentStore({ dataDir: DATA_DIR });
const webTools = createWebTools({
  searchApiBase: WEB_SEARCH_API_BASE,
  timeoutMs: WEB_TOOL_TIMEOUT_MS,
});
const nodeEngineRegistry = createNodeEngineRegistry();
const nodeEngineStore = createNodeEngineStore({
  dataDir: DATA_DIR,
  registry: nodeEngineRegistry,
});
const personaRegistry = createPersonaRegistry({ dataDir: DATA_DIR });
const generatePersonaPatch = createPharmaciusGenerator({
  getPersonaById: personaRegistry.getPersonaById,
  ollamaChat,
});
const orchestrateAttachment = createPharmaciusAttachmentOrchestrator({
  getPersonaById: personaRegistry.getPersonaById,
  ollamaChat,
});
const personaStore = createPersonaStore({
  dataDir: DATA_DIR,
  getPersonaById: personaRegistry.getPersonaById,
  updatePersona: personaRegistry.updatePersona,
  generatePersonaPatch,
});
const runtime = createRuntimeState({
  dataDir: DATA_DIR,
  getAllPersonas: personaRegistry.getAllPersonas,
  manifesteRegisters: personaRegistry.getManifesteRegisters(),
  ollamaModels,
  maxGeneralResponders: MAX_GENERAL_RESPONDERS,
  getChannelTopic: storage.getChannelTopic,
  loadRuntimeAdminState: storage.loadRuntimeAdminState,
  saveRuntimeAdminState: storage.saveRuntimeAdminState,
});
const getRuntimePersonaById = (id) => runtime.getRuntimePersonaById(id);
const getRuntimePersonaByNick = (nick) => runtime.getRuntimePersonaByNick(nick);
const getRuntimePersonaByModel = (model) => runtime.getDefaultRuntimePersonaForModel(model) || personaRegistry.getPersonaByModel(model);
const getRuntimeDefaultPersonaNameForModel = (model) => getRuntimePersonaByModel(model)?.name || null;
const clientRegistry = createClientRegistry({
  getAllPersonas: personaRegistry.getAllPersonas,
  admins: ADMINS,
  ops: OPS,
  ownerNick: OWNER_NICK,
  runtime,
});
const sessionManager = createSessionManager({
  sessionTtlMs: SESSION_TTL_MS,
  inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
  saveSession: storage.saveSession,
  clients: clientRegistry.clients,
  send: clientRegistry.send,
  broadcast: clientRegistry.broadcast,
  admins: ADMINS,
  permanentUsers: clientRegistry.permanentUsers,
});
const chatRouter = createChatRouter({
  admins: ADMINS,
  contextMaxMessages: CONTEXT_MAX_MESSAGES,
  contextKeepRecent: CONTEXT_KEEP_RECENT,
  maxGeneralResponders: MAX_GENERAL_RESPONDERS,
  maxMessageLength: MAX_MESSAGE_LENGTH,
  getGeneralPersonasActive: runtime.getGeneralPersonasActive,
  getNextRegister: runtime.getNextRegister,
  getNextManifestChunk: runtime.getNextManifestChunk,
  getPersonaByModel: getRuntimePersonaByModel,
  getPersonaById: getRuntimePersonaById,
  getPersonaByNick: getRuntimePersonaByNick,
  getPersonasByModel: runtime.getRuntimePersonasByModel,
  isPersonaEnabled: runtime.isPersonaEnabled,
  getSession: sessionManager.getSession,
  saveSession: storage.saveSession,
  getMemoryContext: storage.getMemoryContext,
  appendToMemory: storage.appendToMemory,
  appendPersonaFeedback: personaStore.recordPersonaFeedback,
  updateUserStats: storage.updateUserStats,
  logByNick: storage.logByNick,
  logDPOPair: storage.logDPOPair,
  logTrainingTurn: storage.logTrainingTurn,
  ollamaChat,
  broadcastAll: clientRegistry.broadcastAll,
  send: clientRegistry.send,
});

const attachmentService = createAttachmentService({
  attachmentStore,
  getSession: sessionManager.getSession,
  clients: clientRegistry.clients,
  broadcastAll: clientRegistry.broadcastAll,
  enqueueChannel: chatRouter.enqueueChannel,
  handleAttachmentAnalysis: chatRouter.handleAttachmentAnalysis,
  orchestrateAttachment,
  rememberAttachmentUpload: chatRouter.rememberAttachmentUpload,
  rememberAttachmentAnalysis: chatRouter.rememberAttachmentAnalysis,
  rememberAttachmentFailure: chatRouter.rememberAttachmentFailure,
});

const nodeEngineRuntimes = createNodeEngineRuntimes({
  rootDir: __dirname,
  ollamaChat,
});

const nodeEngineRunner = createNodeEngineRunner({
  rootDir: __dirname,
  registry: nodeEngineRegistry,
  store: nodeEngineStore,
  runtimes: nodeEngineRuntimes,
});

const nodeEngineQueue = createNodeEngineQueue({
  store: nodeEngineStore,
  runner: nodeEngineRunner,
  maxConcurrency: NODE_ENGINE_MAX_CONCURRENCY,
  onError(error) {
    console.error("[node-engine-queue]", error?.message || error);
  },
});

const handleCommand = createCommandHandler({
  adminBootstrapToken: ADMIN_BOOTSTRAP_TOKEN,
  admins: ADMINS,
  appendToMemory: storage.appendToMemory,
  appendPersonaFeedback: personaStore.recordPersonaFeedback,
  broadcast: clientRegistry.broadcast,
  broadcastAll: clientRegistry.broadcastAll,
  buildChannelInfo: runtime.buildChannelInfo,
  channelUsers: clientRegistry.channelUsers,
  claimOwnerNick: clientRegistry.claimOwnerNick,
  clients: clientRegistry.clients,
  formatStats: chatRouter.formatStats,
  generalResponderLabel: runtime.generalResponderLabel,
  getActivePersonaCount: () => runtime.getGeneralPersonasActive().length,
  getAllPersonas: personaRegistry.getAllPersonas,
  getChannelModel: runtime.getChannelModel,
  getChannelTopic: storage.getChannelTopic,
  getDefaultPersonaNameForModel: getRuntimeDefaultPersonaNameForModel,
  getPersonaById: getRuntimePersonaById,
  getPersonaByNick: getRuntimePersonaByNick,
  getPersonasByModel: runtime.getRuntimePersonasByModel,
  getSession: sessionManager.getSession,
  listSessionIds: storage.listSessionIds,
  loadSavedSession: storage.loadSavedSession,
  loadMemory: storage.loadMemory,
  saveSession: storage.saveSession,
  logByNick: storage.logByNick,
  logDPOPair: storage.logDPOPair,
  isAdminNetworkAllowed: networkPolicy.isAdminNetworkAllowed,
  ollamaAllModels,
  ollamaChat,
  ollamaModels,
  searchWeb: webTools.searchWeb,
  fetchWebPage: webTools.fetchWebPage,
  ops: OPS,
  lastRoundResponses: chatRouter.lastRoundResponses,
  replayHistory: chatRouter.replayHistory,
  setChannelTopic: storage.setChannelTopic,
  send: clientRegistry.send,
  buildUploadCapability: attachmentService.buildUploadCapability,
});

attachWebSocketHandlers({
  wss,
  getAllPersonas: runtime.getRuntimePersonaMap,
  getPersonaById: personaRegistry.getPersonaById,
  adminBootstrapToken: ADMIN_BOOTSTRAP_TOKEN,
  getClientIp: networkPolicy.getSocketIp,
  runtime,
  registerUser: storage.registerUser,
  getSession: sessionManager.getSession,
  saveSession: storage.saveSession,
  clientRegistry,
  handleCommand,
  chatRouter,
  buildUploadCapability: attachmentService.buildUploadCapability,
});

registerApiRoutes(app, {
  adminBootstrapToken: ADMIN_BOOTSTRAP_TOKEN,
  host: HOST,
  dataDir: DATA_DIR,
  networkPolicy,
  runtime,
  sessions: sessionManager.sessions,
  clients: clientRegistry.clients,
  channelUsers: clientRegistry.channelUsers,
  listPersonas: personaRegistry.listPersonas,
  listEditablePersonas: personaRegistry.listEditablePersonas,
  ollamaModels,
  ollamaLoadedModels,
  ollamaUrl: OLLAMA_URL,
  maxResponseTokens: MAX_RESPONSE_TOKENS,
  maxGeneralResponders: MAX_GENERAL_RESPONDERS,
  readJsonlArray: storage.readJsonlArray,
  listSavedSessions: storage.listSavedSessions,
  setChannelTopic: storage.setChannelTopic,
  searchHistory: storage.searchHistory,
  getLogsSummary: storage.getLogsSummary,
  buildHistoryHtml: storage.buildHistoryHtml,
  getPersonaById: personaRegistry.getPersonaById,
  updatePersona: personaRegistry.updatePersona,
  createPersonaFromSource: personaRegistry.createPersonaFromSource,
  getPersonaSource: personaStore.getPersonaSource,
  updatePersonaSource: personaStore.updatePersonaSource,
  listPersonaFeedback: personaStore.listPersonaFeedback,
  recordPersonaFeedback: personaStore.recordPersonaFeedback,
  listPersonaProposals: personaStore.listPersonaProposals,
  recordAppliedChange: personaStore.recordAppliedChange,
  reinforcePersona: personaStore.reinforcePersona,
  revertPersona: personaStore.revertPersona,
  setPersonaEnabled: runtime.setPersonaEnabled,
  isPersonaEnabled: runtime.isPersonaEnabled,
  attachmentService,
  adminSessions,
  nodeEngineStore,
  nodeEngineRegistry,
  nodeEngineRunner,
  nodeEngineQueue,
  auditLog,
});

sessionManager.start();
nodeEngineQueue.start();
const initialRetention = storage.runRetention({
  sessionMaxAgeMs: PERSISTED_SESSION_RETENTION_MS,
  logMaxAgeMs: LOG_RETENTION_MS,
});

if (initialRetention.removedSessions || initialRetention.removedLogs) {
  console.log(
    `[retention] startup sweep removed ${initialRetention.removedSessions} session(s), ${initialRetention.removedLogs} log(s)`
  );
}

const retentionIntervalId = setInterval(() => {
  const result = storage.runRetention({
    sessionMaxAgeMs: PERSISTED_SESSION_RETENTION_MS,
    logMaxAgeMs: LOG_RETENTION_MS,
  });
  if (result.removedSessions || result.removedLogs) {
    console.log(
      `[retention] periodic sweep removed ${result.removedSessions} session(s), ${result.removedLogs} log(s)`
    );
  }
}, RETENTION_SWEEP_MS);

function gracefulShutdown(signal) {
  console.log(`\n[shutdown] ${signal} received, saving sessions...`);
  sessionManager.stop();
  nodeEngineQueue.stop();
  clearInterval(retentionIntervalId);
  sessionManager.saveAllSessions();

  for (const [ws] of clientRegistry.clients) {
    try {
      ws.close(1001, "Server shutting down");
    } catch {}
  }

  server.close(() => {
    console.log("[shutdown] Server closed.");
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

server.listen(PORT, HOST, async () => {
  await runtime.refreshChannelMap();
  const accessMode = HOST === "127.0.0.1" || HOST === "::1" ? "loopback" : "lan_controlled";
  const primaryUrl = HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  const listenLabel = `${HOST}:${PORT}`;
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║          🤡 KXKM_Clown v0.3.0            ║
  ║   mIRC-style LAN-controlled LLM chat     ║
  ║   ${primaryUrl.padEnd(39)}║
  ║   Ollama: ${OLLAMA_URL}        ║
  ║   Models: ${String(runtime.getAllModels().length).padEnd(2)} | Personas: ${String(runtime.getGeneralPersonasActive().length).padEnd(2)}         ║
  ║   Max tokens: ${MAX_RESPONSE_TOKENS}/${MAX_RESPONSE_TOKENS_SMALL} | Responders: ${MAX_GENERAL_RESPONDERS}    ║
  ║   Bind: ${listenLabel.padEnd(34)}║
  ║   Mode: ${accessMode.padEnd(34)}║
  ╚═══════════════════════════════════════════╝
  `);
});
