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

  // Fade out status after 5s
  useEffect(() => {
    if (state.status) {
      setStatusVisible(true);
      const timer = setTimeout(() => setStatusVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [state.status]);

  const latencyColor = latency < 100 ? "#33ff33" : latency < 300 ? "#ffaa00" : "#ff3333";

  return (
    <div className="daw-status">
      {/* Left: composition info */}
      <div className="daw-status-left">
        <span className="daw-status-name">{state.compName}</span>
        <span className="daw-status-sep">{"\u2502"}</span>
        <span>{state.tracks.length} pistes</span>
        <span className="daw-status-sep">{"\u2502"}</span>
        <span>{Math.floor(totalDur)}s</span>
        <span className="daw-status-sep">{"\u2502"}</span>
        <span>{state.bpm} BPM</span>
      </div>

      {/* Center: status message with fade */}
      <div className={"daw-status-center" + (statusVisible ? "" : " daw-status-fade")}>
        {state.status}
        {state.generating && <span className="daw-spinner" />}
      </div>

      {/* Right: users + latency */}
      <div className="daw-status-right">
        {users.length > 0 && (
          <span className="daw-status-users" title={users.join(", ")}>
            {"\u{1F464}"} {users.length}
          </span>
        )}
        {latency > 0 && (
          <span className="daw-status-latency" style={{ color: latencyColor }}>
            {"\u25CF"} {latency}ms
          </span>
        )}
      </div>
    </div>
  );
}
