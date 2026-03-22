import { useState, useRef, useCallback, useEffect } from "react";
import { VideotexPageHeader } from "./VideotexMosaic";

type VisualMode = "waveform" | "spectrum" | "particles" | "tunnel" | "kaleidoscope";
type ColorTheme = "green" | "amber" | "pink" | "cyan" | "rainbow";

const THEMES: Record<ColorTheme, string[]> = {
  green: ["#33ff33", "#00cc00", "#009900"],
  amber: ["#ffb300", "#ff8f00", "#ff6f00"],
  pink: ["#ff69b4", "#ff1493", "#c71585"],
  cyan: ["#00ffff", "#00bcd4", "#0097a7"],
  rainbow: ["#f44", "#ff9800", "#ffeb3b", "#4caf50", "#2196f3", "#9c27b0"],
};

export default function VisualSynth() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<VisualMode>("spectrum");
  const [theme, setTheme] = useState<ColorTheme>("green");
  const [fullscreen, setFullscreen] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const modeRef = useRef(mode);
  const themeRef = useRef(theme);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Keep refs in sync so the render loop always sees current values
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  // Simple BPM detection via peak intervals
  const peakTimesRef = useRef<number[]>([]);
  const lastPeakRef = useRef(0);

  function detectBPM(freqArray: Uint8Array) {
    const bass = freqArray.slice(0, 8);
    const avg = bass.reduce((a, b) => a + b, 0) / bass.length;
    const now = performance.now();
    if (avg > 180 && now - lastPeakRef.current > 200) {
      lastPeakRef.current = now;
      peakTimesRef.current.push(now);
      if (peakTimesRef.current.length > 20) peakTimesRef.current.shift();
      if (peakTimesRef.current.length > 4) {
        const intervals: number[] = [];
        for (let i = 1; i < peakTimesRef.current.length; i++) {
          intervals.push(peakTimesRef.current[i] - peakTimesRef.current[i - 1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const detected = Math.round(60000 / avgInterval);
        if (detected > 40 && detected < 220) setBpm(detected);
      }
    }
  }

  const startMic = useCallback(async () => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.current = analyser;
    setActive(true);
    peakTimesRef.current = [];
    setBpm(null);
    startDraw();
  }, []);

  const loadFile = useCallback(async (file: File) => {
    stop();
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.loop = true;
    audioElRef.current = audio;
    const source = ctx.createMediaElementSource(audio);
    sourceRef.current = source;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;
    await audio.play();
    setActive(true);
    peakTimesRef.current = [];
    setBpm(null);
    startDraw();
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    sourceRef.current = null;
    ctxRef.current?.close();
    ctxRef.current = null;
    analyserRef.current = null;
    setActive(false);
    setBpm(null);
  }, []);

  function startDraw() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const g = canvas.getContext("2d")!;
    const bufLen = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufLen);
    const freqArray = new Uint8Array(bufLen);

    const render = () => {
      const W = canvas.width = canvas.offsetWidth;
      const H = canvas.height = canvas.offsetHeight;
      const colors = THEMES[themeRef.current] || THEMES.green;
      const currentMode = modeRef.current;

      analyser.getByteTimeDomainData(dataArray);
      analyser.getByteFrequencyData(freqArray);

      detectBPM(freqArray);

      // Fade trail
      g.fillStyle = "rgba(0,0,0,0.15)";
      g.fillRect(0, 0, W, H);

      switch (currentMode) {
        case "waveform": {
          g.lineWidth = 2;
          g.strokeStyle = colors[0];
          g.beginPath();
          for (let i = 0; i < bufLen; i++) {
            const x = (i / bufLen) * W;
            const y = (dataArray[i] / 255) * H;
            i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
          }
          g.stroke();
          break;
        }
        case "spectrum": {
          const barW = W / bufLen * 2.5;
          for (let i = 0; i < bufLen; i++) {
            const barH = (freqArray[i] / 255) * H;
            const colorIdx = Math.floor((i / bufLen) * colors.length) % colors.length;
            g.fillStyle = colors[colorIdx];
            g.fillRect(i * barW, H - barH, barW - 1, barH);
          }
          break;
        }
        case "particles": {
          const avg = freqArray.reduce((a, b) => a + b, 0) / bufLen;
          const count = Math.floor(avg / 5);
          for (let i = 0; i < count; i++) {
            const x = Math.random() * W;
            const y = Math.random() * H;
            const r = (avg / 255) * 8 + Math.random() * 3;
            g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
            g.beginPath();
            g.arc(x, y, r, 0, Math.PI * 2);
            g.fill();
          }
          break;
        }
        case "tunnel": {
          const avg = freqArray.reduce((a, b) => a + b, 0) / bufLen;
          const cx = W / 2, cy = H / 2;
          for (let r = 5; r < Math.max(W, H); r += 15) {
            const intensity = freqArray[Math.floor((r / W) * bufLen)] || 0;
            g.strokeStyle = colors[Math.floor((r / W) * colors.length) % colors.length];
            g.lineWidth = (intensity / 255) * 4;
            g.beginPath();
            g.arc(cx, cy, r + (avg / 255) * 20, 0, Math.PI * 2);
            g.stroke();
          }
          break;
        }
        case "kaleidoscope": {
          const cx = W / 2, cy = H / 2;
          const segments = 8;
          g.save();
          g.translate(cx, cy);
          for (let s = 0; s < segments; s++) {
            g.rotate((Math.PI * 2) / segments);
            for (let i = 0; i < 20; i++) {
              const freq = freqArray[i * 4] || 0;
              const dist = (freq / 255) * Math.min(W, H) * 0.4;
              const size = (freq / 255) * 6 + 1;
              g.fillStyle = colors[i % colors.length];
              g.fillRect(dist, i * 5, size, size);
            }
          }
          g.restore();
          break;
        }
      }

      rafRef.current = requestAnimationFrame(render);
    };
    render();
  }

  // Cleanup on unmount
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); ctxRef.current?.close(); }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`vsynth ${fullscreen ? "vsynth-fullscreen" : ""}`}>
      {!fullscreen && <VideotexPageHeader title="VISUAL SYNTH" subtitle="Audio → Visuals" color="pink" />}

      <div className="vsynth-toolbar">
        <button className={`vsynth-toggle ${active ? "vsynth-active" : ""}`} onClick={active ? stop : startMic}>
          {active ? "STOP" : "MIC"}
        </button>
        <button className="vsynth-toggle" onClick={() => fileInputRef.current?.click()}>
          FICHIER
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
        />
        <select className="vsynth-select" value={mode} onChange={e => setMode(e.target.value as VisualMode)}>
          <option value="waveform">WAVEFORM</option>
          <option value="spectrum">SPECTRUM</option>
          <option value="particles">PARTICLES</option>
          <option value="tunnel">TUNNEL</option>
          <option value="kaleidoscope">KALEIDOSCOPE</option>
        </select>
        <select className="vsynth-select" value={theme} onChange={e => setTheme(e.target.value as ColorTheme)}>
          <option value="green">GREEN</option>
          <option value="amber">AMBER</option>
          <option value="pink">PINK</option>
          <option value="cyan">CYAN</option>
          <option value="rainbow">RAINBOW</option>
        </select>
        {bpm && <span className="vsynth-bpm">{bpm} BPM</span>}
        <button className="vsynth-fullscreen-btn" onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? "X" : "[ ]"}
        </button>
      </div>

      <canvas ref={canvasRef} className="vsynth-canvas" />
    </div>
  );
}
