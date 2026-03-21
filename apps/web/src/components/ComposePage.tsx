import React, { useState, useRef, useEffect, useCallback } from "react";
import { VideotexPageHeader, VideotexSeparator } from "./VideotexMosaic";

interface Track {
  id: number;
  prompt: string;
  style: string;
  duration: number;
  volume: number;
  type: "music" | "voice" | "sfx";
  audioData?: string;
  audioMime?: string;
}

export default function ComposePage() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("experimental");
  const [duration, setDuration] = useState(30);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mixing, setMixing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [compName, setCompName] = useState("Ma composition");
  const wsRef = useRef<WebSocket | null>(null);

  // Connect to WebSocket
  useEffect(() => {
    const nick = sessionStorage.getItem("kxkm-nick") || "composer";
    const wsUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/ws?nick=" + encodeURIComponent(nick);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const m = JSON.parse(event.data);
        
        // Capture music results (from /layer, /noise, /mix)
        if (m.type === "music" && m.audioData) {
          setTracks(prev => [...prev, {
            id: Date.now() + Math.random(),
            prompt: m.text || "Sans titre",
            style,
            duration,
            volume: 100,
            type: (m.text || "").includes("Noise") ? "sfx" : (m.text || "").includes("Mix") ? "music" : "music",
            audioData: m.audioData,
            audioMime: m.audioMime || "audio/wav",
          }]);
          setGenerating(false);
          setStatus("");
        }
        
        // Capture voice results (from /voice)
        if (m.type === "audio" && m.data) {
          setTracks(prev => [...prev, {
            id: Date.now() + Math.random(),
            prompt: m.nick ? m.nick + " (voix)" : "Voix",
            style: "voice",
            duration: 10,
            volume: 100,
            type: "voice",
            audioData: m.data,
            audioMime: m.mimeType || "audio/wav",
          }]);
          setGenerating(false);
          setStatus("");
        }
        
        // Status messages
        if (m.type === "system" && m.text) {
          const t = m.text;
          if (t.includes("ajoute une piste") || t.includes("Generation") || t.includes("generation") || t.includes("Mixage") || t.includes("compose")) {
            setStatus(t.slice(0, 100));
          }
          if (t.includes("Erreur") || t.includes("echouee")) {
            setGenerating(false);
            setStatus("Erreur: " + t.slice(0, 80));
          }
          if (t.includes("Mix termine")) {
            setMixing(false);
            setStatus("Mix termine!");
          }
        }
      } catch {}
    };

    return () => { ws.close(); };
  }, []);

  function sendCmd(cmd: string) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", text: cmd }));
    }
  }

  function handleAddTrack(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setStatus("Generation en cours...");
    sendCmd("/layer " + prompt.trim() + ", " + style + " style, " + duration + "s");
  }

  function handleAddVoice() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setStatus("Voix en cours...");
    sendCmd("/voice Pharmacius \"" + prompt.trim() + "\"");
  }

  function handleAddNoise(type: string) {
    setGenerating(true);
    setStatus("Noise " + type + "...");
    sendCmd("/noise " + type + " " + duration);
  }

  function handleMix() {
    setMixing(true);
    setStatus("Mixage...");
    sendCmd("/mix");
  }

  function handleNewComp() {
    sendCmd("/comp new " + compName);
    setTracks([]);
    setStatus("Nouvelle composition");
  }

  const maxDuration = Math.max(30, ...tracks.map(t => t.duration));

  return (
    <div className="compose-page">
      <VideotexPageHeader title="COMPOSE" subtitle="Studio multi-pistes" color="magenta" />

      {/* Header */}
      <div className="compose-comp-header">
        <input type="text" value={compName} onChange={e => setCompName(e.target.value)} className="minitel-input" placeholder="Nom" style={{flex:1}} />
        <button className="minitel-nav-btn" onClick={handleNewComp}>Nouvelle</button>
        <span className="compose-track-count">{tracks.length} piste{tracks.length !== 1 ? "s" : ""}</span>
      </div>

      {status && <div className="compose-status">{status}</div>}

      <VideotexSeparator color="magenta" />

      {/* Generator */}
      <form onSubmit={handleAddTrack} className="compose-form">
        <div className="compose-header">{"> AJOUTER UNE PISTE"}</div>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="dark ambient drone, musique concrete..." className="minitel-input compose-textarea" rows={2} maxLength={500} />
        <div className="compose-options">
          <select value={style} onChange={e => setStyle(e.target.value)} className="minitel-input" style={{flex:1}}>
            <optgroup label="Electronique">
              <option value="experimental">Experimental</option>
              <option value="ambient">Ambient</option>
              <option value="drone">Drone</option>
              <option value="noise">Noise</option>
              <option value="glitch">Glitch</option>
              <option value="industrial">Industrial</option>
              <option value="techno">Techno</option>
              <option value="minimal">Minimal</option>
              <option value="synthwave">Synthwave</option>
            </optgroup>
            <optgroup label="Concrete / Acoustique">
              <option value="concrete">Musique concrete</option>
              <option value="electroacoustique">Electroacoustique</option>
              <option value="acousmatic">Acousmatique</option>
              <option value="field-recording">Field recording</option>
            </optgroup>
            <optgroup label="Jazz / Classique">
              <option value="jazz">Jazz</option>
              <option value="free-jazz">Free jazz</option>
              <option value="classical">Classique</option>
              <option value="cinematic">Cinematique</option>
            </optgroup>
            <optgroup label="Rock / Urbain">
              <option value="post-rock">Post-rock</option>
              <option value="metal">Metal</option>
              <option value="hip-hop">Hip-hop</option>
              <option value="lo-fi">Lo-fi</option>
              <option value="trap">Trap</option>
            </optgroup>
            <optgroup label="World / Dark">
              <option value="folk">Folk</option>
              <option value="world">World</option>
              <option value="dark">Dark ambient</option>
            </optgroup>
          </select>
          <select value={duration} onChange={e => setDuration(Number(e.target.value))} className="minitel-input" style={{width:70}}>
            <option value={10}>10s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
            <option value={120}>2min</option>
          </select>
        </div>
        <div className="compose-btn-row">
          <span className="compose-btn-label">Generer:</span>
          <button type="submit" className="minitel-nav-btn" disabled={generating || !prompt.trim()}>Musique</button>
          <button type="button" className="minitel-nav-btn" onClick={handleAddVoice} disabled={generating || !prompt.trim()}>Voix</button>
          <button type="button" className="minitel-nav-btn" onClick={() => handleAddNoise("drone")} disabled={generating}>Drone</button>
          <button type="button" className="minitel-nav-btn" onClick={() => handleAddNoise("pink")} disabled={generating}>Pink</button>
          <button type="button" className="minitel-nav-btn" onClick={() => handleAddNoise("white")} disabled={generating}>White</button>
          <button type="button" className="minitel-nav-btn" onClick={() => handleAddNoise("sine")} disabled={generating}>Sine</button>
          <button type="button" className="minitel-nav-btn" onClick={() => handleAddNoise("brown")} disabled={generating}>Brown</button>
        </div>
        {tracks.length > 0 && (
          <div className="compose-btn-row">
            <span className="compose-btn-label">Edition:</span>
            <button type="button" className="minitel-nav-btn" onClick={() => sendCmd("/undo")}>Undo</button>
            <button type="button" className="minitel-nav-btn" onClick={() => sendCmd("/tracks")}>Tracks</button>
            <button type="button" className="minitel-nav-btn" onClick={() => { const n = prompt.trim() || "1"; sendCmd(`/fx ${n} reverse`); }}>Reverse</button>
            <button type="button" className="minitel-nav-btn" onClick={() => { const n = prompt.trim() || "1"; sendCmd(`/fx ${n} reverb`); }}>Reverb</button>
            <button type="button" className="minitel-nav-btn" onClick={() => { const n = prompt.trim() || "1"; sendCmd(`/fx ${n} echo`); }}>Echo</button>
            <button type="button" className="minitel-nav-btn" onClick={() => { const n = prompt.trim() || "1"; sendCmd(`/fx ${n} distortion`); }}>Distort</button>
            <button type="button" className="minitel-nav-btn" onClick={() => sendCmd(`/stutter ${tracks.length} 8`)}>Stutter</button>
          </div>
        )}
        {tracks.length > 1 && (
          <div className="compose-btn-row">
            <span className="compose-btn-label">Sortie:</span>
            <button type="button" className="minitel-login-btn" onClick={handleMix} disabled={mixing}>
              {mixing ? "Mixage..." : `Mix ${tracks.length}p`}
            </button>
            <button type="button" className="minitel-nav-btn" onClick={() => sendCmd("/master")}>Master</button>
            <button type="button" className="minitel-nav-btn" onClick={() => sendCmd("/export")}>Export</button>
          </div>
        )}
      </form>

      {/* Timeline */}
      {tracks.length > 0 && (
        <>
          <VideotexSeparator color="yellow" />
          <div className="compose-header">{"> TIMELINE"}</div>
          <div className="compose-timeline">
            <div className="timeline-ruler">
              {Array.from({ length: Math.ceil(maxDuration / 5) + 1 }, (_, i) => (
                <span key={i} className="timeline-tick" style={{ left: (i * 5 / maxDuration) * 100 + "%" }}>{i * 5}s</span>
              ))}
            </div>
            {tracks.map((track, i) => {
              const icon = track.type === "voice" ? "V" : track.type === "sfx" ? "N" : "M";
              const colors = ["#c84c0c", "#2c6e49", "#7c3aed", "#0f766e", "#b45309", "#1d4ed8"];
              return (
                <div key={track.id} className="timeline-lane">
                  <span className="timeline-label">{icon}{i + 1}</span>
                  <div className="timeline-track-area">
                    <div className="timeline-block" style={{
                      width: Math.max((track.duration / maxDuration) * 100, 8) + "%",
                      backgroundColor: colors[i % colors.length],
                      opacity: track.volume / 100,
                    }} title={track.prompt + " (" + track.duration + "s)"}>
                      <span className="timeline-block-text">{track.prompt.slice(0, 25)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Tracks detail */}
      {tracks.length > 0 && (
        <>
          <VideotexSeparator color="cyan" />
          <div className="compose-header">{"> PISTES"}</div>
          {tracks.map((track, i) => (
            <div key={track.id} className="compose-track">
              <span className="compose-track-num">#{i + 1}</span>
              <span className="compose-track-prompt">{track.prompt.slice(0, 30)}</span>
              <input type="range" min={0} max={100} value={track.volume} onChange={e => setTracks(prev => prev.map((t, j) => j === i ? { ...t, volume: +e.target.value } : t))} className="compose-volume" title={`Vol: ${track.volume}%`} />
              <div className="compose-track-actions">
                <button className="compose-track-btn" onClick={() => sendCmd(`/solo ${i+1}`)} title="Solo">S</button>
                <button className="compose-track-btn" onClick={() => sendCmd(`/loop ${i+1} 2`)} title="Loop x2">{"\u27f3"}</button>
                <button className="compose-track-btn" onClick={() => sendCmd(`/fx ${i+1} reverse`)} title="Reverse">{"\u21c6"}</button>
              </div>
              {track.audioData && <audio controls src={`data:${track.audioMime};base64,${track.audioData}`} className="compose-audio" />}
              <button className="compose-track-del" onClick={() => setTracks(prev => prev.filter((_, j) => j !== i))}>X</button>
            </div>
          ))}
        </>
      )}

      {/* Status Bar */}
      <div className="compose-status-bar">
        <span>{compName} | {tracks.length}p | {tracks.reduce((s, t) => s + t.duration, 0)}s total</span>
        {status && <span className="compose-status-msg">{status}</span>}
      </div>
    </div>
  );
}
