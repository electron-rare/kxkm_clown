import React, { useState, useRef, useEffect } from "react";
import type { UseWebSocketReturn } from "../hooks/useWebSocket";

const ALL_COMMANDS = [
  "/help", "/nick", "/who", "/clear", "/join", "/channels", "/topic", "/pin",
  "/dm", "/whisper", "/search", "/react", "/mute", "/unmute", "/ban", "/unban",
  "/invite", "/personas", "/web", "/responders", "/random-persona", "/debate",
  "/quote", "/weather", "/ascii", "/voice-test",
  "/imagine", "/imagine-models",
  "/comp", "/layer", "/voice", "/noise", "/ambient", "/compose", "/mix",
  "/master", "/bounce", "/remix", "/randomize", "/clear-comp", "/undo",
  "/silence", "/concat", "/loop", "/snapshot", "/marker", "/metronome",
  "/preview", "/suggest", "/template",
  "/fx", "/normalize", "/crossfade", "/trim", "/stutter", "/glitch",
  "/stretch", "/pan", "/gain",
  "/tracks", "/solo", "/unsolo", "/delete", "/rename", "/duplicate", "/swap",
  "/bpm", "/info",
  "/stem", "/mp3",
  "/drone", "/grain", "/circus", "/honk", "/kokoro",
  "/status", "/stats", "/models", "/llm", "/memory", "/speed", "/model",
  "/persona", "/version", "/changelog", "/session", "/history", "/context",
  "/export", "/reload", "/theme", "/time", "/fortune", "/dice", "/flip",
  "/translate", "/tr", "/debate", "/quote", "/weather", "/ascii",
  "/collab", "/persona-create", "/radio",
  "/summarize", "/mood", "/haiku", "/timer",
  "/sys", "/color", "/whoami",
];

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
  const [cmdQuery, setCmdQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  // Filter personas matching the typed prefix
  const mentionSuggestions = mentionQuery !== null
    ? personas.filter(p => p.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 8)
    : [];

  // Filter commands matching the typed prefix (fuzzy: includes, not just startsWith)
  const cmdSuggestions = cmdQuery !== null
    ? ALL_COMMANDS.filter(c => {
        const q = cmdQuery.toLowerCase();
        return c.toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  const activeSuggestions = mentionSuggestions.length > 0 ? "mention" : cmdSuggestions.length > 0 ? "cmd" : null;

  // Reset index when suggestions change
  useEffect(() => {
    setMentionIdx(0);
  }, [mentionQuery, cmdQuery]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setInput(val);
    const cursorPos = e.target.selectionStart ?? val.length;
    const beforeCursor = val.slice(0, cursorPos);
    const mentionMatch = beforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setCmdQuery(null);
    } else if (beforeCursor.match(/^\/\S*$/) && !beforeCursor.includes(" ")) {
      setCmdQuery(beforeCursor.slice(1));
      setMentionQuery(null);
    } else {
      setMentionQuery(null);
      setCmdQuery(null);
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

  function selectCommand(cmd: string) {
    setInput(cmd + " ");
    setCmdQuery(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const pos = cmd.length + 1;
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function handleKeyDownInternal(e: React.KeyboardEvent) {
    const suggestions = activeSuggestions === "mention" ? mentionSuggestions : cmdSuggestions;
    if (suggestions.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx(prev => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (activeSuggestions === "mention") {
          selectMention(suggestions[mentionIdx]);
        } else {
          selectCommand(suggestions[mentionIdx]);
        }
        return;
      }
      if (e.key === "Enter" && activeSuggestions === "mention") {
        e.preventDefault();
        selectMention(suggestions[mentionIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        setCmdQuery(null);
        return;
      }
    }
    // Default key handling (send on Enter, command history, etc.)
    onKeyDown(e);
  }

  return (
    <div className="chat-input" style={{ position: "relative" }}>
      {mentionSuggestions.length > 0 && (
        <div className="chat-mention-dropdown" role="listbox" aria-label="Suggestions personas">
          {mentionSuggestions.map((name, i) => (
            <button
              key={name}
              role="option"
              aria-selected={i === mentionIdx}
              className={`chat-mention-item ${i === mentionIdx ? "active" : ""}`}
              onMouseDown={(ev) => { ev.preventDefault(); selectMention(name); }}
            >
              @{name}
            </button>
          ))}
        </div>
      )}
      {cmdSuggestions.length > 0 && mentionSuggestions.length === 0 && (
        <div className="chat-mention-dropdown" role="listbox" aria-label="Suggestions commandes">
          {cmdSuggestions.map((cmd, i) => (
            <button
              key={cmd}
              role="option"
              aria-selected={i === mentionIdx}
              className={`chat-mention-item ${i === mentionIdx ? "active" : ""}`}
              onMouseDown={(ev) => { ev.preventDefault(); selectCommand(cmd); }}
            >
              {cmd}
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
      {input.length > 100 && (
        <span className="chat-input-counter" style={{ color: "#666", fontSize: "9px", marginRight: "4px" }}>{input.length}/8192</span>
      )}
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
