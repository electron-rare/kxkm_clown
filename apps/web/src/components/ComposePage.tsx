import React, { useState, useRef, useEffect } from "react";
import { VideotexPageHeader } from "./VideotexMosaic";

interface Track {
  id: number;
  label: string;
  type: "music" | "voice" | "noise" | "fx";
  prompt: string;
  duration: number;
  volume: number;
  color: string;
  audioData?: string;
  audioMime?: string;
  generating: boolean;
}

const DEFAULT_TRACKS: Track[] = [
  { id: 1, label: "MUSIQUE", type: "music", prompt: "", duration: 30, volume: 100, color: "#c84c0c", generating: false },
  { id: 2, label: "VOIX", type: "voice", prompt: "", duration: 10, volume: 100, color: "#2c6e49", generating: false },
  { id: 3, label: "TEXTURE", type: "noise", prompt: "", duration: 30, volume: 80, color: "#7c3aed", generating: false },
  { id: 4, label: "EFFET", type: "fx", prompt: "", duration: 15, volume: 60, color: "#0f766e", generating: false },
];

const NOISE_TYPES = ["drone", "pink", "white", "brown", "sine"];
const STYLES = ["experimental", "ambient", "drone", "noise", "glitch", "industrial", "techno", "minimal", "concrete", "jazz", "classical", "dark", "lo-fi", "post-rock"];

export default function ComposePage() {
  const [tracks, setTracks] = useState<Track[]>(DEFAULT_TRACKS);
  const [compName, setCompName] = useState("Ma composition");
  const [style, setStyle] = useState("experimental");
  const [mixing, setMixing] = useState(false);
  const [status, setStatus] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const nick = sessionStorage.getItem("kxkm-nick") || "composer";
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/ws?nick=" + encodeURIComponent(nick));
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "music" && m.audioData) {
          setTracks(prev => {
            const idx = prev.findIndex(t => t.generating);
            if (idx < 0) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], audioData: m.audioData, audioMime: m.audioMime || "audio/wav", generating: false };
            return updated;
          });
          setStatus("");
        }
        if (m.type === "audio" && m.data) {
          setTracks(prev => {
            const idx = prev.findIndex(t => t.generating);
            if (idx < 0) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], audioData: m.data, audioMime: m.mimeType || "audio/wav", generating: false };
            return updated;
          });
          setStatus("");
        }
        if (m.type === "system" && m.text) {
          if (m.text.includes("Mix termine") || m.text.includes("Master termine")) {
            setMixing(false);
            setStatus("Mix OK!");
          }
          if (m.text.includes("Erreur")) {
            setTracks(prev => prev.map(t => t.generating ? { ...t, generating: false } : t));
            setMixing(false);
            setStatus(m.text.slice(0, 60));
          }
        }
      } catch { /* ignore parse errors */ }
    };
    return () => ws.close();
  }, []);

  function cmd(c: string) {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "command", text: c }));
  }

  function generate(trackIdx: number) {
    const track = tracks[trackIdx];
    if (!track.prompt.trim() && track.type !== "noise") return;

    setTracks(prev => prev.map((t, i) => i === trackIdx ? { ...t, generating: true, audioData: undefined } : t));
    setStatus("Generation " + track.label + "...");

    switch (track.type) {
      case "music":
        cmd("/layer " + track.prompt.trim() + ", " + style + ", " + track.duration + "s");
        break;
      case "voice":
        cmd("/voice Pharmacius \"" + track.prompt.trim() + "\"");
        break;
      case "noise":
        cmd("/noise " + (track.prompt.trim() || "drone") + " " + track.duration);
        break;
      case "fx":
        cmd("/noise " + (track.prompt.trim() || "pink") + " " + track.duration);
        break;
    }
  }

  function mixAll() {
    cmd("/comp new " + compName);
    setMixing(true);
    setStatus("Mixage...");
    cmd("/mix");
  }

  const maxDur = Math.max(30, ...tracks.map(t => t.duration));
  const hasAudio = tracks.some(t => t.audioData);

  return (
    <div className="cmp">
      {/* HEADER */}
      <div className="cmp-header">
        <VideotexPageHeader title="COMPOSE" subtitle="4 pistes" color="magenta" />
        <div className="cmp-name-row">
          <input className="cmp-name" value={compName} onChange={e => setCompName(e.target.value)} placeholder="Nom..." />
          <select className="cmp-style" value={style} onChange={e => setStyle(e.target.value)}>
            {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* 4 TRACKS */}
      <div className="cmp-tracks">
        {tracks.map((track, i) => (
          <div key={track.id} className={"cmp-track" + (track.generating ? " cmp-track-gen" : "")}>
            {/* Track header */}
            <div className="cmp-track-head" style={{ borderLeftColor: track.color }}>
              <span className="cmp-track-label" style={{ color: track.color }}>{track.label}</span>
              <input
                type="range" min={0} max={100} value={track.volume}
                className="cmp-vol"
                onChange={e => setTracks(prev => prev.map((t, j) => j === i ? { ...t, volume: +e.target.value } : t))}
              />
              <select
                className="cmp-dur"
                value={track.duration}
                onChange={e => setTracks(prev => prev.map((t, j) => j === i ? { ...t, duration: +e.target.value } : t))}
              >
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
              </select>
            </div>

            {/* Prompt + generate */}
            <div className="cmp-track-body">
              {track.type === "noise" ? (
                <select
                  className="cmp-prompt"
                  value={track.prompt || "drone"}
                  onChange={e => setTracks(prev => prev.map((t, j) => j === i ? { ...t, prompt: e.target.value } : t))}
                >
                  {NOISE_TYPES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              ) : (
                <input
                  className="cmp-prompt"
                  value={track.prompt}
                  onChange={e => setTracks(prev => prev.map((t, j) => j === i ? { ...t, prompt: e.target.value } : t))}
                  placeholder={track.type === "music" ? "dark ambient drone..." : track.type === "voice" ? "Le son est notre matiere..." : "pink noise..."}
                />
              )}
              <button
                className="cmp-gen-btn"
                style={{ backgroundColor: track.color }}
                disabled={track.generating || (!track.prompt.trim() && track.type !== "noise")}
                onClick={() => generate(i)}
              >
                {track.generating ? "..." : "\u25B6"}
              </button>
            </div>

            {/* Timeline block + audio */}
            <div className="cmp-track-timeline">
              <div
                className="cmp-block"
                style={{
                  width: (track.duration / maxDur) * 100 + "%",
                  backgroundColor: track.audioData ? track.color : "transparent",
                  borderColor: track.color,
                  opacity: track.audioData ? track.volume / 100 : 0.2,
                }}
              >
                {track.audioData && <span className="cmp-block-dur">{track.duration}s</span>}
              </div>
              {track.audioData && (
                <audio controls src={"data:" + track.audioMime + ";base64," + track.audioData} className="cmp-audio" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* MIX CONTROLS */}
      {hasAudio && (
        <div className="cmp-mix">
          <button className="cmp-mix-btn" onClick={mixAll} disabled={mixing}>
            {mixing ? "Mixage..." : "MIX " + tracks.filter(t => t.audioData).length + " pistes"}
          </button>
          <button className="cmp-mix-btn cmp-mix-master" onClick={() => cmd("/master")} disabled={mixing}>
            MASTER
          </button>
        </div>
      )}

      {/* STATUS */}
      {status && <div className="cmp-status">{status}</div>}
    </div>
  );
}
