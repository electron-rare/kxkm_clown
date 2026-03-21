import React, { useRef, useCallback } from "react";
import type { DAWState, DAWAction } from "./types";
import { CTX_ACTIONS, typeIcon } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
}

export default function TimelineGrid({ state, dispatch, onCmd }: Props) {
  const { tracks, selectedTrack, zoom, bpm, dragging, contextMenu, loopEnabled, loopStart, loopEnd } = state;
  const timelineRef = useRef<HTMLDivElement>(null);
  const pxPerSec = zoom;

  const maxDur = Math.max(30, ...tracks.map(t => t.startOffset + t.duration));
  const timelineWidth = maxDur * zoom;
  const beatInterval = 60 / bpm;
  const totalBeats = Math.ceil(maxDur / beatInterval);

  // Snap to grid helper
  const snapToGrid = useCallback((sec: number): number => {
    const snapInterval = beatInterval; // snap to beats
    return Math.round(sec / snapInterval) * snapInterval;
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
      const snapped = snapToGrid(Math.max(0, raw));
      dispatch({ type: "UPDATE_TRACK", index: dragging.trackIdx, updates: { startOffset: snapped } });
    } else {
      const raw = dragging.origDuration + dSec;
      const snapped = Math.max(1, snapToGrid(raw));
      dispatch({ type: "UPDATE_TRACK", index: dragging.trackIdx, updates: { duration: snapped } });
    }
  }, [dragging, pxPerSec, dispatch, snapToGrid]);

  const handlePointerUp = useCallback(() => {
    if (dragging) {
      const t = tracks[dragging.trackIdx];
      if (dragging.mode === "resize" && t.duration !== dragging.origDuration) {
        onCmd(`/trim ${dragging.trackIdx + 1} 0 ${t.duration}`);
      }
      dispatch({ type: "SET_DRAGGING", dragging: null });
    }
  }, [dragging, tracks, onCmd, dispatch]);

  // Click on ruler to seek
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pos = Math.max(0, x / zoom);
    dispatch({ type: "SET_POSITION", position: pos });
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".daw-ruler")) return; // handled by ruler
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    dispatch({ type: "SET_POSITION", position: Math.max(0, (x / timelineWidth) * maxDur) });
  };

  if (tracks.length === 0) return null;

  return (
    <div className="daw-timeline-wrap" onClick={handleTimelineClick}>
      <div className="daw-timeline" style={{ width: timelineWidth + "px" }} ref={timelineRef}>
        {/* Ruler */}
        <div className="daw-ruler" onClick={handleRulerClick}>
          {Array.from({ length: Math.ceil(maxDur) + 1 }, (_, s) => (
            <div key={s} className={"daw-ruler-mark" + (s % 5 === 0 ? " daw-ruler-major" : "")} style={{ left: s * zoom }}>
              {s % 5 === 0 && <span className="daw-ruler-num">{s}s</span>}
            </div>
          ))}
          {/* Playhead triangle marker on ruler */}
          <div className="daw-playhead-marker" style={{ left: state.position * zoom }} />
        </div>

        {/* Lanes */}
        <div className="daw-lanes">
          {/* Beat grid lines */}
          {Array.from({ length: totalBeats + 1 }, (_, b) => (
            <div key={b} className={"daw-beat-line" + (b % 4 === 0 ? " daw-beat-line-major" : "")} style={{ left: b * beatInterval * zoom }} />
          ))}

          {/* Loop region overlay */}
          {loopEnabled && (
            <div className="daw-loop-region" style={{
              left: loopStart * zoom,
              width: (loopEnd - loopStart) * zoom,
            }} />
          )}

          {/* Playhead line */}
          <div className="daw-playhead" style={{ left: state.position * zoom }} />

          {/* Snap indicator while dragging */}
          {dragging && (
            <div className="daw-snap-line" style={{
              left: dragging.mode === "move"
                ? tracks[dragging.trackIdx].startOffset * zoom
                : (tracks[dragging.trackIdx].startOffset + tracks[dragging.trackIdx].duration) * zoom
            }} />
          )}

          {tracks.map((track, i) => {
            const isExpanded = track.expanded !== false;
            const laneHeight = isExpanded ? 56 : 36;

            return (
              <div key={track.id}
                className={"daw-lane" + (selectedTrack === i ? " daw-lane-sel" : "") + (track.muted ? " daw-lane-muted" : "")}
                style={{ height: laneHeight }}
                onClick={e => { e.stopPropagation(); dispatch({ type: "SET_SELECTED", index: i }); }}
                onContextMenu={e => {
                  e.preventDefault(); e.stopPropagation();
                  dispatch({ type: "SET_CONTEXT_MENU", menu: { x: e.clientX, y: e.clientY, trackIdx: i } });
                }}>
                <div
                  className={`daw-block ${dragging?.trackIdx === i ? "daw-block-dragging" : ""}`}
                  style={{
                    width: Math.max(track.duration * zoom, 24),
                    left: track.startOffset * zoom,
                    ["--block-color" as string]: track.color,
                    opacity: track.muted ? 0.3 : 0.6 + (track.volume / 300),
                    height: laneHeight - 12,
                  }}
                  title={`${track.prompt} (${track.startOffset}s \u2192 ${track.startOffset + track.duration}s)`}
                  onPointerDown={e => handlePointerDown(e, i, "move")}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onContextMenu={ev => {
                    ev.preventDefault();
                    dispatch({ type: "SET_CONTEXT_MENU", menu: { x: ev.clientX, y: ev.clientY, trackIdx: i } });
                  }}>
                  {/* Resize handle (right edge) */}
                  <div className="daw-resize-handle"
                    onPointerDown={e => { e.stopPropagation(); handlePointerDown(e, i, "resize"); }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp} />
                  {/* Block content */}
                  <span className="daw-block-badge">{typeIcon(track)}</span>
                  <span className="daw-block-text">{track.prompt.slice(0, 40)}</span>
                  <span className="daw-block-dur">{track.duration}s</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="daw-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <div className="daw-ctx-title">Track #{contextMenu.trackIdx + 1}</div>
          {CTX_ACTIONS.map(a => (
            <button key={a.label} onClick={() => { onCmd(a.fn(contextMenu.trackIdx + 1)); dispatch({ type: "SET_CONTEXT_MENU", menu: null }); }}>{a.label}</button>
          ))}
          <hr />
          <button className="daw-ctx-danger" onClick={() => {
            dispatch({ type: "REMOVE_TRACK", index: contextMenu.trackIdx });
            dispatch({ type: "SET_CONTEXT_MENU", menu: null });
          }}>Supprimer</button>
        </div>
      )}
    </div>
  );
}
