import React, { useState, useRef, useEffect } from "react";
import { VideotexPageHeader } from "./VideotexMosaic";

interface Track {
  id: number;
  prompt: string;
  style: string;
  duration: number;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  type: "music" | "voice" | "sfx";
  color: string;
  audioData?: string;
  audioMime?: string;
}

const COLORS = ["#c84c0c", "#2c6e49", "#7c3aed", "#0f766e", "#b45309", "#1d4ed8", "#be185d", "#0f5b78"];
const STYLES = [
  { group: "Electronique", items: ["experimental", "ambient", "drone", "noise", "glitch", "industrial", "techno", "minimal", "synthwave"] },
  { group: "Concrete", items: ["concrete", "electroacoustique", "acousmatic", "field-recording"] },
  { group: "Jazz/Classique", items: ["jazz", "free-jazz", "classical", "cinematic"] },
  { group: "Rock/Urbain", items: ["post-rock", "metal", "hip-hop", "lo-fi", "trap"] },
  { group: "World/Dark", items: ["folk", "world", "dark", "dark-ambient"] },
];

export default function ComposePage() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("experimental");
  const [duration, setDuration] = useState(30);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [bpm, setBpm] = useState(120);
  const [compName, setCompName] = useState("Ma composition");
  const [status, setStatus] = useState("");
  const [generating, setGenerating] = useState(false);
  const [playheadPos, setPlayheadPos] = useState(0);
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nick = sessionStorage.getItem("kxkm-nick") || "composer";
    const wsUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/ws?nick=" + encodeURIComponent(nick);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const m = JSON.parse(event.data);
        if (m.type === "music" && m.audioData) {
          setTracks(prev => [...prev, {
            id: Date.now() + Math.random(), prompt: m.text || "Sans titre", style, duration, volume: 100, pan: 0, muted: false, solo: false,
            type: (m.text || "").includes("Noise") || (m.text || "").includes("silence") ? "sfx" : "music",
            color: COLORS[prev.length % COLORS.length], audioData: m.audioData, audioMime: m.audioMime || "audio/wav",
          }]);
          setGenerating(false); setStatus("");
        }
        if (m.type === "audio" && m.data) {
          setTracks(prev => [...prev, {
            id: Date.now() + Math.random(), prompt: m.nick ? m.nick + " (voix)" : "Voix", style: "voice", duration: 10, volume: 100, pan: 0, muted: false, solo: false,
            type: "voice", color: COLORS[prev.length % COLORS.length], audioData: m.data, audioMime: m.mimeType || "audio/wav",
          }]);
          setGenerating(false); setStatus("");
        }
        if (m.type === "system" && m.text) {
          const t = m.text;
          if (t.includes("ajoute") || t.includes("Generation") || t.includes("Mixage") || t.includes("Master")) setStatus(t.slice(0, 80));
          if (t.includes("Erreur") || t.includes("echouee")) { setGenerating(false); setStatus("! " + t.slice(0, 60)); }
          if (t.includes("Mix termine") || t.includes("Master termine")) setStatus(t.slice(0, 60));
        }
      } catch {}
    };
    return () => { ws.close(); };
  }, []);

  function cmd(c: string) { wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ type: "command", text: c })); }

  const maxDur = Math.max(30, ...tracks.map(t => t.duration));
  const totalDur = tracks.reduce((s, t) => Math.max(s, t.duration), 0);
  const beats = Math.ceil((maxDur * bpm) / 60);

  return (
    <div className="daw">
      {/* TOP BAR */}
      <div className="daw-topbar">
        <input className="daw-name" value={compName} onChange={e => setCompName(e.target.value)} />
        <div className="daw-transport">
          <button className="daw-btn" onClick={() => { cmd("/comp new " + compName); setTracks([]); }}>NEW</button>
          <button className="daw-btn" onClick={() => cmd("/comp save")}>SAVE</button>
          <span className="daw-bpm" onClick={() => { const b = prompt ? parseInt(prompt) : 0; if (b >= 20 && b <= 300) setBpm(b); }}>
            {bpm} BPM
          </span>
          <span className="daw-time">{Math.floor(totalDur / 60)}:{String(Math.floor(totalDur % 60)).padStart(2, "0")}</span>
          <span className="daw-tracks">{tracks.length}T</span>
        </div>
      </div>

      {/* GLOBAL LANES (Arrangement, Marker, Tempo) */}
      <div className="daw-globals">
        <div className="daw-global-lane">
          <span className="daw-global-label">Arrangement</span>
          <div className="daw-global-area">
            <div className="daw-arrangement-block" style={{ width: "100%" }}>{compName}</div>
          </div>
        </div>
        <div className="daw-global-lane">
          <span className="daw-global-label">Tempo</span>
          <div className="daw-global-area">
            <span className="daw-tempo-point">{bpm}</span>
          </div>
        </div>
      </div>

      {/* RULER */}
      <div className="daw-ruler-row">
        <div className="daw-track-header" />
        <div className="daw-ruler" ref={timelineRef}>
          {Array.from({ length: Math.ceil(maxDur) + 1 }, (_, i) => (
            <div key={i} className={`daw-ruler-mark ${i % 5 === 0 ? "daw-ruler-major" : ""}`} style={{ left: `${(i / maxDur) * 100}%` }}>
              {i % 5 === 0 && <span className="daw-ruler-num">{i}</span>}
            </div>
          ))}
          <div className="daw-playhead" style={{ left: `${(playheadPos / maxDur) * 100}%` }} />
        </div>
      </div>

      {/* TRACKS */}
      <div className="daw-tracks-area">
        {tracks.length === 0 ? (
          <div className="daw-empty">Ajoute des pistes avec les boutons ci-dessous</div>
        ) : tracks.map((track, i) => (
          <div key={track.id} className={`daw-track-row ${selectedTrack === i ? "daw-track-selected" : ""} ${track.muted ? "daw-track-muted" : ""}`} onClick={() => setSelectedTrack(i)}>
            <div className="daw-track-header">
              <div className="daw-track-color" style={{ backgroundColor: track.color }} />
              <span className="daw-track-name">{track.type === "voice" ? "V" : track.type === "sfx" ? "N" : "M"}{i + 1}</span>
              <button className={`daw-btn-sm ${track.muted ? "active" : ""}`} onClick={e => { e.stopPropagation(); setTracks(p => p.map((t, j) => j === i ? { ...t, muted: !t.muted } : t)); }}>M</button>
              <button className={`daw-btn-sm ${track.solo ? "active" : ""}`} onClick={e => { e.stopPropagation(); setTracks(p => p.map((t, j) => j === i ? { ...t, solo: !t.solo } : t)); }}>S</button>
              <input type="range" min={0} max={100} value={track.volume} className="daw-vol" onChange={e => setTracks(p => p.map((t, j) => j === i ? { ...t, volume: +e.target.value } : t))} onClick={e => e.stopPropagation()} />
              {track.audioData && <audio controls src={`data:${track.audioMime};base64,${track.audioData}`} className="daw-audio" />}
            </div>
            <div className="daw-track-lane">
              <div className="daw-block" style={{
                width: `${Math.max((track.duration / maxDur) * 100, 3)}%`,
                backgroundColor: track.color,
                opacity: track.muted ? 0.3 : track.volume / 100,
              }} title={track.prompt}>
                <span className="daw-block-text">{track.prompt.slice(0, 30)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* CONTROLS */}
      <div className="daw-controls">
        <div className="daw-input-row">
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Prompt..." className="daw-prompt" rows={1} />
          <select value={style} onChange={e => setStyle(e.target.value)} className="daw-select">
            {STYLES.map(g => <optgroup key={g.group} label={g.group}>{g.items.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>)}
          </select>
          <select value={duration} onChange={e => setDuration(+e.target.value)} className="daw-select daw-dur">
            <option value={10}>10s</option><option value={30}>30s</option><option value={60}>60s</option><option value={120}>2m</option>
          </select>
        </div>
        <div className="daw-btn-row">
          <button className="daw-btn daw-btn-gen" disabled={generating || !prompt.trim()} onClick={e => { e.preventDefault(); setGenerating(true); setStatus("..."); cmd("/layer " + prompt.trim() + ", " + style + ", " + duration + "s"); }}>MUSIC</button>
          <button className="daw-btn" disabled={generating || !prompt.trim()} onClick={() => { setGenerating(true); cmd('/voice Pharmacius "' + prompt.trim() + '"'); }}>VOICE</button>
          <button className="daw-btn" onClick={() => { setGenerating(true); cmd("/noise drone " + duration); }}>DRONE</button>
          <button className="daw-btn" onClick={() => { setGenerating(true); cmd("/noise pink " + duration); }}>PINK</button>
          <button className="daw-btn" onClick={() => { setGenerating(true); cmd("/noise white " + duration); }}>WHITE</button>
          <button className="daw-btn" onClick={() => { setGenerating(true); cmd("/noise sine " + duration); }}>SINE</button>
          <button className="daw-btn" onClick={() => cmd("/silence " + duration)}>SIL</button>
        </div>
        {tracks.length > 0 && (
          <div className="daw-btn-row">
            <button className="daw-btn" onClick={() => cmd("/undo")}>UNDO</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + ((selectedTrack ?? tracks.length - 1) + 1) + " reverse")}>REV</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + ((selectedTrack ?? tracks.length - 1) + 1) + " reverb")}>VERB</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + ((selectedTrack ?? tracks.length - 1) + 1) + " echo")}>ECHO</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + ((selectedTrack ?? tracks.length - 1) + 1) + " distortion")}>DIST</button>
            <button className="daw-btn" onClick={() => cmd("/stutter " + ((selectedTrack ?? tracks.length - 1) + 1) + " 8")}>STUT</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + ((selectedTrack ?? tracks.length - 1) + 1) + " pitch 5")}>P+</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + ((selectedTrack ?? tracks.length - 1) + 1) + " pitch -5")}>P-</button>
          </div>
        )}
        {tracks.length > 1 && (
          <div className="daw-btn-row">
            <button className="daw-btn daw-btn-mix" onClick={() => { setStatus("Mixage..."); cmd("/mix"); }}>MIX</button>
            <button className="daw-btn daw-btn-mix" onClick={() => { setStatus("Mastering..."); cmd("/master"); }}>MASTER</button>
            <button className="daw-btn" onClick={() => cmd("/export")}>EXPORT</button>
          </div>
        )}
      </div>

      {/* STATUS */}
      <div className="daw-status">{status || `${compName} | ${tracks.length} pistes | ${totalDur}s | ${bpm} BPM`}</div>
    </div>
  );
}
