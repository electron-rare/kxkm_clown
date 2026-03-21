import React, { useState, useEffect } from "react";
import type { DAWState, DAWAction } from "./types";
import { STYLES } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
}

export default function GeneratorPanel({ state, dispatch, onCmd }: Props) {
  const { tracks, selectedTrack, generating, prompt, style, duration, bpm, compName } = state;
  const [tab, setTab] = useState<"gen" | "fx" | "edit" | "manage">("gen");
  const [compositions, setCompositions] = useState<Array<{id: string; name: string; tracks: any[]}>>([]);

  useEffect(() => {
    fetch("/api/v2/media/compositions").then(r => r.json()).then(d => {
      if (d.ok && d.data) setCompositions(d.data);
    }).catch(() => {});
  }, [tab]);

  const sel = selectedTrack !== null ? selectedTrack + 1 : null;
  const target = sel || (tracks.length || 1);

  function gen(cmdStr: string, statusMsg: string) {
    dispatch({ type: "SET_GENERATING", generating: true });
    dispatch({ type: "SET_STATUS", status: statusMsg });
    onCmd(cmdStr);
  }

  return (
    <div className="daw-panel">
      {/* Tab bar */}
      <div className="daw-panel-tabs">
        <button className={`daw-tab ${tab === "gen" ? "active" : ""}`} onClick={() => setTab("gen")}>Generer</button>
        <button className={`daw-tab ${tab === "fx" ? "active" : ""}`} onClick={() => setTab("fx")}>Effets</button>
        <button className={`daw-tab ${tab === "edit" ? "active" : ""}`} onClick={() => setTab("edit")}>Edition</button>
        <button className={`daw-tab ${tab === "manage" ? "active" : ""}`} onClick={() => setTab("manage")}>Gestion</button>
      </div>

      {/* GENERATE TAB */}
      {tab === "gen" && (
        <div className="daw-panel-content">
          <div className="daw-panel-row">
            <textarea value={prompt} onChange={e => dispatch({ type: "SET_PROMPT", prompt: e.target.value })}
              placeholder="Prompt de generation..." className="daw-prompt" rows={1} />
            <select value={style} onChange={e => dispatch({ type: "SET_STYLE", style: e.target.value })} className="daw-select">
              {STYLES.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map(s => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              ))}
            </select>
            <select value={duration} onChange={e => dispatch({ type: "SET_DURATION", duration: +e.target.value })} className="daw-select" style={{ width: 55 }}>
              <option value={5}>5s</option><option value={10}>10s</option><option value={15}>15s</option>
              <option value={30}>30s</option><option value={60}>60s</option><option value={120}>2m</option>
            </select>
          </div>
          <div className="daw-panel-row">
            <button className="daw-btn daw-btn-accent" disabled={generating || !prompt.trim()}
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
          <div className="daw-panel-row">
            <button className="daw-btn" onClick={() => onCmd("/metronome " + bpm)}>METRO</button>
            <button className="daw-btn" onClick={() => gen("/ambient " + (prompt.trim() || "dark ambient"), "Ambient...")}>AMBIENT</button>
            <button className="daw-btn" onClick={() => gen("/randomize " + duration, "Random...")}>RANDOM</button>
            <button className="daw-btn" onClick={() => onCmd("/suggest")}>SUGGEST</button>
            <button className="daw-btn" onClick={() => onCmd("/template")}>TEMPLATE</button>
          </div>
        </div>
      )}

      {/* EFFECTS TAB */}
      {tab === "fx" && (
        <div className="daw-panel-content">
          <div className="daw-panel-row">
            <span className="daw-panel-label">Piste #{target}</span>
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} reverse`)}>REVERSE</button>
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} reverb`)}>REVERB</button>
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} echo`)}>ECHO</button>
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} distortion`)}>DISTORT</button>
            <button className="daw-btn" onClick={() => onCmd(`/stutter ${target} 8`)}>STUTTER</button>
          </div>
          <div className="daw-panel-row">
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} pitch 3`)}>PITCH+</button>
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} pitch -3`)}>PITCH-</button>
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} speed 1.5`)}>SPEED+</button>
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} speed 0.75`)}>SPEED-</button>
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} fade-in 3`)}>FADE IN</button>
            <button className="daw-btn" onClick={() => onCmd(`/fx ${target} fade-out 3`)}>FADE OUT</button>
          </div>
          <div className="daw-panel-row">
            <button className="daw-btn" onClick={() => onCmd(`/normalize ${target}`)}>NORMALIZE</button>
            <button className="daw-btn" onClick={() => onCmd(`/gain ${target} 3`)}>GAIN+3</button>
            <button className="daw-btn" onClick={() => onCmd(`/gain ${target} -3`)}>GAIN-3</button>
            <button className="daw-btn" onClick={() => onCmd(`/glitch ${target}`)}>GLITCH</button>
            <button className="daw-btn" onClick={() => onCmd(`/stretch ${target} 2`)}>STRETCH</button>
            <button className="daw-btn" onClick={() => onCmd(`/pan ${target} -1`)}>PAN L</button>
            <button className="daw-btn" onClick={() => onCmd(`/pan ${target} 0`)}>PAN C</button>
            <button className="daw-btn" onClick={() => onCmd(`/pan ${target} 1`)}>PAN R</button>
          </div>
        </div>
      )}

      {/* EDITION TAB */}
      {tab === "edit" && (
        <div className="daw-panel-content">
          <div className="daw-panel-row">
            <span className="daw-panel-label">Piste #{target}</span>
            <button className="daw-btn" onClick={() => onCmd(`/dup ${target}`)}>DUPLIQUER</button>
            <button className="daw-btn" onClick={() => onCmd(`/remix ${target}`)}>REMIX</button>
            <button className="daw-btn" onClick={() => onCmd(`/preview ${target}`)}>PREVIEW</button>
            <button className="daw-btn" onClick={() => onCmd(`/info ${target}`)}>INFO</button>
            <button className="daw-btn" onClick={() => onCmd(`/delete ${target}`)}>DELETE</button>
          </div>
          <div className="daw-panel-row">
            <button className="daw-btn" onClick={() => onCmd(`/loop ${target} 2`)}>LOOP x2</button>
            <button className="daw-btn" onClick={() => onCmd(`/loop ${target} 4`)}>LOOP x4</button>
            <button className="daw-btn" onClick={() => onCmd(`/trim ${target} 0 ${Math.floor(duration / 2)}`)}>TRIM HALF</button>
            <button className="daw-btn" onClick={() => onCmd("/undo")}>UNDO</button>
            {tracks.length > 1 && <button className="daw-btn" onClick={() => onCmd(`/swap ${target} ${target > 1 ? target - 1 : 2}`)}>SWAP</button>}
            {tracks.length > 1 && <button className="daw-btn" onClick={() => onCmd(`/crossfade ${Math.min(target, tracks.length - 1)} 3`)}>CROSSFADE</button>}
            {tracks.length > 1 && <button className="daw-btn" onClick={() => onCmd(`/concat ${target} ${target < tracks.length ? target + 1 : 1}`)}>CONCAT</button>}
          </div>
          <div className="daw-panel-row">
            <button className="daw-btn" onClick={() => onCmd(`/solo ${target}`)}>SOLO</button>
            <button className="daw-btn" onClick={() => onCmd("/unsolo")}>UNSOLO</button>
          </div>
        </div>
      )}

      {/* MANAGE TAB */}
      {tab === "manage" && (
        <div className="daw-panel-content">
          <div className="daw-panel-row">
            <button className="daw-btn daw-btn-accent" onClick={() => { dispatch({ type: "SET_STATUS", status: "Mixage..." }); onCmd("/mix"); }}>MIX</button>
            <button className="daw-btn daw-btn-accent" onClick={() => { dispatch({ type: "SET_STATUS", status: "Mastering..." }); onCmd("/master"); }}>MASTER</button>
            <button className="daw-btn daw-btn-export" onClick={() => onCmd("/export")}>EXPORT</button>
          </div>
          <div className="daw-panel-row">
            <button className="daw-btn" onClick={() => onCmd("/comp list")}>LIST COMP</button>
            <button className="daw-btn" onClick={() => onCmd(`/snapshot ${compName}`)}>SNAPSHOT</button>
            <button className="daw-btn" onClick={() => onCmd("/marker " + (prompt.trim() || "section"))}>MARKER</button>
            <button className="daw-btn" onClick={() => onCmd("/clear-comp")}>CLEAR ALL</button>
          </div>
          <div className="daw-panel-row">
            <button className="daw-btn" onClick={() => onCmd("/template ambient-4")}>TPL Ambient</button>
            <button className="daw-btn" onClick={() => onCmd("/template noise-art")}>TPL Noise</button>
            <button className="daw-btn" onClick={() => onCmd("/template spoken-word")}>TPL Spoken</button>
          </div>
          {compositions.length > 0 && (
            <div className="daw-panel-row">
              <span className="daw-panel-label">Comps:</span>
              {compositions.slice(0, 5).map(c => (
                <button key={c.id} className="daw-btn" onClick={() => onCmd(`/comp load ${c.id}`)} title={c.name}>
                  {c.name.slice(0, 12)} ({c.tracks?.length || 0}p)
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
