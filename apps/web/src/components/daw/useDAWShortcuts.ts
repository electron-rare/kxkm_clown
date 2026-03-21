import { useEffect } from "react";
import type { DAWState, DAWAction } from "./types";

export function useDAWShortcuts(
  state: DAWState,
  dispatch: React.Dispatch<DAWAction>,
  actions: { play: () => void; pause: () => void; stop: () => void; cmd: (c: string) => void }
) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          state.playing ? actions.pause() : actions.play();
          break;
        case "Enter":
          e.preventDefault();
          actions.stop();
          break;
        case "Delete":
        case "Backspace":
          if (state.selectedTrack !== null) {
            e.preventDefault();
            dispatch({ type: "REMOVE_TRACK", index: state.selectedTrack });
          }
          break;
        case "d":
          if ((e.metaKey || e.ctrlKey) && state.selectedTrack !== null) {
            e.preventDefault();
            actions.cmd("/dup " + (state.selectedTrack + 1));
          }
          break;
        case "z":
          if (e.metaKey || e.ctrlKey) { e.preventDefault(); actions.cmd("/undo"); }
          break;
        case "=":
        case "+":
          e.preventDefault();
          dispatch({ type: "SET_ZOOM", zoom: state.zoom + 2 });
          break;
        case "-":
          e.preventDefault();
          dispatch({ type: "SET_ZOOM", zoom: state.zoom - 2 });
          break;
        case "v":
        case "V":
          dispatch({ type: "SET_TOOL", tool: "select" });
          break;
        case "m":
          if (e.shiftKey) {
            dispatch({ type: "SET_TOOL", tool: "move" });
          } else if (state.selectedTrack !== null) {
            const t = state.tracks[state.selectedTrack];
            if (t) dispatch({ type: "UPDATE_TRACK", index: state.selectedTrack, updates: { muted: !t.muted } });
          }
          break;
        case "M":
          dispatch({ type: "SET_TOOL", tool: "move" });
          break;
        case "t":
        case "T":
          dispatch({ type: "SET_TOOL", tool: "trim" });
          break;
        case "s":
          if (!(e.metaKey || e.ctrlKey)) {
            if (e.shiftKey) {
              dispatch({ type: "SET_TOOL", tool: "split" });
            } else if (state.selectedTrack !== null) {
              const t = state.tracks[state.selectedTrack];
              if (t) dispatch({ type: "UPDATE_TRACK", index: state.selectedTrack, updates: { solo: !t.solo } });
            }
          }
          break;
        case "S":
          dispatch({ type: "SET_TOOL", tool: "split" });
          break;
        case "l":
        case "L":
          dispatch({ type: "SET_LOOP", enabled: !state.loopEnabled });
          break;
        case "r":
        case "R":
          dispatch({ type: "SET_RECORDING", recording: !state.recording });
          break;
        case "ArrowUp":
          if (state.selectedTrack !== null && state.selectedTrack > 0) {
            e.preventDefault();
            dispatch({ type: "SET_SELECTED", index: state.selectedTrack - 1 });
          }
          break;
        case "ArrowDown":
          if (state.selectedTrack !== null && state.selectedTrack < state.tracks.length - 1) {
            e.preventDefault();
            dispatch({ type: "SET_SELECTED", index: state.selectedTrack + 1 });
          }
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, dispatch, actions]);
}
