import React from "react";
import type { ChatMsg } from "./chat-types";

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return h + ":" + m;
}

export interface ChatMessageProps {
  msg: ChatMsg;
  getNickColor: (nick: string) => string | undefined;
  channel: string;
}

export const ChatMessage = React.memo(function ChatMessage({ msg, getNickColor, channel }: ChatMessageProps) {
  switch (msg.type) {
    case "system":
      return (
        <div className="chat-msg chat-msg-system">
          <span className="chat-ts">{fmtTime(msg.timestamp)}</span>
          {(msg.text || "").split("\n").map((line, i) => (
            <div key={i}>{line || "\u00A0"}</div>
          ))}
        </div>
      );

    case "join":
      return (
        <div className="chat-msg chat-msg-system">
          <span className="chat-ts">{fmtTime(msg.timestamp)}</span>
          {"-->  "}{msg.nick} a rejoint {msg.channel || channel}
        </div>
      );

    case "part":
      return (
        <div className="chat-msg chat-msg-system">
          <span className="chat-ts">{fmtTime(msg.timestamp)}</span>
          {"<--  "}{msg.nick} a quitte {msg.channel || channel}
        </div>
      );

    case "audio": {
      const color = msg.nick ? getNickColor(msg.nick) : undefined;
      return (
        <div key={msg.id} className="chat-msg chat-msg-audio" style={color ? { color } : undefined}>
          <span className="chat-ts">{fmtTime(msg.timestamp)}</span>
          <span className="chat-nick" style={color ? { color } : undefined}>
            {"<"}{msg.nick || "???"}{">"}{" "}
          </span>
          <span className="chat-audio-indicator">&#9835;</span>
          <button className="chat-audio-play" aria-label="Lire le message audio" onClick={() => {
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
          <span className="chat-ts">{fmtTime(msg.timestamp)}</span>
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
          <span className="chat-ts">{fmtTime(msg.timestamp)}</span>
          <span className="chat-nick" style={color ? { color } : undefined}>
            {"<"}{msg.nick || "???"}{">"}{" "}
          </span>
          <span className="chat-text">{msg.text}</span>
          {msg.audioData && msg.audioMime && (
            <audio
              controls
              src={`data:${msg.audioMime};base64,${msg.audioData}`}
              aria-label={`Musique generee: ${msg.text || "sans titre"}`}
              style={{ display: "block", marginTop: "4px", maxWidth: "400px" }}
            />
          )}
        </div>
      );
    }

    case "chunk":
    case "message":
    default: {
      const color = msg.nick ? getNickColor(msg.nick) : undefined;
      const isStreaming = msg.type === "chunk";
      const className = color ? "chat-msg chat-msg-persona" : "chat-msg chat-msg-user";
      return (
        <div
          className={`${className}${isStreaming ? " chat-msg-streaming" : ""}`}
          role="article"
          style={color ? { color } : undefined}
        >
          <span className="chat-ts">{fmtTime(msg.timestamp)}</span>
          <span className="chat-nick" style={color ? { color } : undefined}>
            {"<"}{msg.nick || "???"}{">"}{" "}
          </span>
          <span className="chat-text">{msg.text}</span>
          {isStreaming && <span className="chat-cursor">▌</span>}
        </div>
      );
    }
  }
});
