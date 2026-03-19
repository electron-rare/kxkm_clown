import { useState, useRef, useEffect } from "react";
import { useMinitelSounds } from "./useMinitelSounds";
import { resolveWebSocketUrl } from "../lib/websocket-url";

export interface UseGenerationCommandOptions {
  /** Message type to match in WS responses (e.g. "music", "image") */
  responseType: string;
  /** Extract result data from a matched WS message */
  extractResult: (msg: Record<string, unknown>) => Record<string, unknown> | null;
  /** Error substring to match in system messages */
  errorMatch: string;
  /** Simulated progress speed: interval ms between ticks */
  progressInterval?: number;
  /** Simulated progress increment per tick */
  progressStep?: number;
  /** Max results to keep */
  maxResults?: number;
}

export function useGenerationCommand<T extends Record<string, unknown>>(
  opts: UseGenerationCommandOptions,
) {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<T[]>([]);
  const [error, setError] = useState("");
  const sounds = useMinitelSounds();
  const wsRef = useRef<WebSocket | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsUrl = resolveWebSocketUrl();

  const maxResults = opts.maxResults ?? 20;
  const interval = opts.progressInterval ?? 200;
  const step = opts.progressStep ?? 3;

  // Close WS on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Simulated progress bar
  useEffect(() => {
    if (generating) {
      setProgress(0);
      progressRef.current = setInterval(() => {
        setProgress((p) => Math.min(p + step * (0.5 + Math.random()), 92));
      }, interval);
    } else {
      if (progressRef.current) clearInterval(progressRef.current);
      if (progress > 0) {
        setProgress(100);
        setTimeout(() => setProgress(0), 700);
      }
    }
    return () => {
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, [generating]);

  function getWs(): WebSocket | null {
    if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as Record<string, unknown>;
        if (msg.type === opts.responseType) {
          const extracted = opts.extractResult(msg);
          if (extracted) {
            setResults((prev) => [extracted as T, ...prev].slice(0, maxResults));
            setGenerating(false);
            sounds.receive();
          }
        }
        if (
          msg.type === "system" &&
          typeof msg.text === "string" &&
          msg.text.includes(opts.errorMatch)
        ) {
          setError(msg.text);
          setGenerating(false);
        }
      } catch {}
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
    return ws;
  }

  function send(command: string) {
    const ws = getWs();
    const payload = JSON.stringify({ type: "command", text: command });

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ws?.addEventListener("open", () => ws.send(payload), { once: true });
    } else {
      ws.send(payload);
    }

    setGenerating(true);
    setError("");
    sounds.send();
  }

  return { generating, progress, results, setResults, error, send };
}
