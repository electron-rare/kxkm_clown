import React, { useState, useEffect, useRef, useCallback } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useMinitelSounds } from "../hooks/useMinitelSounds";
import MinitelConnect from "./MinitelConnect";
import MinitelFrame from "./MinitelFrame";

const WS_URL = import.meta.env.VITE_WS_URL || (() => {
  if (typeof window === "undefined") return "ws://127.0.0.1:4180/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
})();

interface ChatMsg {
  id: number;
  type: "system" | "message" | "join" | "part" | "persona" | "channelInfo" | "userlist" | "command" | "uploadCapability" | "audio" | "image" | "music";
  nick?: string;
  text?: string;
  color?: string;
  channel?: string;
  users?: string[];
  audioData?: string;
  audioMime?: string;
  imageData?: string;
  imageMime?: string;
  timestamp: number;
}

interface PersonaColor {
  [nick: string]: string;
}

const MAX_MESSAGES = 500;
const MAX_HISTORY = 100;
let msgIdCounter = 0;

interface ChatMessageProps {
  msg: ChatMsg;
  getNickColor: (nick: string) => string | undefined;
  channel: string;
}

const ChatMessage = React.memo(function ChatMessage({ msg, getNickColor, channel }: ChatMessageProps) {
  switch (msg.type) {
    case "system":
      return (
        <div className="chat-msg chat-msg-system">
          {(msg.text || "").split("\n").map((line, i) => (
            <div key={i}>{line || "\u00A0"}</div>
          ))}
        </div>
      );

    case "join":
      return (
        <div className="chat-msg chat-msg-system">
          {"-->  "}{msg.nick} a rejoint {msg.channel || channel}
        </div>
      );

    case "part":
      return (
        <div className="chat-msg chat-msg-system">
          {"<--  "}{msg.nick} a quitte {msg.channel || channel}
        </div>
      );

    case "audio": {
      const color = msg.nick ? getNickColor(msg.nick) : undefined;
      return (
        <div key={msg.id} className="chat-msg chat-msg-audio" style={color ? { color } : undefined}>
          <span className="chat-nick" style={color ? { color } : undefined}>
            {"<"}{msg.nick || "???"}{">"}{" "}
          </span>
          <span className="chat-audio-indicator">&#9835;</span>
          <button className="chat-audio-play" onClick={() => {
            if (msg.audioData && msg.audioMime) {
              const a = new Audio(`data:${msg.audioMime};base64,${msg.audioData}`);
              a.volume = 0.7;
              a.play().catch(() => {});
            }
          }}>&#9654;</button>
        </div>
      );
    }

    case "image": {
      const color = msg.nick ? getNickColor(msg.nick) : undefined;
      return (
        <div className="chat-msg chat-msg-image" style={color ? { color } : undefined}>
          <span className="chat-nick" style={color ? { color } : undefined}>
            {"<"}{msg.nick || "???"}{">"}{" "}
          </span>
          <span className="chat-text">{msg.text}</span>
          {msg.imageData && msg.imageMime && (
            <img
              src={`data:${msg.imageMime};base64,${msg.imageData}`}
              alt={msg.text || "Image generee"}
              className="chat-generated-image"
              style={{ maxWidth: "512px", maxHeight: "512px", display: "block", marginTop: "4px", borderRadius: "4px" }}
            />
          )}
        </div>
      );
    }

    case "music": {
      const color = msg.nick ? getNickColor(msg.nick) : undefined;
      return (
        <div key={msg.id} className="chat-msg chat-msg-music" style={color ? { color } : undefined}>
          <span className="chat-nick" style={color ? { color } : undefined}>
            {"<"}{msg.nick || "???"}{">"}{" "}
          </span>
          <span className="chat-text">{msg.text}</span>
          {msg.audioData && msg.audioMime && (
            <audio
              controls
              src={`data:${msg.audioMime};base64,${msg.audioData}`}
              style={{ display: "block", marginTop: "4px", maxWidth: "400px" }}
            />
          )}
        </div>
      );
    }

    case "message":
    default: {
      const color = msg.nick ? getNickColor(msg.nick) : undefined;
      const className = color ? "chat-msg chat-msg-persona" : "chat-msg chat-msg-user";
      return (
        <div
          className={className}
          style={color ? { color } : undefined}
        >
          <span className="chat-nick" style={color ? { color } : undefined}>
            {"<"}{msg.nick || "???"}{">"}{" "}
          </span>
          <span className="chat-text">{msg.text}</span>
        </div>
      );
    }
  }
});

export default function Chat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [channel, setChannel] = useState("#general");
  const [input, setInput] = useState("");
  const [personaColors, setPersonaColors] = useState<PersonaColor>({});
  const [showConnect, setShowConnect] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef("");
  const keyPressCountRef = useRef(0);

  const sounds = useMinitelSounds();

  const handleMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    const type = msg.type as ChatMsg["type"];

    switch (type) {
      case "persona":
        if (typeof msg.nick === "string" && typeof msg.color === "string") {
          const color = msg.color as string;
          if (/^#[0-9a-fA-F]{3,8}$|^[a-z]{3,20}$/i.test(color)) {
            setPersonaColors((prev) => ({ ...prev, [msg.nick as string]: color }));
          }
        }
        return;

      case "userlist":
        if (Array.isArray(msg.users)) {
          setUsers(msg.users as string[]);
        }
        return;

      case "channelInfo":
        if (typeof msg.channel === "string") {
          setChannel(msg.channel as string);
        }
        return;

      case "uploadCapability":
        // Silently ignore
        return;

      case "image": {
        const chatMsg: ChatMsg = {
          id: ++msgIdCounter,
          type: "image",
          nick: typeof msg.nick === "string" ? msg.nick : undefined,
          text: typeof msg.text === "string" ? msg.text : undefined,
          imageData: typeof msg.imageData === "string" ? msg.imageData : undefined,
          imageMime: typeof msg.imageMime === "string" ? msg.imageMime : undefined,
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          const next = [...prev, chatMsg];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
        return;
      }

      case "music": {
        const chatMsg: ChatMsg = {
          id: ++msgIdCounter,
          type: "music",
          nick: typeof msg.nick === "string" ? msg.nick : undefined,
          text: typeof msg.text === "string" ? msg.text : undefined,
          audioData: typeof msg.audioData === "string" ? msg.audioData : undefined,
          audioMime: typeof msg.audioMime === "string" ? msg.audioMime : undefined,
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          const next = [...prev, chatMsg];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
        return;
      }

      case "audio": {
        if (typeof msg.data === "string" && typeof msg.mimeType === "string") {
          // Add to messages as a playable audio message
          const chatMsg: ChatMsg = {
            id: ++msgIdCounter,
            type: "audio",
            nick: typeof msg.nick === "string" ? msg.nick : undefined,
            text: "\u266A message vocal",
            audioData: msg.data as string,
            audioMime: msg.mimeType as string,
            timestamp: Date.now(),
          };
          setMessages((prev) => {
            const next = [...prev, chatMsg];
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
          });
        }
        return;
      }

      default: {
        const chatMsg: ChatMsg = {
          id: ++msgIdCounter,
          type,
          nick: typeof msg.nick === "string" ? msg.nick : undefined,
          text: typeof msg.text === "string" ? msg.text : undefined,
          color: typeof msg.color === "string" ? msg.color : undefined,
          channel: typeof msg.channel === "string" ? msg.channel : undefined,
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          const next = [...prev, chatMsg];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });

        // Minitel receive beep for persona messages
        if (type === "message" && chatMsg.nick && personaColors[chatMsg.nick]) {
          sounds.receive();
        }

        // Update user list on join/part
        if (type === "join" && chatMsg.nick) {
          setUsers((prev) =>
            prev.includes(chatMsg.nick!) ? prev : [...prev, chatMsg.nick!]
          );
        } else if (type === "part" && chatMsg.nick) {
          setUsers((prev) => prev.filter((u) => u !== chatMsg.nick));
        }
      }
    }
  }, [sounds, personaColors]);

  const ws = useWebSocket({
    url: WS_URL,
    onMessage: handleMessage,
    enabled: true,
  });

  // Track whether user has scrolled up
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    function onScroll() {
      if (!container) return;
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 40;
      autoScrollRef.current = atBottom;
    }

    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (autoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Ref to always have current handleSend in the global keydown handler
  const handleSendRef = useRef<() => void>(() => {});

  // Global F-key handler (Minitel bar: F1=Sommaire F2=Suite F3=Retour F4=Annul F5=Envoi)
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "F1":
          e.preventDefault();
          window.location.hash = "#/";
          break;
        case "F2":
          e.preventDefault();
          messagesContainerRef.current?.scrollBy({ top: 300, behavior: "smooth" });
          break;
        case "F3":
          e.preventDefault();
          history.back();
          break;
        case "F4":
          e.preventDefault();
          setInput("");
          break;
        case "F5":
          e.preventDefault();
          handleSendRef.current();
          break;
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || !ws.connected) return;

    // Push to history
    historyRef.current.unshift(trimmed);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.pop();
    historyIndexRef.current = -1;
    savedInputRef.current = "";

    // /ulla easter egg
    if (trimmed.toLowerCase() === "/ulla") {
      const ullaMessages = [
        "\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557",
        "\u2551     3615 ULLA \u2014 MESSAGERIE       \u2551",
        "\u2551                                   \u2551",
        "\u2551  Salut beau gosse... \uD83D\uDE18           \u2551",
        "\u2551  Tu cherches quoi ce soir ?       \u2551",
        "\u2551  Tape 1 pour RENCONTRE            \u2551",
        "\u2551  Tape 2 pour DIALOGUE             \u2551",
        "\u2551  Tape 3 pour MYSTERE              \u2551",
        "\u2551                                   \u2551",
        "\u2551  0,34\u20AC/min \u2014 ah non, c'est       \u2551",
        "\u2551  gratuit ici, c'est du LOCAL \uD83C\uDFF4\u200D\u2620\uFE0F  \u2551",
        "\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D",
      ];
      ullaMessages.forEach((line, i) => {
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: ++msgIdCounter,
            type: "system",
            text: line,
            timestamp: Date.now(),
          }]);
        }, i * 200);
      });
      setInput("");
      return;
    }

    sounds.send();

    if (trimmed.startsWith("/")) {
      ws.send({ type: "command", text: trimmed });
    } else {
      ws.send({ type: "message", text: trimmed });
    }
    setInput("");
  }

  // Keep handleSendRef in sync
  useEffect(() => { handleSendRef.current = handleSend; });

  const [tabIndex, setTabIndex] = useState(-1);
  const [tabPrefix, setTabPrefix] = useState("");

  function handleKeyDown(e: React.KeyboardEvent) {
    // Debounced Minitel keyPress sound (every 3rd key)
    if (e.key.length === 1) {
      keyPressCountRef.current++;
      if (keyPressCountRef.current % 3 === 0) {
        sounds.keyPress();
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Tab completion for nicks and slash commands
    if (e.key === "Tab") {
      e.preventDefault();
      const text = input;

      // Slash command completion
      if (text.startsWith("/") && !text.includes(" ")) {
        const slashCommands = ["/help", "/clear", "/nick", "/join", "/channels", "/msg", "/web", "/imagine", "/compose", "/status", "/model", "/persona", "/reload", "/export"];
        const prefix = tabPrefix || text;
        const matches = slashCommands.filter((c) => c.startsWith(prefix.toLowerCase()));
        if (matches.length === 0) return;
        const nextIdx = (tabIndex + 1) % matches.length;
        setInput(matches[nextIdx] + " ");
        setTabIndex(nextIdx);
        if (!tabPrefix) setTabPrefix(prefix);
        return;
      }

      // Nick completion
      const words = text.split(" ");
      const lastWord = words[words.length - 1];
      const prefix = tabPrefix || lastWord;
      const matches = users.filter((u) =>
        u.toLowerCase().startsWith(prefix.toLowerCase()),
      );
      if (matches.length === 0) return;
      const nextIdx = (tabIndex + 1) % matches.length;
      words[words.length - 1] = matches[nextIdx] + (words.length === 1 ? ": " : " ");
      setInput(words.join(" "));
      setTabIndex(nextIdx);
      if (!tabPrefix) setTabPrefix(prefix);
      return;
    }

    // ArrowUp — navigate back through message history
    if (e.key === "ArrowUp") {
      const history = historyRef.current;
      if (history.length === 0) return;
      e.preventDefault();
      if (historyIndexRef.current < history.length - 1) {
        if (historyIndexRef.current === -1) savedInputRef.current = input;
        historyIndexRef.current++;
        setInput(history[historyIndexRef.current]);
      }
      return;
    }

    // ArrowDown — navigate forward through message history
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
        setInput(historyRef.current[historyIndexRef.current]);
      } else if (historyIndexRef.current === 0) {
        historyIndexRef.current = -1;
        setInput(savedInputRef.current);
      }
      return;
    }

    // Reset tab state on any other key
    if (tabIndex >= 0) {
      setTabIndex(-1);
      setTabPrefix("");
    }
  }

  const getNickColor = useCallback((nick: string): string | undefined => {
    return personaColors[nick];
  }, [personaColors]);

  if (showConnect) {
    return <MinitelConnect onComplete={() => setShowConnect(false)} skip={false} />;
  }

  return (
    <MinitelFrame channel={channel} connected={ws.connected}>
    <div className="chat-container">
      <div className="chat-header">
        <span className="chat-channel">{channel}</span>
        <span className={`chat-status ${ws.connected ? "chat-status-on" : "chat-status-off"}`}>
          {ws.connected ? "connecte" : "deconnecte"}
        </span>
      </div>

      <div className="chat-body">
        <div className="chat-messages" ref={messagesContainerRef}>
          {messages.map((msg) => (
            <ChatMessage key={msg.id} msg={msg} getNickColor={getNickColor} channel={channel} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-users">
          <div className="chat-users-header">Utilisateurs ({users.length})</div>
          {users.map((u) => (
            <div
              key={u}
              className="chat-user"
              style={personaColors[u] ? { color: personaColors[u] } : undefined}
            >
              {u}
            </div>
          ))}
        </div>
      </div>

      <div className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={ws.connected ? "Message ou /commande... (Tab pour compléter)" : "Connexion en cours..."}
          disabled={!ws.connected}
          autoFocus
        />
        <label className="btn btn-secondary chat-upload-btn" title="Joindre un fichier">
          +
          <input
            type="file"
            style={{ display: "none" }}
            accept="image/*,audio/*,text/*,.pdf,.json,.jsonl,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.epub,.html,.xml,.yaml,.yml,.toml,.ini,.log,.sh,.py,.js,.ts,.c,.cpp,.rs,.go,.java,.sql"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file || !ws.connected) return;
              const reader = new FileReader();
              reader.onload = () => {
                const base64 = (reader.result as string).split(",")[1];
                ws.send({
                  type: "upload",
                  filename: file.name,
                  mimeType: file.type,
                  size: file.size,
                  data: base64,
                });
              };
              reader.readAsDataURL(file);
              e.target.value = "";
            }}
            disabled={!ws.connected}
          />
        </label>
        <button
          className="btn btn-primary"
          onClick={handleSend}
          disabled={!ws.connected || !input.trim()}
        >
          Envoyer
        </button>
      </div>
    </div>
    </MinitelFrame>
  );
}
