import React, { useState, useEffect, useRef } from "react";
import type { DAWState, DAWAction } from "./types";
import { STYLES } from "./types";

interface Props {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  onCmd: (cmd: string) => void;
}

type Tab = "gen" | "fx" | "edit" | "manage";

export default function GeneratorPanel({ state, dispatch, onCmd }: Props) {
  const { tracks, selectedTrack, generating, prompt, style, duration, bpm, compName, panelCollapsed } = state;
  const [tab, setTab] = useState<Tab>("gen");
  const [compositions, setCompositions] = useState<Array<{id: string; name: string; tracks: any[]}>>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/v2/media/compositions").then(r => r.json()).then(d => {
      if (d.ok && d.data) setCompositions(d.data);
    }).catch(() => {});
  }, [tab]);

  useEffect(() => {
    if (tab === "gen" && promptRef.current && !panelCollapsed) promptRef.current.focus();
  }, [tab, panelCollapsed]);

  const sel = selectedTrack !== null ? selectedTrack + 1 : null;
  const target = sel || (tracks.length || 1);

  function gen(cmdStr: string, statusMsg: string) {
    dispatch({ type: "SET_GENERATING", generating: true });
    dispatch({ type: "SET_STATUS", status: statusMsg });
    onCmd(cmdStr);
  }

  const handlePromptKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey && prompt.trim() && !generating) {
      e.preventDefault();
      gen("/layer " + prompt.trim() + ", " + style + ", " + duration + "s", "Generation...");
    }
  };

  const toggleCollapse = () => dispatch({ type: "SET_PANEL_COLLAPSED", collapsed: !panelCollapsed });

  return (
    <div className={"daw-panel" + (panelCollapsed ? " daw-panel-collapsed" : "")}>
      {/* Tab bar */}
      <div className="daw-panel-tabs">
        <button className="daw-panel-toggle" onClick={toggleCollapse}>
          {panelCollapsed ? "\u25B2" : "\u25BC"}
        </button>
        {(["gen", "fx", "edit", "manage"] as const).map(t => (
          <button key={t} className={"daw-panel-tab" + (tab === t ? " active" : "")}
            onClick={() => { setTab(t); if (panelCollapsed) toggleCollapse(); }}>
            {t === "gen" ? "Generate" : t === "fx" ? "Effects" : t === "edit" ? "Edit" : "Manage"}
          </button>
        ))}
        {generating && <span className="daw-panel-spinner">Generating...</span>}
      </div>

      <div className="daw-panel-body">
        {tab === "gen" && (
          <>
            <div className="daw-panel-row">
              <textarea ref={promptRef} value={prompt}
                onChange={e => dispatch({ type: "SET_PROMPT", prompt: e.target.value })}
                onKeyDown={handlePromptKeyDown}
                placeholder="Prompt... (Shift+Enter to generate)"
                className="daw-panel-prompt" rows={1} />
              <select value={style} onChange={e => dispatch({ type: "SET_STYLE", style: e.target.value })} className="daw-panel-select">
                {STYLES.map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map(s => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                ))}
              </select>
              <select value={duration} onChange={e => dispatch({ type: "SET_DURATION", duration: +e.target.value })} className="daw-panel-select daw-panel-select-sm">
                <option value={5}>5s</option><option value={10}>10s</option><option value={15}>15s</option>
                <option value={30}>30s</option><option value={60}>60s</option><option value={120}>2m</option>
              </select>
            </div>
            <div className="daw-panel-grid">
              <button className={"daw-pbtn daw-pbtn-accent" + (generating ? " daw-gen-active" : "")} disabled={generating || !prompt.trim()}
                onClick={() => gen("/layer " + prompt.trim() + ", " + style + ", " + duration + "s", "Generation...")}>MUSIC</button>
              <button className={"daw-pbtn daw-pbtn-voice" + (generating ? " daw-gen-active" : "")} disabled={generating || !prompt.trim()}
                onClick={() => gen('/voice Pharmacius "' + prompt.trim() + '"', "Voix...")}>VOICE</button>
              <button className="daw-pbtn" onClick={() => gen("/noise drone " + duration, "Drone...")}>DRONE</button>
              <button className="daw-pbtn" onClick={() => gen("/noise pink " + duration, "Pink...")}>PINK</button>
              <button className="daw-pbtn" onClick={() => gen("/noise white " + duration, "White...")}>WHITE</button>
              <button className="daw-pbtn" onClick={() => gen("/noise sine " + duration, "Sine...")}>SINE</button>
              <button className="daw-pbtn" onClick={() => gen("/noise brown " + duration, "Brown...")}>BROWN</button>
              <button className="daw-pbtn" onClick={() => onCmd("/silence " + duration)}>SILENCE</button>
              <button className="daw-pbtn" onClick={() => onCmd("/metronome " + bpm)}>METRO</button>
              <button className="daw-pbtn" onClick={() => gen("/ambient " + (prompt.trim() || "dark ambient"), "Ambient...")}>AMBIENT</button>
              <button className="daw-pbtn" onClick={() => gen("/randomize " + duration, "Random...")}>RANDOM</button>
              <button className="daw-pbtn" onClick={() => onCmd("/suggest")}>SUGGEST</button>
            </div>
          </>
        )}

        {tab === "fx" && (
          <div className="daw-panel-grid">
            <span className="daw-panel-target">Track #{target}</span>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " reverse")}>REVERSE</button>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " reverb")}>REVERB</button>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " echo")}>ECHO</button>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " distortion")}>DISTORT</button>
            <button className="daw-pbtn" onClick={() => onCmd("/stutter " + target + " 8")}>STUTTER</button>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " pitch 3")}>PITCH+</button>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " pitch -3")}>PITCH-</button>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " speed 1.5")}>SPEED+</button>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " speed 0.75")}>SPEED-</button>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " fade-in 3")}>FADE IN</button>
            <button className="daw-pbtn" onClick={() => onCmd("/fx " + target + " fade-out 3")}>FADE OUT</button>
            <button className="daw-pbtn" onClick={() => onCmd("/normalize " + target)}>NORMALIZE</button>
            <button className="daw-pbtn" onClick={() => onCmd("/gain " + target + " 3")}>GAIN+3</button>
            <button className="daw-pbtn" onClick={() => onCmd("/gain " + target + " -3")}>GAIN-3</button>
            <button className="daw-pbtn" onClick={() => onCmd("/glitch " + target)}>GLITCH</button>
            <button className="daw-pbtn" onClick={() => onCmd("/stretch " + target + " 2")}>STRETCH</button>
            <button className="daw-pbtn" onClick={() => onCmd("/pan " + target + " -1")}>PAN L</button>
            <button className="daw-pbtn" onClick={() => onCmd("/pan " + target + " 0")}>PAN C</button>
            <button className="daw-pbtn" onClick={() => onCmd("/pan " + target + " 1")}>PAN R</button>
          </div>
        )}

        {tab === "edit" && (
          <div className="daw-panel-grid">
            <span className="daw-panel-target">Track #{target}</span>
            <button className="daw-pbtn" onClick={() => onCmd("/dup " + target)}>DUPLICATE</button>
            <button className="daw-pbtn" onClick={() => onCmd("/remix " + target)}>REMIX</button>
            <button className="daw-pbtn" onClick={() => onCmd("/preview " + target)}>PREVIEW</button>
            <button className="daw-pbtn" onClick={() => onCmd("/info " + target)}>INFO</button>
            <button className="daw-pbtn daw-pbtn-danger" onClick={() => onCmd("/delete " + target)}>DELETE</button>
            <button className="daw-pbtn" onClick={() => onCmd("/loop " + target + " 2")}>LOOP x2</button>
            <button className="daw-pbtn" onClick={() => onCmd("/loop " + target + " 4")}>LOOP x4</button>
            <button className="daw-pbtn" onClick={() => onCmd("/trim " + target + " 0 " + Math.floor(duration / 2))}>TRIM HALF</button>
            <button className="daw-pbtn" onClick={() => onCmd("/undo")}>UNDO</button>
            {tracks.length > 1 && <button className="daw-pbtn" onClick={() => onCmd("/swap " + target + " " + (target > 1 ? target - 1 : 2))}>SWAP</button>}
            {tracks.length > 1 && <button className="daw-pbtn" onClick={() => onCmd("/crossfade " + Math.min(target, tracks.length - 1) + " 3")}>CROSSFADE</button>}
            {tracks.length > 1 && <button className="daw-pbtn" onClick={() => onCmd("/concat " + target + " " + (target < tracks.length ? target + 1 : 1))}>CONCAT</button>}
            <button className="daw-pbtn" onClick={() => onCmd("/solo " + target)}>SOLO</button>
            <button className="daw-pbtn" onClick={() => onCmd("/unsolo")}>UNSOLO</button>
          </div>
        )}

        {tab === "manage" && (
          <div className="daw-panel-grid">
            <button className="daw-pbtn daw-pbtn-accent" onClick={() => { dispatch({ type: "SET_STATUS", status: "Mixage..." }); onCmd("/mix"); }}>MIX</button>
            <button className="daw-pbtn daw-pbtn-accent" onClick={() => { dispatch({ type: "SET_STATUS", status: "Mastering..." }); onCmd("/master"); }}>MASTER</button>
            <button className="daw-pbtn daw-pbtn-export" onClick={() => onCmd("/export")}>EXPORT</button>
            <button className="daw-pbtn" onClick={() => onCmd("/comp list")}>LIST</button>
            <button className="daw-pbtn" onClick={() => onCmd("/snapshot " + compName)}>SNAPSHOT</button>
            <button className="daw-pbtn" onClick={() => onCmd("/marker " + (prompt.trim() || "section"))}>MARKER</button>
            <button className="daw-pbtn daw-pbtn-danger" onClick={() => onCmd("/clear-comp")}>CLEAR ALL</button>
            <button className="daw-pbtn" onClick={() => onCmd("/template ambient-4")}>TPL Ambient</button>
            <button className="daw-pbtn" onClick={() => onCmd("/template noise-art")}>TPL Noise</button>
            <button className="daw-pbtn" onClick={() => onCmd("/template spoken-word")}>TPL Spoken</button>
            {compositions.slice(0, 5).map(c => (
              <button key={c.id} className="daw-pbtn" onClick={() => onCmd("/comp load " + c.id)} title={c.name}>
                {c.name.slice(0, 12)} ({c.tracks?.length || 0}p)
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
