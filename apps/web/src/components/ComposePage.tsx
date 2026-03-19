import { useState } from "react";
import { useGenerationCommand } from "../hooks/useGenerationCommand";
import { VideotexPageHeader } from "./VideotexMosaic";

interface ComposeResult {
  status: string;
  audioData?: string;
  audioMime?: string;
  prompt?: string;
}

export default function ComposePage() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("experimental");
  const [duration, setDuration] = useState(30);
  const [activeTrack, setActiveTrack] = useState<number | null>(null);

  const { generating, progress, results, error, send } = useGenerationCommand<ComposeResult>({
    responseType: "music",
    extractResult: (msg) =>
      msg.audioData
        ? { status: "completed", audioData: msg.audioData as string, audioMime: (msg.audioMime as string) || "audio/wav", prompt: msg.text as string }
        : null,
    errorMatch: "Composition echouee",
    progressInterval: 200,
    progressStep: 2,
    maxResults: 10,
  });

  function handleCompose(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || generating) return;
    send(`/compose ${prompt.trim()}, ${style} style, ${duration}s`);
  }

  return (
    <div className="compose-page">
      <VideotexPageHeader title="COMPOSITION MUSICALE" subtitle="ACE-Step 1.5 — GPU local" color="pink" />

      <form onSubmit={handleCompose} className="compose-form">
        <div className="minitel-field">
          <label>Description musicale _</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="ambient drone with deep bass, musique concrete style..." className="minitel-input compose-textarea" rows={3} maxLength={500} />
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

      {generating && (
        <div className="vtx-progress">
          <div className="vtx-progress-label"><span className="minitel-cursor">{"█"}</span> GENERATION EN COURS</div>
          <div className="vtx-progress-bar">
            <div className="vtx-progress-fill" style={{ width: `${progress}%` }}>{"█".repeat(Math.floor(progress / 2.5))}</div>
          </div>
          <div className="vtx-progress-pct">{Math.floor(progress)}%</div>
        </div>
      )}

      {results.length > 0 && (
        <div className="compose-results">
          <div className="compose-results-title">{"--- Compositions ---"}</div>
          {results.map((r, i) => (
            <div key={i} className={`vtx-track${activeTrack === i ? " vtx-track-active" : ""}`} onClick={() => setActiveTrack(activeTrack === i ? null : i)}>
              <div className="vtx-track-header">
                <span className="vtx-track-icon">{activeTrack === i ? "\u25B6" : "\u266B"}</span>
                <span className="vtx-track-title">{r.prompt || "Sans titre"}</span>
                <span className="vtx-track-badge">OK</span>
              </div>
              {activeTrack === i && r.audioData && r.audioMime && (
                <div className="vtx-player">
                  <audio controls autoPlay src={`data:${r.audioMime};base64,${r.audioData}`} className="vtx-audio" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
