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

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function DateSeparator({ timestamp }: { timestamp: number }) {
  const d = new Date(timestamp);
  const today = new Date();
  const isToday = isSameDay(d.getTime(), today.getTime());
  const isYesterday = isSameDay(d.getTime(), today.getTime() - 86400000);
  const label = isToday ? "Aujourd'hui" : isYesterday ? "Hier" : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return <div className="chat-date-sep">{label}</div>;
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

  // Ctrl+F search overlay
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const searchMatches = searchOpen && searchQuery.length >= 2
    ? new Set(messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase())).map(m => m.id))
    : new Set<number>();

  // Channel switching — no page reload
  const [channels] = useState(["#general", "#musique", "#images", "#dev", "#random"]);
  const [showChannelMenu, setShowChannelMenu] = useState(false);

  // Theme toggle — persisted in localStorage
  const [theme, setTheme] = useState(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem("kxkm-theme") || "dark" : "dark"
  );

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("kxkm-theme", next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, []);

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
        <div className="chat-channel-selector">
          <button className="chat-channel-btn" onClick={() => setShowChannelMenu(!showChannelMenu)}>
            {channel} &#9662;
          </button>
          {showChannelMenu && (
            <div className="chat-channel-menu">
              {channels.map(ch => (
                <button
                  key={ch}
                  className={`chat-channel-item ${ch === channel ? "active" : ""}`}
                  onClick={() => {
                    if (ch !== channel && ws.connected) {
                      ws.send({ type: "command", text: `/join ${ch}` });
                    }
                    setShowChannelMenu(false);
                  }}
                >
                  {ch}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className={`chat-status ${ws.connected ? "chat-status-on" : ws.connectionStatus === "reconnecting" ? "chat-status-warn" : "chat-status-off"}`}>
          <span className="chat-status-dot" />
          {ws.connected
            ? <>connecte{ws.latencyMs != null && <span style={{ opacity: 0.5, marginLeft: 4 }}>{ws.latencyMs}ms</span>}</>
            : ws.connectionStatus === "reconnecting"
              ? `reconnexion (${ws.reconnectAttempts})`
              : <>deconnecte<button className="chat-reconnect-btn" onClick={ws.reconnect}>reconnecter</button></>}
        </span>
        <span className="chat-count">{users.length} en ligne | {messages.length} msgs</span>
        <button
          className={`chat-voice-toggle ${voiceChat ? "chat-voice-on" : ""}`}
          onClick={toggleVoiceChat}
          title={voiceChat ? "Voicechat ON — cliquer pour couper" : "Voicechat OFF — cliquer pour activer"}
        >
          {voiceChat ? "\uD83D\uDD0A" : "\uD83D\uDD07"}
        </button>
        <button className="chat-theme-toggle" onClick={toggleTheme} title={theme === "dark" ? "Mode clair" : "Mode sombre"}>
          {theme === "dark" ? "\u2600" : "\u263E"}
        </button>
      </div>

      {ws.connectionStatus === "reconnecting" && (
        <div className="chat-reconnect-banner">
          Reconnexion en cours (tentative {ws.reconnectAttempts})...
          <button className="chat-reconnect-btn" onClick={ws.reconnect} style={{ marginLeft: 8 }}>forcer</button>
        </div>
      )}

      <div className="chat-body">
        <div className="chat-messages" ref={containerRef} role="log" aria-live="polite">
          {searchOpen && (
            <div className="chat-search-bar">
              <input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                className="chat-search-input"
              />
              <span className="chat-search-count">{searchMatches.size} resultats</span>
              <button className="chat-search-close" onClick={() => { setSearchOpen(false); setSearchQuery(""); }}>&#10005;</button>
            </div>
          )}
          {messages.map((msg, idx) => {
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const showDateSep = !prevMsg || !isSameDay(prevMsg.timestamp, msg.timestamp);
            return (
              <React.Fragment key={msg.id}>
                {showDateSep && <DateSeparator timestamp={msg.timestamp} />}
                <div className={searchMatches.has(msg.id) ? "chat-msg-highlight" : undefined}>
                  <ChatMessage msg={msg} getNickColor={getNickColor} channel={channel} onVote={handleVote} />
                </div>
              </React.Fragment>
            );
          })}
          <div ref={messagesEndRef} />
          <span className="chat-context-indicator" title="Contexte conversationnel utilise">
            {messages.length} msgs
          </span>
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
        personas={Object.keys(personaColors)}
      />
    </div>
  );
}
