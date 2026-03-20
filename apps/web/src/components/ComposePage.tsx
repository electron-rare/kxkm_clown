import React, { useState, useEffect } from "react";
import { useGenerationCommand } from "../hooks/useGenerationCommand";
import { VideotexPageHeader, VideotexSeparator } from "./VideotexMosaic";

interface Track {
  id: number;
  prompt: string;
  style: string;
  duration: number;
  volume: number;
  audioData?: string;
  audioMime?: string;
}

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
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mixing, setMixing] = useState(false);
  const [compName, setCompName] = useState("Ma composition");

  const { generating, progress, results, error, send, getWs } = useGenerationCommand<ComposeResult>({
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

  // When a new result arrives, add it as a track
  const lastResultCount = React.useRef(0);
  useEffect(() => {
    if (results.length > lastResultCount.current) {
      const newest = results[0]; // results are prepended
      if (newest?.audioData) {
        setTracks((prev) => [
          ...prev,
          {
            id: Date.now(),
            prompt: newest.prompt || prompt || "Sans titre",
            style,
            duration,
            volume: 100,
            audioData: newest.audioData,
            audioMime: newest.audioMime,
          },
        ]);
      }
    }
    lastResultCount.current = results.length;
  }, [results.length]);

  function handleAddTrack(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || generating) return;
    send(`/layer ${prompt.trim()}, ${style} style, ${duration}s`);
  }

  function handleMix() {
    const ws = getWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setMixing(true);
    ws.send(JSON.stringify({ type: "command", text: "/mix" }));
    setTimeout(() => setMixing(false), 30000);
  }

  function handleNewComp() {
    const ws = getWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "command", text: `/comp new ${compName}` }));
    setTracks([]);
  }

  return (
    <div className="compose-page">
      <VideotexPageHeader title="COMPOSE" subtitle="Studio de composition multi-pistes" color="pink" />

      {/* Composition Header */}
      <div className="compose-comp-header">
        <input
          type="text"
          value={compName}
          onChange={(e) => setCompName(e.target.value)}
          className="minitel-input"
          placeholder="Nom de la composition"
        />
        <button className="minitel-nav-btn" onClick={handleNewComp}>
          Nouvelle
        </button>
        <span className="compose-track-count">
          {tracks.length} piste{tracks.length !== 1 ? "s" : ""}
        </span>
      </div>

      <VideotexSeparator color="pink" />

      {/* Track Generator */}
      <form onSubmit={handleAddTrack} className="compose-form">
        <div className="compose-header">{">>> AJOUTER UNE PISTE <<<"}</div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="dark ambient drone with deep bass, musique concrete style..."
          className="minitel-input compose-textarea"
          rows={2}
          maxLength={500}
        />
        <div className="compose-options">
          <div className="minitel-field">
            <label>Style _</label>
            <select value={style} onChange={(e) => setStyle(e.target.value)} className="minitel-input">
              <optgroup label="Electronique">
                <option value="experimental">Experimental</option>
                <option value="ambient">Ambient</option>
                <option value="drone">Drone</option>
                <option value="noise">Noise</option>
                <option value="glitch">Glitch</option>
                <option value="industrial">Industrial</option>
                <option value="techno">Techno</option>
                <option value="house">House</option>
                <option value="minimal">Minimal</option>
                <option value="synthwave">Synthwave</option>
                <option value="vaporwave">Vaporwave</option>
                <option value="chillwave">Chillwave</option>
              </optgroup>
              <optgroup label="Acoustique / Concrete">
                <option value="concrete">Musique concrete</option>
                <option value="electroacoustique">Electroacoustique</option>
                <option value="acousmatic">Acousmatique</option>
                <option value="field-recording">Field recording</option>
                <option value="granular">Granulaire</option>
                <option value="spectral">Spectrale</option>
              </optgroup>
              <optgroup label="Jazz / Classique">
                <option value="jazz">Jazz</option>
                <option value="free-jazz">Free jazz</option>
                <option value="classical">Classique</option>
                <option value="orchestral">Orchestral</option>
                <option value="cinematic">Cinematique</option>
                <option value="epic">Epique</option>
              </optgroup>
              <optgroup label="Rock / Metal">
                <option value="post-rock">Post-rock</option>
                <option value="shoegaze">Shoegaze</option>
                <option value="dream-pop">Dream pop</option>
                <option value="metal">Metal</option>
                <option value="punk">Punk</option>
              </optgroup>
              <optgroup label="Urbain">
                <option value="hip-hop">Hip-hop</option>
                <option value="trap">Trap</option>
                <option value="lo-fi">Lo-fi</option>
              </optgroup>
              <optgroup label="World">
                <option value="folk">Folk</option>
                <option value="world">World</option>
                <option value="african">Africain</option>
                <option value="arabic">Arabe</option>
                <option value="indian">Indien</option>
                <option value="gamelan">Gamelan</option>
              </optgroup>
              <optgroup label="Dark / Atmosphere">
                <option value="dark">Dark ambient</option>
                <option value="dark-ambient">Dark ambient deep</option>
              </optgroup>
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
          <button type="submit" className="minitel-login-btn" disabled={generating || !prompt.trim()}>
            {generating ? `Generation... ${Math.floor(progress)}%` : ">>> Ajouter piste <<<"}
          </button>
        </div>
        {error && <div className="minitel-login-error">{error}</div>}
      </form>

      {generating && (
        <div className="vtx-progress">
          <div className="vtx-progress-label">
            <span className="minitel-cursor">{"\u2588"}</span> GENERATION EN COURS
          </div>
          <div className="vtx-progress-bar">
            <div className="vtx-progress-fill" style={{ width: `${progress}%` }}>
              {"\u2588".repeat(Math.floor(progress / 2.5))}
            </div>
          </div>
          <div className="vtx-progress-pct">{Math.floor(progress)}%</div>
        </div>
      )}

      <VideotexSeparator color="cyan" />

      {/* Track List */}
      <div className="compose-tracks">
        <div className="compose-header">{">>> PISTES <<<"}</div>
        {tracks.length === 0 ? (
          <div className="muted" style={{ textAlign: "center", padding: "12px 0", opacity: 0.5 }}>
            Aucune piste. Ajoute-en une ci-dessus.
          </div>
        ) : (
          tracks.map((track, i) => (
            <div key={track.id} className="compose-track">
              <span className="compose-track-num">#{i + 1}</span>
              <span className="compose-track-prompt">{track.prompt}</span>
              <span className="compose-track-info">
                {track.style} &middot; {track.duration}s
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={track.volume}
                onChange={(e) => {
                  setTracks((prev) => prev.map((t, j) => (j === i ? { ...t, volume: Number(e.target.value) } : t)));
                }}
                className="compose-volume"
                title={`Volume: ${track.volume}%`}
              />
              {track.audioData && (
                <audio controls src={`data:${track.audioMime};base64,${track.audioData}`} className="compose-audio" />
              )}
              <button
                className="compose-track-del"
                onClick={() => setTracks((prev) => prev.filter((_, j) => j !== i))}
              >
                X
              </button>
            </div>
          ))
        )}
      </div>

      {/* Mix Controls */}
      {tracks.length > 0 && (
        <>
          <VideotexSeparator color="green" />
          <div className="compose-mix">
            <div className="compose-header">{">>> MIXAGE <<<"}</div>
            <div className="compose-mix-controls">
              <button className="minitel-login-btn" onClick={handleMix} disabled={mixing || tracks.length < 1}>
                {mixing ? "Mixage en cours..." : `>>> Mixer ${tracks.length} piste${tracks.length !== 1 ? "s" : ""} <<<`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
