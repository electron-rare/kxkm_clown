import React, { useRef, useEffect, useCallback, useState } from "react";
import { useChatState } from "../hooks/useChatState";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ChatSidebar } from "./ChatSidebar";
import type { ChatMsg } from "./chat-types";

// ---------------------------------------------------------------------------
// Audio queue for voice chat — plays TTS audio sequentially
// ---------------------------------------------------------------------------
function useAudioQueue(enabled: boolean) {
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);

  const playNext = useCallback(() => {
    if (!enabled || queueRef.current.length === 0) {
      playingRef.current = false;
      return;
    }
    playingRef.current = true;
    const src = queueRef.current.shift()!;
    const audio = new Audio(src);
    audio.volume = 0.8;
    audio.onended = () => playNext();
    audio.onerror = () => playNext();
    audio.play().catch(() => playNext());
  }, [enabled]);

  const enqueue = useCallback((dataUri: string) => {
    if (!enabled) return;
    queueRef.current.push(dataUri);
    if (!playingRef.current) playNext();
  }, [enabled, playNext]);

  return { enqueue };
}

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

  // Voice chat toggle — persisted in sessionStorage
  const [voiceChat, setVoiceChat] = useState(() =>
    typeof sessionStorage !== "undefined" ? sessionStorage.getItem("kxkm-voicechat") === "1" : false
  );
  const { enqueue: enqueueAudio } = useAudioQueue(voiceChat);

  // Auto-enqueue audio messages when voice chat is ON
  const lastAudioIdRef = useRef<number>(0);
  useEffect(() => {
    if (!voiceChat) return;
    // Enqueue ALL new audio messages since lastAudioIdRef (not just the last one)
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.type === "audio" && msg.id > lastAudioIdRef.current && msg.audioData && msg.audioMime) {
        lastAudioIdRef.current = msg.id;
        enqueueAudio(`data:${msg.audioMime};base64,${msg.audioData}`);
      }
    }
  }, [messages, voiceChat, enqueueAudio]);

  const toggleVoiceChat = useCallback(() => {
    setVoiceChat(prev => {
      const next = !prev;
      sessionStorage.setItem("kxkm-voicechat", next ? "1" : "0");
      return next;
    });
  }, []);

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
        <button
          className={`chat-voice-toggle ${voiceChat ? "chat-voice-on" : ""}`}
          onClick={toggleVoiceChat}
          title={voiceChat ? "Voicechat ON — cliquer pour couper" : "Voicechat OFF — cliquer pour activer"}
        >
          {voiceChat ? "\uD83D\uDD0A" : "\uD83D\uDD07"}
        </button>
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
