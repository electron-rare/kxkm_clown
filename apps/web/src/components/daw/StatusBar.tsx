import React from "react";
import type { DAWState } from "./types";

interface Props {
  state: DAWState;
  users?: string[];
}

export default function StatusBar({ state, users = [] }: Props) {
  const totalDur = state.tracks.reduce((s, t) => Math.max(s, t.duration), 0);

  return (
    <div className="daw-status">
      {state.status || (state.compName + " | " + state.tracks.length + " pistes | " + Math.floor(totalDur) + "s | " + state.bpm + " BPM")}
      {state.generating && <span className="daw-spinner" />}
      {users.length > 0 && (
        <span className="daw-users" title={users.join(", ")}>
          {" | "}{users.length} utilisateur{users.length > 1 ? "s" : ""}: {users.slice(0, 5).join(", ")}{users.length > 5 ? "..." : ""}
        </span>
      )}
    </div>
  );
}
