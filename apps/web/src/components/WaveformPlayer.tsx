import { useRef, useEffect, useCallback, useState, memo } from "react";
import WaveSurfer from "wavesurfer.js";

interface WaveformPlayerProps {
  src: string;
  label?: string;
  color?: string;
}

export const WaveformPlayer = memo(function WaveformPlayer({ src, label, color }: WaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color || "#39ff14",
      progressColor: color ? `${color}88` : "#39ff1488",
      cursorColor: "#ff00ff",
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      height: 32,
      normalize: true,
      backend: "WebAudio",
    });
    ws.load(src);
    ws.on("ready", () => setDuration(ws.getDuration()));
    ws.on("audioprocess", () => setCurrentTime(ws.getCurrentTime()));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => { setPlaying(false); setCurrentTime(0); });
    wsRef.current = ws;
    return () => { ws.destroy(); wsRef.current = null; };
  }, [src, color]);

  const toggle = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="waveform-player" aria-label={label || "Audio"}>
      <button className="waveform-btn" onClick={toggle} type="button">
        {playing ? "⏸" : "▶"}
      </button>
      <div className="waveform-wave" ref={containerRef} />
      <span className="waveform-time">
        {fmtTime(currentTime)}/{fmtTime(duration)}
      </span>
    </div>
  );
});
