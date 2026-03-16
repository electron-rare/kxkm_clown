import { useRef, useCallback, useEffect } from "react";

export function useMinitelSounds() {
  const ctxRef = useRef<AudioContext | null>(null);
  const mountedRef = useRef(true);
  const timerRefs = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  function getCtx(): AudioContext {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }

  function trackTimeout(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      timerRefs.current.delete(id);
      if (mountedRef.current) fn();
    }, ms);
    timerRefs.current.add(id);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timerRefs.current.forEach((id) => clearTimeout(id));
      timerRefs.current.clear();
      if (ctxRef.current) {
        try { ctxRef.current.close(); } catch {}
        ctxRef.current = null;
      }
    };
  }, []);

  const beep = useCallback((freq = 800, duration = 0.05) => {
    if (!mountedRef.current) return;
    try {
      const ctx = getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {}
  }, []);

  const keyPress = useCallback(() => beep(1200, 0.03), [beep]);
  const send = useCallback(() => {
    if (!mountedRef.current) return;
    beep(800, 0.05);
    trackTimeout(() => beep(1000, 0.05), 60);
  }, [beep]);
  const receive = useCallback(() => beep(600, 0.08), [beep]);
  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    beep(1000, 0.1);
    trackTimeout(() => beep(1200, 0.1), 150);
    trackTimeout(() => beep(800, 0.15), 350);
  }, [beep]);

  return { keyPress, send, receive, connect };
}
