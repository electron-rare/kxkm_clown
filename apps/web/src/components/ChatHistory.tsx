import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";

interface ChatLogFile {
  date: string;
  lines: number;
  size: number;
}

interface ChatLogMessage {
  ts?: string;
  channel?: string;
  nick?: string;
  type?: string;
  text?: string;
  filename?: string;
  size?: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return "[??:??:??]";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return `[${ts}]`;
    return `[${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}]`;
  } catch {
    return `[${ts}]`;
  }
}

function renderMessage(msg: ChatLogMessage): string {
  const ts = formatTimestamp(msg.ts);

  if (msg.type === "join") {
    return `${ts} --> ${msg.nick || "?"} a rejoint ${msg.channel || ""}`;
  }
  if (msg.type === "part") {
    return `${ts} <-- ${msg.nick || "?"} a quitte ${msg.channel || ""}`;
  }
  if (msg.type === "system") {
    return `${ts} * ${msg.text || ""}`;
  }
  if (msg.type === "upload" && msg.filename) {
    return `${ts} * ${msg.nick || "?"} a envoye: ${msg.filename} (${formatFileSize(msg.size || 0)})`;
  }

  return `${ts} <${msg.nick || "?"}> ${msg.text || ""}`;
}

function messageClass(msg: ChatLogMessage): string {
  if (msg.type === "join" || msg.type === "part" || msg.type === "system") {
    return "history-line history-line-system";
  }
  return "history-line";
}

export default function ChatHistory() {
  const [files, setFiles] = useState<ChatLogFile[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatLogMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [offset, setOffset] = useState(0);
  const logViewerRef = useRef<HTMLDivElement>(null);

  const PAGE_SIZE = 200;

  // Load available dates
  useEffect(() => {
    setLoading(true);
    api
      .getChatHistoryDates()
      .then((data) => {
        setFiles(data.files);
        if (data.files.length > 0 && !selectedDate) {
          setSelectedDate(data.files[0].date);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur de chargement"))
      .finally(() => setLoading(false));
  }, []);

  // Load messages when date or offset changes
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    setError("");
    api
      .getChatHistoryByDate(selectedDate, PAGE_SIZE, offset)
      .then((data) => {
        setMessages(data.messages);
        setTotal(data.total);
      })
      .catch((err) => {
        setMessages([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : "Erreur de chargement");
      })
      .finally(() => setLoading(false));
  }, [selectedDate, offset]);

  const handleDateSelect = useCallback((date: string) => {
    setSelectedDate(date);
    setOffset(0);
    setSearchTerm("");
  }, []);

  const filteredMessages = searchTerm
    ? messages.filter((msg) => {
        const rendered = renderMessage(msg).toLowerCase();
        return rendered.includes(searchTerm.toLowerCase());
      })
    : messages;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="history-container">
      <h2>Historique des conversations</h2>

      <div className="history-layout">
        {/* Date picker sidebar */}
        <div className="history-sidebar">
          <div className="history-sidebar-header">Dates disponibles</div>
          {files.length === 0 && !loading && (
            <div className="history-empty">Aucun log disponible</div>
          )}
          {files.map((f) => (
            <button
              key={f.date}
              className={`history-date-btn${selectedDate === f.date ? " history-date-active" : ""}`}
              onClick={() => handleDateSelect(f.date)}
            >
              <span className="history-date-label">{f.date}</span>
              <span className="history-date-meta">
                {f.lines} msg &middot; {formatFileSize(f.size)}
              </span>
            </button>
          ))}
        </div>

        {/* Log viewer */}
        <div className="history-main">
          {/* Search bar */}
          <div className="history-toolbar">
            <input
              type="text"
              className="history-search"
              placeholder="Filtrer les messages..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {totalPages > 1 && (
              <div className="history-pagination">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  &laquo; Prec
                </button>
                <span className="history-page-info">
                  {currentPage} / {totalPages}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Suiv &raquo;
                </button>
              </div>
            )}
          </div>

          {error && <div className="banner">{error}</div>}

          {loading && (
            <div className="history-loading">Chargement...</div>
          )}

          <div className="history-log" ref={logViewerRef}>
            {!loading && filteredMessages.length === 0 && selectedDate && (
              <div className="history-empty">
                {searchTerm ? "Aucun message correspondant" : "Aucun message pour cette date"}
              </div>
            )}
            {filteredMessages.map((msg, i) => (
              <div key={`${offset}-${i}`} className={messageClass(msg)}>
                {renderMessage(msg)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        .history-container {
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .history-container h2 {
          margin: 0 0 12px 0;
        }
        .history-layout {
          display: flex;
          flex: 1;
          min-height: 0;
          gap: 12px;
        }
        .history-sidebar {
          width: 200px;
          flex-shrink: 0;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 4px;
          overflow-y: auto;
        }
        .history-sidebar-header {
          padding: 8px 12px;
          font-weight: bold;
          font-size: 0.85em;
          color: #8b949e;
          border-bottom: 1px solid #30363d;
          font-family: monospace;
        }
        .history-date-btn {
          display: flex;
          flex-direction: column;
          width: 100%;
          padding: 8px 12px;
          border: none;
          background: transparent;
          color: #c9d1d9;
          cursor: pointer;
          text-align: left;
          font-family: monospace;
          font-size: 0.85em;
          border-bottom: 1px solid #21262d;
        }
        .history-date-btn:hover {
          background: #161b22;
        }
        .history-date-active {
          background: #1f2937 !important;
          border-left: 3px solid #58a6ff;
        }
        .history-date-meta {
          font-size: 0.75em;
          color: #6e7681;
          margin-top: 2px;
        }
        .history-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .history-toolbar {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        .history-search {
          flex: 1;
          min-width: 150px;
          padding: 6px 10px;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 4px;
          color: #c9d1d9;
          font-family: monospace;
          font-size: 0.9em;
        }
        .history-search::placeholder {
          color: #6e7681;
        }
        .history-pagination {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .history-page-info {
          font-family: monospace;
          font-size: 0.85em;
          color: #8b949e;
        }
        .btn-sm {
          padding: 4px 8px;
          font-size: 0.8em;
        }
        .history-log {
          flex: 1;
          overflow-y: auto;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 4px;
          padding: 8px 12px;
          font-family: "Courier New", "Courier", monospace;
          font-size: 0.85em;
          line-height: 1.5;
          color: #c9d1d9;
          min-height: 300px;
        }
        .history-line {
          white-space: pre-wrap;
          word-break: break-word;
        }
        .history-line-system {
          color: #6e7681;
          font-style: italic;
        }
        .history-loading {
          padding: 20px;
          text-align: center;
          color: #8b949e;
          font-family: monospace;
        }
        .history-empty {
          padding: 20px;
          text-align: center;
          color: #6e7681;
          font-family: monospace;
        }
      `}</style>
    </div>
  );
}
