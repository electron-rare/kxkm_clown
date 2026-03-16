import { useRef, useCallback } from "react";

export function useMinitelSounds() {
  const ctxRef = useRef<AudioContext | null>(null);

  function getCtx(): AudioContext {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }

  const beep = useCallback((freq = 800, duration = 0.05) => {
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
    beep(800, 0.05);
    setTimeout(() => beep(1000, 0.05), 60);
  }, [beep]);
  const receive = useCallback(() => beep(600, 0.08), [beep]);
  const connect = useCallback(() => {
    beep(1000, 0.1);
    setTimeout(() => beep(1200, 0.1), 150);
    setTimeout(() => beep(800, 0.15), 350);
  }, [beep]);

  return { keyPress, send, receive, connect };
}
