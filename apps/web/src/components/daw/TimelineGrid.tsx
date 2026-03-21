import React, { useRef, useCallback } from "react";
import type { DAWState, DAWAction } from "./types";
import { CTX_ACTIONS, typeIcon } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
}

export default function TimelineGrid({ state, dispatch, onCmd }: Props) {
  const { tracks, selectedTrack, zoom, bpm, dragging, contextMenu, loopEnabled, loopStart, loopEnd, signature } = state;
  const timelineRef = useRef<HTMLDivElement>(null);
  const pxPerSec = zoom;

  const maxDur = Math.max(30, ...tracks.map(t => t.startOffset + t.duration));
  const timelineWidth = maxDur * zoom + 200;
  const beatInterval = 60 / bpm;
  const barInterval = beatInterval * signature[0];
  const totalBars = Math.ceil(maxDur / barInterval) + 1;
  const totalBeats = Math.ceil(maxDur / beatInterval);

  const snapToGrid = useCallback((sec: number): number => {
    return Math.round(sec / beatInterval) * beatInterval;
  }, [beatInterval]);

  const handlePointerDown = useCallback((e: React.PointerEvent, trackIdx: number, mode: "move" | "resize") => {
    e.preventDefault(); e.stopPropagation();
    const track = tracks[trackIdx];
    dispatch({ type: "SET_DRAGGING", dragging: { trackIdx, mode, startX: e.clientX, origOffset: track.startOffset, origDuration: track.duration } });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [tracks, dispatch]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.startX;
    const dSec = dx / pxPerSec;
    if (dragging.mode === "move") {
      const raw = dragging.origOffset + dSec;
      dispatch({ type: "UPDATE_TRACK", index: dragging.trackIdx, updates: { startOffset: snapToGrid(Math.max(0, raw)) } });
    } else {
      const raw = dragging.origDuration + dSec;
      dispatch({ type: "UPDATE_TRACK", index: dragging.trackIdx, updates: { duration: Math.max(1, snapToGrid(raw)) } });
    }
  }, [dragging, pxPerSec, dispatch, snapToGrid]);

  const handlePointerUp = useCallback(() => {
    if (dragging) {
      const t = tracks[dragging.trackIdx];
      if (dragging.mode === "resize" && t.duration !== dragging.origDuration) {
        onCmd("/trim " + (dragging.trackIdx + 1) + " 0 " + t.duration);
      }
      dispatch({ type: "SET_DRAGGING", dragging: null });
    }
  }, [dragging, tracks, onCmd, dispatch]);

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    dispatch({ type: "SET_POSITION", position: Math.max(0, (e.clientX - rect.left) / zoom) });
  };

  const handleLaneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".daw-ruler")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    dispatch({ type: "SET_POSITION", position: Math.max(0, x / zoom) });
  };

  return (
    <div className="daw-timeline-wrap" onClick={handleLaneClick}>
      <div className="daw-timeline" style={{ width: timelineWidth + "px" }} ref={timelineRef}>
        {/* Ruler -- bar numbers */}
        <div className="daw-ruler" onClick={handleRulerClick}>
          {Array.from({ length: totalBars }, (_, b) => {
            const sec = b * barInterval;
            return (
              <div key={b} className="daw-ruler-bar" style={{ left: sec * zoom }}>
                <span className="daw-ruler-num">{b + 1}</span>
              </div>
            );
          })}
          {Array.from({ length: totalBeats }, (_, b) => {
            if (b % signature[0] === 0) return null;
            return <div key={"b" + b} className="daw-ruler-beat" style={{ left: b * beatInterval * zoom }} />;
          })}
        </div>

        {/* Lanes */}
        <div className="daw-lanes">
          {/* Grid lines */}
          {Array.from({ length: totalBeats + 1 }, (_, b) => (
            <div key={b}
              className={"daw-grid-line" + (b % signature[0] === 0 ? " daw-grid-major" : "")}
              style={{ left: b * beatInterval * zoom }} />
          ))}

          {/* Loop region */}
          {loopEnabled && (
            <div className="daw-loop-region" style={{ left: loopStart * zoom, width: (loopEnd - loopStart) * zoom }} />
          )}

          {/* Playhead -- clean 1px white line */}
          <div className="daw-playhead" style={{ left: state.position * zoom }} />

          {/* Track lanes */}
          {tracks.map((track, i) => (
            <div key={track.id}
              className={"daw-lane" + (selectedTrack === i ? " daw-lane-sel" : "") + (track.muted ? " daw-lane-muted" : "")}
              onClick={e => { e.stopPropagation(); dispatch({ type: "SET_SELECTED", index: i }); }}
              onContextMenu={e => {
                e.preventDefault(); e.stopPropagation();
                dispatch({ type: "SET_CONTEXT_MENU", menu: { x: e.clientX, y: e.clientY, trackIdx: i } });
              }}>
              <div
                className={"daw-block" + (selectedTrack === i ? " daw-block-sel" : "") + (dragging?.trackIdx === i ? " daw-block-drag" : "")}
                style={{
                  width: Math.max(track.duration * zoom, 20),
                  left: track.startOffset * zoom,
                  background: track.color,
                  opacity: track.muted ? 0.25 : 1,
                }}
                onPointerDown={e => handlePointerDown(e, i, "move")}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onContextMenu={ev => {
                  ev.preventDefault();
                  dispatch({ type: "SET_CONTEXT_MENU", menu: { x: ev.clientX, y: ev.clientY, trackIdx: i } });
                }}>
                {/* Left resize handle */}
                <div className="daw-resize-l"
                  onPointerDown={e => { e.stopPropagation(); /* TODO: left resize */ }} />
                {/* Content */}
                <span className="daw-block-icon">{typeIcon(track)}</span>
                <span className="daw-block-text">{track.prompt.slice(0, 50)}</span>
                <span className="daw-block-dur">{track.duration}s</span>
                {/* Right resize handle */}
                <div className="daw-resize-r"
                  onPointerDown={e => { e.stopPropagation(); handlePointerDown(e, i, "resize"); }}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Context menu -- compact essentials only */}
      {contextMenu && (
        <div className="daw-ctx" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <div className="daw-ctx-head">Track #{contextMenu.trackIdx + 1}</div>
          {CTX_ACTIONS.map(a => (
            <button key={a.label} className="daw-ctx-item" onClick={() => {
              onCmd(a.fn(contextMenu.trackIdx + 1));
              dispatch({ type: "SET_CONTEXT_MENU", menu: null });
            }}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
