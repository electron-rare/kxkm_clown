import { useState, useRef, useEffect } from "react";
import { useMinitelSounds } from "../hooks/useMinitelSounds";
import { resolveWebSocketUrl } from "../lib/websocket-url";
import { VideotexPageHeader } from "./VideotexMosaic";

interface ImageResult {
  prompt: string;
  imageData?: string;
  imageMime?: string;
}

export default function ImaginePage() {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [error, setError] = useState("");
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const sounds = useMinitelSounds();
  const wsRef = useRef<WebSocket | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsUrl = resolveWebSocketUrl();

  // Simulated progress (~3s for SDXL Lightning)
  useEffect(() => {
    if (generating) {
      setProgress(0);
      progressRef.current = setInterval(() => {
        setProgress(p => Math.min(p + 3 + Math.random() * 4, 92));
      }, 100);
    } else {
      if (progressRef.current) clearInterval(progressRef.current);
      if (progress > 0) {
        setProgress(100);
        setTimeout(() => setProgress(0), 600);
      }
    }
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [generating]);

  function getWs(): WebSocket | null {
    if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "image" && msg.imageData) {
          const newResult = {
            prompt: msg.text || prompt,
            imageData: msg.imageData,
            imageMime: msg.imageMime || "image/png",
          };
          setResults(prev => [newResult, ...prev].slice(0, 20));
          setGenerating(false);
          setViewIdx(0); // Auto-show the new image
          sounds.receive();
        }
        if (msg.type === "system" && msg.text?.includes("echoue")) {
          setError(msg.text);
          setGenerating(false);
        }
      } catch {}
    };

    ws.onclose = () => { wsRef.current = null; };
    return ws;
  }

  function handleImagine(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || generating) return;

    const ws = getWs();
    const sendMsg = () => {
      ws?.send(JSON.stringify({ type: "command", text: `/imagine ${prompt.trim()}` }));
    };

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ws?.addEventListener("open", sendMsg, { once: true });
    } else {
      sendMsg();
    }

    setGenerating(true);
    setError("");
    sounds.send();
  }

  return (
    <div className="imagine-page">
      <VideotexPageHeader title="GENERATION IMAGES" subtitle="ComfyUI — SDXL Lightning" color="amber" />

      <form onSubmit={handleImagine} className="compose-form">
        <div className="minitel-field">
          <label>Description (anglais) _</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="a cyberpunk terminal glowing green, dark room, phosphor CRT aesthetic..."
            className="minitel-input compose-textarea"
            rows={3}
            maxLength={500}
          />
        </div>

        <button type="submit" className="minitel-login-btn" disabled={generating || !prompt.trim()}>
          {generating ? "Generation en cours..." : ">>> Imaginer <<<"}
        </button>
      </form>

      {error && <div className="minitel-login-error">{error}</div>}

      {/* Progress bar */}
      {generating && (
        <div className="vtx-progress vtx-amber">
          <div className="vtx-progress-label">
            <span className="minitel-cursor">█</span> RENDU EN COURS
          </div>
          <div className="vtx-progress-bar">
            <div className="vtx-progress-fill" style={{ width: `${progress}%` }}>
              {"▓".repeat(Math.floor(progress / 2.5))}
            </div>
          </div>
          <div className="vtx-progress-pct">{Math.floor(progress)}%</div>
        </div>
      )}

      {/* Fullscreen image viewer */}
      {viewIdx !== null && results[viewIdx]?.imageData && (
        <div className="vtx-viewer" onClick={() => setViewIdx(null)}>
          <div className="vtx-viewer-frame" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:${results[viewIdx].imageMime};base64,${results[viewIdx].imageData}`}
              alt={results[viewIdx].prompt}
              className="vtx-viewer-img"
            />
            <div className="vtx-viewer-caption">{results[viewIdx].prompt}</div>
            <div className="vtx-viewer-nav">
              {viewIdx < results.length - 1 && (
                <button className="vtx-viewer-btn" onClick={() => setViewIdx(viewIdx + 1)}>◀ Prec</button>
              )}
              <button className="vtx-viewer-btn vtx-viewer-close" onClick={() => setViewIdx(null)}>✕ Fermer</button>
              {viewIdx > 0 && (
                <button className="vtx-viewer-btn" onClick={() => setViewIdx(viewIdx - 1)}>Suiv ▶</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Thumbnail grid */}
      {results.length > 0 && (
        <div className="imagine-results">
          <div className="compose-results-title">{"--- Images generees ---"}</div>
          <div className="imagine-grid">
            {results.map((r, i) => (
              <div key={i} className="imagine-result" onClick={() => setViewIdx(i)}>
                {r.imageData && r.imageMime && (
                  <img
                    src={`data:${r.imageMime};base64,${r.imageData}`}
                    alt={r.prompt}
                    className="imagine-img"
                  />
                )}
                <div className="imagine-prompt">{r.prompt}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
