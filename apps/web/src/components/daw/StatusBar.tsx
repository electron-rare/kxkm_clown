import React, { useEffect, useState } from "react";
import type { DAWState } from "./types";

interface Props {
  state: DAWState;
  users?: string[];
  latency?: number;
}

export default function StatusBar({ state, users = [], latency = 0 }: Props) {
  const totalDur = state.tracks.reduce((s, t) => Math.max(s, t.startOffset + t.duration), 0);
  const [statusVisible, setStatusVisible] = useState(true);

  useEffect(() => {
    if (state.status) {
      setStatusVisible(true);
      const timer = setTimeout(() => setStatusVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [state.status]);

  const durMin = Math.floor(totalDur / 60);
  const durSec = Math.floor(totalDur % 60);
  const latencyColor = latency < 100 ? "#4a4" : latency < 300 ? "#aa6" : "#a44";

  return (
    <div className="daw-status" role="status">
      <div className="daw-status-l">
        <span>{state.compName}</span>
        <span className="daw-status-dim">|</span>
        <span>{state.tracks.length} tracks</span>
        <span className="daw-status-dim">|</span>
        <span>{String(durMin).padStart(2, "0")}:{String(durSec).padStart(2, "0")}</span>
      </div>
      <div className={"daw-status-c" + (statusVisible ? "" : " daw-status-hidden")}>
        {state.status}
        {state.generating && <span className="daw-spinner" />}
      </div>
      <div className="daw-status-r">
        <span>{state.bpm} BPM</span>
        <span className="daw-status-dim">|</span>
        <span>44.1kHz</span>
        {users.length > 0 && (
          <>
            <span className="daw-status-dim">|</span>
            <span title={users.join(", ")}>{users.length} user{users.length > 1 ? "s" : ""}</span>
          </>
        )}
        {latency > 0 && (
          <>
            <span className="daw-status-dim">|</span>
            <span style={{ color: latencyColor }}>{latency}ms</span>
          </>
        )}
      </div>
    </div>
  );
}
