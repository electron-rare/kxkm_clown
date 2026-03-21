import React, { lazy, Suspense } from "react";
import type { ChatMsg } from "./chat-types";

const WaveformPlayer = lazy(() => import("./WaveformPlayer").then(m => ({ default: m.WaveformPlayer })));

function renderText(text: string): React.ReactNode {
  // Split by code blocks first
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(...renderInlineBlock(text.slice(lastIdx, match.index)));
    }
    parts.push(<pre key={match.index} className="chat-code-block"><code>{match[2]}</code></pre>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(...renderInlineBlock(text.slice(lastIdx)));
  return parts;
}

function renderInlineBlock(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  if (lines.length === 1) {
    const r = renderInline(text);
    return Array.isArray(r) ? r : [r];
  }
  return [lines.map((line, i) => (
    <React.Fragment key={i}>
      {i > 0 && <br />}
      {renderInline(line)}
    </React.Fragment>
  ))];
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|@[A-Za-z0-9_\-\u00C0-\u00FF]+)/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const m = match[0];
    if (m.startsWith("**")) parts.push(<strong key={match.index}>{m.slice(2, -2)}</strong>);
    else if (m.startsWith("*")) parts.push(<em key={match.index}>{m.slice(1, -1)}</em>);
    else if (m.startsWith("`")) parts.push(<code key={match.index}>{m.slice(1, -1)}</code>);
    else if (m.startsWith("@")) parts.push(<span key={match.index} className="chat-mention">{m}</span>);
    lastIdx = match.index + m.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length === 1 ? parts[0] : parts;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return h + ":" + m;
}

// Quick reaction emojis
const REACTIONS = ["\uD83D\uDC4D", "\u2764\uFE0F", "\uD83D\uDE02", "\uD83C\uDFB5", "\uD83D\uDD25"];

export interface ChatMessageProps {
  msg: ChatMsg;
  getNickColor: (nick: string) => string | undefined;
  channel: string;
  onVote?: (msg: ChatMsg, vote: "up" | "down") => void;
}

export const ChatMessage = React.memo(function ChatMessage({ msg, getNickColor, channel, onVote }: ChatMessageProps) {
  switch (msg.type) {
    case "system":
      return (
        <div className="chat-msg chat-msg-system">
          <span className="chat-ts" title={new Date(msg.timestamp).toLocaleString("fr-FR")}>{fmtTime(msg.timestamp)}</span>
          {(msg.text || "").split("\n").map((line, i) => (
            <div key={i}>{line || "\u00A0"}</div>
          ))}
        </div>
      );

    case "join":
      return (
        <div className="chat-msg chat-msg-system">
          <span className="chat-ts" title={new Date(msg.timestamp).toLocaleString("fr-FR")}>{fmtTime(msg.timestamp)}</span>
          {"-->  "}{msg.nick} a rejoint {msg.channel || channel}
        </div>
      );

    case "part":
      return (
        <div className="chat-msg chat-msg-system">
          <span className="chat-ts" title={new Date(msg.timestamp).toLocaleString("fr-FR")}>{fmtTime(msg.timestamp)}</span>
          {"<--  "}{msg.nick} a quitte {msg.channel || channel}
        </div>
      );

    case "audio":
      // Audio messages are hidden — playback handled by voice chat queue in Chat.tsx
      return null;

    case "image": {
      const color = msg.nick ? getNickColor(msg.nick) : undefined;
      return (
        <div className="chat-msg chat-msg-image" style={color ? { color } : undefined}>
          <span className="chat-ts" title={new Date(msg.timestamp).toLocaleString("fr-FR")}>{fmtTime(msg.timestamp)}</span>
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
          <span className="chat-ts" title={new Date(msg.timestamp).toLocaleString("fr-FR")}>{fmtTime(msg.timestamp)}</span>
          <span className="chat-nick" style={color ? { color } : undefined}>
            {"<"}{msg.nick || "???"}{">"}{" "}
          </span>
          <span className="chat-text">{msg.text}</span>
          {msg.audioData && msg.audioMime && (
            <Suspense fallback={
              <audio controls src={`data:${msg.audioMime};base64,${msg.audioData}`}
                style={{ display: "block", marginTop: "4px", maxWidth: "400px" }} />
            }>
              <WaveformPlayer
                src={`data:${msg.audioMime};base64,${msg.audioData}`}
                label={msg.text || "sans titre"}
                color={color}
              />
            </Suspense>
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
          <span className="chat-ts" title={new Date(msg.timestamp).toLocaleString("fr-FR")}>{fmtTime(msg.timestamp)}</span>
          {color && <span className="chat-avatar" style={{ backgroundColor: color }}>{(msg.nick || "?")[0]}</span>}
          <span className="chat-nick" style={color ? { color } : undefined}>
            {"<"}{msg.nick || "???"}{">"}{" "}
          </span>
          <span className="chat-text">{renderText(msg.text || "")}</span>
          {isStreaming && <span className="chat-cursor">▌</span>}
          {!isStreaming && color && (
            <span className="chat-actions">
              {onVote && (
                <>
                  <button className="chat-vote-btn chat-vote-up" title="Bonne reponse" aria-label="Voter positif" onClick={() => onVote(msg, "up")}>{"\u25B2"}</button>
                  <button className="chat-vote-btn chat-vote-down" title="Mauvaise reponse" aria-label="Voter negatif" onClick={() => onVote(msg, "down")}>{"\u25BC"}</button>
                </>
              )}
              {REACTIONS.map(r => (
                <button key={r} className="chat-react-btn" aria-label={`Reagir ${r}`} onClick={() => {
                  fetch("/api/v2/feedback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messageId: msg.id, personaNick: msg.nick, response: msg.text, vote: "react", reaction: r }),
                  }).catch(() => {});
                }}>{r}</button>
              ))}
              <button className="chat-react-btn" aria-label="Copier le message" onClick={() => {
                if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {});
              }} title="Copier">{"\uD83D\uDCCB"}</button>
              <button className="chat-react-btn" onClick={() => {
                const input = document.querySelector('.chat-input-field') as HTMLInputElement;
                if (input && msg.nick) {
                  input.value = `@${msg.nick} `;
                  input.focus();
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                }
              }} title="Repondre">{"\u21A9"}</button>
              <button className="chat-pin-btn" aria-label="Epingler le message" onClick={() => {
                if (msg.text) {
                  fetch("/api/v2/feedback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messageId: msg.id, personaNick: msg.nick, response: msg.text, vote: "pin", channel }),
                  }).catch(() => {});
                }
              }} title="Epingler">{"\uD83D\uDCCC"}</button>
            </span>
          )}
        </div>
      );
    }
  }
});
