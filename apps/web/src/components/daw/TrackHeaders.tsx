import React, { useRef, useEffect } from "react";
import type { DAWState, DAWAction } from "./types";
import { FX_LIST, typeIcon, volToDb } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
}

function PanKnob({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const angle = value * 135;
  const label = value < -0.01 ? "L" + Math.round(Math.abs(value) * 100) : value > 0.01 ? "R" + Math.round(value * 100) : "C";

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    onChange(Math.max(-1, Math.min(1, value + delta)));
  };

  const handleDblClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(0);
  };

  return (
    <div className="daw-th-pan" onWheel={handleWheel} onDoubleClick={handleDblClick} title={"Pan: " + label}>
      <svg width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="9" fill="none" stroke="#444" strokeWidth="1.5" />
        <circle cx="11" cy="11" r="7" fill="#2a2a2a" />
        <line x1="11" y1="11"
          x2={11 + 6 * Math.sin(angle * Math.PI / 180)}
          y2={11 - 6 * Math.cos(angle * Math.PI / 180)}
          stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="daw-th-pan-lr">
        <span style={{ opacity: value < -0.01 ? 1 : 0.3 }}>L</span>
        <span style={{ opacity: value > 0.01 ? 1 : 0.3 }}>R</span>
      </span>
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

  return (
    <div className="daw-tracks" role="list" aria-label="Tracks">
      <div className="daw-tracks-ruler">
        <span className="daw-tracks-label">TRACKS</span>
      </div>

      {tracks.map((track, i) => (
        <div key={track.id}
          className={"daw-th" + (selectedTrack === i ? " daw-th-sel" : "") + (track.muted ? " daw-th-muted" : "")}
          style={{ borderLeftColor: track.color }}
          onClick={() => dispatch({ type: "SET_SELECTED", index: i })}
          role="listitem">

          {/* Row 1: color dot + number + name */}
          <div className="daw-th-row1">
            <span className="daw-th-dot" style={{ background: track.color }} />
            <span className="daw-th-num">{String(i + 1).padStart(2, "0")}</span>
            {editingName === i ? (
              <input ref={editInputRef} className="daw-th-name-edit" defaultValue={track.name}
                onBlur={e => { updateTrack(i, { name: e.target.value }); dispatch({ type: "SET_EDITING_NAME", index: null }); }}
                onKeyDown={e => {
                  if (e.key === "Enter") { updateTrack(i, { name: (e.target as HTMLInputElement).value }); dispatch({ type: "SET_EDITING_NAME", index: null }); }
                  if (e.key === "Escape") dispatch({ type: "SET_EDITING_NAME", index: null });
                }} />
            ) : (
              <span className="daw-th-name" onDoubleClick={e => { e.stopPropagation(); dispatch({ type: "SET_EDITING_NAME", index: i }); }}>
                {track.name}
              </span>
            )}
          </div>

          {/* Row 2: M/S/R buttons */}
          <div className="daw-th-msr">
            <button className={"daw-msr-btn daw-msr-m" + (track.muted ? " active" : "")} onClick={e => {
              e.stopPropagation();
              const willMute = !track.muted;
              updateTrack(i, { muted: willMute });
              onCmd("/fx " + (i + 1) + " volume " + (willMute ? 0 : track.volume));
            }}>M</button>
            <button className={"daw-msr-btn daw-msr-s" + (track.solo ? " active" : "")} onClick={e => {
              e.stopPropagation();
              const willSolo = !track.solo;
              updateTrack(i, { solo: willSolo });
              onCmd(willSolo ? "/solo " + (i + 1) : "/unsolo");
            }}>S</button>
            <button className={"daw-msr-btn daw-msr-r" + (track.recordArmed ? " active" : "")} onClick={e => {
              e.stopPropagation();
              updateTrack(i, { recordArmed: !track.recordArmed });
            }}>R</button>
          </div>

          {/* Row 3: volume fader + dB */}
          <div className="daw-th-fader">
            <input type="range" min={0} max={100} value={track.volume}
              className="daw-fader"
              title={"Vol: " + volToDb(track.volume) + " dB"}
              onClick={e => e.stopPropagation()}
              onChange={e => {
                const newVol = +e.target.value;
                updateTrack(i, { volume: newVol });
                clearTimeout((window as any).__volTimer);
                (window as any).__volTimer = setTimeout(() => onCmd("/fx " + (i + 1) + " volume " + newVol), 500);
              }} />
            <span className="daw-fader-db">{volToDb(track.volume)}</span>
          </div>

          {/* Row 4: pan knob + FX */}
          <div className="daw-th-row4">
            <PanKnob value={track.pan} onChange={v => { updateTrack(i, { pan: v }); onCmd("/pan " + (i + 1) + " " + v); }} />

            <span className="daw-th-fx" onClick={e => {
              e.stopPropagation(); e.nativeEvent.stopImmediatePropagation();
              dispatch({ type: "SET_FX_OPEN", index: fxOpen === i ? null : i });
            }}>
              FX: {track.fxCount || 0}
              <span className="daw-th-fx-add">+</span>
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

          {/* Preview + delete */}
          <div className="daw-th-row5">
            {track.audioData && (
              <button className="daw-th-preview" onClick={e => {
                e.stopPropagation();
                const a = new Audio("data:" + track.audioMime + ";base64," + track.audioData);
                a.play();
                setTimeout(() => a.pause(), 3000);
              }} title="Preview 3s">{"\u25B6"}</button>
            )}
            <button className="daw-th-del" onClick={e => {
              e.stopPropagation();
              dispatch({ type: "REMOVE_TRACK", index: i });
            }} title="Delete track">{"\u2715"}</button>
          </div>
        </div>
      ))}

      {tracks.length === 0 && (
        <div className="daw-th-empty">
          No tracks yet<br />
          <span>Use the panel below to generate</span>
        </div>
      )}
    </div>
  );
}
