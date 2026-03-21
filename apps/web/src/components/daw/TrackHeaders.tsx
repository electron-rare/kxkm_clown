import React, { useRef, useEffect, useCallback } from "react";
import type { DAWState, DAWAction } from "./types";
import { FX_LIST, typeIcon } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
}

function PanKnob({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  // Pan value: -1 (L) to 1 (R), 0 = center
  // Angle: -135deg to +135deg
  const angle = value * 135;
  const label = value < -0.01 ? "L" + Math.round(Math.abs(value) * 100) : value > 0.01 ? "R" + Math.round(value * 100) : "C";

  const handleClick = () => {
    const vals = [-1, -0.5, 0, 0.5, 1];
    const ni = vals.findIndex(v => Math.abs(v - value) < 0.1);
    onChange(vals[(ni >= 0 ? ni + 1 : 2) % vals.length]);
  };

  return (
    <div className="daw-pan-knob" onClick={e => { e.stopPropagation(); handleClick(); }} title={`Pan: ${label}`}>
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="#2a2a2a" stroke="#555" strokeWidth="1" />
        <line
          x1="10" y1="10"
          x2={10 + 6 * Math.sin(angle * Math.PI / 180)}
          y2={10 - 6 * Math.cos(angle * Math.PI / 180)}
          stroke="#4af" strokeWidth="2" strokeLinecap="round"
        />
        <circle cx="10" cy="10" r="2" fill="#4af" />
      </svg>
      <span className="daw-pan-label">{label}</span>
    </div>
  );
}

export default function TrackHeaders({ state, dispatch, onCmd }: Props) {
  const { tracks, selectedTrack, editingName, fxOpen } = state;
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editInputRef.current) editInputRef.current.focus(); }, [editingName]);

  const updateTrack = (idx: number, patch: Partial<typeof tracks[0]>) =>
    dispatch({ type: "UPDATE_TRACK", index: idx, updates: patch });

  const fxCmd = (trackIdx: number, fx: typeof FX_LIST[0]) => {
    const i = trackIdx + 1;
    if (fx.special) onCmd(fx.special.replace("{i}", String(i)));
    else onCmd("/fx " + i + " " + fx.cmd);
  };

  const toggleExpand = useCallback((idx: number) => {
    const t = tracks[idx];
    updateTrack(idx, { expanded: !t.expanded });
  }, [tracks]);

  return (
    <div className="daw-headers">
      {/* Header ruler area - empty for alignment */}
      <div className="daw-header-ruler">
        <span className="daw-header-ruler-label">TRACKS</span>
      </div>

      {tracks.map((track, i) => {
        const isExpanded = track.expanded !== false; // default expanded
        const trackHeight = isExpanded ? "auto" : undefined;

        return (
          <div key={track.id}
            className={"daw-th" + (selectedTrack === i ? " daw-th-sel" : "") + (track.muted ? " daw-th-muted" : "")}
            style={{ borderLeftColor: track.color }}
            onClick={() => dispatch({ type: "SET_SELECTED", index: i })}
            onDoubleClick={() => toggleExpand(i)}>

            {/* Row 1: Track number + name */}
            <div className="daw-th-row1">
              <span className="daw-th-num">{i + 1}</span>
              <span className="daw-th-type-icon">{typeIcon(track)}</span>
              {editingName === i ? (
                <input ref={editInputRef} className="daw-th-name-edit" defaultValue={track.name}
                  onBlur={e => { updateTrack(i, { name: e.target.value }); dispatch({ type: "SET_EDITING_NAME", index: null }); }}
                  onKeyDown={e => {
                    if (e.key === "Enter") { updateTrack(i, { name: (e.target as HTMLInputElement).value }); dispatch({ type: "SET_EDITING_NAME", index: null }); }
                    if (e.key === "Escape") dispatch({ type: "SET_EDITING_NAME", index: null });
                  }} />
              ) : (
                <span className="daw-th-name" onDoubleClick={e => { e.stopPropagation(); dispatch({ type: "SET_EDITING_NAME", index: i }); }}
                  title="Double-click to rename">{track.name}</span>
              )}
              <button className="daw-btn-sm daw-btn-del" onClick={e => {
                e.stopPropagation(); dispatch({ type: "REMOVE_TRACK", index: i });
              }} title="Delete track">{"\u2715"}</button>
            </div>

            {/* Row 2: M/S/R buttons + Volume fader */}
            {isExpanded && (
              <div className="daw-th-row2">
                <div className="daw-th-btns">
                  <button className={"daw-btn-sm daw-btn-mute" + (track.muted ? " active" : "")} onClick={e => {
                    e.stopPropagation(); const willMute = !track.muted;
                    updateTrack(i, { muted: willMute }); onCmd(`/fx ${i + 1} volume ${willMute ? 0 : track.volume}`);
                  }} title="Mute">M</button>
                  <button className={"daw-btn-sm daw-btn-solo" + (track.solo ? " active" : "")} onClick={e => {
                    e.stopPropagation(); const willSolo = !track.solo;
                    updateTrack(i, { solo: willSolo }); onCmd(willSolo ? `/solo ${i + 1}` : `/unsolo`);
                  }} title="Solo">S</button>
                  <button className={"daw-btn-sm daw-btn-rec-arm" + (track.recordArmed ? " active" : "")} onClick={e => {
                    e.stopPropagation(); updateTrack(i, { recordArmed: !track.recordArmed });
                  }} title="Record Arm">{"\u25CF"}</button>
                </div>

                {/* Volume fader */}
                <div className="daw-fader-wrap">
                  <input type="range" min={0} max={100} value={track.volume}
                    className="daw-fader"
                    style={{ "--val": track.volume + "%" } as React.CSSProperties}
                    title={"Vol: " + track.volume + "%"}
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      const newVol = +e.target.value;
                      updateTrack(i, { volume: newVol });
                      clearTimeout((window as any).__volTimer);
                      (window as any).__volTimer = setTimeout(() => onCmd(`/fx ${i + 1} volume ${newVol}`), 500);
                    }} />
                  <span className="daw-fader-val">{track.volume}</span>
                </div>
              </div>
            )}

            {/* Row 3: Pan + FX */}
            {isExpanded && (
              <div className="daw-th-row3">
                <PanKnob value={track.pan} onChange={v => { updateTrack(i, { pan: v }); onCmd(`/pan ${i + 1} ${v}`); }} />

                {/* FX indicator */}
                <span className="daw-fx-trigger" onClick={e => {
                  e.stopPropagation(); e.nativeEvent.stopImmediatePropagation();
                  dispatch({ type: "SET_FX_OPEN", index: fxOpen === i ? null : i });
                }}>
                  FX{track.fxCount ? ` (${track.fxCount})` : ""}
                </span>
                {fxOpen === i && (
                  <div className="daw-fx-dropdown" onClick={e => e.stopPropagation()}>
                    {FX_LIST.map(fx => (
                      <button key={fx.label} onClick={() => {
                        fxCmd(i, fx);
                        updateTrack(i, { fxCount: (track.fxCount || 0) + 1 });
                        dispatch({ type: "SET_FX_OPEN", index: null });
                      }}>{fx.label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Collapsed mini audio player */}
            {isExpanded && track.audioData && (
              <audio controls src={"data:" + track.audioMime + ";base64," + track.audioData} className="daw-audio-sm" onClick={e => e.stopPropagation()} />
            )}
          </div>
        );
      })}
      {tracks.length === 0 && <div className="daw-th-empty">Pas de pistes<br/><span style={{ fontSize: 9, color: "#666" }}>Utilisez le panneau ci-dessous pour generer</span></div>}
    </div>
  );
}
