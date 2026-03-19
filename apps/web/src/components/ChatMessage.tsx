import React from "react";
import type { ChatMsg } from "./chat-types";

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
