const crypto = require("crypto");

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_COOKIE_NAME = "kxkm_admin_session";

function parseCookieHeader(header) {
  const cookies = {};
  const raw = String(header || "");
  if (!raw) return cookies;

  for (const part of raw.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (!name) continue;
    const value = valueParts.join("=");
    try {
      cookies[name] = decodeURIComponent(value || "");
    } catch {
      cookies[name] = value || "";
    }
  }

  return cookies;
}

function serializeCookie(name, value, {
  httpOnly = true,
  sameSite = "Strict",
  path = "/",
  secure = false,
  expires = null,
} = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  if (expires instanceof Date) parts.push(`Expires=${expires.toUTCString()}`);
  return parts.join("; ");
}

function createAdminSessionManager({
  cookieName = DEFAULT_COOKIE_NAME,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
} = {}) {
  const sessions = new Map();
  let lastPruneMs = 0;
  const PRUNE_INTERVAL_MS = 60 * 1000; // prune at most once per minute

  function nowIso() {
    return new Date().toISOString();
  }

  function pruneExpiredSessions() {
    const now = Date.now();
    if (now - lastPruneMs < PRUNE_INTERVAL_MS) return;
    lastPruneMs = now;

    for (const [sessionId, session] of sessions) {
      if ((now - session.lastSeenAtMs) > sessionTtlMs) {
        sessions.delete(sessionId);
      }
    }
  }

  function readCookieSessionId(req) {
    const cookies = parseCookieHeader(req?.headers?.cookie);
    return String(cookies[cookieName] || "").trim();
  }

  function getSession(sessionId) {
    pruneExpiredSessions();
    if (!sessionId) return null;
    const session = sessions.get(sessionId) || null;
    if (!session) return null;
    session.lastSeenAt = nowIso();
    session.lastSeenAtMs = Date.now();
    return { ...session };
  }

  function getRequestSession(req) {
    return getSession(readCookieSessionId(req));
  }

  function createSession({ ip = "", userAgent = "", actor = "admin" } = {}) {
    pruneExpiredSessions();
    const session = {
      id: crypto.randomUUID(),
      actor: String(actor || "admin").trim().slice(0, 80) || "admin",
      ip: String(ip || "").trim().slice(0, 120),
      userAgent: String(userAgent || "").trim().slice(0, 240),
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      lastSeenAtMs: Date.now(),
    };
    sessions.set(session.id, session);
    return { ...session };
  }

  function destroySession(sessionId) {
    if (!sessionId) return false;
    return sessions.delete(sessionId);
  }

  function destroyRequestSession(req) {
    return destroySession(readCookieSessionId(req));
  }

  function buildSessionCookie({ secure = false } = {}) {
    return serializeCookie(cookieName, "", {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      secure,
      expires: new Date(0),
    });
  }

  function buildSetCookie(sessionId, { secure = false } = {}) {
    return serializeCookie(cookieName, sessionId, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      secure,
    });
  }

  function listSessions() {
    pruneExpiredSessions();
    return Array.from(sessions.values()).map((session) => ({
      ...session,
      lastSeenAtMs: undefined,
    }));
  }

  return {
    cookieName,
    createSession,
    getSession,
    getRequestSession,
    destroySession,
    destroyRequestSession,
    buildSetCookie,
    buildClearCookie: buildSessionCookie,
    listSessions,
  };
}

module.exports = {
  createAdminSessionManager,
  parseCookieHeader,
};
