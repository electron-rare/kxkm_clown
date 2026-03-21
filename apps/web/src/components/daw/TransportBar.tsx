import React, { useRef, useCallback } from "react";
import type { DAWState, DAWAction } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onSeek?: (pos: number) => void;
  onNew?: () => void;
  onSave?: () => void;
}

export default function TransportBar({ state, dispatch, onCmd, onPlay, onPause, onStop, onSeek, onNew, onSave }: Props) {
  const totalDur = state.tracks.reduce((s, t) => Math.max(s, t.startOffset + t.duration), 0);
  const posMin = Math.floor(state.position / 60);
  const posSec = Math.floor(state.position % 60);
  const posMs = Math.floor((state.position % 1) * 100);
  const totalMin = Math.floor(totalDur / 60);
  const totalSec = Math.floor(totalDur % 60);

  // Tap tempo
  const tapTimesRef = useRef<number[]>([]);
  const handleTapTempo = useCallback(() => {
    const now = Date.now();
    const taps = tapTimesRef.current;
    // Reset if last tap was >2s ago
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      tapTimesRef.current = [];
    }
    tapTimesRef.current.push(now);
    if (tapTimesRef.current.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapTimesRef.current.length; i++) {
        intervals.push(tapTimesRef.current[i] - tapTimesRef.current[i - 1]);
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avg);
      if (bpm >= 20 && bpm <= 300) {
        dispatch({ type: "SET_BPM", bpm });
      }
    }
    // Keep only last 8 taps
    if (tapTimesRef.current.length > 8) tapTimesRef.current = tapTimesRef.current.slice(-8);
  }, [dispatch]);

  const toolIcons: Record<string, string> = {
    select: "\u{2B11}",   // arrow
    move: "\u{270B}",     // hand
    trim: "\u{2702}",     // scissors
  };

  return (
    <div className="daw-topbar">
      {/* Left: composition name */}
      <div className="daw-transport-left">
        <input className="daw-name" value={state.compName}
          onChange={e => dispatch({ type: "SET_NAME", name: e.target.value })} title="Composition name" />
      </div>

      {/* Center: transport controls + LCD */}
      <div className="daw-transport-center">
        {/* Transport buttons */}
        <div className="daw-transport-btns">
          <button className="daw-btn-transport" onClick={onStop} title="Stop (Enter)">
            <span className="daw-icon-stop">{"\u23F9"}</span>
          </button>
          <button className={"daw-btn-transport" + (state.playing ? " daw-btn-transport-active" : "")}
            onClick={() => state.playing ? onPause?.() : onPlay?.()}
            title="Play/Pause (Space)">
            <span>{state.playing ? "\u23F8" : "\u25B6"}</span>
          </button>
          <button className={"daw-btn-transport daw-btn-record" + (state.recording ? " daw-btn-record-active" : "")}
            onClick={() => dispatch({ type: "SET_RECORDING", recording: !state.recording })}
            title="Record">
            <span>{"\u23FA"}</span>
          </button>
        </div>

        {/* LCD time display */}
        <div className="daw-lcd" title="Position / Total">
          <span className="daw-lcd-time">
            {String(posMin).padStart(2, "0")}:{String(posSec).padStart(2, "0")}.{String(posMs).padStart(2, "0")}
          </span>
          <span className="daw-lcd-sep">/</span>
          <span className="daw-lcd-total">
            {String(totalMin).padStart(2, "0")}:{String(totalSec).padStart(2, "0")}
          </span>
        </div>

        {/* BPM + tap tempo */}
        <div className="daw-bpm-group">
          <input type="number" className="daw-bpm-input" min={20} max={300} value={state.bpm}
            onChange={e => dispatch({ type: "SET_BPM", bpm: +e.target.value })} title="BPM" />
          <button className="daw-btn-tap" onClick={handleTapTempo} title="Tap Tempo">TAP</button>
        </div>

        {/* Loop toggle */}
        <button className={"daw-btn-loop" + (state.loopEnabled ? " active" : "")}
          onClick={() => dispatch({ type: "SET_LOOP", enabled: !state.loopEnabled })}
          title="Loop">
          {"\u{1F501}"}
        </button>
      </div>

      {/* Right: tools, zoom, file ops */}
      <div className="daw-transport-right">
        {/* Tool selector */}
        <div className="daw-tool-btns">
          {(["select", "move", "trim"] as const).map(t => (
            <button key={t} className={"daw-btn-tool" + (state.tool === t ? " active" : "")}
              onClick={() => dispatch({ type: "SET_TOOL", tool: t })}
              title={t.charAt(0).toUpperCase() + t.slice(1)}>
              {toolIcons[t]}
            </button>
          ))}
        </div>

        {/* Zoom slider */}
        <div className="daw-zoom-group">
          <span className="daw-zoom-icon">{"\u{1F50D}"}</span>
          <input type="range" className="daw-zoom-slider" min={2} max={30} step={1}
            value={state.zoom}
            onChange={e => dispatch({ type: "SET_ZOOM", zoom: +e.target.value })}
            title={`Zoom: ${state.zoom}px/s`} />
        </div>

        {/* File operations */}
        <div className="daw-file-btns">
          <button className="daw-btn daw-btn-file" onClick={onNew} title="New">NEW</button>
          <button className="daw-btn daw-btn-file" onClick={onSave} title="Save">SAVE</button>
          <button className="daw-btn daw-btn-file" onClick={() => onCmd("/comp load")} title="Load">LOAD</button>
        </div>
      </div>
    </div>
  );
}
