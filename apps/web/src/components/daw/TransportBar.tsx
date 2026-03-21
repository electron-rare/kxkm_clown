import React from "react";
import type { DAWState, DAWAction } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
}

export default function TransportBar({ state, dispatch, onCmd }: Props) {
  const totalDur = state.tracks.reduce((s, t) => Math.max(s, t.duration), 0);

  return (
    <div className="daw-topbar">
      <input className="daw-name" value={state.compName}
        onChange={e => dispatch({ type: "SET_NAME", name: e.target.value })} title="Composition name" />
      <label className="daw-bpm-label">
        BPM <input type="number" className="daw-bpm-input" min={20} max={300} value={state.bpm}
          onChange={e => dispatch({ type: "SET_BPM", bpm: +e.target.value })} />
      </label>
      <span className="daw-time">
        {String(Math.floor(totalDur / 60)).padStart(2, "0")}:{String(Math.floor(totalDur % 60)).padStart(2, "0")}
      </span>
      <span className="daw-track-count">{state.tracks.length} pistes</span>
      <div className="daw-transport">
        <button className="daw-btn" onClick={() => {
          onCmd("/comp new " + state.compName);
          dispatch({ type: "SET_TRACKS", tracks: [] });
          dispatch({ type: "SET_STATUS", status: "Nouveau" });
        }}>NEW</button>
        <button className="daw-btn" onClick={() => onCmd("/comp save")}>SAVE</button>
        <button className="daw-btn" onClick={() => onCmd("/comp load")}>LOAD</button>
      </div>
    </div>
  );
}
