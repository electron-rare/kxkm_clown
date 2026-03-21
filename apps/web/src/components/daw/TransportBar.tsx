import React from "react";
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

  return (
    <div className="daw-topbar">
      <input className="daw-name" value={state.compName}
        onChange={e => dispatch({ type: "SET_NAME", name: e.target.value })} title="Composition name" />
      <label className="daw-bpm-label">
        BPM <input type="number" className="daw-bpm-input" min={20} max={300} value={state.bpm}
          onChange={e => dispatch({ type: "SET_BPM", bpm: +e.target.value })} />
      </label>
      <div className="daw-transport">
        <button className="daw-btn" onClick={onStop} title="Stop (Enter)">STOP</button>
        <button className={"daw-btn" + (state.playing ? " daw-btn-active" : "")}
          onClick={() => state.playing ? onPause?.() : onPlay?.()}
          title="Play/Pause (Space)">
          {state.playing ? "PAUSE" : "PLAY"}
        </button>
        <input type="range" className="daw-seek" min={0} max={Math.max(totalDur, 1)} step={0.1}
          value={state.position}
          onChange={e => {
            const pos = +e.target.value;
            dispatch({ type: "SET_POSITION", position: pos });
            onSeek?.(pos);
          }}
          title="Seek" />
        <span className="daw-time">
          {String(posMin).padStart(2, "0")}:{String(posSec).padStart(2, "0")}
          {" / "}
          {String(Math.floor(totalDur / 60)).padStart(2, "0")}:{String(Math.floor(totalDur % 60)).padStart(2, "0")}
        </span>
      </div>
      <span className="daw-track-count">{state.tracks.length} pistes</span>
      <div className="daw-transport">
        <button className="daw-btn" onClick={onNew}>NEW</button>
        <button className="daw-btn" onClick={onSave}>SAVE</button>
        <button className="daw-btn" onClick={() => onCmd("/comp load")}>LOAD</button>
      </div>
    </div>
  );
}
