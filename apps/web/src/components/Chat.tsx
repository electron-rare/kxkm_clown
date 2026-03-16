import { useState, useEffect, useRef, useCallback } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:3333";

interface ChatMsg {
  id: number;
  type: "system" | "message" | "join" | "part" | "persona" | "channelInfo" | "userlist" | "command" | "uploadCapability";
  nick?: string;
  text?: string;
  color?: string;
  channel?: string;
  users?: string[];
  timestamp: number;
}

interface PersonaColor {
  [nick: string]: string;
}

let msgIdCounter = 0;

export default function Chat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [channel, setChannel] = useState("#general");
  const [input, setInput] = useState("");
  const [personaColors, setPersonaColors] = useState<PersonaColor>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const handleMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    const type = msg.type as ChatMsg["type"];

    switch (type) {
      case "persona":
        if (typeof msg.nick === "string" && typeof msg.color === "string") {
          setPersonaColors((prev) => ({ ...prev, [msg.nick as string]: msg.color as string }));
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
        setMessages((prev) => [...prev, chatMsg]);

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
  }, []);

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

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || !ws.connected) return;

    if (trimmed.startsWith("/")) {
      ws.send({ type: "command", text: trimmed });
    } else {
      ws.send({ type: "message", text: trimmed });
    }
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function getNickColor(nick: string): string | undefined {
    return personaColors[nick];
  }

  function renderMessage(msg: ChatMsg) {
    switch (msg.type) {
      case "system":
        return (
          <div key={msg.id} className="chat-msg chat-msg-system">
            {(msg.text || "").split("\n").map((line, i) => (
              <div key={i}>{line || "\u00A0"}</div>
            ))}
          </div>
        );

      case "join":
        return (
          <div key={msg.id} className="chat-msg chat-msg-system">
            {"-->  "}{msg.nick} a rejoint {msg.channel || channel}
          </div>
        );

      case "part":
        return (
          <div key={msg.id} className="chat-msg chat-msg-system">
            {"<--  "}{msg.nick} a quitte {msg.channel || channel}
          </div>
        );

      case "message":
      default: {
        const color = msg.nick ? getNickColor(msg.nick) : undefined;
        const className = color ? "chat-msg chat-msg-persona" : "chat-msg chat-msg-user";
        return (
          <div
            key={msg.id}
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
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <span className="chat-channel">{channel}</span>
        <span className={`chat-status ${ws.connected ? "chat-status-on" : "chat-status-off"}`}>
          {ws.connected ? "connecte" : "deconnecte"}
        </span>
      </div>

      <div className="chat-body">
        <div className="chat-messages" ref={messagesContainerRef}>
          {messages.map(renderMessage)}
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
          placeholder={ws.connected ? "Message ou /commande..." : "Connexion en cours..."}
          disabled={!ws.connected}
          autoFocus
        />
        <button
          className="btn btn-primary"
          onClick={handleSend}
          disabled={!ws.connected || !input.trim()}
        >
          Envoyer
        </button>
      </div>
    </div>
  );
}
