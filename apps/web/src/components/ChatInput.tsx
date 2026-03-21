import React, { useState, useRef, useEffect } from "react";
import type { UseWebSocketReturn } from "../hooks/useWebSocket";

export interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  ws: UseWebSocketReturn;
  personas?: string[];
}

export const ChatInput = React.memo(function ChatInput({ input, setInput, onSend, onKeyDown, ws, personas = [] }: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  // Filter personas matching the typed prefix
  const mentionSuggestions = mentionQuery !== null
    ? personas.filter(p => p.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 8)
    : [];

  // Reset index when suggestions change
  useEffect(() => {
    setMentionIdx(0);
  }, [mentionQuery]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setInput(val);
    const cursorPos = e.target.selectionStart ?? val.length;
    const beforeCursor = val.slice(0, cursorPos);
    const mentionMatch = beforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
    } else {
      setMentionQuery(null);
    }
  }

  function selectMention(name: string) {
    const el = inputRef.current;
    const cursorPos = el?.selectionStart ?? input.length;
    const beforeCursor = input.slice(0, cursorPos);
    const afterCursor = input.slice(cursorPos);
    const newBefore = beforeCursor.replace(/@\w*$/, `@${name} `);
    const newVal = newBefore + afterCursor;
    setInput(newVal);
    setMentionQuery(null);
    // Restore focus & cursor position after React re-render
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        const pos = newBefore.length;
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function handleKeyDownInternal(e: React.KeyboardEvent) {
    if (mentionSuggestions.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx(prev => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx(prev => (prev + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        selectMention(mentionSuggestions[mentionIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    // Default key handling (send on Enter, command history, etc.)
    onKeyDown(e);
  }

  return (
    <div className="chat-input" style={{ position: "relative" }}>
      {mentionSuggestions.length > 0 && (
        <div className="chat-mention-dropdown">
          {mentionSuggestions.map((name, i) => (
            <button
              key={name}
              className={`chat-mention-item ${i === mentionIdx ? "active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); selectMention(name); }}
            >
              @{name}
            </button>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDownInternal}
        placeholder={ws.connected ? "Message ou /commande... (@mention, Tab pour completer)" : "Connexion en cours..."}
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
        onClick={onSend}
        disabled={!ws.connected || !input.trim()}
        aria-label="Envoyer le message"
      >
        Envoyer
      </button>
    </div>
  );
});
