import { useState, useEffect, useRef, useCallback, memo } from "react";

// Mirror of apps/api/src/composition-store.ts types (no import to avoid circular deps)
export interface TimelineTrack {
  id: string;
  type: "music" | "voice" | "sfx";
  prompt: string;
  style?: string;
  duration: number;
  volume: number;
  startMs: number;
  filePath?: string;
  createdAt: string;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  startMs: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  gain: number;
}

export interface TimelineMarker {
  id: string;
  label: string;
  atMs: number;
  color?: string;
  createdAt: string;
}

export interface TimelineModelV1 {
  version: 1;
  bpm: number;
  timeSignature: [number, number];
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
}

export interface CompositionMeta {
  id: string;
  name: string;
  channel: string;
  nick: string;
  createdAt: string;
  updatedAt: string;
  timeline: TimelineModelV1;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const TRACK_COLORS: Record<string, string> = {
  music: "#c84c0c",
  voice: "#2c6e49",
  sfx: "#7c3aed",
};

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ─── sub-components ─────────────────────────────────────────────────────────

const TimelineRuler = memo(function TimelineRuler({
  totalMs,
  pixelsPerSec,
}: {
  totalMs: number;
  pixelsPerSec: number;
}) {
  const totalSec = Math.ceil(totalMs / 1000);
  const ticks = [];
  for (let s = 0; s <= totalSec; s += 5) {
    ticks.push(
      <div
        key={s}
        className="tl-tick"
        style={{ left: s * pixelsPerSec }}
        aria-hidden="true"
      >
        <span className="tl-tick-label">{fmtMs(s * 1000)}</span>
      </div>
    );
  }
  return (
    <div
      className="tl-ruler"
      style={{ width: totalSec * pixelsPerSec + 64 }}
      aria-label="Timeline ruler"
    >
      {ticks}
    </div>
  );
});

const ClipBlock = memo(function ClipBlock({
  clip,
  track,
  pixelsPerSec,
}: {
  clip: TimelineClip;
  track: TimelineTrack | undefined;
  pixelsPerSec: number;
}) {
  const color = track ? TRACK_COLORS[track.type] ?? "#888" : "#888";
  const left = (clip.startMs / 1000) * pixelsPerSec;
  const width = Math.max(8, (clip.durationMs / 1000) * pixelsPerSec - 2);
  const label = track?.prompt.slice(0, 24) ?? clip.id;
  return (
    <div
      className="tl-clip"
      style={{ left, width, background: color }}
      title={`${label} — gain: ${clip.gain}%`}
      aria-label={label}
    >
      <span className="tl-clip-label">{label}</span>
    </div>
  );
});

const MarkerLine = memo(function MarkerLine({
  marker,
  pixelsPerSec,
  laneHeight,
  trackCount,
}: {
  marker: TimelineMarker;
  pixelsPerSec: number;
  laneHeight: number;
  trackCount: number;
}) {
  const left = (marker.atMs / 1000) * pixelsPerSec;
  const height = laneHeight * Math.max(1, trackCount);
  return (
    <div
      className="tl-marker"
      style={{ left, height, borderColor: marker.color ?? "#ff00ff" }}
      title={`${marker.label} @ ${fmtMs(marker.atMs)}`}
      aria-label={`Marker: ${marker.label}`}
    >
      <span className="tl-marker-label" style={{ color: marker.color ?? "#ff00ff" }}>
        {marker.label}
      </span>
    </div>
  );
});

// ─── Playhead ────────────────────────────────────────────────────────────────

function usePlayback(totalMs: number) {
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const offsetRef = useRef<number>(0);

  const play = useCallback(() => {
    if (posMs >= totalMs) setPosMs(0);
    startRef.current = performance.now();
    offsetRef.current = posMs >= totalMs ? 0 : posMs;
    setPlaying(true);
  }, [posMs, totalMs]);

  const pause = useCallback(() => {
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const seek = useCallback((ms: number) => {
    setPosMs(Math.max(0, Math.min(ms, totalMs)));
    startRef.current = performance.now();
    offsetRef.current = ms;
  }, [totalMs]);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      const next = offsetRef.current + elapsed;
      if (next >= totalMs) {
        setPosMs(totalMs);
        setPlaying(false);
        return;
      }
      setPosMs(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, totalMs]);

  return { playing, posMs, play, pause, seek };
}

// ─── Main component ──────────────────────────────────────────────────────────

interface TimelineViewProps {
  /** Fetch composition from API by ID */
  compositionId?: string;
  /** Or pass data directly */
  timeline?: TimelineModelV1;
  title?: string;
  /** px per second, default 8 */
  pixelsPerSec?: number;
  /** Lane height in px, default 40 */
  laneHeight?: number;
}

export const TimelineView = memo(function TimelineView({
  compositionId,
  timeline: timelineProp,
  title,
  pixelsPerSec = 8,
  laneHeight = 40,
}: TimelineViewProps) {
  const [timeline, setTimeline] = useState<TimelineModelV1 | null>(timelineProp ?? null);
  const [meta, setMeta] = useState<Pick<CompositionMeta, "name" | "bpm" | "timeSignature"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch from API if compositionId provided
  useEffect(() => {
    if (!compositionId) return;
    setLoading(true);
    fetch(`/api/v2/media/compositions/${encodeURIComponent(compositionId)}`)
      .then(r => r.json())
      .then((d: { ok: boolean; data?: CompositionMeta; error?: string }) => {
        if (d.ok && d.data) {
          setTimeline(d.data.timeline);
          setMeta({ name: d.data.name, bpm: d.data.timeline.bpm, timeSignature: d.data.timeline.timeSignature });
        } else {
          setError(d.error ?? "Erreur chargement composition");
        }
      })
      .catch(() => setError("Erreur réseau"))
      .finally(() => setLoading(false));
  }, [compositionId]);

  // Sync direct prop
  useEffect(() => {
    if (timelineProp) setTimeline(timelineProp);
  }, [timelineProp]);

  const totalMs = timeline
    ? Math.max(
        1000,
        ...timeline.clips.map(c => c.startMs + c.durationMs),
        ...timeline.markers.map(m => m.atMs + 2000),
      )
    : 0;

  const { playing, posMs, play, pause, seek } = usePlayback(totalMs);

  const trackMap = new Map<string, TimelineTrack>(
    timeline?.tracks.map(t => [t.id, t]) ?? []
  );

  // Seek on ruler click
  const handleRulerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
      const ms = (x / pixelsPerSec) * 1000;
      seek(ms);
    },
    [pixelsPerSec, seek]
  );

  if (loading) return <div className="tl-loading" aria-live="polite">Chargement…</div>;
  if (error) return <div className="tl-error" role="alert">{error}</div>;
  if (!timeline) return <div className="tl-empty">Aucune timeline disponible</div>;

  const displayTitle = title ?? meta?.name ?? "Timeline";
  const bpm = meta?.bpm ?? timeline.bpm;
  const ts = meta?.timeSignature ?? timeline.timeSignature;
  const totalSec = Math.ceil(totalMs / 1000);
  const containerWidth = totalSec * pixelsPerSec + 64;
  const playheadLeft = (posMs / 1000) * pixelsPerSec;

  return (
    <div className="tl-root" aria-label={`Timeline: ${displayTitle}`}>
      {/* Header */}
      <div className="tl-header">
        <span className="tl-title">{displayTitle}</span>
        <span className="tl-meta">{bpm} BPM · {ts[0]}/{ts[1]}</span>
        <span className="tl-duration">{fmtMs(totalMs)}</span>
      </div>

      {/* Transport */}
      <div className="tl-transport" role="toolbar" aria-label="Lecture">
        <button
          className="tl-btn"
          onClick={playing ? pause : play}
          type="button"
          aria-label={playing ? "Pause" : "Lecture"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          className="tl-btn"
          onClick={() => { pause(); seek(0); }}
          type="button"
          aria-label="Retour début"
        >
          ⏮
        </button>
        <span className="tl-pos" aria-live="polite">{fmtMs(posMs)} / {fmtMs(totalMs)}</span>
      </div>

      {/* Scrollable canvas */}
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-canvas" style={{ width: containerWidth }}>
          {/* Ruler (clickable for seek) */}
          <div
            className="tl-ruler-wrap"
            onClick={handleRulerClick}
            role="slider"
            aria-label="Barre de navigation"
            aria-valuemin={0}
            aria-valuemax={totalMs}
            aria-valuenow={Math.round(posMs)}
          >
            <TimelineRuler totalMs={totalMs} pixelsPerSec={pixelsPerSec} />
          </div>

          {/* Tracks */}
          <div className="tl-lanes" style={{ position: "relative" }}>
            {/* Playhead */}
            <div
              className="tl-playhead"
              style={{ left: playheadLeft, height: laneHeight * Math.max(1, timeline.tracks.length) }}
              aria-hidden="true"
            />

            {/* Markers */}
            {timeline.markers.map(marker => (
              <MarkerLine
                key={marker.id}
                marker={marker}
                pixelsPerSec={pixelsPerSec}
                laneHeight={laneHeight}
                trackCount={timeline.tracks.length}
              />
            ))}

            {timeline.tracks.map((track, i) => {
              const trackClips = timeline.clips.filter(c => c.trackId === track.id);
              const color = TRACK_COLORS[track.type] ?? "#888";
              return (
                <div
                  key={track.id}
                  className="tl-lane"
                  style={{ height: laneHeight }}
                  aria-label={`Piste: ${track.type} — ${track.prompt.slice(0, 40)}`}
                >
                  <div
                    className="tl-lane-label"
                    style={{ borderLeftColor: color }}
                    title={track.prompt}
                  >
                    <span className="tl-lane-type">{track.type.toUpperCase()}</span>
                    <span className="tl-lane-prompt">{track.prompt.slice(0, 18)}</span>
                  </div>
                  <div className="tl-lane-clips" style={{ width: containerWidth }}>
                    {trackClips.map(clip => (
                      <ClipBlock
                        key={clip.id}
                        clip={clip}
                        track={trackMap.get(clip.trackId)}
                        pixelsPerSec={pixelsPerSec}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {timeline.tracks.length === 0 && (
              <div className="tl-empty-tracks" aria-label="Aucune piste">
                Aucune piste — utilisez /comp pour ajouter des pistes
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Marker legend */}
      {timeline.markers.length > 0 && (
        <div className="tl-marker-legend" aria-label="Marqueurs">
          {timeline.markers
            .slice()
            .sort((a, b) => a.atMs - b.atMs)
            .map(m => (
              <button
                key={m.id}
                className="tl-marker-btn"
                style={{ borderColor: m.color ?? "#ff00ff", color: m.color ?? "#ff00ff" }}
                onClick={() => seek(m.atMs)}
                type="button"
                title={`Aller à ${fmtMs(m.atMs)}`}
              >
                {m.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
});

export default TimelineView;
