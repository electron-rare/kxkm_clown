import React from "react";
import type { DAWState, DAWAction } from "./types";
import { STYLES } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
}

export default function GeneratorPanel({ state, dispatch, onCmd }: Props) {
  const { tracks, selectedTrack, generating, prompt, style, duration } = state;
  const selIdx = selectedTrack !== null ? selectedTrack : (tracks.length > 0 ? tracks.length - 1 : null);

  function gen(cmdStr: string, statusMsg: string) {
    dispatch({ type: "SET_GENERATING", generating: true });
    dispatch({ type: "SET_STATUS", status: statusMsg });
    onCmd(cmdStr);
  }

  return (
    <div className="daw-generator">
      <div className="daw-gen-row">
        <textarea value={prompt} onChange={e => dispatch({ type: "SET_PROMPT", prompt: e.target.value })}
          placeholder="Prompt de generation..." className="daw-prompt" rows={2} />
        <select value={style} onChange={e => dispatch({ type: "SET_STYLE", style: e.target.value })} className="daw-select">
          {STYLES.map(g => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map(s => <option key={s} value={s}>{s}</option>)}
            </optgroup>
          ))}
        </select>
        <select value={duration} onChange={e => dispatch({ type: "SET_DURATION", duration: +e.target.value })} className="daw-select daw-dur">
          <option value={5}>5s</option><option value={10}>10s</option><option value={15}>15s</option>
          <option value={30}>30s</option><option value={60}>60s</option><option value={120}>2m</option>
        </select>
      </div>
      <div className="daw-btn-row">
        <button className="daw-btn daw-btn-gen" disabled={generating || !prompt.trim()}
          onClick={() => gen("/layer " + prompt.trim() + ", " + style + ", " + duration + "s", "Generation...")}>MUSIC</button>
        <button className="daw-btn daw-btn-voice" disabled={generating || !prompt.trim()}
          onClick={() => gen('/voice Pharmacius "' + prompt.trim() + '"', "Voix...")}>VOICE</button>
        <button className="daw-btn" onClick={() => gen("/noise drone " + duration, "Drone...")}>DRONE</button>
        <button className="daw-btn" onClick={() => gen("/noise pink " + duration, "Pink...")}>PINK</button>
        <button className="daw-btn" onClick={() => gen("/noise white " + duration, "White...")}>WHITE</button>
        <button className="daw-btn" onClick={() => gen("/noise sine " + duration, "Sine...")}>SINE</button>
        <button className="daw-btn" onClick={() => gen("/noise brown " + duration, "Brown...")}>BROWN</button>
        <button className="daw-btn" onClick={() => onCmd("/silence " + duration)}>SILENCE</button>
      </div>
      {selIdx !== null && tracks.length > 0 && (
        <div className="daw-btn-row daw-fx-bar">
          <span className="daw-fx-label">FX #{selIdx + 1}</span>
          <button className="daw-btn" onClick={() => onCmd("/fx " + (selIdx + 1) + " reverse")}>REV</button>
          <button className="daw-btn" onClick={() => onCmd("/fx " + (selIdx + 1) + " reverb")}>VERB</button>
          <button className="daw-btn" onClick={() => onCmd("/fx " + (selIdx + 1) + " echo")}>ECHO</button>
          <button className="daw-btn" onClick={() => onCmd("/fx " + (selIdx + 1) + " distortion")}>DIST</button>
          <button className="daw-btn" onClick={() => onCmd("/stutter " + (selIdx + 1) + " 8")}>STUT</button>
          <button className="daw-btn" onClick={() => onCmd("/fx " + (selIdx + 1) + " pitch 3")}>P+</button>
          <button className="daw-btn" onClick={() => onCmd("/fx " + (selIdx + 1) + " pitch -3")}>P-</button>
          <button className="daw-btn" onClick={() => onCmd("/fx " + (selIdx + 1) + " fade-in 3")}>FIN</button>
          <button className="daw-btn" onClick={() => onCmd("/fx " + (selIdx + 1) + " fade-out 3")}>FOUT</button>
          <button className="daw-btn" onClick={() => onCmd("/normalize " + (selIdx + 1))}>NORM</button>
        </div>
      )}
      {tracks.length > 1 && (
        <div className="daw-btn-row daw-mix-bar">
          <button className="daw-btn daw-btn-mix" onClick={() => { dispatch({ type: "SET_STATUS", status: "Mixage..." }); onCmd("/mix"); }}>MIX</button>
          <button className="daw-btn daw-btn-mix" onClick={() => { dispatch({ type: "SET_STATUS", status: "Mastering..." }); onCmd("/master"); }}>MASTER</button>
          <button className="daw-btn daw-btn-export" onClick={() => onCmd("/export")}>EXPORT</button>
        </div>
      )}
    </div>
  );
}
