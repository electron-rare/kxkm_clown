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
  tracks: [], playing: false, position: 0, zoom: 8,
  selectedTrack: null, status: "", generating: false,
  editingName: null, fxOpen: null, prompt: "", style: "experimental",
  duration: 30, contextMenu: null, dragging: null,
};

export default function ComposePage() {
  const [state, dispatch] = useReducer(dawReducer, initialState);
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const { play, pause, stop, seek } = usePlayback(state.tracks, dispatch);

  // WebSocket connection
  useEffect(() => {
    const nick = sessionStorage.getItem("kxkm-nick") || "composer";
    const wsUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/ws?nick=" + encodeURIComponent(nick);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const m = JSON.parse(event.data);
        if (m.type === "music" && m.audioData) {
          dispatch({ type: "ADD_TRACK", track: {
            id: Date.now() + Math.random(),
            name: (m.text || "Sans titre").slice(0, 30),
            prompt: m.text || "Sans titre", style: state.style, duration: state.duration,
            volume: 100, pan: 0, muted: false, solo: false,
            type: (m.text || "").match(/noise|silence|drone|pink|white|sine|brown/i) ? "noise" as const : "music" as const,
            color: COLORS[state.tracks.length % COLORS.length], startOffset: 0,
            audioData: m.audioData, audioMime: m.audioMime || "audio/wav",
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
            audioData: m.data, audioMime: m.mimeType || "audio/wav",
          }});
          dispatch({ type: "SET_GENERATING", generating: false });
          dispatch({ type: "SET_STATUS", status: "" });
        }
        // Multi-user collaboration: comp_update sync
        if (m.type === "system" && m.text?.startsWith("__comp_update__")) {
          try {
            const update = JSON.parse(m.text.slice(15));
            dispatch({ type: "SET_STATUS", status: `[collab] ${update.action} (${update.trackCount || ""}p)` });
            if (update.action === "track_added" || update.action === "track_removed" || update.action === "fx_applied") {
              cmd("/tracks");
            }
          } catch {}
          return;
        }
        // Shared playback sync
        if (m.type === "system" && m.text?.startsWith("__playback__play__")) {
          play();
          dispatch({ type: "SET_STATUS", status: `[collab] ${m.text.split("__")[4]} a lance la lecture` });
          return;
        }
        if (m.type === "system" && m.text?.startsWith("__playback__stop__")) {
          stop();
          dispatch({ type: "SET_STATUS", status: `[collab] ${m.text.split("__")[4]} a arrete` });
          return;
        }
        // User presence tracking
        if (m.type === "system" && m.text?.startsWith("__userlist__")) {
          try {
            const users = JSON.parse(m.text.slice(12));
            setConnectedUsers(users);
          } catch {}
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

    return () => { ws.close(); };
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

  const handleNew = useCallback(() => {
    cmd("/comp new " + state.compName);
    dispatch({ type: "SET_TRACKS", tracks: [] });
    dispatch({ type: "SET_STATUS", status: "Nouveau" });
  }, [cmd, state.compName]);

  const handleSave = useCallback(() => {
    cmd("/comp save");
  }, [cmd]);

  useDAWShortcuts(state, dispatch, { play, pause, stop, cmd });

  return (
    <div className="daw">
      <TransportBar state={state} dispatch={dispatch} onCmd={cmd}
        onPlay={play} onPause={pause} onStop={stop} onSeek={seek}
        onNew={handleNew} onSave={handleSave} />
      <div className="daw-body">
        <TrackHeaders state={state} dispatch={dispatch} onCmd={cmd} />
        <TimelineGrid state={state} dispatch={dispatch} onCmd={cmd} />
      </div>
      <GeneratorPanel state={state} dispatch={dispatch} onCmd={cmd} />
      <StatusBar state={state} users={connectedUsers} />
    </div>
  );
}
