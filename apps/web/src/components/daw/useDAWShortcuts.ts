import { useEffect } from "react";
import type { DAWState, DAWAction } from "./types";

export function useDAWShortcuts(
  state: DAWState,
  dispatch: React.Dispatch<DAWAction>,
  actions: { play: () => void; pause: () => void; stop: () => void; cmd: (c: string) => void }
) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Do not capture when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case " ": // Space: play/pause toggle
          e.preventDefault();
          state.playing ? actions.pause() : actions.play();
          break;
        case "Enter": // Stop
          e.preventDefault();
          actions.stop();
          break;
        case "Delete":
        case "Backspace": // Delete selected track
          if (state.selectedTrack !== null) {
            e.preventDefault();
            dispatch({ type: "REMOVE_TRACK", index: state.selectedTrack });
          }
          break;
        case "d": // Duplicate
          if ((e.metaKey || e.ctrlKey) && state.selectedTrack !== null) {
            e.preventDefault();
            actions.cmd("/dup " + (state.selectedTrack + 1));
          }
          break;
        case "z": // Undo
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            actions.cmd("/undo");
          }
          break;
        case "=":
        case "+": // Zoom in
          e.preventDefault();
          dispatch({ type: "SET_ZOOM", zoom: Math.min(30, state.zoom + 2) });
          break;
        case "-": // Zoom out
          e.preventDefault();
          dispatch({ type: "SET_ZOOM", zoom: Math.max(2, state.zoom - 2) });
          break;
        case "m": // Toggle mute on selected
          if (state.selectedTrack !== null) {
            const t = state.tracks[state.selectedTrack];
            if (t) dispatch({ type: "UPDATE_TRACK", index: state.selectedTrack, updates: { muted: !t.muted } });
          }
          break;
        case "s": // Toggle solo on selected (not cmd+s)
          if (!(e.metaKey || e.ctrlKey) && state.selectedTrack !== null) {
            const t = state.tracks[state.selectedTrack];
            if (t) dispatch({ type: "UPDATE_TRACK", index: state.selectedTrack, updates: { solo: !t.solo } });
          }
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, dispatch, actions]);
}
