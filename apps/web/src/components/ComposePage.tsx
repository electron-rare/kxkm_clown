import React, { useState, useRef, useEffect, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { VideotexPageHeader } from "./VideotexMosaic";

interface Track {
  id: number;
  label: string;
  type: "music" | "voice" | "noise" | "fx";
  prompt: string;
  duration: number;
  volume: number;
  color: string;
  startOffset: number;
  audioData?: string;
  audioMime?: string;
  generating: boolean;
  genStart?: number; // timestamp when generation started
  genElapsed?: number; // elapsed seconds (updated by timer)
  persona?: string;
}

const TRACK_TYPES = ["music", "voice", "noise", "fx"] as const;
const TYPE_COLORS: Record<string, string> = {
  music: "#c84c0c",
  voice: "#2c6e49",
  noise: "#7c3aed",
  fx: "#0f766e",
};
const TYPE_LABELS: Record<string, string> = {
  music: "MUSIQUE",
  voice: "VOIX",
  noise: "TEXTURE",
  fx: "EFFET",
};

const DEFAULT_TRACKS: Track[] = [
  { id: 1, label: "MUSIQUE", type: "music", prompt: "", duration: 30, volume: 100, color: "#c84c0c", startOffset: 0, generating: false },
  { id: 2, label: "VOIX", type: "voice", prompt: "", duration: 10, volume: 100, color: "#2c6e49", startOffset: 0, generating: false },
  { id: 3, label: "TEXTURE", type: "noise", prompt: "", duration: 30, volume: 80, color: "#7c3aed", startOffset: 0, generating: false },
  { id: 4, label: "EFFET", type: "fx", prompt: "", duration: 15, volume: 60, color: "#0f766e", startOffset: 0, generating: false },
];

const NOISE_TYPES = ["drone", "pink", "white", "brown", "sine"];
const STYLES = ["experimental", "ambient", "drone", "noise", "glitch", "industrial", "techno", "minimal", "concrete", "jazz", "classical", "dark", "lo-fi", "post-rock"];
const PERSONAS = ["Pharmacius", "Docteur Maboul", "Gargantua", "Nostradamus", "Piaf"];

function toAudioDataUrl(audioData: string, audioMime: string) {
  return `data:${audioMime};base64,${audioData}`;
}

function WaveformPreview({
  audioData,
  audioMime,
  color,
  className,
  height,
  barWidth,
}: {
  audioData: string;
  audioMime: string;
  color: string;
  className: string;
  height: number;
  barWidth?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !audioData) return;

    const wave = WaveSurfer.create({
      container: containerRef.current,
      waveColor: `${color}55`,
      progressColor: color,
      cursorColor: "rgba(255,255,255,0.18)",
      height,
      normalize: true,
      interact: false,
      hideScrollbar: true,
      dragToSeek: false,
      barWidth,
      barGap: 1,
      barRadius: 2,
      cursorWidth: 0,
    });

    wave.load(toAudioDataUrl(audioData, audioMime));

    return () => {
      wave.destroy();
    };
  }, [audioData, audioMime, barWidth, color, height]);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}

function TrackWaveform({ audioData, audioMime, color }: { audioData: string; audioMime: string; color: string }) {
  return (
    <WaveformPreview
      audioData={audioData}
      audioMime={audioMime}
      color={color}
      className="cmp-waveform cmp-waveform-preview"
      height={30}
      barWidth={2}
    />
  );
}

function TimelineWaveform({ audioData, audioMime, color }: { audioData: string; audioMime: string; color: string }) {
  return (
    <WaveformPreview
      audioData={audioData}
      audioMime={audioMime}
      color={color}
      className="cmp-tl-waveform"
      height={18}
      barWidth={1}
    />
  );
}

interface ServerComposition {
  id: string;
  name: string;
  nick: string;
  createdAt: string;
  updatedAt: string;
  tracks: { id: string; type: string; prompt: string; duration: number }[];
}

export default function ComposePage() {
  const [tracks, setTracks] = useState<Track[]>(DEFAULT_TRACKS);
  const [compName, setCompName] = useState("Ma composition");
  const [style, setStyle] = useState("experimental");
  const [mixing, setMixing] = useState(false);
  const [status, setStatus] = useState("");
  const [parallelMode, setParallelMode] = useState(false);
  const [serverComps, setServerComps] = useState<ServerComposition[] | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const [dragging, setDragging] = useState<{ trackIdx: number; mode: "move" | "resize"; startX: number; origOffset: number; origDur: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; trackIdx: number } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const genTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Generation elapsed timer — update all generating tracks every second
  useEffect(() => {
    genTimerRef.current = setInterval(() => {
      setTracks(prev => {
        const hasGen = prev.some(t => t.generating);
        if (!hasGen) return prev;
        return prev.map(t =>
          t.generating && t.genStart
            ? { ...t, genElapsed: Math.round((Date.now() - t.genStart) / 1000) }
            : t
        );
      });
    }, 1000);
    return () => { if (genTimerRef.current) clearInterval(genTimerRef.current); };
  }, []);

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
            const idx = prev.findIndex(t => t.generating && (t.type === "music"));
            if (idx < 0) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], audioData: m.audioData, audioMime: m.audioMime || "audio/wav", generating: false, genStart: undefined, genElapsed: undefined };
            return updated;
          });
          setStatus("");
        }
        if (m.type === "audio" && m.data) {
          setTracks(prev => {
            const idx = prev.findIndex(t => t.generating);
            if (idx < 0) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], audioData: m.data, audioMime: m.mimeType || "audio/wav", generating: false, genStart: undefined, genElapsed: undefined };
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
            setTracks(prev => prev.map(t => t.generating ? { ...t, generating: false, genStart: undefined, genElapsed: undefined } : t));
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

  const maxDur = Math.max(30, ...tracks.map(t => (t.startOffset || 0) + t.duration));

  // Close context menu on outside click
  useEffect(() => {
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const startDrag = useCallback((e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    const track = tracks[idx];
    setDragging({ trackIdx: idx, mode: "move", startX: e.clientX, origOffset: track.startOffset || 0, origDur: track.duration });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [tracks]);

  const startResize = useCallback((e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    const track = tracks[idx];
    setDragging({ trackIdx: idx, mode: "resize", startX: e.clientX, origOffset: track.startOffset || 0, origDur: track.duration });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [tracks]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pxPerSec = (rect.width - 30) / maxDur;
    const dx = e.clientX - dragging.startX;
    const dSec = dx / pxPerSec;

    setTracks(prev => prev.map((t, i) => {
      if (i !== dragging.trackIdx) return t;
      if (dragging.mode === "move") {
        return { ...t, startOffset: Math.max(0, Math.round((dragging.origOffset + dSec) * 2) / 2) };
      } else {
        return { ...t, duration: Math.max(1, Math.round((dragging.origDur + dSec) * 2) / 2) };
      }
    }));
  }, [dragging, maxDur]);

  const onPointerUp = useCallback(() => { setDragging(null); }, []);

  function duplicateTrack(idx: number) {
    const src = tracks[idx];
    if (!src.audioData) return;
    setTracks(prev => [...prev, {
      ...src,
      id: Date.now(),
      label: src.label + "'",
      startOffset: (src.startOffset || 0) + src.duration,
    }]);
    setCtxMenu(null);
  }

  function addTrack() {
    const nextId = Date.now();
    const type = TRACK_TYPES[tracks.length % TRACK_TYPES.length];
    setTracks(prev => [...prev, {
      id: nextId,
      label: TYPE_LABELS[type] + " " + (prev.filter(t => t.type === type).length + 1),
      type,
      prompt: "",
      duration: type === "voice" ? 10 : 30,
      volume: 80,
      color: TYPE_COLORS[type],
      startOffset: 0,
      generating: false,
    }]);
  }

  function removeTrack(idx: number) {
    if (tracks.length <= 1) return;
    setTracks(prev => prev.filter((_, j) => j !== idx));
    setCtxMenu(null);
  }

  function changeTrackType(idx: number, newType: typeof TRACK_TYPES[number]) {
    setTracks(prev => prev.map((t, i) =>
      i === idx ? { ...t, type: newType, label: TYPE_LABELS[newType], color: TYPE_COLORS[newType], prompt: "" } : t
    ));
  }

  function generate(trackIdx: number) {
    const track = tracks[trackIdx];
    if (!track.prompt.trim() && track.type !== "noise") return;

    setTracks(prev => prev.map((t, i) => i === trackIdx ? { ...t, generating: true, audioData: undefined, genStart: Date.now(), genElapsed: 0 } : t));
    setStatus("Generation " + track.label + "...");

    const persona = track.persona || "Pharmacius";
    switch (track.type) {
      case "music":
        cmd("/layer " + track.prompt.trim() + ", " + style + ", " + track.duration + "s");
        break;
      case "voice":
        cmd(`/voice ${persona} "${track.prompt.trim()}"`);
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

  async function autoCompose() {
    setStatus("IA compose " + tracks.length + " pistes...");
    for (let i = 0; i < tracks.length; i++) {
      try {
        const resp = await fetch("/api/v2/ai/suggest-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: tracks[i].type, style, existing: "", context: "" }),
        });
        const data = await resp.json();
        if (data.prompt) {
          setTracks(prev => prev.map((t, j) => j === i ? { ...t, prompt: data.prompt } : t));
        }
      } catch {}
    }
    setStatus("Prompts generes — clique \u25b6 sur chaque piste");
  }

  async function generateAll() {
    if (parallelMode) {
      // Launch all tracks simultaneously — GPU handles music, CPU handles noise/fx
      const eligible = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.prompt.trim() || t.type === "noise");
      // GPU tasks (music) go first, CPU tasks (noise/fx/voice) can run alongside
      const gpuTasks = eligible.filter(({ t }) => t.type === "music");
      const cpuTasks = eligible.filter(({ t }) => t.type !== "music");

      // Launch CPU tasks immediately (they use ffmpeg, not GPU)
      for (const { i } of cpuTasks) generate(i);
      // Stagger GPU tasks by 500ms to avoid VRAM spike
      for (const { i } of gpuTasks) {
        generate(i);
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      // Sequential: one at a time
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].prompt.trim() || tracks[i].type === "noise") {
          generate(i);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
  }

  const hasAudio = tracks.some(t => t.audioData);
  const generatingCount = tracks.filter(t => t.generating).length;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");

  async function saveToServer() {
    const nick = sessionStorage.getItem("kxkm-nick") || "composer";
    const audioTracks = tracks.filter(t => t.audioData);
    if (audioTracks.length === 0) return;
    setSaveStatus("saving");
    try {
      const resp = await fetch("/api/v2/media/compositions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: compName,
          nick,
          tracks: audioTracks.map(t => ({
            type: t.type === "fx" ? "sfx" : t.type,
            prompt: t.prompt,
            style,
            duration: t.duration,
            volume: t.volume,
            startOffset: t.startOffset || 0,
          })),
        }),
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      setSaveStatus("ok");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("err");
      setTimeout(() => setSaveStatus("idle"), 4000);
    }
  }

  async function loadServerComps() {
    setServerLoading(true);
    setServerError("");
    try {
      const resp = await fetch("/api/v2/media/compositions");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const json = await resp.json();
      const list: ServerComposition[] = (json.data || []).sort(
        (a: ServerComposition, b: ServerComposition) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setServerComps(list);
    } catch (err) {
      setServerError("Erreur chargement: " + String(err));
      setServerComps([]);
    } finally {
      setServerLoading(false);
    }
  }

  // Playlist mode: play all tracks sequentially
  const [playing, setPlaying] = useState(false);
  const playlistRef = useRef<HTMLAudioElement | null>(null);

  const playPlaylist = useCallback(() => {
    const audioTracks = tracks.filter(t => t.audioData && t.audioMime);
    if (audioTracks.length === 0) return;
    setPlaying(true);
    let idx = 0;
    const playNext = () => {
      if (idx >= audioTracks.length) { setPlaying(false); return; }
      const t = audioTracks[idx];
      const audio = new Audio(`data:${t.audioMime};base64,${t.audioData}`);
      playlistRef.current = audio;
      audio.volume = (t.volume || 100) / 100;
      audio.onended = () => { idx++; playNext(); };
      audio.onerror = () => { idx++; playNext(); };
      audio.play().catch(() => { idx++; playNext(); });
    };
    playNext();
  }, [tracks]);

  const stopPlaylist = useCallback(() => {
    if (playlistRef.current) {
      playlistRef.current.pause();
      playlistRef.current = null;
    }
    setPlaying(false);
  }, []);

  return (
    <div className="cmp">
      {/* HEADER */}
      <div className="cmp-header">
        <VideotexPageHeader title="COMPOSE" subtitle={tracks.length + " pistes"} color="pink" />
        <div className="cmp-name-row">
          <input className="cmp-name" value={compName} onChange={e => setCompName(e.target.value)} placeholder="Nom..." />
          <select className="cmp-style" value={style} onChange={e => setStyle(e.target.value)}>
            {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="cmp-parallel-label" title="Lance noise/voice/fx en parallele (CPU) pendant music (GPU)">
            <input type="checkbox" checked={parallelMode} onChange={e => setParallelMode(e.target.checked)} />
            <span className="cmp-parallel-text">{"\u26A1"} Par.</span>
          </label>
          <button className="cmp-auto-btn" onClick={autoCompose} disabled={generatingCount > 0}>
            {"\u{1F916}"} Auto
          </button>
          <button className="cmp-genall-btn" onClick={generateAll} disabled={generatingCount > 0}>
            {"\u25B6\u25B6"} Tout
          </button>
          <button className="cmp-play-btn" onClick={playing ? stopPlaylist : playPlaylist} disabled={!hasAudio} title={playing ? "Stop" : "Enchainer toutes les pistes"}>
            {playing ? "\u23F9" : "\u25B6"} {playing ? "Stop" : "Play"}
          </button>
          <button className="cmp-add-track-btn" onClick={addTrack} title="Ajouter une piste">+</button>
          <button
            className="cmp-server-btn"
            onClick={loadServerComps}
            disabled={serverLoading}
            title="Charger les compositions sauvegardees sur le serveur"
          >
            {serverLoading ? "..." : "\u2601 Serveur"}
          </button>
        </div>
      </div>

      {/* TRACKS */}
      <div className="cmp-tracks">
        {tracks.map((track, i) => (
          <div key={track.id} className={"cmp-track" + (track.generating ? " cmp-track-gen" : "")}>
            {/* Track header */}
            <div className="cmp-track-head" style={{ borderLeftColor: track.color }}>
              <select
                className="cmp-type-sel"
                value={track.type}
                onChange={e => changeTrackType(i, e.target.value as typeof TRACK_TYPES[number])}
                style={{ color: track.color }}
              >
                {TRACK_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>

              {track.type === "voice" && (
                <select
                  className="cmp-persona-sel"
                  value={track.persona || "Pharmacius"}
                  onChange={e => setTracks(prev => prev.map((t, j) => j === i ? { ...t, persona: e.target.value } : t))}
                >
                  {PERSONAS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )}

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
              <button
                className="cmp-ai-btn"
                title="IA suggere un prompt"
                onClick={async () => {
                  setStatus(`IA reflechit pour ${track.label}...`);
                  try {
                    const resp = await fetch("/api/v2/ai/suggest-prompt", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ type: track.type, style, existing: track.prompt, context: tracks.map(t => t.prompt).filter(Boolean).join(", ") }),
                    });
                    const data = await resp.json();
                    if (data.prompt) {
                      setTracks(prev => prev.map((t, j) => j === i ? { ...t, prompt: data.prompt } : t));
                    }
                    setStatus("");
                  } catch { setStatus("IA indisponible"); }
                }}
              >{"\u2728"}</button>
              <button className="cmp-del-btn" title="Supprimer" onClick={() => removeTrack(i)}>{"\u2715"}</button>
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
                {track.generating ? `${track.genElapsed || 0}s` : "\u25B6"}
              </button>
              {track.audioData && track.audioMime && (
                <TrackWaveform audioData={track.audioData} audioMime={track.audioMime} color={track.color} />
              )}
            </div>

            {/* Per-track progress bar */}
            {track.generating && (
              <div className="cmp-track-progress">
                <div className="cmp-track-progress-bar" style={{ backgroundColor: track.color }}>
                  <div className="cmp-track-progress-fill" style={{ backgroundColor: track.color }} />
                </div>
                <span className="cmp-track-progress-label">{track.genElapsed || 0}s</span>
              </div>
            )}

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

      {/* TIMELINE */}
      <div className="cmp-timeline" ref={timelineRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {/* Ruler */}
        <div className="cmp-ruler">
          {Array.from({ length: Math.ceil(maxDur / 5) + 1 }, (_, i) => (
            <span key={i} className="cmp-tick" style={{ left: `${(i * 5 / maxDur) * 100}%` }}>{i * 5}s</span>
          ))}
        </div>
        {/* Track lanes */}
        {tracks.map((track, i) => (
          <div key={track.id} className="cmp-lane">
            <span className="cmp-lane-label" style={{ color: track.color }}>{track.label[0]}{i + 1}</span>
            <div className="cmp-lane-area">
              {track.audioData && (
                <div
                  className={`cmp-tl-block ${dragging?.trackIdx === i ? "cmp-tl-dragging" : ""}`}
                  style={{
                    left: `${((track.startOffset || 0) / maxDur) * 100}%`,
                    width: `${Math.max((track.duration / maxDur) * 100, 5)}%`,
                    backgroundColor: track.color,
                    opacity: track.volume / 100,
                  }}
                  title={`${track.prompt || track.label} (${track.duration}s)`}
                  onPointerDown={e => startDrag(e, i)}
                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, trackIdx: i }); }}
                >
                  {track.audioData && track.audioMime && (
                    <TimelineWaveform audioData={track.audioData} audioMime={track.audioMime} color={track.color} />
                  )}
                  <span className="cmp-tl-text">{track.prompt?.slice(0, 20) || track.label}</span>
                  <span className="cmp-tl-dur">{track.duration}s</span>
                  {/* Resize handle */}
                  <div className="cmp-tl-resize" onPointerDown={e => { e.stopPropagation(); startResize(e, i); }} />
                </div>
              )}
              {/* Show generating pulse on lane */}
              {track.generating && !track.audioData && (
                <div
                  className="cmp-tl-generating"
                  style={{
                    left: `${((track.startOffset || 0) / maxDur) * 100}%`,
                    width: `${Math.max((track.duration / maxDur) * 100, 5)}%`,
                    borderColor: track.color,
                  }}
                >
                  <span className="cmp-tl-gen-text">{track.genElapsed || 0}s...</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div className="cmp-ctx" style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { duplicateTrack(ctxMenu.trackIdx); setCtxMenu(null); }}>{"\u{1F4CB}"} Dupliquer</button>
          <button onClick={() => { cmd(`/fx ${ctxMenu.trackIdx+1} reverse`); setCtxMenu(null); }}>{"\u23EA"} Reverse</button>
          <button onClick={() => { cmd(`/fx ${ctxMenu.trackIdx+1} reverb`); setCtxMenu(null); }}>{"\u{1F30A}"} Reverb</button>
          <button onClick={() => { cmd(`/fx ${ctxMenu.trackIdx+1} echo`); setCtxMenu(null); }}>{"\u{1F501}"} Echo</button>
          <button onClick={() => { cmd(`/fx ${ctxMenu.trackIdx+1} distortion`); setCtxMenu(null); }}>{"\u{1F4A5}"} Distortion</button>
          <button onClick={() => { cmd(`/fx ${ctxMenu.trackIdx+1} pitch 3`); setCtxMenu(null); }}>{"\u{1F53C}"} Pitch+</button>
          <button onClick={() => { cmd(`/fx ${ctxMenu.trackIdx+1} pitch -3`); setCtxMenu(null); }}>{"\u{1F53D}"} Pitch-</button>
          <button onClick={() => { cmd(`/stutter ${ctxMenu.trackIdx+1} 8`); setCtxMenu(null); }}>{"\u26A1"} Stutter</button>
          <button onClick={() => { cmd(`/glitch ${ctxMenu.trackIdx+1}`); setCtxMenu(null); }}>{"\u{1F300}"} Glitch</button>
          <button onClick={() => { cmd(`/stretch ${ctxMenu.trackIdx+1} 1.5`); setCtxMenu(null); }}>{"\u23E9"} Stretch</button>
          <hr className="cmp-ctx-sep" />
          <button onClick={() => removeTrack(ctxMenu.trackIdx)} style={{color:"#e53935"}}>{"\u{1F5D1}"} Supprimer</button>
        </div>
      )}

      {/* MIX CONTROLS */}
      {hasAudio && (
        <div className="cmp-mix">
          <button className="cmp-mix-btn" onClick={mixAll} disabled={mixing}>
            {mixing ? "Mixage..." : "MIX " + tracks.filter(t => t.audioData).length + " pistes"}
          </button>
          <button className="cmp-mix-btn cmp-mix-master" onClick={() => cmd("/master")} disabled={mixing}>
            MASTER
          </button>
          <button
            className={"cmp-mix-btn cmp-mix-save" + (saveStatus === "ok" ? " cmp-mix-save-ok" : saveStatus === "err" ? " cmp-mix-save-err" : "")}
            onClick={saveToServer}
            disabled={saveStatus === "saving"}
            title={"Sauver " + tracks.filter(t => t.audioData).length + " piste(s) sur le serveur"}
          >
            {saveStatus === "saving" ? "..." : saveStatus === "ok" ? "\u2713 Sauve" : saveStatus === "err" ? "\u2717 Erreur" : "\uD83D\uDCBE Sauver"}
          </button>
        </div>
      )}

      {/* STATUS */}
      {(status || generatingCount > 0) && (
        <div className="cmp-status">
          {generatingCount > 0 && <span className="cmp-gen-count">{generatingCount} generation{generatingCount > 1 ? "s" : ""} en cours</span>}
          {status && <span>{status}</span>}
        </div>
      )}

      {/* SERVER COMPOSITIONS PANEL */}
      {serverComps !== null && (
        <div className="cmp-server-panel">
          <div className="cmp-server-panel-header">
            <span className="cmp-server-panel-title">\u2601 Compositions serveur ({serverComps.length})</span>
            <button className="cmp-server-close" onClick={() => setServerComps(null)}>\u2715</button>
          </div>
          {serverError && <div className="cmp-server-error">{serverError}</div>}
          {serverComps.length === 0 && !serverError && (
            <div className="cmp-server-empty">Aucune composition sauvegardee.</div>
          )}
          {serverComps.map(comp => (
            <div key={comp.id} className="cmp-server-item">
              <div className="cmp-server-item-name">{comp.name}</div>
              <div className="cmp-server-item-meta">
                <span className="cmp-server-item-nick">{comp.nick}</span>
                <span className="cmp-server-item-date">{new Date(comp.updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
                <span className="cmp-server-item-tracks">{comp.tracks?.length ?? 0} pistes</span>
              </div>
              {comp.tracks && comp.tracks.length > 0 && (
                <div className="cmp-server-item-tracklist">
                  {comp.tracks.slice(0, 4).map(t => (
                    <span key={t.id} className="cmp-server-track-chip" title={t.prompt || t.type}>
                      {t.type} {t.duration}s
                    </span>
                  ))}
                  {comp.tracks.length > 4 && <span className="cmp-server-track-chip cmp-server-track-more">+{comp.tracks.length - 4}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
