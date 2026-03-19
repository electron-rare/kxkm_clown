import React, { useRef, useEffect, useCallback } from "react";
import { List, useListRef } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { useChatState } from "../hooks/useChatState";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ChatSidebar } from "./ChatSidebar";
import type { ChatMsg } from "./chat-types";

const ROW_HEIGHT_DEFAULT = 24;
const ROW_HEIGHT_IMAGE = 540;
const ROW_HEIGHT_AUDIO = 48;
const ROW_HEIGHT_MUSIC = 72;

function estimateRowHeight(msg: ChatMsg): number {
  switch (msg.type) {
    case "image":
      return ROW_HEIGHT_IMAGE;
    case "audio":
      return ROW_HEIGHT_AUDIO;
    case "music":
      return ROW_HEIGHT_MUSIC;
    default: {
      const text = msg.text || "";
      const lines = Math.ceil(text.length / 80) || 1;
      return Math.max(ROW_HEIGHT_DEFAULT, lines * 20 + 4);
    }
  }
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

  const listRef = useListRef();
  const autoScrollRef = useRef(true);

  // Keep a stable reference to messages for row component
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const getRowHeight = useCallback((index: number): number => {
    return estimateRowHeight(messagesRef.current[index]);
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScrollRef.current && listRef.current && messages.length > 0) {
      listRef.current.scrollToRow({ index: messages.length - 1, align: "end" });
    }
  }, [messages, listRef]);

  // Track scroll position via the outer element to detect user scroll-up
  const outerElRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Get the outer element from the list ref
    const el = listRef.current?.element;
    if (!el) return;
    outerElRef.current = el;

    function onScroll() {
      const outer = outerElRef.current;
      if (!outer) return;
      const atBottom = outer.scrollHeight - outer.scrollTop - outer.clientHeight < 40;
      autoScrollRef.current = atBottom;
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [listRef, messages.length]); // re-attach when list mounts (messages.length goes from 0 to >0)

  const Row = useCallback(({ index, style }: { index: number; style: React.CSSProperties; ariaAttributes: Record<string, unknown> }) => (
    <div style={style}>
      <ChatMessage
        msg={messagesRef.current[index]}
        getNickColor={getNickColor}
        channel={channel}
      />
    </div>
  ), [getNickColor, channel]);

  return (
    <div className="chat-container">
      <div className="chat-header">
        <span className="chat-channel">{channel}</span>
        <span className={`chat-status ${ws.connected ? "chat-status-on" : "chat-status-off"}`}>
          {ws.connected ? "connecte" : "deconnecte"}
        </span>
      </div>

      <div className="chat-body">
        <div className="chat-messages" role="log" aria-live="polite">
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <List
                listRef={listRef}
                height={height}
                width={width}
                rowCount={messages.length}
                rowHeight={getRowHeight}
                overscanCount={10}
                rowComponent={Row}
              />
            )}
          </AutoSizer>
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
