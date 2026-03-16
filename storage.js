const fs = require("fs");
const path = require("path");

function createStorage(dataDir, {
  memoryMaxConversations = 100,
} = {}) {
  const usersFile = path.join(dataDir, "users.json");
  const channelsFile = path.join(dataDir, "channels.json");
  const runtimeAdminFile = path.join(dataDir, "runtime-admin.json");
  const sessionsDir = path.join(dataDir, "sessions");
  const logsDir = path.join(dataDir, "logs");
  const MAX_SESSION_MESSAGES = 400;

  function cleanText(value, maxLength = 4000) {
    return String(value || "").trim().slice(0, maxLength);
  }

  function getMemoryPath(nick) {
    const safe = nick.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
    const resolved = path.join(dataDir, "memory", `${safe}.json`);
    if (!resolved.startsWith(path.join(dataDir, "memory"))) {
      throw new Error("Invalid memory path");
    }
    return resolved;
  }

  function loadMemory(nick) {
    try {
      return JSON.parse(fs.readFileSync(getMemoryPath(nick), "utf-8"));
    } catch {
      return { nick, conversations: [], summary: "", lastSeen: null };
    }
  }

  function saveMemory(nick, memory) {
    memory.lastSeen = new Date().toISOString();
    fs.writeFileSync(getMemoryPath(nick), JSON.stringify(memory, null, 2));
  }

  function appendToMemory(nick, channel, model, userMsg, assistantMsg) {
    const mem = loadMemory(nick);
    mem.conversations.push({
      ts: new Date().toISOString(),
      channel,
      model,
      user: userMsg,
      assistant: assistantMsg.slice(0, 500),
    });
    if (mem.conversations.length > memoryMaxConversations) {
      mem.conversations = mem.conversations.slice(-memoryMaxConversations);
    }
    saveMemory(nick, mem);
  }

  function getMemoryContext(nick) {
    const mem = loadMemory(nick);
    if (!mem.conversations.length) return "";
    const recent = mem.conversations.slice(-5);
    let ctx = `\n=== MÉMOIRE DE ${nick} (dernières interactions) ===\n`;
    for (const c of recent) {
      ctx += `[${c.ts.slice(0, 16)}] ${nick}: ${c.user.slice(0, 100)}\n`;
      ctx += `  → ${c.model || "?"}: ${c.assistant.slice(0, 100)}\n`;
    }
    ctx += "=== FIN MÉMOIRE ===\n";
    return ctx;
  }

  function safeChannel(channel) {
    return channel.replace(/[^a-z0-9_#-]/gi, "_").slice(0, 50);
  }

  function logByNick(nick, channel, role, text) {
    const safe = nick.replace(/[^a-z0-9_-]/gi, "_").slice(0, 20);
    const safeChan = safeChannel(channel);
    const safeRole = String(role || "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 20);
    const ts = new Date().toISOString();
    const line = `[${ts}] [${safeChan}] <${safeRole}> ${text.slice(0, 2000)}\n`;
    try {
      fs.appendFileSync(path.join(logsDir, `nick_${safe}.log`), line);
      fs.appendFileSync(path.join(logsDir, `${safeChan}.log`), `[${ts}] <${safeRole}> ${text.slice(0, 2000)}\n`);
    } catch (e) {
      console.error("[log] write error:", e.message);
    }
  }

  function logDPOPair(nick, prompt, chosen, rejected, chosenModel, rejectedModel) {
    const entry = {
      timestamp: new Date().toISOString(),
      nick,
      prompt,
      chosen: { model: chosenModel, content: chosen },
      rejected: { model: rejectedModel, content: rejected },
    };
    fs.appendFileSync(
      path.join(dataDir, "dpo", "pairs.jsonl"),
      JSON.stringify(entry) + "\n"
    );
  }

  function logTrainingTurn(channel, nick, model, messages) {
    const entry = {
      timestamp: new Date().toISOString(),
      channel,
      nick,
      model,
      messages: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    };
    fs.appendFileSync(
      path.join(dataDir, "training", "conversations.jsonl"),
      JSON.stringify(entry) + "\n"
    );
  }

  function loadUsers() {
    try {
      return JSON.parse(fs.readFileSync(usersFile, "utf-8"));
    } catch {
      return {};
    }
  }

  function saveUsers(users) {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  }

  function loadChannelsState() {
    try {
      const state = JSON.parse(fs.readFileSync(channelsFile, "utf-8"));
      if (state && typeof state === "object") return state;
    } catch {}
    return { topics: {} };
  }

  function saveChannelsState(state) {
    fs.writeFileSync(channelsFile, JSON.stringify(state, null, 2));
  }

  function getChannelTopic(channel) {
    const safe = safeChannel(channel);
    const topics = loadChannelsState().topics || {};
    return topics[safe] || null;
  }

  function setChannelTopic(channel, topic, updatedBy = "admin") {
    const safe = safeChannel(channel);
    const state = loadChannelsState();
    if (!state.topics || typeof state.topics !== "object") {
      state.topics = {};
    }

    const cleanTopic = String(topic || "").trim().slice(0, 240);
    state.topics[safe] = {
      channel,
      topic: cleanTopic,
      updatedAt: new Date().toISOString(),
      updatedBy: String(updatedBy || "admin").trim().slice(0, 40) || "admin",
    };
    saveChannelsState(state);
    return state.topics[safe];
  }

  function listChannelTopics() {
    const topics = loadChannelsState().topics || {};
    return Object.values(topics);
  }

  function normalizeRuntimeAdminState(value = {}) {
    const disabledPersonaIds = Array.isArray(value.disabledPersonaIds)
      ? [...new Set(
        value.disabledPersonaIds
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      )]
      : [];

    return {
      disabledPersonaIds,
      updatedAt: value.updatedAt || null,
      updatedBy: value.updatedBy || null,
    };
  }

  function loadRuntimeAdminState() {
    try {
      return normalizeRuntimeAdminState(JSON.parse(fs.readFileSync(runtimeAdminFile, "utf-8")));
    } catch {
      return normalizeRuntimeAdminState();
    }
  }

  function saveRuntimeAdminState(state) {
    const normalized = normalizeRuntimeAdminState(state);
    fs.writeFileSync(runtimeAdminFile, JSON.stringify(normalized, null, 2));
    return normalized;
  }

  function registerUser(nick) {
    const users = loadUsers();
    if (!users[nick]) {
      users[nick] = {
        nick,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        totalMessages: 0,
        channels: ["#general"],
      };
    }
    users[nick].lastSeen = new Date().toISOString();
    saveUsers(users);
    return users[nick];
  }

  function updateUserStats(nick, channel) {
    const users = loadUsers();
    if (users[nick]) {
      users[nick].lastSeen = new Date().toISOString();
      users[nick].totalMessages = (users[nick].totalMessages || 0) + 1;
      if (!users[nick].channels.includes(channel)) {
        users[nick].channels.push(channel);
      }
      saveUsers(users);
    }
  }

  function saveSession(id, session) {
    if (!session) return;
    const safeId = String(id || "").replace(/[^a-z0-9_#:-]/gi, "_").slice(0, 180);
    if (!safeId) return;
    const file = path.join(sessionsDir, `${safeId}.json`);
    fs.writeFileSync(file, JSON.stringify(session, (k, v) => k.startsWith("_") ? undefined : v, 2));
  }

  function normalizeSessionSnapshot(session) {
    if (!session || typeof session !== "object") return null;

    const messages = Array.isArray(session.messages)
      ? session.messages
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          role: ["system", "user", "assistant"].includes(entry.role) ? entry.role : "user",
          content: cleanText(entry.content, 12000),
        }))
        .filter((entry) => entry.content)
        .slice(-MAX_SESSION_MESSAGES)
      : [];

    return {
      model: cleanText(session.model, 120) || null,
      persona: cleanText(session.persona, 120) || null,
      messages,
      created: Number.isFinite(Number(session.created)) ? Number(session.created) : Date.now(),
    };
  }

  function loadSavedSession(id) {
    const safeId = cleanText(id, 180).replace(/[^a-z0-9_#:-]/gi, "_");
    if (!safeId) return null;

    const file = path.join(sessionsDir, `${safeId}.json`);
    if (!fs.existsSync(file)) return null;

    try {
      return normalizeSessionSnapshot(JSON.parse(fs.readFileSync(file, "utf-8")));
    } catch {
      return null;
    }
  }

  function listSessionIds(limit = 20) {
    return listSavedSessions(limit).map((entry) => entry.id);
  }

  function listSavedSessions(limit = 20) {
    if (!fs.existsSync(sessionsDir)) return [];

    return fs.readdirSync(sessionsDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        const fullPath = path.join(sessionsDir, file);
        const stat = fs.statSync(fullPath);
        return {
          id: file.replace(/\.json$/, ""),
          file,
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  function pruneFilesOlderThan(dir, maxAgeMs, matcher) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 1 || !fs.existsSync(dir)) {
      return 0;
    }

    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const entry of fs.readdirSync(dir)) {
      if (typeof matcher === "function" && !matcher(entry)) continue;

      const file = path.join(dir, entry);
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.mtimeMs >= cutoff) continue;

      fs.rmSync(file, { force: true });
      removed++;
    }

    return removed;
  }

  function pruneSavedSessions(maxAgeMs) {
    return pruneFilesOlderThan(sessionsDir, maxAgeMs, (entry) => entry.endsWith(".json"));
  }

  function pruneLogs(maxAgeMs) {
    return pruneFilesOlderThan(logsDir, maxAgeMs, (entry) => entry.endsWith(".log"));
  }

  function runRetention({
    sessionMaxAgeMs = 0,
    logMaxAgeMs = 0,
  } = {}) {
    const removedSessions = pruneSavedSessions(sessionMaxAgeMs);
    const removedLogs = pruneLogs(logMaxAgeMs);

    return {
      removedSessions,
      removedLogs,
    };
  }

  function readJsonlArray(file) {
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  function parseChannelLogLine(channel, line) {
    const match = line.match(/^\[(?<ts>[^\]]+)\]\s+<(?<nick>[^>]+)>\s(?<text>.*)$/);
    if (!match?.groups) return null;
    return {
      ts: match.groups.ts,
      channel,
      nick: match.groups.nick,
      text: match.groups.text,
    };
  }

  function readChannelLogEntries(channel) {
    const safeChan = safeChannel(channel);
    const file = path.join(dataDir, "logs", `${safeChan}.log`);
    if (!fs.existsSync(file)) return [];

    return fs.readFileSync(file, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => parseChannelLogLine(channel, line))
      .filter(Boolean);
  }

  function listChannelLogFiles() {
    const dir = path.join(dataDir, "logs");
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".log") && !file.startsWith("nick_"))
      .map((file) => {
        const safeName = file.replace(/\.log$/, "");
        const channel = safeName.startsWith("#") ? safeName : `#${safeName}`;
        return { file, channel };
      });
  }

  function searchHistory({ q = "", channel = "", nick = "", limit = 100, before = "", after = "" } = {}) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const beforeTs = before ? Date.parse(before) : null;
    const afterTs = after ? Date.parse(after) : null;
    const query = String(q || "").trim().toLowerCase();
    const expectedNick = String(nick || "").trim().toLowerCase();
    const channels = channel
      ? [String(channel)]
      : listChannelLogFiles().map((entry) => entry.channel);

    const results = [];

    for (const currentChannel of channels) {
      const entries = readChannelLogEntries(currentChannel);
      for (const entry of entries) {
        if (beforeTs && Date.parse(entry.ts) >= beforeTs) continue;
        if (afterTs && Date.parse(entry.ts) <= afterTs) continue;
        if (expectedNick && entry.nick.toLowerCase() !== expectedNick) continue;
        if (query) {
          const haystack = `${entry.nick} ${entry.text}`.toLowerCase();
          if (!haystack.includes(query)) continue;
        }
        results.push(entry);
      }
    }

    return results
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, normalizedLimit);
  }

  function getLogsSummary({ channel = "", limit = 12 } = {}) {
    const files = listChannelLogFiles();
    return files
      .filter((entry) => !channel || entry.channel === channel)
      .map(({ channel: currentChannel }) => {
        const entries = readChannelLogEntries(currentChannel);
        const lastEntry = entries[entries.length - 1] || null;
        const firstEntry = entries[0] || null;
        const uniqueNicks = [...new Set(entries.map((entry) => entry.nick))];
        return {
          channel: currentChannel,
          count: entries.length,
          firstTs: firstEntry?.ts || null,
          lastTs: lastEntry?.ts || null,
          lastNick: lastEntry?.nick || null,
          lastText: lastEntry?.text || null,
          uniqueNickCount: uniqueNicks.length,
          uniqueNicks: uniqueNicks.slice(0, 20),
        };
      })
      .sort((a, b) => (b.lastTs || "").localeCompare(a.lastTs || ""))
      .slice(0, limit);
  }

  function buildHistoryHtml({ entries = [], title = "Export KXKM_Clown" } = {}) {
    const escapeHtml = (value) => String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const items = entries.map((entry) => `
      <article class="entry">
        <div class="meta">${escapeHtml(entry.ts)} · ${escapeHtml(entry.channel)} · &lt;${escapeHtml(entry.nick)}&gt;</div>
        <pre>${escapeHtml(entry.text)}</pre>
      </article>
    `).join("\n");

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 24px; background: #0a0a12; color: #d6d8f0; font: 14px/1.6 "Cascadia Code", monospace; }
    h1 { margin: 0 0 16px; color: #00e5ff; }
    .entry { margin: 0 0 16px; padding: 12px 14px; background: #141626; border: 1px solid #2a2e45; }
    .meta { color: #8d93b7; margin-bottom: 8px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${items || "<p>Aucune entrée.</p>"}
</body>
</html>`;
  }

  function exportHistoryHtml(options = {}) {
    const entries = searchHistory(options)
      .slice()
      .sort((a, b) => a.ts.localeCompare(b.ts));

    const titleParts = ["Historique KXKM_Clown"];
    if (options.channel) titleParts.push(String(options.channel));
    if (options.nick) titleParts.push(`nick:${String(options.nick)}`);
    if (options.q) titleParts.push(`recherche:${String(options.q)}`);

    const title = titleParts.join(" · ");
    return {
      title,
      count: entries.length,
      entries,
      html: buildHistoryHtml({ entries, title }),
    };
  }

  return {
    getMemoryPath,
    loadMemory,
    saveMemory,
    appendToMemory,
    getMemoryContext,
    safeChannel,
    logByNick,
    logDPOPair,
    logTrainingTurn,
    loadUsers,
    saveUsers,
    getChannelTopic,
    setChannelTopic,
    listChannelTopics,
    loadRuntimeAdminState,
    saveRuntimeAdminState,
    registerUser,
    updateUserStats,
    saveSession,
    loadSavedSession,
    listSessionIds,
    listSavedSessions,
    pruneSavedSessions,
    pruneLogs,
    runRetention,
    readJsonlArray,
    readChannelLogEntries,
    searchHistory,
    getLogsSummary,
    buildHistoryHtml,
    exportHistoryHtml,
  };
}

module.exports = {
  createStorage,
};
