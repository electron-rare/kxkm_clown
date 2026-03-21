import React, { useReducer, useRef, useEffect, useCallback, useState } from "react";
import { dawReducer, COLORS, type DAWState } from "./daw/types";
import TransportBar from "./daw/TransportBar";
import TrackHeaders from "./daw/TrackHeaders";
import TimelineGrid from "./daw/TimelineGrid";
import GeneratorPanel from "./daw/GeneratorPanel";
import StatusBar from "./daw/StatusBar";
import { usePlayback } from "./daw/usePlayback";
import { useDAWShortcuts } from "./daw/useDAWShortcuts";

const initialState: DAWState = {
  compId: "", compName: "Ma composition", bpm: 120,
  tracks: [], playing: false, position: 0, zoom: 10,
  selectedTrack: null, status: "", generating: false,
  editingName: null, fxOpen: null, prompt: "", style: "experimental",
  duration: 30, contextMenu: null, dragging: null,
  loopEnabled: false, loopStart: 0, loopEnd: 30,
  tool: "select", panelCollapsed: false, recording: false,
  timeDisplay: "time", signature: [4, 4],
};

export default function ComposePage() {
  const [state, dispatch] = useReducer(dawReducer, initialState);
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [latency, setLatency] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef(0);
  const loadCompRef = useRef<(id: string) => void>(() => {});

  const { play, pause, stop, seek } = usePlayback(state.tracks, dispatch);

  // WebSocket connection
  useEffect(() => {
    const nick = sessionStorage.getItem("kxkm-nick") || "composer";
    const wsUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/ws?nick=" + encodeURIComponent(nick);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        pingRef.current = Date.now();
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 5000);

    ws.onmessage = (event) => {
      try {
        const m = JSON.parse(event.data);
        if (m.type === "pong") { setLatency(Date.now() - pingRef.current); return; }
        if (m.type === "music" && m.audioData) {
          dispatch({ type: "ADD_TRACK", track: {
            id: Date.now() + Math.random(),
            name: (m.text || "Sans titre").slice(0, 30),
            prompt: m.text || "Sans titre", style: state.style, duration: state.duration,
            volume: 100, pan: 0, muted: false, solo: false,
            type: (m.text || "").match(/noise|silence|drone|pink|white|sine|brown/i) ? "noise" as const : "music" as const,
            color: COLORS[state.tracks.length % COLORS.length], startOffset: 0,
            audioData: m.audioData, audioMime: m.audioMime || "audio/wav", fxCount: 0,
          }});
          dispatch({ type: "SET_GENERATING", generating: false });
          dispatch({ type: "SET_STATUS", status: "" });
        }
        if (m.type === "audio" && m.data) {
          dispatch({ type: "ADD_TRACK", track: {
            id: Date.now() + Math.random(),
            name: m.nick ? m.nick + " (voix)" : "Voix",
            prompt: m.nick ? m.nick + " (voix)" : "Voix",
            style: "voice", duration: 10, volume: 100, pan: 0,
            muted: false, solo: false, type: "voice" as const,
            color: COLORS[state.tracks.length % COLORS.length], startOffset: 0,
            audioData: m.data, audioMime: m.mimeType || "audio/wav", fxCount: 0,
          }});
          dispatch({ type: "SET_GENERATING", generating: false });
          dispatch({ type: "SET_STATUS", status: "" });
        }
        if (m.type === "system" && m.text?.startsWith("__comp_update__")) {
          try {
            const update = JSON.parse(m.text.slice(15));
            dispatch({ type: "SET_STATUS", status: "[collab] " + update.action + " (" + (update.trackCount || "") + "p)" });
            if (update.compId && (update.action === "track_added" || update.action === "track_removed" || update.action === "fx_applied")) {
              loadCompRef.current(update.compId);
            }
          } catch {}
          return;
        }
        if (m.type === "system" && m.text?.startsWith("__comp_loaded__")) {
          try { const parsed = JSON.parse(m.text.slice(15)); if (parsed.compId) loadCompRef.current(parsed.compId); } catch {}
          return;
        }
        if (m.type === "system" && m.text?.startsWith("__playback__play__")) {
          play(); dispatch({ type: "SET_STATUS", status: "[collab] " + m.text.split("__")[4] + " a lance la lecture" }); return;
        }
        if (m.type === "system" && m.text?.startsWith("__playback__stop__")) {
          stop(); dispatch({ type: "SET_STATUS", status: "[collab] " + m.text.split("__")[4] + " a arrete" }); return;
        }
        if (m.type === "system" && m.text?.startsWith("__userlist__")) {
          try { const users = JSON.parse(m.text.slice(12)); setConnectedUsers(users); } catch {}
          return;
        }
        if (m.type === "system" && m.text) {
          const t = m.text;
          if (t.includes("ajoute") || t.includes("Generation") || t.includes("Mixage") || t.includes("Master")) {
            dispatch({ type: "SET_STATUS", status: t.slice(0, 80) });
          }
          if (t.includes("Erreur") || t.includes("echouee")) {
            dispatch({ type: "SET_GENERATING", generating: false });
            dispatch({ type: "SET_STATUS", status: "! " + t.slice(0, 60) });
          }
          if (t.includes("Mix termine") || t.includes("Master termine")) {
            dispatch({ type: "SET_STATUS", status: t.slice(0, 60) });
          }
        }
      } catch { /* ignore */ }
    };

    return () => { clearInterval(pingInterval); ws.close(); };
  }, []);

  // Close menus on click
  useEffect(() => {
    const close = () => {
      dispatch({ type: "SET_CONTEXT_MENU", menu: null });
      dispatch({ type: "SET_FX_OPEN", index: null });
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const cmd = useCallback((c: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", text: c }));
    }
  }, []);

  // Load composition from server
  const loadComposition = useCallback(async (compId: string) => {
    try {
      const resp = await fetch("/api/v2/media/compositions/" + compId);
      const data = await resp.json();
      if (!data.ok || !data.data) return;
      const comp = data.data;
      dispatch({ type: "SET_COMP_ID", id: comp.id });
      dispatch({ type: "SET_NAME", name: comp.name });
      if (comp.bpm) dispatch({ type: "SET_BPM", bpm: comp.bpm });

      const loadedTracks: typeof initialState.tracks = [];
      for (const t of comp.tracks || []) {
        const track: typeof initialState.tracks[0] = {
          id: t.id ? Number(t.id.replace(/\D/g, "").slice(-10)) || Date.now() + Math.random() : Date.now() + Math.random(),
          name: (t.prompt || "Track").slice(0, 30),
          prompt: t.prompt || "", style: "", duration: t.duration || 10,
          startOffset: (t.startMs || 0) / 1000, volume: t.volume ?? 100, pan: 0,
          muted: false, solo: false,
          type: t.type === "voice" ? "voice" as const : t.type === "sfx" || t.type === "noise" ? "noise" as const : "music" as const,
          color: COLORS[loadedTracks.length % COLORS.length], fxCount: 0,
        };
        if (t.id && comp.id) {
          try {
            const audioResp = await fetch("/api/v2/media/compositions/" + comp.id + "/tracks/" + t.id);
            if (audioResp.ok) {
              const buf = await audioResp.arrayBuffer();
              const bytes = new Uint8Array(buf);
              let binary = "";
              for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
              track.audioData = btoa(binary);
              track.audioMime = "audio/wav";
            }
          } catch { /* track file may not exist */ }
        }
        loadedTracks.push(track);
      }
      dispatch({ type: "SET_TRACKS", tracks: loadedTracks });
      dispatch({ type: "SET_STATUS", status: "Loaded: " + comp.name + " (" + loadedTracks.length + " tracks)" });
    } catch { /* network error */ }
  }, []);
  loadCompRef.current = loadComposition;

  const handleNew = useCallback(() => {
    cmd("/comp new " + state.compName);
    dispatch({ type: "SET_TRACKS", tracks: [] });
    dispatch({ type: "SET_STATUS", status: "Nouveau" });
  }, [cmd, state.compName]);

  const handleSave = useCallback(() => { cmd("/comp save"); }, [cmd]);

  useDAWShortcuts(state, dispatch, { play, pause, stop, cmd });

  return (
    <div className="daw">
      <TransportBar state={state} dispatch={dispatch} onCmd={cmd}
        onPlay={play} onPause={pause} onStop={stop} onSeek={seek}
        onNew={handleNew} onSave={handleSave} />
      <TrackHeaders state={state} dispatch={dispatch} onCmd={cmd} />
      <TimelineGrid state={state} dispatch={dispatch} onCmd={cmd} />
      <GeneratorPanel state={state} dispatch={dispatch} onCmd={cmd} />
      <StatusBar state={state} users={connectedUsers} latency={latency} />
    </div>
  );
}
