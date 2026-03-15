function attachWebSocketHandlers({
  wss,
  getAllPersonas,
  getPersonaById,
  adminBootstrapToken,
  getClientIp,
  runtime,
  registerUser,
  getSession,
  saveSession,
  clientRegistry,
  handleCommand,
  chatRouter,
  buildUploadCapability,
}) {
  const {
    clients,
    broadcast,
    broadcastAll,
    channelUsers,
    findAvailableNick,
  } = clientRegistry;
  const { enqueueChannel, handleMessage, replayHistory } = chatRouter;

  let clientId = 0;

  wss.on("connection", (ws, req) => {
    const id = ++clientId;
    const defaultNick = findAvailableNick(`user_${id}`);
    const info = {
      nick: defaultNick,
      channel: "#general",
      sessionId: `sess_${id}_${Date.now()}`,
      lastActivity: Date.now(),
      clientIp: typeof getClientIp === "function" ? getClientIp(req) : "",
    };

    clients.set(ws, info);
    getSession(info.sessionId);
    const allPersonas = getAllPersonas();

    ws.send(JSON.stringify({ type: "system", text: buildMotd({
      allPersonas,
      adminBootstrapToken,
      info,
      generalResponderLabel: runtime.generalResponderLabel(),
    }) }));

    for (const [name, persona] of Object.entries(allPersonas)) {
      ws.send(JSON.stringify({ type: "persona", nick: name, color: persona.color }));
    }

    registerUser(info.nick);

    broadcast(info.channel, {
      type: "join",
      nick: info.nick,
      channel: info.channel,
      text: `${info.nick} a rejoint ${info.channel}`,
    }, ws);

    ws.send(JSON.stringify({ type: "userlist", users: channelUsers(info.channel) }));
    const session = getSession(info.sessionId);
    const selectedPersona = session.persona ? getPersonaById(session.persona) : null;
    ws.send(JSON.stringify(runtime.buildChannelInfo(
      info.channel,
      session.model,
      selectedPersona?.name || null,
      selectedPersona?.id || session.persona || null
    )));
    if (typeof buildUploadCapability === "function") {
      ws.send(JSON.stringify(buildUploadCapability(info, session)));
    }
    replayHistory(ws, info.channel);

    ws.on("message", async (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      info.lastActivity = Date.now();

      if (message.type === "command") {
        await handleCommand(ws, info, message.text);
      } else if (message.type === "message") {
        enqueueChannel(info.channel, () => handleMessage(ws, info, message.text));
      }
    });

    ws.on("close", () => {
      broadcast(info.channel, {
        type: "part",
        nick: info.nick,
        channel: info.channel,
        text: `${info.nick} a quitté ${info.channel}`,
      });
      saveSession(info.sessionId, getSession(info.sessionId));
      clients.delete(ws);
    });
  });
}

function buildMotd({ allPersonas, adminBootstrapToken, info, generalResponderLabel }) {
  return [
    "***",
    "***  ██╗  ██╗██╗  ██╗██╗  ██╗███╗   ███╗",
    "***  ██║ ██╔╝╚██╗██╔╝██║ ██╔╝████╗ ████║",
    "***  █████╔╝  ╚███╔╝ █████╔╝ ██╔████╔██║",
    "***  ██╔═██╗  ██╔██╗ ██╔═██╗ ██║╚██╔╝██║",
    "***  ██║  ██╗██╔╝ ██╗██║  ██╗██║ ╚═╝ ██║",
    "***  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝",
    "***         🤡 C L O W N  v0.3.0 🤡",
    "***",
    "***  \"DON'T PANIC: le build a vu pire que ce commit.\"",
    "***  \"Space is the place, mais d'abord passe les tests.\"",
    "***",
    "***  ═══ AGENTS RÉSIDENTS ═══",
    ...Object.entries(allPersonas).map(([name, persona]) => `***    ● ${name.padEnd(12)} — ${persona.desc}`),
    "***",
    "***  ═══ COMMANDES ═══",
    "***  /help  /nick  /join  /model  /persona  /msg  /memory  /vote  /sessions",
    "***  @nom pour mentionner — /msg nom pour MP",
    `***  #general: ${generalResponderLabel}`,
    "***  Données locales: logs, mémoire, sessions, training et DPO écrits dans data/",
    ...(adminBootstrapToken ? ["***  Bootstrap admin: /saisail <token> (token + reseau autorise)"] : []),
    "***",
    "***  \"Le merveilleux commence au moment où la pipeline",
    "***   devient fiable.\" — electron rare",
    "***",
    `***  Nick: ${info.nick} | Canal: ${info.channel}`,
    `***  ton nick: ${info.nick}`,
    "***",
  ].join("\n");
}

module.exports = {
  attachWebSocketHandlers,
};
