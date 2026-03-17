import { useState, useRef } from "react";
import { useMinitelSounds } from "../hooks/useMinitelSounds";

/**
 * /imagine mode — Image generation via ComfyUI
 * Minitel-style interface for generating images from text prompts.
 */

interface ImageResult {
  prompt: string;
  imageData?: string;
  imageMime?: string;
  error?: string;
}

export default function ImaginePage() {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [error, setError] = useState("");
  const sounds = useMinitelSounds();
  const wsRef = useRef<WebSocket | null>(null);

  function getWs(): WebSocket | null {
    if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "image" && msg.imageData) {
          setResults(prev => [{
            prompt: msg.text || prompt,
            imageData: msg.imageData,
            imageMime: msg.imageMime || "image/png",
          }, ...prev].slice(0, 10));
          setGenerating(false);
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
      ws?.send(JSON.stringify({
        type: "message",
        text: `/imagine ${prompt.trim()}`,
      }));
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
      <div className="compose-header">{">>> GENERATION IMAGES <<<"}</div>
      <div className="compose-subtitle">ComfyUI — SDXL Lightning (~3s/image)</div>

      <form onSubmit={handleImagine} className="compose-form">
        <div className="minitel-field">
          <label>Description de l'image (en anglais) _</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="a cyberpunk terminal glowing green, dark room, phosphor CRT aesthetic..."
            className="minitel-input compose-textarea"
            rows={3}
            maxLength={500}
          />
        </div>

        <button
          type="submit"
          className="minitel-login-btn"
          disabled={generating || !prompt.trim()}
        >
          {generating ? "Generation en cours..." : ">>> Imaginer <<<"}
        </button>
      </form>

      {error && <div className="minitel-login-error">{error}</div>}

      {generating && (
        <div className="compose-generating">
          <span className="minitel-cursor">█</span> Generation en cours (~3s)...
        </div>
      )}

      {results.length > 0 && (
        <div className="imagine-results">
          <div className="compose-results-title">{"--- Images generees ---"}</div>
          <div className="imagine-grid">
            {results.map((r, i) => (
              <div key={i} className="imagine-result">
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
