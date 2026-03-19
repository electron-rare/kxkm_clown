import React from "react";
import { useChatState } from "../hooks/useChatState";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ChatSidebar } from "./ChatSidebar";

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
    messagesEndRef,
    messagesContainerRef,
    getNickColor,
    handleSend,
    handleKeyDown,
  } = useChatState();

  return (
    <div className="chat-container">
      <div className="chat-header">
        <span className="chat-channel">{channel}</span>
        <span className={`chat-status ${ws.connected ? "chat-status-on" : "chat-status-off"}`}>
          {ws.connected ? "connecte" : "deconnecte"}
        </span>
      </div>

      <div className="chat-body">
        <div className="chat-messages" ref={messagesContainerRef} role="log" aria-live="polite">
          {messages.map((msg) => (
            <ChatMessage key={msg.id} msg={msg} getNickColor={getNickColor} channel={channel} />
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
        <div className="chat-typing">
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
