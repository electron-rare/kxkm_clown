import { useState, useRef } from "react";
import { useMinitelSounds } from "../hooks/useMinitelSounds";

/**
 * /compose mode — Music generation via ACE-Step 1.5
 * Minitel-style interface for composing music from text prompts.
 */

interface ComposeResult {
  status: string;
  audioData?: string;
  audioMime?: string;
  prompt?: string;
  error?: string;
  duration?: number;
}

export default function ComposePage() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("experimental");
  const [duration, setDuration] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<ComposeResult[]>([]);
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
        if (msg.type === "music" && msg.audioData) {
          setResults(prev => [{
            status: "completed",
            audioData: msg.audioData,
            audioMime: msg.audioMime || "audio/wav",
            prompt: msg.text,
          }, ...prev].slice(0, 10));
          setGenerating(false);
          sounds.receive();
        }
        if (msg.type === "system" && msg.text?.includes("Composition echouee")) {
          setError(msg.text);
          setGenerating(false);
        }
      } catch {}
    };

    ws.onclose = () => { wsRef.current = null; };
    return ws;
  }

  function handleCompose(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || generating) return;

    const ws = getWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Wait for connection then send
      ws?.addEventListener("open", () => {
        ws.send(JSON.stringify({
          type: "message",
          text: `/compose ${prompt.trim()}, ${style} style, ${duration}s`,
        }));
      }, { once: true });
    } else {
      ws.send(JSON.stringify({
        type: "message",
        text: `/compose ${prompt.trim()}, ${style} style, ${duration}s`,
      }));
    }

    setGenerating(true);
    setError("");
    sounds.send();
  }

  return (
    <div className="compose-page">
      <div className="compose-header">{">>> COMPOSITION MUSICALE <<<"}</div>
      <div className="compose-subtitle">ACE-Step 1.5 — Generation locale GPU</div>

      <form onSubmit={handleCompose} className="compose-form">
        <div className="minitel-field">
          <label>Description musicale _</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="ambient drone with deep bass, musique concrete style..."
            className="minitel-input compose-textarea"
            rows={3}
            maxLength={500}
          />
        </div>

        <div className="compose-options">
          <div className="minitel-field">
            <label>Style _</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="minitel-input"
            >
              <option value="experimental">Experimental</option>
              <option value="ambient">Ambient</option>
              <option value="electronic">Electronic</option>
              <option value="concrete">Musique concrete</option>
              <option value="drone">Drone</option>
              <option value="noise">Noise</option>
              <option value="classical">Classical</option>
              <option value="jazz">Jazz</option>
              <option value="hiphop">Hip-hop</option>
              <option value="folk">Folk</option>
            </select>
          </div>

          <div className="minitel-field">
            <label>Duree _</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="minitel-input"
            >
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={120}>2min</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          className="minitel-login-btn"
          disabled={generating || !prompt.trim()}
        >
          {generating ? "Generation en cours..." : ">>> Composer <<<"}
        </button>
      </form>

      {error && <div className="minitel-login-error">{error}</div>}

      {generating && (
        <div className="compose-generating">
          <span className="minitel-cursor">█</span> Generation en cours...
          <br />
          <span className="compose-hint">(peut prendre 10-60 secondes selon la duree)</span>
        </div>
      )}

      {results.length > 0 && (
        <div className="compose-results">
          <div className="compose-results-title">{"--- Compositions ---"}</div>
          {results.map((r, i) => (
            <div key={i} className="compose-result">
              <div className="compose-result-prompt">{r.prompt || "Sans titre"}</div>
              {r.audioData && r.audioMime && (
                <audio
                  controls
                  src={`data:${r.audioMime};base64,${r.audioData}`}
                  className="compose-audio"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
