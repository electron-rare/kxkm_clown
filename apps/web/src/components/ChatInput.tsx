import React from "react";
import type { UseWebSocketReturn } from "../hooks/useWebSocket";

export interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  ws: UseWebSocketReturn;
}

export const ChatInput = React.memo(function ChatInput({ input, setInput, onSend, onKeyDown, ws }: ChatInputProps) {
  return (
    <div className="chat-input">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={ws.connected ? "Message ou /commande... (Tab pour compléter)" : "Connexion en cours..."}
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
