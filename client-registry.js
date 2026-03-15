function createClientRegistry({ getAllPersonas, admins, ops, ownerNick, runtime }) {
  const clients = new Map();
  const permanentUsers = [];

  function send(ws, type, text, nick) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type, text, nick }));
    }
  }

  function broadcast(channel, msg, excludeWs = null) {
    const json = JSON.stringify(msg);
    for (const [ws, info] of clients) {
      if (info.channel === channel && ws !== excludeWs && ws.readyState === 1) {
        ws.send(json);
      }
    }
  }

  function broadcastAll(channel, msg) {
    const json = JSON.stringify(msg);
    for (const [ws, info] of clients) {
      if (info.channel === channel && ws.readyState === 1) {
        ws.send(json);
      }
    }
  }

  function isNickTaken(nick, excludeWs = null) {
    const lower = nick.toLowerCase();
    for (const [ws, info] of clients) {
      if (info.nick.toLowerCase() === lower && ws !== excludeWs) return true;
    }
    for (const name of Object.keys(getAllPersonas())) {
      if (name.toLowerCase() === lower) return true;
    }
    return false;
  }

  function findAvailableNick(base) {
    if (!isNickTaken(base)) return base;
    for (let i = 1; i <= 99; i++) {
      const candidate = `${base}${i}`;
      if (!isNickTaken(candidate)) return candidate;
    }
    return `${base}_${Date.now() % 10000}`;
  }

  function channelUsers(channel) {
    const users = [];
    for (const [, info] of clients) {
      if (info.channel === channel) users.push(info.nick);
    }

    let botNicks = [];
    const channelModel = runtime.getChannelModel(channel);
    if (channel === "#general" || !channelModel) {
      botNicks = runtime.getGeneralPersonasActive().map((persona) => persona.name);
    } else if (channelModel !== "ADMIN") {
      botNicks = runtime.getRuntimePersonasByModel(channelModel).map((persona) => persona.name);
    }

    const allUsers = [...new Set([...permanentUsers, ...users])];
    const displayUsers = allUsers.map((user) => (ops.has(user) ? `@${user}` : user));
    return [...displayUsers, ...botNicks];
  }

  function claimOwnerNick(ws, info) {
    if (info.nick === ownerNick) {
      return send(ws, "system", `*** Tu es déjà ${ownerNick} [ADMIN][OP]`);
    }
    if (isNickTaken(ownerNick, ws)) {
      return send(ws, "system", `*** ${ownerNick} est déjà connecté`);
    }

    const oldNick = info.nick;
    info.nick = ownerNick;
    send(ws, "system", `*** Bootstrap admin réussi. Tu es maintenant ${ownerNick} [ADMIN][OP]`);
    ws.send(JSON.stringify({ type: "nick_change", nick: ownerNick }));
    broadcast(info.channel, { type: "system", text: `*** ${oldNick} est maintenant @${ownerNick} [ADMIN]` }, ws);
    broadcastAll(info.channel, { type: "userlist", users: channelUsers(info.channel) });
  }

  return {
    clients,
    permanentUsers,
    send,
    broadcast,
    broadcastAll,
    channelUsers,
    findAvailableNick,
    claimOwnerNick,
  };
}

module.exports = {
  createClientRegistry,
};
