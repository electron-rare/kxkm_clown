import { useRef, useCallback, useEffect } from "react";
import type { Track, DAWAction } from "./types";

export function usePlayback(tracks: Track[], dispatch: React.Dispatch<DAWAction>) {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainNodesRef = useRef<GainNode[]>([]);
  const startTimeRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(0);
  const playingRef = useRef(false);

  // Decode audio data to AudioBuffers (lazy, cached)
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  async function decodeTrack(track: Track): Promise<AudioBuffer | null> {
    if (!track.audioData) return null;
    const key = String(track.id);
    if (buffersRef.current.has(key)) return buffersRef.current.get(key)!;

    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;

    const binary = atob(track.audioData);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    try {
      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
      buffersRef.current.set(key, buffer);
      return buffer;
    } catch {
      return null;
    }
  }

  // Playhead animation
  function updatePlayhead() {
    if (!playingRef.current || !ctxRef.current) return;
    const pos = offsetRef.current + (ctxRef.current.currentTime - startTimeRef.current);
    dispatch({ type: "SET_POSITION", position: pos });
    rafRef.current = requestAnimationFrame(updatePlayhead);
  }

  const play = useCallback(async (fromPosition?: number) => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") await ctx.resume();

    // Stop any existing playback
    sourcesRef.current.forEach(s => { try { s.stop(); } catch { /* noop */ } });
    sourcesRef.current = [];
    gainNodesRef.current = [];

    const pos = fromPosition ?? offsetRef.current;
    offsetRef.current = pos;
    startTimeRef.current = ctx.currentTime;

    // Create source + gain + panner for each track
    const hasSolo = tracks.some(t => t.solo);

    for (const track of tracks) {
      const buffer = await decodeTrack(track);
      if (!buffer) continue;

      const shouldPlay = !track.muted && (!hasSolo || track.solo);

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gain = ctx.createGain();
      gain.gain.value = shouldPlay ? track.volume / 100 : 0;

      const panner = ctx.createStereoPanner();
      panner.pan.value = track.pan;

      source.connect(gain).connect(panner).connect(ctx.destination);

      // Calculate when this track should start relative to playback position
      const trackStart = track.startOffset - pos;
      if (trackStart >= 0) {
        source.start(ctx.currentTime + trackStart);
      } else {
        // Track already started — play from offset into the track
        const offset = Math.min(-trackStart, buffer.duration);
        if (offset < buffer.duration) {
          source.start(0, offset);
        }
      }

      sourcesRef.current.push(source);
      gainNodesRef.current.push(gain);
    }

    playingRef.current = true;
    dispatch({ type: "SET_PLAYING", playing: true });
    rafRef.current = requestAnimationFrame(updatePlayhead);
  }, [tracks, dispatch]);

  const pause = useCallback(() => {
    if (!ctxRef.current || !playingRef.current) return;
    offsetRef.current += ctxRef.current.currentTime - startTimeRef.current;
    sourcesRef.current.forEach(s => { try { s.stop(); } catch { /* noop */ } });
    sourcesRef.current = [];
    playingRef.current = false;
    cancelAnimationFrame(rafRef.current);
    dispatch({ type: "SET_PLAYING", playing: false });
  }, [dispatch]);

  const stop = useCallback(() => {
    sourcesRef.current.forEach(s => { try { s.stop(); } catch { /* noop */ } });
    sourcesRef.current = [];
    playingRef.current = false;
    offsetRef.current = 0;
    cancelAnimationFrame(rafRef.current);
    dispatch({ type: "SET_PLAYING", playing: false });
    dispatch({ type: "SET_POSITION", position: 0 });
  }, [dispatch]);

  const seek = useCallback((position: number) => {
    offsetRef.current = position;
    dispatch({ type: "SET_POSITION", position });
    if (playingRef.current) {
      play(position);
    }
  }, [play, dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sourcesRef.current.forEach(s => { try { s.stop(); } catch { /* noop */ } });
      cancelAnimationFrame(rafRef.current);
      ctxRef.current?.close();
    };
  }, []);

  return { play, pause, stop, seek };
}
