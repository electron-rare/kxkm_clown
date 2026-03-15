const path = require("path");
const { parseAdminAllowedSubnets } = require("./network-policy");

const PORT = process.env.PORT || 3333;
const HOST = process.env.HOST || "0.0.0.0";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const ADMIN_BOOTSTRAP_TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN || "";
const ADMIN_ALLOWED_SUBNETS = parseAdminAllowedSubnets(process.env.ADMIN_ALLOWED_SUBNETS);
const DATA_DIR = path.join(__dirname, "data");
const WEB_SEARCH_API_BASE = process.env.WEB_SEARCH_API_BASE || "";
const WEB_TOOL_TIMEOUT_MS = Number.isFinite(Number.parseInt(process.env.WEB_TOOL_TIMEOUT_MS || "", 10))
  ? Math.max(1000, Number.parseInt(process.env.WEB_TOOL_TIMEOUT_MS || "", 10))
  : 12000;

const CONTEXT_MAX_MESSAGES = 40; // compact after this many messages
const CONTEXT_KEEP_RECENT = 10; // keep last N messages after compaction
const MAX_RESPONSE_TOKENS = 150; // big models: ~3 phrases
const MAX_RESPONSE_TOKENS_SMALL = 80; // mistral: ~2 phrases
const MAX_RESPONSE_CHARS = 600; // hard character limit (abort stream beyond this)
const MAX_GENERAL_RESPONDERS = Number.isFinite(Number.parseInt(process.env.MAX_GENERAL_RESPONDERS || "", 10))
  ? Math.max(0, Number.parseInt(process.env.MAX_GENERAL_RESPONDERS || "", 10))
  : 4; // 0 = all active personas respond on #general
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min session cleanup
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const MAX_MESSAGE_LENGTH = 4096; // max user message length
const MEMORY_MAX_CONVERSATIONS = Number.isFinite(Number.parseInt(process.env.MEMORY_MAX_CONVERSATIONS || "", 10))
  ? Math.max(10, Number.parseInt(process.env.MEMORY_MAX_CONVERSATIONS || "", 10))
  : 100;
const RETENTION_SESSION_DAYS = Number.isFinite(Number.parseInt(process.env.RETENTION_SESSION_DAYS || "", 10))
  ? Math.max(1, Number.parseInt(process.env.RETENTION_SESSION_DAYS || "", 10))
  : 7;
const RETENTION_LOG_DAYS = Number.isFinite(Number.parseInt(process.env.RETENTION_LOG_DAYS || "", 10))
  ? Math.max(1, Number.parseInt(process.env.RETENTION_LOG_DAYS || "", 10))
  : 30;
const RETENTION_SWEEP_MS = Number.isFinite(Number.parseInt(process.env.RETENTION_SWEEP_MS || "", 10))
  ? Math.max(60 * 1000, Number.parseInt(process.env.RETENTION_SWEEP_MS || "", 10))
  : 6 * 60 * 60 * 1000;
const PERSISTED_SESSION_RETENTION_MS = RETENTION_SESSION_DAYS * 24 * 60 * 60 * 1000;
const LOG_RETENTION_MS = RETENTION_LOG_DAYS * 24 * 60 * 60 * 1000;

const OWNER_NICK = "saisail";
const HIDDEN_MODEL_PREFIX = "mascarade-";

const ADMINS = new Set([OWNER_NICK]); // server admins
const OPS = new Set([OWNER_NICK]); // channel operators

module.exports = {
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
  RETENTION_SESSION_DAYS,
  RETENTION_LOG_DAYS,
  RETENTION_SWEEP_MS,
  PERSISTED_SESSION_RETENTION_MS,
  LOG_RETENTION_MS,
  OWNER_NICK,
  HIDDEN_MODEL_PREFIX,
  ADMINS,
  OPS,
};
