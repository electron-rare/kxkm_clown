import React, { useRef, useEffect } from "react";
import type { DAWState, DAWAction } from "./types";
import { FX_LIST, typeIcon } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
}

export default function TrackHeaders({ state, dispatch, onCmd }: Props) {
  const { tracks, selectedTrack, editingName, fxOpen, zoom } = state;
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editInputRef.current) editInputRef.current.focus(); }, [editingName]);

  const updateTrack = (idx: number, patch: Partial<typeof tracks[0]>) =>
    dispatch({ type: "UPDATE_TRACK", index: idx, updates: patch });

  const cyclePan = (idx: number) => {
    const vals = [-1, -0.5, 0, 0.5, 1];
    const ni = vals.indexOf(tracks[idx].pan);
    updateTrack(idx, { pan: vals[(ni >= 0 ? ni + 1 : 2) % vals.length] });
  };

  const fxCmd = (trackIdx: number, fx: typeof FX_LIST[0]) => {
    const i = trackIdx + 1;
    if (fx.special) onCmd(fx.special.replace("{i}", String(i)));
    else onCmd("/fx " + i + " " + fx.cmd);
  };

  return (
    <div className="daw-headers">
      <div className="daw-header-ruler">
        <button className="daw-zoom-btn" onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom - 2 })} title="Zoom out">-</button>
        <span className="daw-zoom-val">{zoom}px/s</span>
        <button className="daw-zoom-btn" onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom + 2 })} title="Zoom in">+</button>
      </div>
      {tracks.map((track, i) => (
        <div key={track.id} className={"daw-th" + (selectedTrack === i ? " daw-th-sel" : "") + (track.muted ? " daw-th-muted" : "")}
          onClick={() => dispatch({ type: "SET_SELECTED", index: i })}>
          <div className="daw-th-row1">
            <div className="daw-th-color" style={{ backgroundColor: track.color }} />
            <span className="daw-th-type">{typeIcon(track)}{i + 1}</span>
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
          </div>
          <div className="daw-th-row2">
            <button className={"daw-btn-sm" + (track.muted ? " active" : "")} onClick={e => {
              e.stopPropagation(); const willMute = !track.muted;
              updateTrack(i, { muted: willMute }); onCmd(`/fx ${i + 1} volume ${willMute ? 0 : track.volume}`);
            }}>M</button>
            <button className={"daw-btn-sm" + (track.solo ? " active" : "")} onClick={e => {
              e.stopPropagation(); const willSolo = !track.solo;
              updateTrack(i, { solo: willSolo }); onCmd(willSolo ? `/solo ${i + 1}` : `/unsolo`);
            }}>S</button>
            <input type="range" min={0} max={100} value={track.volume} className="daw-vol" title={"Vol: " + track.volume + "%"}
              onClick={e => e.stopPropagation()} onChange={e => {
              const newVol = +e.target.value;
              updateTrack(i, { volume: newVol });
              clearTimeout((window as any).__volTimer);
              (window as any).__volTimer = setTimeout(() => onCmd(`/fx ${i + 1} volume ${newVol}`), 500);
            }} />
            <span className="daw-pan" onClick={e => { e.stopPropagation(); cyclePan(i); }} title="Pan (click to cycle)">
              {track.pan < 0 ? "L" + Math.abs(track.pan * 100) : track.pan > 0 ? "R" + (track.pan * 100) : "C"}
            </span>
            <span className="daw-fx-trigger" onClick={e => {
              e.stopPropagation(); e.nativeEvent.stopImmediatePropagation();
              dispatch({ type: "SET_FX_OPEN", index: fxOpen === i ? null : i });
            }}>FX</span>
            {fxOpen === i && (
              <div className="daw-fx-dropdown" onClick={e => e.stopPropagation()}>
                {FX_LIST.map(fx => (
                  <button key={fx.label} onClick={() => { fxCmd(i, fx); dispatch({ type: "SET_FX_OPEN", index: null }); }}>{fx.label}</button>
                ))}
              </div>
            )}
            <button className="daw-btn-sm daw-btn-del" onClick={e => {
              e.stopPropagation(); dispatch({ type: "REMOVE_TRACK", index: i });
            }} title="Delete track">X</button>
          </div>
          {track.audioData && (
            <audio controls src={"data:" + track.audioMime + ";base64," + track.audioData} className="daw-audio-sm" onClick={e => e.stopPropagation()} />
          )}
        </div>
      ))}
      {tracks.length === 0 && <div className="daw-th-empty">Pas de pistes</div>}
    </div>
  );
}
