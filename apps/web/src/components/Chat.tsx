import React, { useRef, useEffect, useCallback } from "react";
import { useChatState } from "../hooks/useChatState";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ChatSidebar } from "./ChatSidebar";
import type { ChatMsg } from "./chat-types";

export default function Chat() {
  const {
    messages,
    users,
    channel,
    input,
    setInput,
    personaColors,
    sidebarCollapsed,
    toggleSidebar,
    typingPersona,
    ws,
    getNickColor,
    handleSend,
    handleKeyDown,
  } = useChatState();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const handleVote = useCallback((msg: ChatMsg, vote: "up" | "down") => {
    fetch("/api/v2/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: msg.id,
        personaNick: msg.nick,
        prompt: "",  // We don't track the original prompt in the message
        response: msg.text,
        vote,
        channel,
      }),
    }).catch(() => {});
  }, [channel]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (autoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className="chat-container">
      <div className="chat-header">
        <span className="chat-channel">{channel}</span>
        <span className={`chat-status ${ws.connected ? "chat-status-on" : ws.connectionStatus === "reconnecting" ? "chat-status-warn" : "chat-status-off"}`}>
          {ws.connected ? "connecte" : ws.connectionStatus === "reconnecting" ? `reconnexion (${ws.reconnectAttempts})` : "deconnecte"}
        </span>
        <span className="chat-count">{messages.length} msgs</span>
      </div>

      <div className="chat-body">
        <div className="chat-messages" ref={containerRef} role="log" aria-live="polite">
          {messages.map((msg) => (
            <ChatMessage key={msg.id} msg={msg} getNickColor={getNickColor} channel={channel} onVote={handleVote} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <ChatSidebar
          personaColors={personaColors}
          users={users}
          sidebarCollapsed={sidebarCollapsed}
          toggleSidebar={toggleSidebar}
        />
      </div>

      {typingPersona && (
        <div className="chat-typing" role="status" aria-live="assertive">
          {">>> "}{typingPersona}{" ecrit"}
          <span className="chat-typing-dots">...</span>
        </div>
      )}

      <ChatInput
        input={input}
        setInput={setInput}
        onSend={handleSend}
        onKeyDown={handleKeyDown}
        ws={ws}
      />
    </div>
  );
}
