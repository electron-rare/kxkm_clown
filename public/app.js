const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const chatContainerEl = document.getElementById("chat-container");
const connStatus = document.getElementById("conn-status");
const modelLabel = document.getElementById("model-label");
const modelSelect = document.getElementById("model-select");
const personaLabel = document.getElementById("persona-label");
const personaSelect = document.getElementById("persona-select");
const modelInfo = document.getElementById("model-info");
const personaInfo = document.getElementById("persona-info");
const uploadInfo = document.getElementById("upload-info");
const userlistEl = document.getElementById("userlist");
const channelsEl = document.getElementById("channels");
const channelFocusNameEl = document.getElementById("channel-focus-name");
const channelFocusMetaEl = document.getElementById("channel-focus-meta");
const channelFocusTopicEl = document.getElementById("channel-focus-topic");
const promptEl = document.getElementById("input-prompt");
const warningBanner = document.getElementById("warning-banner");
const attachButton = document.getElementById("attach-button");
const attachInput = document.getElementById("attach-input");
const inputAreaEl = document.getElementById("input-area");

let ws;
let myNick = "";
let currentChannel = "#general";
let history = [];
let histIdx = -1;
let generating = 0; // counter: number of active streams (0 = idle)
const MAX_DOM_MESSAGES = 500;
let availablePersonas = [];
let lastChannelInfo = null;
let knownChannels = [];
let uploadCapability = null;
let uploadInFlight = 0;
const attachmentCards = new Map();

// Per-bot streaming state (fixes concurrent stream clobbering)
const streamingBots = new Map(); // nick -> { el, text }
const botColors = {}; // nick -> color name (populated by "persona" messages)
let thinkingEl = null;
let thinkingInterval = null;

// ── Thinking animation ──

const THINK_FRAMES = [
  [
    "    🤡        ",
    "   /|\\   i'm  ",
    "   / \\  thinking",
    "  about a trust...",
  ],
  [
    "    🤡        ",
    "   \\|/   i'm  ",
    "   / \\  thinking",
    "  about a trust...",
  ],
  [
    "    🤡        ",
    "   /|\\   i'm  ",
    "   | |  thinking",
    "  about a trust...",
  ],
  [
    "    🤡        ",
    "   \\|/   i'm  ",
    "   | |  thinking",
    "  about a trust...",
  ],
];

const THINK_BRAINS = [
  "  ╭─────────────────╮",
  "  │  ◠ _ ◠  trust?  │",
  "  │  ░▒▓▓▒░  hmm... │",
  "  ╰─────────────────╯",
];

let thinkFrame = 0;
let thinkDots = 0;

function startThinking(nick) {
  stopThinking(); // Kill any previous thinking animation (P2-1 singleton fix)
  thinkingEl = document.createElement("div");
  thinkingEl.className = "thinking-box";
  messagesEl.appendChild(thinkingEl);
  thinkFrame = 0;
  thinkDots = 0;
  const safeNick = esc(nick); // P1: XSS fix

  thinkingInterval = setInterval(() => {
    if (!thinkingEl) return;
    const frame = THINK_FRAMES[thinkFrame % THINK_FRAMES.length];
    thinkDots = (thinkDots + 1) % 4;
    const dots = ".".repeat(thinkDots + 1);
    const elapsed = ((Date.now() - thinkStart) / 1000).toFixed(0);

    const art = [
      `<span class="think-ascii">${frame[0]}</span>`,
      `<span class="think-ascii">${frame[1]}</span>`,
      `<span class="think-ascii">${frame[2]}</span>`,
      `<span class="think-text">${frame[3]}${dots}</span>`,
      ``,
      `<span class="think-dots">  ⏱ ${elapsed}s — ${safeNick} is loading${dots}</span>`,
    ].join("\n");

    thinkingEl.innerHTML = art;
    scrollBottom();
    thinkFrame++;
  }, 400);

  scrollBottom();
}

let thinkStart = 0;

function stopThinking() {
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
  }
  if (thinkingEl) {
    thinkingEl.remove();
    thinkingEl = null;
  }
}

// ── WebSocket ──

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    connStatus.textContent = "connecté";
    connStatus.style.color = "#00cc66";
    // Reset state on reconnect
    generating = 0;
    streamingBots.clear();
    uploadCapability = null;
    uploadInFlight = 0;
    stopThinking();
    refreshUploadState();
    // Set chosen nickname
    if (chosenNick) {
      ws.send(JSON.stringify({ type: "command", text: `/nick ${chosenNick}` }));
    }
    // Rejoin current channel if not default
    if (currentChannel && currentChannel !== "#general") {
      ws.send(JSON.stringify({ type: "command", text: `/join ${currentChannel}` }));
    }
    loadModels();
    loadPersonas();
  };

  ws.onclose = () => {
    connStatus.textContent = "déconnecté — reconnexion...";
    connStatus.style.color = "#cc4444";
    uploadCapability = null;
    uploadInFlight = 0;
    refreshUploadState();
    setTimeout(connect, 2000);
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleMsg(msg);
    } catch (err) {
      console.error("[ws] malformed message:", err);
    }
  };
}

function handleMsg(msg) {
  switch (msg.type) {
    case "system":
      appendSystem(msg.text);
      // Capture nick from welcome
      const nickMatch = msg.text.match(/ton nick: (\S+)/);
      if (nickMatch) {
        myNick = nickMatch[1];
        promptEl.textContent = `${myNick}>`;
      }
      break;

    case "message":
      appendChat(msg.nick, msg.text, msg.nick === myNick);
      break;

    case "join":
      appendLine("join", msg.text);
      break;

    case "part":
      appendLine("part", msg.text);
      break;

    case "stream_start": {
      generating++;
      thinkStart = Date.now();
      startThinking(msg.nick);
      streamingBots.set(msg.nick, { el: null, text: "" });
      break;
    }

    case "stream_token": {
      const bot = streamingBots.get(msg.nick);
      if (!bot) break;
      // First token: kill thinking, create streaming element
      if (!bot.el) {
        stopThinking();
        bot.el = appendStreaming(msg.nick);
      }
      bot.text += msg.text;
      bot.el.querySelector(".text").textContent = bot.text;
      scrollBottom();
      break;
    }

    case "stream_end": {
      stopThinking();
      const bot = streamingBots.get(msg.nick);
      if (bot?.el) {
        bot.el.classList.remove("streaming");
        // Re-render final text with colorized nicks
        const textEl = bot.el.querySelector(".text");
        if (textEl && bot.text) {
          textEl.innerHTML = colorizeNicks(bot.text);
        }
        if (msg.stats) {
          const statsSpan = document.createElement("span");
          statsSpan.className = "stats";
          statsSpan.textContent = " " + msg.stats;
          bot.el.appendChild(statsSpan);
        }
      }
      streamingBots.delete(msg.nick);
      generating = Math.max(0, generating - 1);
      pruneDOM();
      break;
    }

    case "nick_change":
      myNick = msg.nick;
      promptEl.textContent = `${myNick}>`;
      break;

    case "persona":
      // Store bot color mapping
      botColors[msg.nick] = msg.color;
      break;

    case "pm": {
      // Incoming private message
      const pmDiv = document.createElement("div");
      pmDiv.className = "msg pm";
      const col = botColors[msg.from] || "white";
      pmDiv.innerHTML = `<span class="ts">[${ts()}]</span> <span style="color:var(--${col === 'cyan' ? 'bot-schaeffer' : col === 'red' ? 'bot-batty' : col === 'violet' ? 'bot-radigue' : col === 'orange' ? 'bot-moorcock' : 'magenta'})">★ MP de ${esc(msg.from)}:</span> <span class="text">${esc(msg.text)}</span>`;
      messagesEl.appendChild(pmDiv);
      scrollBottom();
      break;
    }

    case "pm_sent": {
      const pmDiv = document.createElement("div");
      pmDiv.className = "msg pm";
      pmDiv.innerHTML = `<span class="ts">[${ts()}]</span> <span style="color:var(--fg-dim)">★ MP</span> <span class="text" style="color:var(--fg-dim)">${esc(msg.text)}</span>`;
      messagesEl.appendChild(pmDiv);
      scrollBottom();
      break;
    }

    case "pm_token": {
      let pmBot = streamingBots.get("pm_" + msg.from);
      if (!pmBot) {
        const el = document.createElement("div");
        el.className = "msg pm streaming";
        const col = botColors[msg.from] || "magenta";
        el.innerHTML = `<span class="ts">[${ts()}]</span> <span style="color:var(--${col === 'cyan' ? 'bot-schaeffer' : col === 'red' ? 'bot-batty' : col === 'violet' ? 'bot-radigue' : col === 'orange' ? 'bot-moorcock' : 'magenta'})">★ MP ${esc(msg.from)}:</span> <span class="text"></span>`;
        messagesEl.appendChild(el);
        pmBot = { el, text: "" };
        streamingBots.set("pm_" + msg.from, pmBot);
      }
      pmBot.text += msg.text;
      pmBot.el.querySelector(".text").textContent = pmBot.text;
      scrollBottom();
      break;
    }

    case "pm_end": {
      const pmBot = streamingBots.get("pm_" + msg.from);
      if (pmBot?.el) {
        pmBot.el.classList.remove("streaming");
        if (msg.stats) {
          const s = document.createElement("span");
          s.className = "stats";
          s.textContent = " " + msg.stats;
          pmBot.el.appendChild(s);
        }
      }
      streamingBots.delete("pm_" + msg.from);
      break;
    }

    case "channel_info":
      lastChannelInfo = msg;
      knownChannels = knownChannels.map((channel) =>
        channel.name === msg.channel
          ? {
              ...channel,
              type: msg.channelType,
              model: msg.model,
              topic: msg.topic,
              responders: msg.generalResponders,
              respondersMode: msg.generalRespondersMode,
            }
          : channel
      );
      renderChannels(knownChannels);
      loadPersonas();
      const topicText = msg.topic ? `topic: ${msg.topic}` : "";
      if (msg.channelType === "general") {
        modelLabel.style.display = "none";
        modelSelect.style.display = "none";
        personaLabel.style.display = "none";
        personaSelect.style.display = "none";
        modelInfo.textContent = msg.generalRespondersMode === "all"
          ? `toutes les personas actives répondent (${msg.generalResponders})`
          : `${msg.generalResponders} personas max par message`;
        personaInfo.textContent = topicText;
      } else if (msg.channelType === "admin") {
        modelLabel.style.display = "";
        modelSelect.style.display = "";
        personaLabel.style.display = "";
        personaSelect.style.display = "";
        modelInfo.textContent = msg.model ? msg.model : "— choisis avec /model —";
        modelSelect.value = msg.model || "";
        personaInfo.textContent = topicText;
        refreshPersonaSelect(msg);
      } else {
        modelLabel.style.display = "";
        modelSelect.style.display = "none";
        personaLabel.style.display = "";
        personaSelect.style.display = "";
        modelInfo.textContent = msg.model + " (dédié)";
        personaInfo.textContent = topicText;
        refreshPersonaSelect(msg);
      }
      break;

    case "upload_capability":
      uploadCapability = msg;
      refreshUploadState();
      break;

    case "attachment_uploaded":
      upsertAttachmentCard(msg.attachment, {
        status: "uploaded",
        time: msg.time,
      });
      break;

    case "attachment_analysis":
      upsertAttachmentCard(msg.attachment, {
        status: "ready",
        summary: msg.summary,
        generator: msg.generator,
        warnings: msg.warnings,
        time: msg.time,
      });
      break;

    case "attachment_failed":
      upsertAttachmentCard(msg.attachment, {
        status: "failed",
        error: msg.error,
        time: msg.time,
      });
      break;

    case "history_msg": {
      // Replayed history message (from channel history)
      const div = document.createElement("div");
      const isBot = !!msg.bot;
      const txtClass = isBot ? botTextClass(msg.nick) : "";
      div.className = `msg ${txtClass}`;
      div.style.opacity = "0.7"; // dim history messages
      const nickClass = isBot ? botNickClass(msg.nick) : "user-nick";
      const timeStr = msg.time || "";
      div.innerHTML = `<span class="ts">[${esc(timeStr)}]</span> <span class="nick ${nickClass}">&lt;${esc(msg.nick)}&gt;</span> <span class="text">${colorizeNicks(msg.text)}</span>`;
      messagesEl.appendChild(div);
      scrollBottom();
      break;
    }

    case "userlist":
      renderUsers(msg.users);
      break;
  }
}

// ── Rendering ──

function ts() {
  return new Date().toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" });
}

function appendSystem(text) {
  const lines = text.split("\n");
  lines.forEach(line => {
    const div = document.createElement("div");
    div.className = "msg system";
    div.innerHTML = `<span class="ts">[${ts()}]</span> <span class="text">${esc(line)}</span>`;
    messagesEl.appendChild(div);
  });
  pruneDOM();
  scrollBottom();
}

function describeChannelMeta(channel) {
  if (!channel) return "canal";
  if (channel.type === "general") {
    const badge = channel.respondersMode === "all"
      ? `toutes les personas · ${channel.responders || 0}`
      : `${channel.responders || 0} max`;
    return `salon général · ${badge}`;
  }
  if (channel.type === "admin") {
    return "canal admin · choix libre";
  }
  if (channel.model) {
    return `canal dédié · ${channel.model}`;
  }
  return channel.type || "canal";
}

function channelTopicText(channel) {
  return channel?.topic || "Aucun topic explicite pour ce canal.";
}

function renderChannelFocus() {
  const active = knownChannels.find((channel) => channel.name === currentChannel) || lastChannelInfo || { channel: currentChannel, name: currentChannel };
  channelFocusNameEl.textContent = active.name || active.channel || currentChannel;
  channelFocusMetaEl.textContent = describeChannelMeta(active);
  channelFocusTopicEl.textContent = channelTopicText(active);
}

function renderChannels(channels) {
  knownChannels = channels;
  channelsEl.innerHTML = "";
  channels.forEach((ch) => {
    const div = document.createElement("div");
    div.className = "chan" + (ch.name === currentChannel ? " active" : "");
    div.dataset.chan = ch.name;
    if (ch.topic) div.title = ch.topic;

    let badge = "";
    if (ch.type === "general") {
      badge = ch.respondersMode === "all" ? `all ${ch.responders}` : `${ch.responders} max`;
    } else if (ch.type === "admin") {
      badge = "pick";
    } else if (ch.model) {
      badge = ch.model.split(":")[0];
    }

    div.innerHTML = `
      <div class="chan-head">
        <span class="chan-name">${esc(ch.name)}</span>
        <span class="chan-badge">${esc(badge)}</span>
      </div>
      <div class="chan-meta">${esc(describeChannelMeta(ch))}</div>
      <div class="chan-topic">${esc(channelTopicText(ch))}</div>
    `;
    channelsEl.appendChild(div);
  });
  renderChannelFocus();
}

function normalizePersonaPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload).map(([name, persona]) => ({
    name,
    id: persona.id,
    model: persona.model,
    desc: persona.desc,
    style: persona.style,
    color: persona.color,
    tags: persona.tags || [],
    priority: persona.priority || 0,
    generalEnabled: persona.generalEnabled !== false,
    defaultForModel: Boolean(persona.defaultForModel),
  }));
}

function refreshPersonaSelect(channelInfo = lastChannelInfo) {
  const personasForModel = channelInfo?.model
    ? availablePersonas.filter((persona) => persona.model === channelInfo.model)
    : [];

  personaSelect.innerHTML = "";

  if (!channelInfo || channelInfo.channelType === "general") {
    personaSelect.disabled = true;
    personaSelect.innerHTML = '<option value="">— persona —</option>';
    personaInfo.textContent = "";
    return;
  }

  if (!channelInfo.model) {
    personaSelect.disabled = true;
    personaSelect.innerHTML = '<option value="">— choisis un modèle —</option>';
    personaInfo.textContent = "Sélectionne d'abord un modèle sur #admin.";
    return;
  }

  if (!personasForModel.length) {
    personaSelect.disabled = true;
    personaSelect.innerHTML = '<option value="">— aucune persona —</option>';
    personaInfo.textContent = `Aucune persona configurée pour ${channelInfo.model}.`;
    return;
  }

  personaSelect.disabled = false;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— sélectionner —";
  personaSelect.appendChild(placeholder);

  personasForModel.forEach((persona) => {
    const option = document.createElement("option");
    option.value = persona.id;
    option.textContent = persona.defaultForModel
      ? `${persona.name} [défaut]`
      : persona.name;
    personaSelect.appendChild(option);
  });

  const fallbackPersona = personasForModel.find((persona) => persona.defaultForModel) || personasForModel[0];
  const activePersonaId = channelInfo.personaId
    || personasForModel.find((persona) => persona.name === channelInfo.persona)?.id
    || fallbackPersona?.id
    || "";
  personaSelect.value = activePersonaId;

  const activePersona = personasForModel.find((persona) => persona.id === activePersonaId);
  personaInfo.textContent = activePersona
    ? `${activePersona.name} — ${activePersona.desc}`
    : `${personasForModel.length} personas pour ${channelInfo.model}`;
}

// Map color name → CSS nick class
const colorToNickClass = {
  cyan: "bot-schaeffer", red: "bot-batty", violet: "bot-radigue", orange: "bot-moorcock",
  green: "bot-oliveros", yellow: "bot-sunra", blue: "bot-lessig", pink: "bot-leckie",
  magenta: "bot-leary", white: "bot-tolkien", lime: "bot-russell",
  teal: "bot-gibson", sand: "bot-herbert", ice: "bot-ikeda", crimson: "bot-anarchiste",
};

// Map color name → CSS text rainbow class
const colorToTextClass = {
  cyan: "bot-text-schaeffer", red: "bot-text-batty", violet: "bot-text-radigue", orange: "bot-text-moorcock",
  green: "bot-text-oliveros", yellow: "bot-text-sunra", blue: "bot-text-lessig", pink: "bot-text-leckie",
  magenta: "bot-text-leary", white: "bot-text-tolkien", lime: "bot-text-russell",
  teal: "bot-text-gibson", sand: "bot-text-herbert", ice: "bot-text-ikeda", crimson: "bot-text-anarchiste",
};

// Map color name → CSS variable
const colorVarMap = {
  cyan: "--bot-schaeffer", red: "--bot-batty", violet: "--bot-radigue", orange: "--bot-moorcock",
  green: "--bot-oliveros", yellow: "--bot-sunra", blue: "--bot-lessig", pink: "--bot-leckie",
  magenta: "--bot-leary", white: "--bot-tolkien", lime: "--bot-russell",
  teal: "--bot-gibson", sand: "--bot-herbert", ice: "--bot-ikeda", crimson: "--bot-anarchiste",
};

function botNickClass(nick) {
  const color = botColors[nick];
  if (!color) return "bot-nick";
  return colorToNickClass[color] || "bot-nick";
}

function botTextClass(nick) {
  const color = botColors[nick];
  if (!color) return "";
  return colorToTextClass[color] || "";
}

function colorizeNicks(text) {
  let result = esc(text);
  // Build all replacements in a single pass to avoid ordering bugs (P1-2)
  const replacements = [];
  // Collect @myNick matches
  if (myNick && myNick.length > 1) {
    const re = new RegExp(`@${myNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    let m;
    while ((m = re.exec(result)) !== null) {
      replacements.push({ start: m.index, end: m.index + m[0].length, html: `<span style="background:var(--violet);color:var(--white);padding:0 3px;border-radius:2px">@${esc(myNick)}</span>` });
    }
  }
  // Collect bot name matches
  for (const [bNick, bColor] of Object.entries(botColors)) {
    const cssVar = colorVarMap[bColor] || "--magenta";
    const re = new RegExp(`\\b${bNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    let m;
    while ((m = re.exec(result)) !== null) {
      // Skip if overlapping with existing replacement
      const overlaps = replacements.some((r) => m.index < r.end && m.index + m[0].length > r.start);
      if (!overlaps) {
        replacements.push({ start: m.index, end: m.index + m[0].length, html: `<span style="color:var(${cssVar});font-weight:bold">${esc(bNick)}</span>` });
      }
    }
  }
  // Apply replacements from end to start to preserve indices
  replacements.sort((a, b) => b.start - a.start);
  for (const r of replacements) {
    result = result.slice(0, r.start) + r.html + result.slice(r.end);
  }
  return result;
}

function appendChat(nick, text, isMe) {
  const div = document.createElement("div");
  const txtClass = isMe ? "" : botTextClass(nick);
  div.className = `msg ${txtClass}`;
  const nickClass = isMe ? "user-nick" : botNickClass(nick);
  div.innerHTML = `<span class="ts">[${ts()}]</span> <span class="nick ${nickClass}">&lt;${esc(nick)}&gt;</span> <span class="text">${colorizeNicks(text)}</span>`;
  messagesEl.appendChild(div);
  scrollBottom();
}

function appendStreaming(nick) {
  const div = document.createElement("div");
  const txtClass = botTextClass(nick);
  div.className = `msg streaming ${txtClass}`;
  const nickClass = botNickClass(nick);
  div.innerHTML = `<span class="ts">[${ts()}]</span> <span class="nick ${nickClass}">&lt;${esc(nick)}&gt;</span> <span class="text"></span>`;
  messagesEl.appendChild(div);
  scrollBottom();
  return div;
}

function appendLine(type, text) {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.innerHTML = `<span class="ts">[${ts()}]</span> <span class="text">${esc(text)}</span>`;
  messagesEl.appendChild(div);
  pruneDOM();
  scrollBottom();
}

function renderUsers(users) {
  userlistEl.innerHTML = "";
  // Sort: permanent users first, then humans, then bots
  const bots = users.filter(u => botColors[u]);
  const humans = users.filter(u => !botColors[u]);

  // Render humans
  humans.forEach(u => {
    const div = document.createElement("div");
    div.className = "user";
    if (u === myNick) div.style.color = "var(--white)";
    div.textContent = u;
    userlistEl.appendChild(div);
  });

  // Separator if both
  if (humans.length && bots.length) {
    const sep = document.createElement("div");
    sep.style.cssText = "color:var(--fg-dim);font-size:14px;padding:4px 0 2px;border-top:1px solid var(--border);margin-top:4px;";
    sep.textContent = `── agents (${bots.length}) ──`;
    userlistEl.appendChild(sep);
  }

  // Render bots with their color
  bots.forEach(u => {
    const div = document.createElement("div");
    div.className = "user bot";
    const cssVar = colorVarMap[botColors[u]] || "--magenta";
    div.innerHTML = `<span style="font-size:12px;color:var(${cssVar})">● </span>${esc(u)}`;
    div.style.color = `var(${cssVar})`;
    userlistEl.appendChild(div);
  });
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function pruneDOM() {
  while (messagesEl.children.length > MAX_DOM_MESSAGES) {
    messagesEl.removeChild(messagesEl.firstChild);
  }
}

const _escEl = document.createElement("div");
function esc(s) {
  _escEl.textContent = s;
  return _escEl.innerHTML;
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} Ko`;
  return `${Math.round(size / 1024 / 102.4) / 10} Mo`;
}

function attachmentPreviewText(attachment, details = {}) {
  const analysis = attachment?.analysis || {};
  return (
    analysis.extractedText
    || analysis.transcript
    || analysis.caption
    || details.summary
    || ""
  ).trim();
}

function attachmentStatusLabel(status) {
  switch (status) {
    case "ready": return "analyse prête";
    case "extracting": return "analyse en cours";
    case "failed": return "analyse échouée";
    default: return "fichier reçu";
  }
}

function upsertAttachmentCard(attachment, details = {}) {
  if (!attachment?.id) return;

  let row = attachmentCards.get(attachment.id);
  if (!row) {
    row = document.createElement("div");
    row.className = "msg attachment-row";
    row.dataset.attachmentId = attachment.id;
    messagesEl.appendChild(row);
    attachmentCards.set(attachment.id, row);
  }

  const warnings = Array.isArray(details.warnings)
    ? details.warnings
    : (attachment.analysis?.warnings || []);
  const preview = attachmentPreviewText(attachment, details);
  const summaryText = attachment.analysis?.sourceSummary
    || details.summary
    || "Pièce jointe locale en cours d’analyse.";
  const status = details.status || attachment.status || "uploaded";
  const pharmaciusNote = details.summary || "";
  const errorMessage = details.error || attachment.error?.message || "";

  row.className = `msg attachment-row ${status}`;
  row.innerHTML = `
    <div class="attachment-card">
      <div class="attachment-head">
        <span class="ts">[${esc(details.time || ts())}]</span>
        <span class="attachment-pill status-${esc(attachment.kind || "file")}">${esc(attachment.kind || "file")}</span>
        <span class="attachment-pill status-${esc(status)}">${esc(attachmentStatusLabel(status))}</span>
        <span class="attachment-name">${esc(attachment.originalName || attachment.id)}</span>
      </div>
      <div class="attachment-meta">${esc(attachment.nick || "local")} · ${esc(attachment.mime || "application/octet-stream")} · ${esc(formatBytes(attachment.sizeBytes))}</div>
      <div class="attachment-summary">${esc(summaryText)}</div>
      ${pharmaciusNote ? `<div class="attachment-pharmacius">Pharmacius: ${esc(pharmaciusNote)}</div>` : ""}
      ${warnings.length ? `<div class="attachment-warnings">Vigilance: ${warnings.map((warning) => esc(warning)).join(" | ")}</div>` : ""}
      ${errorMessage ? `<div class="attachment-warnings">Erreur: ${esc(errorMessage)}</div>` : ""}
      ${attachment.downloadUrl ? `<a class="attachment-download" href="${esc(attachment.downloadUrl)}" target="_blank" rel="noopener">ouvrir le fichier</a>` : ""}
      ${preview ? `<details class="attachment-preview"><summary>aperçu</summary><pre>${esc(preview.slice(0, 1600))}</pre></details>` : ""}
    </div>
  `;

  pruneDOM();
  scrollBottom();
}

function acceptedKindsText(capability = uploadCapability) {
  if (!capability?.acceptedKinds?.length) return "fichiers indisponibles";
  return capability.acceptedKinds.join(" · ");
}

function setDragUpload(active) {
  inputAreaEl?.classList.toggle("dragover", Boolean(active));
  chatContainerEl.classList.toggle("drag-upload", Boolean(active));
}

function refreshUploadState() {
  if (!attachButton || !uploadInfo) return;

  const available = Boolean(uploadCapability?.sessionId && uploadCapability?.uploadToken && ws?.readyState === 1);
  attachButton.disabled = !available || uploadInFlight > 0;

  if (!available) {
    attachButton.title = "Upload indisponible";
    uploadInfo.textContent = "fichiers: indisponible";
    setDragUpload(false);
    return;
  }

  attachButton.title = `Joindre un fichier (${acceptedKindsText()})`;
  const maxBytes = Number(uploadCapability.maxUploadBytes) || 0;
  const maxText = maxBytes ? ` · max ${formatBytes(maxBytes)}` : "";
  const busyText = uploadInFlight > 0 ? ` · ${uploadInFlight} envoi(s)` : "";
  uploadInfo.textContent = `fichiers: ${acceptedKindsText()}${maxText}${busyText}`;
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;

  if (!uploadCapability?.sessionId || !uploadCapability?.uploadToken) {
    appendSystem("*** Upload indisponible pour cette session.");
    return;
  }

  for (const file of files) {
    if (uploadCapability.maxUploadBytes && file.size > uploadCapability.maxUploadBytes) {
      appendSystem(`*** ${file.name}: fichier trop volumineux (${formatBytes(file.size)} > ${formatBytes(uploadCapability.maxUploadBytes)})`);
      continue;
    }

    uploadInFlight += 1;
    refreshUploadState();

    try {
      const response = await fetch("/api/chat/attachments", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-chat-session-id": uploadCapability.sessionId,
          "x-chat-upload-token": uploadCapability.uploadToken,
          "x-file-name": encodeURIComponent(file.name || "attachment.bin"),
          "x-file-mime": file.type || "application/octet-stream",
        },
        body: file,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || `upload ${response.status}`);
      }
    } catch (error) {
      appendSystem(`*** Upload impossible pour ${file.name}: ${error.message}`);
    } finally {
      uploadInFlight = Math.max(0, uploadInFlight - 1);
      refreshUploadState();
      attachInput.value = "";
    }
  }
}

// ── Input ──

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const text = inputEl.value.trim();
    if (!text) return;

    history.unshift(text);
    if (history.length > 100) history.pop();
    histIdx = -1;

    if (text.startsWith("/")) {
      ws.send(JSON.stringify({ type: "command", text }));
    } else {
      ws.send(JSON.stringify({ type: "message", text }));
    }

    inputEl.value = "";
  } else if (e.key === "ArrowUp") {
    if (histIdx < history.length - 1) {
      histIdx++;
      inputEl.value = history[histIdx];
    }
    e.preventDefault();
  } else if (e.key === "ArrowDown") {
    if (histIdx > 0) {
      histIdx--;
      inputEl.value = history[histIdx];
    } else {
      histIdx = -1;
      inputEl.value = "";
    }
    e.preventDefault();
  } else if (e.key === "Tab") {
    e.preventDefault();
    const val = inputEl.value;
    const cursorPos = inputEl.selectionStart;
    // Find the word being typed (before cursor)
    const beforeCursor = val.slice(0, cursorPos);
    const wordMatch = beforeCursor.match(/(\S+)$/);
    if (!wordMatch) return;
    const partial = wordMatch[1];
    const wordStart = cursorPos - partial.length;

    if (val.startsWith("/") && wordStart === 0) {
      // Tab complete for commands
      const cmds = ["/nick","/join","/model","/persona","/system","/clear","/who","/stop","/sessions","/help","/msg","/vote","/kick","/op","/deop","/whois","/notice","/topic","/quit","/memory"];
      const match = cmds.filter(c => c.startsWith(partial));
      if (match.length === 1) inputEl.value = match[0] + " " + val.slice(cursorPos);
    } else {
      // Tab complete for nicks (bot + human)
      const allNicks = Object.keys(botColors);
      // Add visible human nicks from userlist
      document.querySelectorAll("#userlist .user:not(.bot)").forEach(el => {
        const nick = el.textContent.replace(/^@/, "").trim();
        if (nick && !allNicks.includes(nick)) allNicks.push(nick);
      });
      const lowerPartial = partial.replace(/^@/, "").toLowerCase();
      const prefix = partial.startsWith("@") ? "@" : "";
      const matches = allNicks.filter(n => n.toLowerCase().startsWith(lowerPartial));
      if (matches.length === 1) {
        inputEl.value = val.slice(0, wordStart) + prefix + matches[0] + " " + val.slice(cursorPos);
      } else if (matches.length > 1) {
        // Show matches as system hint
        appendSystem("Tab: " + matches.join(", "));
      }
    }
  }
});

attachButton?.addEventListener("click", () => {
  if (attachButton.disabled) return;
  attachInput?.click();
});

attachInput?.addEventListener("change", async (event) => {
  await uploadFiles(event.target.files);
});

["dragenter", "dragover"].forEach((eventName) => {
  chatContainerEl.addEventListener(eventName, (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    setDragUpload(true);
  });
});

["dragleave", "dragend"].forEach((eventName) => {
  chatContainerEl.addEventListener(eventName, (event) => {
    if (event.target === chatContainerEl || event.target === inputAreaEl) {
      setDragUpload(false);
    }
  });
});

chatContainerEl.addEventListener("drop", async (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  setDragUpload(false);
  await uploadFiles(event.dataTransfer.files);
});

// ── Model selector ──

async function loadModels() {
  try {
    const res = await fetch("/api/models");
    const models = await res.json();
    modelSelect.innerHTML = '<option value="">— sélectionner —</option>';
    models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = `${m.name} [${m.size}]`;
      modelSelect.appendChild(opt);
    });
  } catch (e) {
    modelSelect.innerHTML = '<option value="">erreur chargement</option>';
  }
}

async function loadPersonas() {
  try {
    const res = await fetch("/api/personas");
    availablePersonas = normalizePersonaPayload(await res.json());
  } catch (e) {
    availablePersonas = [];
  }

  refreshPersonaSelect(lastChannelInfo);
}

modelSelect.addEventListener("change", () => {
  const model = modelSelect.value;
  if (model) {
    lastChannelInfo = { ...(lastChannelInfo || {}), model, persona: null, personaId: null };
    ws.send(JSON.stringify({ type: "command", text: `/model ${model}` }));
    modelInfo.textContent = model;
    refreshPersonaSelect(lastChannelInfo);
  }
});

personaSelect.addEventListener("change", () => {
  const personaId = personaSelect.value;
  if (personaId) {
    const selectedPersona = availablePersonas.find((persona) => persona.id === personaId) || null;
    lastChannelInfo = {
      ...(lastChannelInfo || {}),
      persona: selectedPersona?.name || null,
      personaId,
    };
    ws.send(JSON.stringify({ type: "command", text: `/persona ${personaId}` }));
    refreshPersonaSelect(lastChannelInfo);
  }
});

// ── Channel clicks ──

channelsEl.addEventListener("click", (e) => {
  const chanEl = e.target.closest(".chan");
  if (!chanEl) return;
  const chan = chanEl.dataset.chan;
  if (chan === currentChannel) return;

  document.querySelectorAll("#channels .chan").forEach(c => c.classList.remove("active"));
  chanEl.classList.add("active");
  currentChannel = chan;
  renderChannelFocus();
  ws.send(JSON.stringify({ type: "command", text: `/join ${chan}` }));
});

// ── Load channels dynamically ──

async function loadChannels() {
  try {
    const res = await fetch("/api/channels");
    const channels = await res.json();
    renderChannels(channels);
  } catch (e) {
    console.error("Failed to load channels:", e);
  }
}

// ── Nickname modal ──

const nickModal = document.getElementById("nick-modal");
const nickInput = document.getElementById("nick-input");
const mainEl = document.getElementById("main");
const titlebar = document.getElementById("titlebar");
let chosenNick = "";

function enterChat(nick) {
  chosenNick = nick;
  nickModal.style.display = "none";
  mainEl.style.display = "flex";
  titlebar.style.display = "";
  warningBanner.style.display = "block";
  loadChannels();
  connect();
  inputEl.focus();
}

nickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = nickInput.value.trim();
    const nick = val.replace(/\s+/g, "_");
    if (!nick) return;
    enterChat(nick);
  }
});

nickInput.focus();
