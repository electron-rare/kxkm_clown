import React from "react";
import type { DAWState } from "./types";

interface Props {
  state: DAWState;
}

export default function StatusBar({ state }: Props) {
  const totalDur = state.tracks.reduce((s, t) => Math.max(s, t.duration), 0);

  return (
    <div className="daw-status">
      {state.status || (state.compName + " | " + state.tracks.length + " pistes | " + Math.floor(totalDur) + "s | " + state.bpm + " BPM")}
      {state.generating && <span className="daw-spinner" />}
    </div>
  );
}
