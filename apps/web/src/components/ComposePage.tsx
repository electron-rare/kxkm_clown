import { useState, useRef, useEffect } from "react";
import { useMinitelSounds } from "../hooks/useMinitelSounds";
import { resolveWebSocketUrl } from "../lib/websocket-url";
import { VideotexPageHeader } from "./VideotexMosaic";

interface ComposeResult {
  status: string;
  audioData?: string;
  audioMime?: string;
  prompt?: string;
  error?: string;
}

export default function ComposePage() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("experimental");
  const [duration, setDuration] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ComposeResult[]>([]);
  const [error, setError] = useState("");
  const [activeTrack, setActiveTrack] = useState<number | null>(null);
  const sounds = useMinitelSounds();
  const wsRef = useRef<WebSocket | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsUrl = resolveWebSocketUrl();

  // Close WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Simulated progress bar during generation
  useEffect(() => {
    if (generating) {
      setProgress(0);
      const estimatedMs = duration * 1000;
      const step = 100 / (estimatedMs / 200);
      progressRef.current = setInterval(() => {
        setProgress(p => Math.min(p + step * (0.5 + Math.random()), 92));
      }, 200);
    } else {
      if (progressRef.current) clearInterval(progressRef.current);
      if (progress > 0) {
        setProgress(100);
        setTimeout(() => setProgress(0), 800);
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
    const cmd = `/compose ${prompt.trim()}, ${style} style, ${duration}s`;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ws?.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "command", text: cmd }));
      }, { once: true });
    } else {
      ws.send(JSON.stringify({ type: "command", text: cmd }));
    }

    setGenerating(true);
    setError("");
    sounds.send();
  }

  return (
    <div className="compose-page">
      <VideotexPageHeader title="COMPOSITION MUSICALE" subtitle="ACE-Step 1.5 — GPU local" color="pink" />

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
            <select value={style} onChange={(e) => setStyle(e.target.value)} className="minitel-input">
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
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="minitel-input">
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={120}>2min</option>
            </select>
          </div>
        </div>

        <button type="submit" className="minitel-login-btn" disabled={generating || !prompt.trim()}>
          {generating ? "Generation en cours..." : ">>> Composer <<<"}
        </button>
      </form>

      {error && <div className="minitel-login-error">{error}</div>}

      {/* Progress bar */}
      {generating && (
        <div className="vtx-progress">
          <div className="vtx-progress-label">
            <span className="minitel-cursor">█</span> GENERATION EN COURS
          </div>
          <div className="vtx-progress-bar">
            <div className="vtx-progress-fill" style={{ width: `${progress}%` }}>
              {"█".repeat(Math.floor(progress / 2.5))}
            </div>
          </div>
          <div className="vtx-progress-pct">{Math.floor(progress)}%</div>
        </div>
      )}

      {/* Results with player */}
      {results.length > 0 && (
        <div className="compose-results">
          <div className="compose-results-title">{"--- Compositions ---"}</div>
          {results.map((r, i) => (
            <div
              key={i}
              className={`vtx-track${activeTrack === i ? " vtx-track-active" : ""}`}
              onClick={() => setActiveTrack(activeTrack === i ? null : i)}
            >
              <div className="vtx-track-header">
                <span className="vtx-track-icon">{activeTrack === i ? "▶" : "♫"}</span>
                <span className="vtx-track-title">{r.prompt || "Sans titre"}</span>
                <span className="vtx-track-badge">OK</span>
              </div>
              {activeTrack === i && r.audioData && r.audioMime && (
                <div className="vtx-player">
                  <audio
                    controls
                    autoPlay
                    src={`data:${r.audioMime};base64,${r.audioData}`}
                    className="vtx-audio"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
