import React, { useState, useRef, useEffect, useCallback } from "react";

interface Track {
  id: number;
  name: string;
  prompt: string;
  style: string;
  duration: number;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  type: "music" | "voice" | "noise";
  color: string;
  startOffset: number; // seconds offset in timeline
  audioData?: string;
  audioMime?: string;
}

const COLORS = ["#c84c0c","#2c6e49","#7c3aed","#0f766e","#b45309","#1d4ed8","#be185d","#0f5b78","#9333ea","#dc2626","#059669","#d97706"];
const STYLES = [
  { group: "Electronique", items: ["experimental","ambient","drone","noise","glitch","industrial","techno","minimal","synthwave","idm","breakbeat","drum-n-bass","dubstep","house"] },
  { group: "Concrete", items: ["concrete","electroacoustique","acousmatic","field-recording","tape-music"] },
  { group: "Jazz/Classique", items: ["jazz","free-jazz","classical","cinematic","orchestral","chamber","opera"] },
  { group: "Rock/Urbain", items: ["post-rock","metal","punk","hip-hop","lo-fi","trap","garage"] },
  { group: "World/Dark", items: ["folk","world","dark","dark-ambient","ritual","tribal"] },
];
const FX_LIST = [
  { label: "Reverse", cmd: "reverse", special: "" },
  { label: "Reverb", cmd: "reverb", special: "" },
  { label: "Echo", cmd: "echo", special: "" },
  { label: "Distortion", cmd: "distortion", special: "" },
  { label: "Stutter x8", cmd: "stutter", special: "/stutter {i} 8" },
  { label: "Pitch +3", cmd: "pitch 3", special: "" },
  { label: "Pitch -3", cmd: "pitch -3", special: "" },
  { label: "Fade In 3s", cmd: "fade-in 3", special: "" },
  { label: "Fade Out 3s", cmd: "fade-out 3", special: "" },
  { label: "Normalize", cmd: "normalize", special: "/normalize {i}" },
  { label: "Speed +20%", cmd: "speed 1.2", special: "" },
  { label: "Speed -20%", cmd: "speed 0.8", special: "" },
];
const CTX_ACTIONS = [
  { label: "Reverse", fn: (i: number) => "/fx " + i + " reverse" },
  { label: "Reverb", fn: (i: number) => "/fx " + i + " reverb" },
  { label: "Echo", fn: (i: number) => "/fx " + i + " echo" },
  { label: "Distortion", fn: (i: number) => "/fx " + i + " distortion" },
  { label: "Pitch +3", fn: (i: number) => "/fx " + i + " pitch 3" },
  { label: "Pitch -3", fn: (i: number) => "/fx " + i + " pitch -3" },
  { label: "Fade In 3s", fn: (i: number) => "/fx " + i + " fade-in 3" },
  { label: "Fade Out 3s", fn: (i: number) => "/fx " + i + " fade-out 3" },
  { label: "Stutter x8", fn: (i: number) => "/stutter " + i + " 8" },
  { label: "Normalize", fn: (i: number) => "/normalize " + i },
  { label: "Loop x2", fn: (i: number) => "/loop " + i + " 2" },
  { label: "Duplicate", fn: (i: number) => "/dup " + i },
  { label: "Remix", fn: (i: number) => "/remix " + i },
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
  const [zoom, setZoom] = useState(8);
  const [editingName, setEditingName] = useState<number | null>(null);
  const [fxOpen, setFxOpen] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{ trackIdx: number; mode: "move" | "resize"; startX: number; origOffset: number; origDuration: number } | null>(null);
  const pxPerSec = zoom;

  // Handle drag/resize
  const handlePointerDown = useCallback((e: React.PointerEvent, trackIdx: number, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    const track = tracks[trackIdx];
    setDragging({ trackIdx, mode, startX: e.clientX, origOffset: track.startOffset, origDuration: track.duration });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [tracks]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.startX;
    const dSec = dx / pxPerSec;
    setTracks(prev => prev.map((t, i) => {
      if (i !== dragging.trackIdx) return t;
      if (dragging.mode === "move") {
        return { ...t, startOffset: Math.max(0, Math.round((dragging.origOffset + dSec) * 2) / 2) }; // snap 0.5s
      } else {
        return { ...t, duration: Math.max(1, Math.round((dragging.origDuration + dSec) * 2) / 2) }; // snap 0.5s
      }
    }));
  }, [dragging, pxPerSec]);

  const handlePointerUp = useCallback(() => {
    if (dragging) {
      const t = tracks[dragging.trackIdx];
      if (dragging.mode === "resize" && t.duration !== dragging.origDuration) {
        // Send trim command
        cmd(`/trim ${dragging.trackIdx + 1} 0 ${t.duration}`);
      }
      setDragging(null);
    }
  }, [dragging, tracks]);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackIdx: number } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

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
            id: Date.now() + Math.random(),
            name: (m.text || "Sans titre").slice(0, 30),
            prompt: m.text || "Sans titre", style, duration, volume: 100, pan: 0,
            muted: false, solo: false,
            type: (m.text || "").match(/noise|silence|drone|pink|white|sine|brown/i) ? "noise" as const : "music" as const,
            color: COLORS[prev.length % COLORS.length], startOffset: 0,
            audioData: m.audioData, audioMime: m.audioMime || "audio/wav",
          }]);
          setGenerating(false); setStatus("");
        }
        if (m.type === "audio" && m.data) {
          setTracks(prev => [...prev, {
            id: Date.now() + Math.random(),
            name: m.nick ? m.nick + " (voix)" : "Voix",
            prompt: m.nick ? m.nick + " (voix)" : "Voix",
            style: "voice", duration: 10, volume: 100, pan: 0,
            muted: false, solo: false, type: "voice" as const,
            color: COLORS[prev.length % COLORS.length], startOffset: 0,
            audioData: m.data, audioMime: m.mimeType || "audio/wav",
          }]);
          setGenerating(false); setStatus("");
        }
        if (m.type === "system" && m.text) {
          const t = m.text;
          if (t.includes("ajoute") || t.includes("Generation") || t.includes("Mixage") || t.includes("Master")) setStatus(t.slice(0, 80));
          if (t.includes("Erreur") || t.includes("echouee")) { setGenerating(false); setStatus("! " + t.slice(0, 60)); }
          if (t.includes("Mix termine") || t.includes("Master termine")) setStatus(t.slice(0, 60));
        }
      } catch { /* ignore */ }
    };
    return () => { ws.close(); };
  }, []);

  useEffect(() => {
    const close = () => { setContextMenu(null); setFxOpen(null); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  useEffect(() => { if (editInputRef.current) editInputRef.current.focus(); }, [editingName]);

  const cmd = useCallback((c: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", text: c }));
    }
  }, []);

  const maxDur = Math.max(30, ...tracks.map(t => t.startOffset + t.duration));
  const totalDur = tracks.reduce((s, t) => Math.max(s, t.duration), 0);
  const timelineWidth = maxDur * zoom;
  const beatInterval = 60 / bpm;
  const totalBeats = Math.ceil(maxDur / beatInterval);
  const typeIcon = (t: Track) => t.type === "voice" ? "V" : t.type === "noise" ? "N" : "M";

  const updateTrack = (idx: number, patch: Partial<Track>) =>
    setTracks(p => p.map((t, j) => j === idx ? { ...t, ...patch } : t));
  const deleteTrack = (idx: number) =>
    setTracks(p => p.filter((_, j) => j !== idx));
  const cyclePan = (idx: number) => {
    const vals = [-1, -0.5, 0, 0.5, 1];
    const cur = tracks[idx].pan;
    const ni = vals.indexOf(cur);
    const next = vals[(ni >= 0 ? ni + 1 : 2) % vals.length];
    updateTrack(idx, { pan: next });
  };

  const fxCmd = (trackIdx: number, fx: typeof FX_LIST[0]) => {
    const i = trackIdx + 1;
    if (fx.special) cmd(fx.special.replace("{i}", String(i)));
    else cmd("/fx " + i + " " + fx.cmd);
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    setPlayheadPos(Math.max(0, (x / timelineWidth) * maxDur));
  };

  const selIdx = selectedTrack !== null ? selectedTrack : (tracks.length > 0 ? tracks.length - 1 : null);

  return (
    <div className="daw">
      {/* Transport Bar */}
      <div className="daw-topbar">
        <input className="daw-name" value={compName} onChange={e => setCompName(e.target.value)} title="Composition name" />
        <label className="daw-bpm-label">
          BPM <input type="number" className="daw-bpm-input" min={20} max={300} value={bpm} onChange={e => setBpm(Math.max(20, Math.min(300, +e.target.value)))} />
        </label>
        <span className="daw-time">{String(Math.floor(totalDur / 60)).padStart(2, "0")}:{String(Math.floor(totalDur % 60)).padStart(2, "0")}</span>
        <span className="daw-track-count">{tracks.length} pistes</span>
        <div className="daw-transport">
          <button className="daw-btn" onClick={() => { cmd("/comp new " + compName); setTracks([]); setStatus("Nouveau"); }}>NEW</button>
          <button className="daw-btn" onClick={() => cmd("/comp save")}>SAVE</button>
          <button className="daw-btn" onClick={() => cmd("/comp load")}>LOAD</button>
        </div>
      </div>

      {/* Body: Headers + Timeline */}
      <div className="daw-body">
        {/* Track Headers (left panel 160px) */}
        <div className="daw-headers">
          <div className="daw-header-ruler">
            <button className="daw-zoom-btn" onClick={() => setZoom(z => Math.max(2, z - 2))} title="Zoom out">-</button>
            <span className="daw-zoom-val">{zoom}px/s</span>
            <button className="daw-zoom-btn" onClick={() => setZoom(z => Math.min(30, z + 2))} title="Zoom in">+</button>
          </div>
          {tracks.map((track, i) => (
            <div key={track.id} className={"daw-th" + (selectedTrack === i ? " daw-th-sel" : "") + (track.muted ? " daw-th-muted" : "")} onClick={() => setSelectedTrack(i)}>
              <div className="daw-th-row1">
                <div className="daw-th-color" style={{ backgroundColor: track.color }} />
                <span className="daw-th-type">{typeIcon(track)}{i + 1}</span>
                {editingName === i ? (
                  <input ref={editInputRef} className="daw-th-name-edit" defaultValue={track.name}
                    onBlur={e => { updateTrack(i, { name: e.target.value }); setEditingName(null); }}
                    onKeyDown={e => { if (e.key === "Enter") { updateTrack(i, { name: (e.target as HTMLInputElement).value }); setEditingName(null); } if (e.key === "Escape") setEditingName(null); }}
                  />
                ) : (
                  <span className="daw-th-name" onDoubleClick={e => { e.stopPropagation(); setEditingName(i); }} title="Double-click to rename">{track.name}</span>
                )}
              </div>
              <div className="daw-th-row2">
                <button className={"daw-btn-sm" + (track.muted ? " active" : "")} onClick={e => { e.stopPropagation(); updateTrack(i, { muted: !track.muted }); }}>M</button>
                <button className={"daw-btn-sm" + (track.solo ? " active" : "")} onClick={e => { e.stopPropagation(); updateTrack(i, { solo: !track.solo }); }}>S</button>
                <input type="range" min={0} max={100} value={track.volume} className="daw-vol" title={"Vol: " + track.volume + "%"}
                  onClick={e => e.stopPropagation()} onChange={e => updateTrack(i, { volume: +e.target.value })} />
                <span className="daw-pan" onClick={e => { e.stopPropagation(); cyclePan(i); }} title="Pan (click to cycle)">
                  {track.pan < 0 ? "L" + Math.abs(track.pan * 100) : track.pan > 0 ? "R" + (track.pan * 100) : "C"}
                </span>
                <span className="daw-fx-trigger" onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setFxOpen(fxOpen === i ? null : i); }}>FX</span>
                {fxOpen === i && (
                  <div className="daw-fx-dropdown" onClick={e => e.stopPropagation()}>
                    {FX_LIST.map(fx => (
                      <button key={fx.label} onClick={() => { fxCmd(i, fx); setFxOpen(null); }}>{fx.label}</button>
                    ))}
                  </div>
                )}
                <button className="daw-btn-sm daw-btn-del" onClick={e => { e.stopPropagation(); deleteTrack(i); }} title="Delete track">X</button>
              </div>
              {track.audioData && (
                <audio controls src={"data:" + track.audioMime + ";base64," + track.audioData} className="daw-audio-sm" onClick={e => e.stopPropagation()} />
              )}
            </div>
          ))}
          {tracks.length === 0 && <div className="daw-th-empty">Pas de pistes</div>}
        </div>

        {/* Timeline (right panel, scrollable) */}
        <div className="daw-timeline-wrap" onClick={handleTimelineClick}>
          <div className="daw-timeline" style={{ width: timelineWidth + "px" }} ref={timelineRef}>
            <div className="daw-ruler">
              {Array.from({ length: Math.ceil(maxDur) + 1 }, (_, s) => (
                <div key={s} className={"daw-ruler-mark" + (s % 5 === 0 ? " daw-ruler-major" : "")} style={{ left: s * zoom }}>
                  {s % 5 === 0 && <span className="daw-ruler-num">{s}s</span>}
                </div>
              ))}
            </div>
            <div className="daw-lanes">
              {Array.from({ length: totalBeats + 1 }, (_, b) => (
                <div key={b} className="daw-beat-line" style={{ left: b * beatInterval * zoom }} />
              ))}
              <div className="daw-playhead" style={{ left: playheadPos * zoom }} />
              {tracks.map((track, i) => (
                <div key={track.id} className={"daw-lane" + (selectedTrack === i ? " daw-lane-sel" : "") + (track.muted ? " daw-lane-muted" : "")}
                  onClick={e => { e.stopPropagation(); setSelectedTrack(i); }}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, trackIdx: i }); }}>
                  <div className={`daw-block ${dragging?.trackIdx === i ? "daw-block-dragging" : ""}`} style={{
                    width: Math.max(track.duration * zoom, 24),
                    backgroundColor: track.color,
                    opacity: track.muted ? 0.3 : 0.5 + (track.volume / 200),
                  }} title={`${track.prompt} (${track.startOffset}s → ${track.startOffset + track.duration}s)`}
                  onPointerDown={(e) => handlePointerDown(e, i, "move")}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                
                  onContextMenu={(ev) => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, trackIdx: i }); }}>
                  {/* Resize handle */}
                  <div className="daw-resize-handle"
                    onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(e, i, "resize"); }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                  />
                    <span className="daw-block-text">{track.prompt.slice(0, 40)}</span>
                    <span className="daw-block-dur">{track.duration}s</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="daw-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <div className="daw-ctx-title">Track #{contextMenu.trackIdx + 1}</div>
          {CTX_ACTIONS.map(a => (
            <button key={a.label} onClick={() => { cmd(a.fn(contextMenu.trackIdx + 1)); setContextMenu(null); }}>{a.label}</button>
          ))}
          <hr />
          <button className="daw-ctx-danger" onClick={() => { deleteTrack(contextMenu.trackIdx); setContextMenu(null); }}>Supprimer</button>
        </div>
      )}

      {/* Generator Panel */}
      <div className="daw-generator">
        <div className="daw-gen-row">
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Prompt de generation..." className="daw-prompt" rows={2} />
          <select value={style} onChange={e => setStyle(e.target.value)} className="daw-select">
            {STYLES.map(g => <optgroup key={g.group} label={g.group}>{g.items.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>)}
          </select>
          <select value={duration} onChange={e => setDuration(+e.target.value)} className="daw-select daw-dur">
            <option value={5}>5s</option><option value={10}>10s</option><option value={15}>15s</option>
            <option value={30}>30s</option><option value={60}>60s</option><option value={120}>2m</option>
          </select>
        </div>
        <div className="daw-btn-row">
          <button className="daw-btn daw-btn-gen" disabled={generating || !prompt.trim()} onClick={() => { setGenerating(true); setStatus("Generation..."); cmd("/layer " + prompt.trim() + ", " + style + ", " + duration + "s"); }}>MUSIC</button>
          <button className="daw-btn daw-btn-voice" disabled={generating || !prompt.trim()} onClick={() => { setGenerating(true); setStatus("Voix..."); cmd('/voice Pharmacius "' + prompt.trim() + '"'); }}>VOICE</button>
          <button className="daw-btn" onClick={() => { setGenerating(true); setStatus("Drone..."); cmd("/noise drone " + duration); }}>DRONE</button>
          <button className="daw-btn" onClick={() => { setGenerating(true); setStatus("Pink..."); cmd("/noise pink " + duration); }}>PINK</button>
          <button className="daw-btn" onClick={() => { setGenerating(true); setStatus("White..."); cmd("/noise white " + duration); }}>WHITE</button>
          <button className="daw-btn" onClick={() => { setGenerating(true); setStatus("Sine..."); cmd("/noise sine " + duration); }}>SINE</button>
          <button className="daw-btn" onClick={() => { setGenerating(true); setStatus("Brown..."); cmd("/noise brown " + duration); }}>BROWN</button>
          <button className="daw-btn" onClick={() => { cmd("/silence " + duration); }}>SILENCE</button>
        </div>
        {selIdx !== null && tracks.length > 0 && (
          <div className="daw-btn-row daw-fx-bar">
            <span className="daw-fx-label">FX #{selIdx + 1}</span>
            <button className="daw-btn" onClick={() => cmd("/fx " + (selIdx + 1) + " reverse")}>REV</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + (selIdx + 1) + " reverb")}>VERB</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + (selIdx + 1) + " echo")}>ECHO</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + (selIdx + 1) + " distortion")}>DIST</button>
            <button className="daw-btn" onClick={() => cmd("/stutter " + (selIdx + 1) + " 8")}>STUT</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + (selIdx + 1) + " pitch 3")}>P+</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + (selIdx + 1) + " pitch -3")}>P-</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + (selIdx + 1) + " fade-in 3")}>FIN</button>
            <button className="daw-btn" onClick={() => cmd("/fx " + (selIdx + 1) + " fade-out 3")}>FOUT</button>
            <button className="daw-btn" onClick={() => cmd("/normalize " + (selIdx + 1))}>NORM</button>
          </div>
        )}
        {tracks.length > 1 && (
          <div className="daw-btn-row daw-mix-bar">
            <button className="daw-btn daw-btn-mix" onClick={() => { setStatus("Mixage..."); cmd("/mix"); }}>MIX</button>
            <button className="daw-btn daw-btn-mix" onClick={() => { setStatus("Mastering..."); cmd("/master"); }}>MASTER</button>
            <button className="daw-btn daw-btn-export" onClick={() => cmd("/export")}>EXPORT</button>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="daw-status">
        {status || (compName + " | " + tracks.length + " pistes | " + Math.floor(totalDur) + "s | " + bpm + " BPM")}
        {generating && <span className="daw-spinner" />}
      </div>
    </div>
  );
}
