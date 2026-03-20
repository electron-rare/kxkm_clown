function createSessionManager({
  sessionTtlMs,
  inactivityTimeoutMs,
  saveSession,
  clients,
  send,
  broadcast,
  admins,
  permanentUsers,
}) {
  const sessions = new Map();
  const intervalIds = [];

  function getSession(id) {
    if (!sessions.has(id)) {
      sessions.set(id, {
        model: null,
        persona: null,
        messages: [],
        created: Date.now(),
        _abort: false,
        _abortController: null,
      });
    }
    return sessions.get(id);
  }

  function purgeStaleSessions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of sessions) {
      if (now - session.created <= sessionTtlMs) continue;

      let inUse = false;
      for (const [, info] of clients) {
        if (info.sessionId === id) {
          inUse = true;
          break;
        }
      }

      if (!inUse) {
        sessions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[cleanup] Purged ${cleaned} stale sessions (${sessions.size} remaining)`);
    }
  }

  function disconnectInactiveClients() {
    const now = Date.now();
    const toDisconnect = [];

    for (const [ws, info] of clients) {
      if (permanentUsers.includes(info.nick) || admins.has(info.nick)) continue;
      if (now - info.lastActivity <= inactivityTimeoutMs) continue;
      toDisconnect.push([ws, info]);
    }

    for (const [ws, info] of toDisconnect) {
      console.log(`[timeout] Kicking ${info.nick} (inactive ${Math.round((now - info.lastActivity) / 60000)}min)`);
      send(ws, "system", "*** Tu as été déconnecté pour inactivité (1h). Reconnecte-toi!");
      broadcast(info.channel, { type: "system", text: `*** ${info.nick} a été déconnecté (inactivité)` }, ws);
      saveSession(info.sessionId, sessions.get(info.sessionId));
      clients.delete(ws);

      try {
        ws.close(1000, "Inactivity timeout");
      } catch {}
    }
  }

  function start() {
    intervalIds.push(setInterval(purgeStaleSessions, 5 * 60 * 1000));
    intervalIds.push(setInterval(disconnectInactiveClients, 5 * 60 * 1000));
  }

  function stop() {
    for (const id of intervalIds) clearInterval(id);
    intervalIds.length = 0;
  }

  let _lastSaveAllTs = 0;

  function saveAllSessions() {
    const now = Date.now();
    if (now - _lastSaveAllTs < 2000) return;
    _lastSaveAllTs = now;
    for (const [id, session] of sessions) {
      saveSession(id, session);
    }
  }

  return {
    sessions,
    getSession,
    saveAllSessions,
    start,
    stop,
  };
}

module.exports = {
  createSessionManager,
};
