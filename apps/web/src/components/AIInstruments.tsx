import { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import { VideotexPageHeader } from "./VideotexMosaic";

const MidiGenerator = lazy(() => import("./MidiGenerator"));

const AI_BRIDGE = "/api/v2/ai-bridge/instrument";
const DAW_SAMPLES = "/api/v2/daw/samples";

// ── Types ──

interface InstrumentResult {
  blobUrl: string;
  saved: boolean;
  serverUrl?: string;
}

type GenState = "idle" | "generating" | "done" | "error";

// ── Note helpers ──

const CHROMATIC_NOTES: string[] = [];
for (let oct = 1; oct <= 4; oct++) {
  for (const n of ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]) {
    CHROMATIC_NOTES.push(`${n}${oct}`);
    if (n === "C" && oct === 4) break; // stop at C4
  }
}

// ── Elapsed timer helper ──

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function useElapsedTimer(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      setElapsed(0);
      const t0 = Date.now();
      ref.current = setInterval(() => setElapsed(Date.now() - t0), 250);
    } else if (ref.current) {
      clearInterval(ref.current);
      ref.current = null;
    }
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, [running]);

  return elapsed;
}

// ── Shared generate helper ──

async function generateInstrument(
  endpoint: string,
  params: Record<string, unknown>,
): Promise<InstrumentResult> {
  // 1. POST to ai-bridge
  const res = await fetch(`${AI_BRIDGE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Generate failed: ${res.status} ${res.statusText}`);

  // 2. Get blob response
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  // 3. Auto-save to /api/v2/daw/samples
  let saved = false;
  let serverUrl: string | undefined;
  try {
    const fd = new FormData();
    fd.append("file", blob, `${endpoint}-${Date.now()}.wav`);
    fd.append("type", endpoint);
    fd.append("params", JSON.stringify(params));
    const saveRes = await fetch(DAW_SAMPLES, { method: "POST", body: fd });
    if (saveRes.ok) {
      const json = await saveRes.json();
      serverUrl = json.url || json.filename;
      saved = true;
    }
  } catch {
    // save failed silently — user still gets preview
  }

  return { blobUrl, saved, serverUrl };
}

// ── Instrument card wrapper ──

function InstrumentCard({
  title,
  color,
  cssClass,
  state,
  elapsed,
  error,
  result,
  onGenerate,
  children,
}: {
  title: string;
  color: string;
  cssClass: string;
  state: GenState;
  elapsed: number;
  error: string;
  result: InstrumentResult | null;
  onGenerate: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`ai-inst ${cssClass}`} style={{ borderLeft: `4px solid ${color}` }}>
      <div className="ai-inst-header" style={{ color }}>
        {title}
      </div>

      <div className="ai-inst-controls">{children}</div>

      <div className="ai-inst-actions">
        <button
          className="ai-inst-gen-btn"
          disabled={state === "generating"}
          onClick={onGenerate}
          style={{ borderColor: color }}
        >
          {state === "generating" ? `GENERATING... ${formatElapsed(elapsed)}` : "GENERATE"}
        </button>

        {state === "error" && <span className="ai-inst-error">ERR: {error}</span>}

        {result && (
          <div className="ai-inst-result">
            <audio controls src={result.blobUrl} />
            <span className="ai-inst-saved">
              {result.saved ? "SAVED" : "PREVIEW ONLY"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Control helpers ──

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  unit = "",
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <label className="ai-ctrl">
      <span className="ai-ctrl-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="ai-ctrl-value">
        {value}
        {unit}
      </span>
    </label>
  );
}

function Select({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="ai-ctrl">
      <span className="ai-ctrl-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// ══════════════════════════════════════════════════════════════
//  1. AI DRUMS
// ══════════════════════════════════════════════════════════════

function AIDrums() {
  const [bpm, setBpm] = useState(120);
  const [pattern, setPattern] = useState("kick");
  const [bars, setBars] = useState(4);
  const [swing, setSwing] = useState(0);
  const [state, setState] = useState<GenState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<InstrumentResult | null>(null);
  const elapsed = useElapsedTimer(state === "generating");

  const generate = useCallback(async () => {
    setState("generating");
    setError("");
    try {
      const r = await generateInstrument("drums", { bpm, pattern, bars, swing });
      setResult(r);
      setState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  }, [bpm, pattern, bars, swing]);

  return (
    <InstrumentCard
      title="AI DRUMS"
      color="#ff4444"
      cssClass="ai-inst-drums"
      state={state}
      elapsed={elapsed}
      error={error}
      result={result}
      onGenerate={generate}
    >
      <Slider label="BPM" min={60} max={200} value={bpm} onChange={setBpm} />
      <Select
        label="PATTERN"
        options={["kick", "snare", "hihat", "kick+snare", "full-kit"]}
        value={pattern}
        onChange={setPattern}
      />
      <Slider label="BARS" min={1} max={8} value={bars} onChange={setBars} />
      <Slider label="SWING" min={0} max={100} value={swing} onChange={setSwing} unit="%" />
    </InstrumentCard>
  );
}

// ══════════════════════════════════════════════════════════════
//  2. AI BASS
// ══════════════════════════════════════════════════════════════

function AIBass() {
  const [note, setNote] = useState("C2");
  const [waveform, setWaveform] = useState("sine");
  const [pattern, setPattern] = useState("sustain");
  const [duration, setDuration] = useState(30);
  const [bpm, setBpm] = useState(120);
  const [state, setState] = useState<GenState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<InstrumentResult | null>(null);
  const elapsed = useElapsedTimer(state === "generating");

  const generate = useCallback(async () => {
    setState("generating");
    setError("");
    try {
      const r = await generateInstrument("bass", { note, waveform, pattern, duration, bpm });
      setResult(r);
      setState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  }, [note, waveform, pattern, duration, bpm]);

  return (
    <InstrumentCard
      title="AI BASS"
      color="#ff8800"
      cssClass="ai-inst-bass"
      state={state}
      elapsed={elapsed}
      error={error}
      result={result}
      onGenerate={generate}
    >
      <Select label="NOTE" options={CHROMATIC_NOTES} value={note} onChange={setNote} />
      <Select label="WAVE" options={["sine", "saw", "square"]} value={waveform} onChange={setWaveform} />
      <Select label="PATTERN" options={["sustain", "pulse", "arp"]} value={pattern} onChange={setPattern} />
      <Slider label="DURATION" min={5} max={60} value={duration} onChange={setDuration} unit="s" />
      <Slider label="BPM" min={60} max={200} value={bpm} onChange={setBpm} />
    </InstrumentCard>
  );
}

// ══════════════════════════════════════════════════════════════
//  3. AI PAD
// ══════════════════════════════════════════════════════════════

function AIPad() {
  const [type, setType] = useState("warm");
  const [chord, setChord] = useState("Cm");
  const [duration, setDuration] = useState(30);
  const [state, setState] = useState<GenState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<InstrumentResult | null>(null);
  const elapsed = useElapsedTimer(state === "generating");

  const generate = useCallback(async () => {
    setState("generating");
    setError("");
    try {
      const r = await generateInstrument("pad", { type, chord, duration });
      setResult(r);
      setState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  }, [type, chord, duration]);

  return (
    <InstrumentCard
      title="AI PAD"
      color="#4488ff"
      cssClass="ai-inst-pad"
      state={state}
      elapsed={elapsed}
      error={error}
      result={result}
      onGenerate={generate}
    >
      <Select
        label="TYPE"
        options={["warm", "cold", "dark", "bright", "evolving"]}
        value={type}
        onChange={setType}
      />
      <Select
        label="CHORD"
        options={["Cm", "Dm", "Am", "Em", "Fm", "Gm", "Bbm"]}
        value={chord}
        onChange={setChord}
      />
      <Slider label="DURATION" min={10} max={120} value={duration} onChange={setDuration} unit="s" />
    </InstrumentCard>
  );
}

// ══════════════════════════════════════════════════════════════
//  4. AI CHOIR
// ══════════════════════════════════════════════════════════════

function AIChoir() {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState(3);
  const [spread, setSpread] = useState(0.5);
  const [duration, setDuration] = useState(15);
  const [state, setState] = useState<GenState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<InstrumentResult | null>(null);
  const elapsed = useElapsedTimer(state === "generating");

  const generate = useCallback(async () => {
    setState("generating");
    setError("");
    try {
      const r = await generateInstrument("choir", { text, voices, spread, duration });
      setResult(r);
      setState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  }, [text, voices, spread, duration]);

  return (
    <InstrumentCard
      title="AI CHOIR"
      color="#aa44ff"
      cssClass="ai-inst-choir"
      state={state}
      elapsed={elapsed}
      error={error}
      result={result}
      onGenerate={generate}
    >
      <label className="ai-ctrl ai-ctrl-wide">
        <span className="ai-ctrl-label">TEXT</span>
        <input
          type="text"
          placeholder="What to sing..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="ai-text-input"
        />
      </label>
      <Slider label="VOICES" min={1} max={6} value={voices} onChange={setVoices} />
      <Slider label="SPREAD" min={0} max={1} step={0.05} value={spread} onChange={setSpread} />
      <Slider label="DURATION" min={5} max={30} value={duration} onChange={setDuration} unit="s" />
    </InstrumentCard>
  );
}

// ══════════════════════════════════════════════════════════════
//  5. AI FX
// ══════════════════════════════════════════════════════════════

function AIFX() {
  const [type, setType] = useState("riser");
  const [duration, setDuration] = useState(5);
  const [state, setState] = useState<GenState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<InstrumentResult | null>(null);
  const elapsed = useElapsedTimer(state === "generating");

  const generate = useCallback(async () => {
    setState("generating");
    setError("");
    try {
      const r = await generateInstrument("fx", { type, duration });
      setResult(r);
      setState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  }, [type, duration]);

  return (
    <InstrumentCard
      title="AI FX"
      color="#44cc44"
      cssClass="ai-inst-fx"
      state={state}
      elapsed={elapsed}
      error={error}
      result={result}
      onGenerate={generate}
    >
      <Select
        label="TYPE"
        options={["riser", "drop", "sweep", "impact", "stutter"]}
        value={type}
        onChange={setType}
      />
      <Slider label="DURATION" min={1} max={15} value={duration} onChange={setDuration} unit="s" />
    </InstrumentCard>
  );
}

// ══════════════════════════════════════════════════════════════
//  6. AI MIDI (Magenta.js)
// ══════════════════════════════════════════════════════════════

function AIMidi() {
  return (
    <div className="ai-inst ai-inst-midi" style={{ borderLeft: "4px solid #00bcd4" }}>
      <div className="ai-inst-header" style={{ color: "#00bcd4" }}>
        AI MIDI
      </div>
      <div className="ai-inst-controls">
        <Suspense
          fallback={
            <span style={{ color: "#00bcd4", opacity: 0.6 }}>LOADING MAGENTA.JS...</span>
          }
        >
          <MidiGenerator />
        </Suspense>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  RACK — main export
// ══════════════════════════════════════════════════════════════

export default function AIInstruments() {
  return (
    <div className="ai-rack">
      <VideotexPageHeader title="AI INSTRUMENT RACK" subtitle="6 instruments natifs" color="cyan" />

      <AIDrums />
      <AIBass />
      <AIPad />
      <AIChoir />
      <AIFX />
      <AIMidi />

      <style>{`
        .ai-rack {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
          font-family: 'VT323', monospace;
          color: #e0e0e0;
          max-width: 900px;
          margin: 0 auto;
        }

        .ai-inst {
          background: #1a1a2e;
          border-radius: 4px;
          padding: 1rem 1.2rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .ai-inst-header {
          font-size: 1.4rem;
          letter-spacing: 2px;
          text-transform: uppercase;
        }

        .ai-inst-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem 1.2rem;
          align-items: center;
        }

        .ai-ctrl {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.95rem;
        }

        .ai-ctrl-wide {
          flex: 1 1 100%;
        }

        .ai-ctrl-label {
          color: #888;
          min-width: 60px;
          text-transform: uppercase;
          font-size: 0.85rem;
          letter-spacing: 1px;
        }

        .ai-ctrl input[type="range"] {
          accent-color: #ff69b4;
          width: 100px;
          cursor: pointer;
        }

        .ai-ctrl select {
          background: #0d0d1a;
          color: #e0e0e0;
          border: 1px solid #333;
          padding: 2px 6px;
          font-family: 'VT323', monospace;
          font-size: 0.95rem;
          cursor: pointer;
        }

        .ai-text-input {
          background: #0d0d1a;
          color: #e0e0e0;
          border: 1px solid #333;
          padding: 4px 8px;
          font-family: 'VT323', monospace;
          font-size: 0.95rem;
          flex: 1;
        }

        .ai-ctrl-value {
          color: #ff69b4;
          min-width: 40px;
          text-align: right;
          font-size: 0.9rem;
        }

        .ai-inst-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.75rem;
        }

        .ai-inst-gen-btn {
          background: #0d0d1a;
          color: #e0e0e0;
          border: 2px solid #555;
          padding: 6px 18px;
          font-family: 'VT323', monospace;
          font-size: 1.1rem;
          letter-spacing: 2px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }

        .ai-inst-gen-btn:hover:not(:disabled) {
          background: #222;
          color: #fff;
        }

        .ai-inst-gen-btn:disabled {
          opacity: 0.6;
          cursor: wait;
        }

        .ai-inst-error {
          color: #ff4444;
          font-size: 0.9rem;
        }

        .ai-inst-result {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex: 1;
        }

        .ai-inst-result audio {
          height: 32px;
          flex: 1;
          min-width: 180px;
        }

        .ai-inst-saved {
          font-size: 0.8rem;
          color: #44cc44;
          letter-spacing: 1px;
        }

        /* Per-instrument accent borders already set via inline style */
        .ai-inst-drums .ai-ctrl input[type="range"] { accent-color: #ff4444; }
        .ai-inst-bass .ai-ctrl input[type="range"] { accent-color: #ff8800; }
        .ai-inst-pad .ai-ctrl input[type="range"] { accent-color: #4488ff; }
        .ai-inst-choir .ai-ctrl input[type="range"] { accent-color: #aa44ff; }
        .ai-inst-fx .ai-ctrl input[type="range"] { accent-color: #44cc44; }
        .ai-inst-midi .ai-ctrl input[type="range"] { accent-color: #00bcd4; }

        @media (max-width: 600px) {
          .ai-inst-controls {
            flex-direction: column;
            align-items: stretch;
          }
          .ai-ctrl input[type="range"] {
            width: 100%;
            flex: 1;
          }
          .ai-inst-result {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
