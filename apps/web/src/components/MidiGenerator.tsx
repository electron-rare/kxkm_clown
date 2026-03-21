/**
 * MidiGenerator — AI MIDI generation using Magenta.js (DrumsRNN + MelodyRNN)
 * Renders notes via Web Audio API (OfflineAudioContext) for playback & WAV export.
 */
import { useState, useCallback, useRef, useEffect } from "react";

// ── Magenta types (loaded dynamically) ──

interface INoteSequence {
  ticksPerQuarter?: number;
  totalQuantizedSteps?: number;
  quantizationInfo?: { stepsPerQuarter: number };
  notes?: Array<{
    pitch: number;
    quantizedStartStep: number;
    quantizedEndStep: number;
    isDrum?: boolean;
  }>;
  totalTime?: number;
}

interface MusicRNN {
  initialize(): Promise<void>;
  continueSequence(
    seq: INoteSequence,
    steps: number,
    temperature: number,
  ): Promise<INoteSequence>;
  dispose(): void;
}

interface MagentaMusic {
  MusicRNN: new (checkpoint: string) => MusicRNN;
  sequences: {
    quantizeNoteSequence(seq: INoteSequence, stepsPerQuarter: number): INoteSequence;
  };
}

// ── Lazy-loaded Magenta singleton ──

let magentaPromise: Promise<MagentaMusic> | null = null;

function loadMagenta(): Promise<MagentaMusic> {
  if (!magentaPromise) {
    magentaPromise = import("@magenta/music" as string).then(
      (mod) => mod.default ?? mod,
    ) as Promise<MagentaMusic>;
  }
  return magentaPromise;
}

// ── Model checkpoints ──

const DRUMS_CHECKPOINT =
  "https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/drum_kit_rnn";
const MELODY_CHECKPOINT =
  "https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/basic_rnn";

// ── Drum seed (kick + snare + hihat) ──

const DRUM_SEED: INoteSequence = {
  ticksPerQuarter: 220,
  totalQuantizedSteps: 4,
  quantizationInfo: { stepsPerQuarter: 4 },
  notes: [
    { pitch: 36, quantizedStartStep: 0, quantizedEndStep: 1, isDrum: true },
    { pitch: 38, quantizedStartStep: 2, quantizedEndStep: 3, isDrum: true },
    { pitch: 42, quantizedStartStep: 1, quantizedEndStep: 2, isDrum: true },
    { pitch: 42, quantizedStartStep: 3, quantizedEndStep: 4, isDrum: true },
  ],
};

// ── Melody seed (C major fragment) ──

const MELODY_SEED: INoteSequence = {
  ticksPerQuarter: 220,
  totalQuantizedSteps: 4,
  quantizationInfo: { stepsPerQuarter: 4 },
  notes: [
    { pitch: 60, quantizedStartStep: 0, quantizedEndStep: 1 },
    { pitch: 64, quantizedStartStep: 1, quantizedEndStep: 2 },
    { pitch: 67, quantizedStartStep: 2, quantizedEndStep: 3 },
    { pitch: 72, quantizedStartStep: 3, quantizedEndStep: 4 },
  ],
};

// ── Audio rendering ──

function midiPitchToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/**
 * Render a NoteSequence to a WAV Blob via OfflineAudioContext.
 * Drums: short noise burst + pitched oscillator.
 * Melody: sine/triangle oscillator.
 */
async function renderToWav(
  seq: INoteSequence,
  isDrum: boolean,
  bpm: number,
): Promise<{ blob: Blob; buffer: AudioBuffer }> {
  const stepsPerSecond = (bpm / 60) * 4; // 16th note resolution at stepsPerQuarter=4
  const notes = seq.notes ?? [];
  const totalSteps = seq.totalQuantizedSteps ?? 32;
  const duration = totalSteps / stepsPerSecond + 0.5; // extra tail
  const sampleRate = 44100;

  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate);

  for (const note of notes) {
    const startTime = note.quantizedStartStep / stepsPerSecond;
    const endTime = note.quantizedEndStep / stepsPerSecond;
    const noteDur = Math.max(endTime - startTime, 0.05);

    if (isDrum) {
      // Noise burst for drums
      const bufferSize = Math.ceil(sampleRate * Math.min(noteDur, 0.15));
      const noiseBuffer = ctx.createBuffer(1, bufferSize, sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.4;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.6, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + Math.min(noteDur, 0.15));

      // Pitched click for tonal drums
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(midiPitchToFreq(note.pitch), startTime);
      osc.frequency.exponentialRampToValueAtTime(30, startTime + 0.08);

      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.5, startTime);
      oscGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);

      noise.connect(gain).connect(ctx.destination);
      osc.connect(oscGain).connect(ctx.destination);

      noise.start(startTime);
      noise.stop(startTime + Math.min(noteDur, 0.15));
      osc.start(startTime);
      osc.stop(startTime + 0.1);
    } else {
      // Melody: sine + triangle layered
      const osc1 = ctx.createOscillator();
      osc1.type = "sine";
      osc1.frequency.value = midiPitchToFreq(note.pitch);

      const osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.value = midiPitchToFreq(note.pitch);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
      gain.gain.setValueAtTime(0.3, startTime + noteDur * 0.7);
      gain.gain.linearRampToValueAtTime(0, startTime + noteDur);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(startTime);
      osc1.stop(startTime + noteDur);
      osc2.start(startTime);
      osc2.stop(startTime + noteDur);
    }
  }

  const buffer = await ctx.startRendering();
  const blob = audioBufferToWavBlob(buffer);
  return { blob, buffer };
}

/** Encode AudioBuffer as WAV blob */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, headerSize + dataSize - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channels
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));

  let offset = headerSize;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numCh; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ── Save to DAW samples ──

const DAW_SAMPLES = "/api/v2/daw/samples";

async function saveToDaw(blob: Blob, type: string): Promise<{ saved: boolean; url?: string }> {
  try {
    const fd = new FormData();
    fd.append("file", blob, `midi-${type}-${Date.now()}.wav`);
    fd.append("type", `midi-${type}`);
    const res = await fetch(DAW_SAMPLES, { method: "POST", body: fd });
    if (res.ok) {
      const json = await res.json();
      return { saved: true, url: json.url || json.filename };
    }
  } catch {
    // silent
  }
  return { saved: false };
}

// ── Types ──

type MidiGenState = "idle" | "loading" | "generating" | "rendering" | "done" | "error";

interface MidiResult {
  blobUrl: string;
  blob: Blob;
  saved: boolean;
  type: "drums" | "melody";
}

// ── Main Component ──

export default function MidiGenerator() {
  // Drums state
  const [drumTemp, setDrumTemp] = useState(1.0);
  const [drumSteps, setDrumSteps] = useState(32);
  const [drumState, setDrumState] = useState<MidiGenState>("idle");
  const [drumResult, setDrumResult] = useState<MidiResult | null>(null);

  // Melody state
  const [melTemp, setMelTemp] = useState(1.0);
  const [melSteps, setMelSteps] = useState(64);
  const [melState, setMelState] = useState<MidiGenState>("idle");
  const [melResult, setMelResult] = useState<MidiResult | null>(null);

  const [bpm, setBpm] = useState(120);
  const [error, setError] = useState("");

  // Playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Model refs
  const drumsRnnRef = useRef<MusicRNN | null>(null);
  const melodyRnnRef = useRef<MusicRNN | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      drumsRnnRef.current?.dispose();
      melodyRnnRef.current?.dispose();
    };
  }, []);

  // ── Generate drums ──
  const generateDrums = useCallback(async () => {
    setDrumState("loading");
    setError("");
    try {
      const mm = await loadMagenta();
      setDrumState("generating");

      if (!drumsRnnRef.current) {
        drumsRnnRef.current = new mm.MusicRNN(DRUMS_CHECKPOINT);
        await drumsRnnRef.current.initialize();
      }

      const seq = await drumsRnnRef.current.continueSequence(DRUM_SEED, drumSteps, drumTemp);
      setDrumState("rendering");

      const { blob } = await renderToWav(seq, true, bpm);
      const blobUrl = URL.createObjectURL(blob);

      // Save to DAW
      const { saved } = await saveToDaw(blob, "drums");

      setDrumResult({ blobUrl, blob, saved, type: "drums" });
      setDrumState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Drum generation failed");
      setDrumState("error");
    }
  }, [drumTemp, drumSteps, bpm]);

  // ── Generate melody ──
  const generateMelody = useCallback(async () => {
    setMelState("loading");
    setError("");
    try {
      const mm = await loadMagenta();
      setMelState("generating");

      if (!melodyRnnRef.current) {
        melodyRnnRef.current = new mm.MusicRNN(MELODY_CHECKPOINT);
        await melodyRnnRef.current.initialize();
      }

      const seq = await melodyRnnRef.current.continueSequence(MELODY_SEED, melSteps, melTemp);
      setMelState("rendering");

      const { blob } = await renderToWav(seq, false, bpm);
      const blobUrl = URL.createObjectURL(blob);

      const { saved } = await saveToDaw(blob, "melody");

      setMelResult({ blobUrl, blob, saved, type: "melody" });
      setMelState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Melody generation failed");
      setMelState("error");
    }
  }, [melTemp, melSteps, bpm]);

  // ── Playback ──
  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(false);
  }, []);

  const playResult = useCallback(
    (result: MidiResult) => {
      stopPlayback();
      const audio = new Audio(result.blobUrl);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.play();
      setPlaying(true);
    },
    [stopPlayback],
  );

  // ── Download WAV ──
  const downloadWav = useCallback((result: MidiResult) => {
    const a = document.createElement("a");
    a.href = result.blobUrl;
    a.download = `magenta-${result.type}-${Date.now()}.wav`;
    a.click();
  }, []);

  const stateLabel = (s: MidiGenState) => {
    switch (s) {
      case "loading":
        return "LOADING MODEL...";
      case "generating":
        return "GENERATING...";
      case "rendering":
        return "RENDERING WAV...";
      default:
        return "GENERATE";
    }
  };

  const isBusy = (s: MidiGenState) => s === "loading" || s === "generating" || s === "rendering";

  return (
    <div className="ai-midi-container">
      {/* Shared BPM */}
      <label className="ai-ctrl ai-midi-bpm">
        <span className="ai-ctrl-label">BPM</span>
        <input
          type="range"
          min={60}
          max={200}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
        />
        <span className="ai-ctrl-value">{bpm}</span>
      </label>

      {/* ── DRUMS ── */}
      <div className="ai-midi-section">
        <div className="ai-midi-section-title">DRUMS RNN</div>
        <div className="ai-midi-controls">
          <label className="ai-ctrl">
            <span className="ai-ctrl-label">TEMP</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={drumTemp}
              onChange={(e) => setDrumTemp(Number(e.target.value))}
            />
            <span className="ai-ctrl-value">{drumTemp.toFixed(2)}</span>
          </label>
          <label className="ai-ctrl">
            <span className="ai-ctrl-label">STEPS</span>
            <input
              type="range"
              min={8}
              max={64}
              step={4}
              value={drumSteps}
              onChange={(e) => setDrumSteps(Number(e.target.value))}
            />
            <span className="ai-ctrl-value">{drumSteps}</span>
          </label>
          <button
            className="ai-midi-gen-btn"
            disabled={isBusy(drumState)}
            onClick={generateDrums}
          >
            {stateLabel(drumState)}
          </button>
        </div>

        {drumResult && (
          <div className="ai-midi-result">
            <button className="ai-midi-play-btn" onClick={() => (playing ? stopPlayback() : playResult(drumResult))}>
              {playing ? "STOP" : "PLAY"}
            </button>
            <audio controls src={drumResult.blobUrl} />
            <button className="ai-midi-dl-btn" onClick={() => downloadWav(drumResult)}>
              DL WAV
            </button>
            <span className="ai-midi-saved">{drumResult.saved ? "SAVED" : "PREVIEW"}</span>
          </div>
        )}
      </div>

      {/* ── MELODY ── */}
      <div className="ai-midi-section">
        <div className="ai-midi-section-title">MELODY RNN</div>
        <div className="ai-midi-controls">
          <label className="ai-ctrl">
            <span className="ai-ctrl-label">TEMP</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={melTemp}
              onChange={(e) => setMelTemp(Number(e.target.value))}
            />
            <span className="ai-ctrl-value">{melTemp.toFixed(2)}</span>
          </label>
          <label className="ai-ctrl">
            <span className="ai-ctrl-label">STEPS</span>
            <input
              type="range"
              min={16}
              max={128}
              step={8}
              value={melSteps}
              onChange={(e) => setMelSteps(Number(e.target.value))}
            />
            <span className="ai-ctrl-value">{melSteps}</span>
          </label>
          <button
            className="ai-midi-gen-btn"
            disabled={isBusy(melState)}
            onClick={generateMelody}
          >
            {stateLabel(melState)}
          </button>
        </div>

        {melResult && (
          <div className="ai-midi-result">
            <button className="ai-midi-play-btn" onClick={() => (playing ? stopPlayback() : playResult(melResult))}>
              {playing ? "STOP" : "PLAY"}
            </button>
            <audio controls src={melResult.blobUrl} />
            <button className="ai-midi-dl-btn" onClick={() => downloadWav(melResult)}>
              DL WAV
            </button>
            <span className="ai-midi-saved">{melResult.saved ? "SAVED" : "PREVIEW"}</span>
          </div>
        )}
      </div>

      {error && <div className="ai-midi-error">ERR: {error}</div>}

      <style>{`
        .ai-midi-container {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .ai-midi-bpm input[type="range"] {
          accent-color: #00bcd4;
          width: 120px;
        }

        .ai-midi-section {
          background: #0d0d1a;
          border: 1px solid #00bcd433;
          border-radius: 3px;
          padding: 0.6rem 0.8rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .ai-midi-section-title {
          color: #00bcd4;
          font-size: 1rem;
          letter-spacing: 2px;
          opacity: 0.8;
        }

        .ai-midi-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem 1rem;
          align-items: center;
        }

        .ai-midi-controls .ai-ctrl input[type="range"] {
          accent-color: #00bcd4;
          width: 90px;
        }

        .ai-midi-gen-btn {
          background: #0a1a1f;
          color: #00bcd4;
          border: 1px solid #00bcd4;
          padding: 4px 14px;
          font-family: 'VT323', monospace;
          font-size: 1rem;
          letter-spacing: 2px;
          cursor: pointer;
          transition: background 0.15s;
        }

        .ai-midi-gen-btn:hover:not(:disabled) {
          background: #00bcd422;
        }

        .ai-midi-gen-btn:disabled {
          opacity: 0.5;
          cursor: wait;
        }

        .ai-midi-result {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .ai-midi-result audio {
          height: 28px;
          flex: 1;
          min-width: 150px;
        }

        .ai-midi-play-btn,
        .ai-midi-dl-btn {
          background: #0d0d1a;
          color: #00bcd4;
          border: 1px solid #00bcd466;
          padding: 2px 10px;
          font-family: 'VT323', monospace;
          font-size: 0.9rem;
          letter-spacing: 1px;
          cursor: pointer;
        }

        .ai-midi-play-btn:hover,
        .ai-midi-dl-btn:hover {
          background: #00bcd422;
        }

        .ai-midi-saved {
          font-size: 0.8rem;
          color: #44cc44;
          letter-spacing: 1px;
        }

        .ai-midi-error {
          color: #ff4444;
          font-size: 0.9rem;
          padding: 0.3rem 0;
        }

        @media (max-width: 600px) {
          .ai-midi-controls {
            flex-direction: column;
            align-items: stretch;
          }
          .ai-midi-controls .ai-ctrl input[type="range"] {
            width: 100%;
            flex: 1;
          }
          .ai-midi-result {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
