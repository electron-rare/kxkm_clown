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

const TOOLS: { key: DAWState["tool"]; label: string; shortcut: string }[] = [
  { key: "select", label: "\u2190", shortcut: "V" },
  { key: "move", label: "\u2725", shortcut: "M" },
  { key: "trim", label: "\u2016", shortcut: "T" },
  { key: "split", label: "\u2215", shortcut: "S" },
];

export default function TransportBar({ state, dispatch, onCmd, onPlay, onPause, onStop, onSeek, onNew, onSave }: Props) {
  const tapTimesRef = useRef<number[]>([]);

  const handleTapTempo = useCallback(() => {
    const now = Date.now();
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) tapTimesRef.current = [];
    tapTimesRef.current.push(now);
    if (tapTimesRef.current.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapTimesRef.current.length; i++) intervals.push(tapTimesRef.current[i] - tapTimesRef.current[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avg);
      if (bpm >= 20 && bpm <= 300) dispatch({ type: "SET_BPM", bpm });
    }
    if (tapTimesRef.current.length > 8) tapTimesRef.current = tapTimesRef.current.slice(-8);
  }, [dispatch]);

  // LCD time
  const pos = state.position;
  const totalDur = state.tracks.reduce((s, t) => Math.max(s, t.startOffset + t.duration), 0);

  let lcdMain: string;
  let lcdSub: string;
  if (state.timeDisplay === "bars") {
    const beatDur = 60 / state.bpm;
    const barDur = beatDur * state.signature[0];
    const bar = Math.floor(pos / barDur) + 1;
    const beat = Math.floor((pos % barDur) / beatDur) + 1;
    const tick = Math.floor(((pos % beatDur) / beatDur) * 960);
    lcdMain = String(bar).padStart(3, " ") + "." + String(beat) + "." + String(tick).padStart(3, "0");
    const tBar = Math.floor(totalDur / barDur) + 1;
    lcdSub = String(tBar) + " bars";
  } else {
    const min = Math.floor(pos / 60);
    const sec = Math.floor(pos % 60);
    const ms = Math.floor((pos % 1) * 1000);
    lcdMain = String(min).padStart(2, "0") + ":" + String(sec).padStart(2, "0") + "." + String(ms).padStart(3, "0");
    const tMin = Math.floor(totalDur / 60);
    const tSec = Math.floor(totalDur % 60);
    lcdSub = String(tMin).padStart(2, "0") + ":" + String(tSec).padStart(2, "0");
  }

  const handleBpmWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    dispatch({ type: "SET_BPM", bpm: state.bpm + delta });
  }, [state.bpm, dispatch]);

  return (
    <div className="daw-transport" role="toolbar" aria-label="Transport">
      {/* File ops */}
      <div className="daw-transport-file">
        <button className="daw-tbtn daw-tbtn-file" onClick={onNew} title="New composition">NEW</button>
        <button className="daw-tbtn daw-tbtn-file" onClick={onSave} title="Save">SAVE</button>
        <button className="daw-tbtn daw-tbtn-file" onClick={() => onCmd("/comp load")} title="Load">LOAD</button>
      </div>

      <div className="daw-transport-sep" />

      {/* Transport controls */}
      <div className="daw-transport-controls">
        <button className="daw-tbtn daw-tbtn-lg" onClick={() => { onStop?.(); onSeek?.(0); }} title="Rewind">
          <span className="daw-ico">{"\u23EE"}</span>
        </button>
        <button className="daw-tbtn daw-tbtn-lg" onClick={onStop} title="Stop (Enter)">
          <span className="daw-ico">{"\u23F9"}</span>
        </button>
        <button className={"daw-tbtn daw-tbtn-lg daw-tbtn-play" + (state.playing ? " active" : "")}
          onClick={() => state.playing ? onPause?.() : onPlay?.()} title="Play/Pause (Space)">
          <span className="daw-ico">{state.playing ? "\u23F8" : "\u25B6"}</span>
        </button>
        <button className={"daw-tbtn daw-tbtn-lg daw-tbtn-rec" + (state.recording ? " active" : "")}
          onClick={() => dispatch({ type: "SET_RECORDING", recording: !state.recording })} title="Record (R)">
          <span className="daw-ico">{"\u23FA"}</span>
        </button>
      </div>

      <div className="daw-transport-sep" />

      {/* LCD display */}
      <div className="daw-lcd"
        onClick={() => dispatch({ type: "SET_TIME_DISPLAY", mode: state.timeDisplay === "time" ? "bars" : "time" })}
        title="Click to toggle time/bars">
        <span className="daw-lcd-main">{lcdMain}</span>
        <span className="daw-lcd-sub">{lcdSub}</span>
      </div>

      <div className="daw-transport-sep" />

      {/* BPM */}
      <div className="daw-transport-bpm" onWheel={handleBpmWheel}>
        <input type="number" className="daw-bpm-input" min={20} max={300} value={state.bpm}
          onChange={e => dispatch({ type: "SET_BPM", bpm: +e.target.value })} title="BPM (scroll to adjust)" />
        <span className="daw-bpm-label">BPM</span>
        <button className="daw-tbtn daw-tbtn-tap" onClick={handleTapTempo} title="Tap Tempo">TAP</button>
      </div>

      {/* Signature */}
      <div className="daw-transport-sig">
        <span className="daw-sig-display">{state.signature[0]}/{state.signature[1]}</span>
      </div>

      {/* Loop */}
      <button className={"daw-tbtn daw-tbtn-loop" + (state.loopEnabled ? " active" : "")}
        onClick={() => dispatch({ type: "SET_LOOP", enabled: !state.loopEnabled })} title="Loop (L)">
        {"\u21BB"}
      </button>

      <div className="daw-transport-sep" />

      {/* Tools */}
      <div className="daw-transport-tools">
        {TOOLS.map(t => (
          <button key={t.key}
            className={"daw-tbtn daw-tbtn-tool" + (state.tool === t.key ? " active" : "")}
            onClick={() => dispatch({ type: "SET_TOOL", tool: t.key })}
            title={t.key + " (" + t.shortcut + ")"}>
            <span className="daw-tool-ico">{t.label}</span>
            <span className="daw-tool-key">{t.shortcut}</span>
          </button>
        ))}
      </div>

      <div className="daw-transport-sep" />

      {/* Zoom */}
      <div className="daw-transport-zoom">
        <input type="range" className="daw-zoom-slider" min={2} max={60} step={1}
          value={state.zoom}
          onChange={e => dispatch({ type: "SET_ZOOM", zoom: +e.target.value })}
          title={"Zoom: " + state.zoom + "px/s"} />
      </div>

      {/* Composition name */}
      <input className="daw-transport-name" value={state.compName}
        onChange={e => dispatch({ type: "SET_NAME", name: e.target.value })} title="Composition name" />
    </div>
  );
}
