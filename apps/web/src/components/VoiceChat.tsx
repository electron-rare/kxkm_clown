import React, { useState, useEffect, useRef, useCallback } from "react";
import { getPersonaColor } from "@kxkm/ui";
import { useWebSocket } from "../hooks/useWebSocket";
import { useMinitelSounds } from "../hooks/useMinitelSounds";
import { resolveWebSocketUrl } from "../lib/websocket-url";
import { VideotexPageHeader } from "./VideotexMosaic";

function buildWsUrl(): string {
  const base = resolveWebSocketUrl();
  const nick = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("kxkm-nick") : null;
  if (!nick) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}nick=${encodeURIComponent(nick)}`;
}

interface VoiceEntry {
  id: number;
  nick: string;
  text: string;
  isUser: boolean;
  hasAudio: boolean;
  audioData?: string;
  audioMime?: string;
  timestamp: number;
}

interface PersonaColor {
  [nick: string]: string;
}

const MAX_VOICE_HISTORY = 30;
const SILENCE_TIMEOUT_MS = 2000;
let entryIdCounter = 0;

export default function VoiceChat() {
  const [isRecording, setIsRecording] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [waitingResponse, setWaitingResponse] = useState(false);
  const [volume, setVolume] = useState(() => {
    try {
      const stored = localStorage.getItem("kxkm_voice_volume");
      return stored !== null ? parseFloat(stored) : 0.8;
    } catch { return 0.8; }
  });
  const [voiceHistory, setVoiceHistory] = useState<VoiceEntry[]>([]);
  const [personaColors, setPersonaColors] = useState<PersonaColor>({});
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const audioQueueRef = useRef<Array<{ nick: string; data: string; mime: string }>>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const levelAnimRef = useRef<number>(0);
  const volumeRef = useRef(volume);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  const userNick = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("kxkm-nick") || "moi" : "moi";
  const sounds = useMinitelSounds();

  useEffect(() => {
    volumeRef.current = volume;
    if (currentAudioRef.current) currentAudioRef.current.volume = volume;
    try { localStorage.setItem("kxkm_voice_volume", String(volume)); } catch {}
  }, [volume]);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [voiceHistory]);

  // Audio queue management
  const playNext = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    const { nick, data, mime } = audioQueueRef.current.shift()!;
    setActiveSpeaker(nick);

    const audio = new Audio(`data:${mime};base64,${data}`);
    audio.volume = volumeRef.current;
    currentAudioRef.current = audio;
    const cleanup = () => {
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      setActiveSpeaker(null);
      playNext();
    };
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    audio.play().catch(cleanup);
  }, []);

  const enqueueAudio = useCallback((nick: string, data: string, mime: string) => {
    if (audioQueueRef.current.length >= 10) audioQueueRef.current.shift();
    audioQueueRef.current.push({ nick, data, mime });
    playNext();
  }, [playNext]);

  const replayAudio = useCallback((entry: VoiceEntry) => {
    if (entry.audioData && entry.audioMime) {
      enqueueAudio(entry.nick, entry.audioData, entry.audioMime);
    }
  }, [enqueueAudio]);

  const addToHistory = useCallback((entry: Omit<VoiceEntry, "id" | "timestamp">) => {
    setVoiceHistory((prev) => {
      const next = [...prev, { ...entry, id: ++entryIdCounter, timestamp: Date.now() }];
      return next.length > MAX_VOICE_HISTORY ? next.slice(-MAX_VOICE_HISTORY) : next;
    });
  }, []);

  // Audio level monitoring
  function startLevelMonitor(stream: MediaStream) {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);

    let lastSoundTime = Date.now();

    function tick() {
      if (!mountedRef.current || !analyserRef.current) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const normalized = Math.min(avg / 80, 1);
      setAudioLevel(normalized);

      // Silence detection
      if (normalized > 0.05) {
        lastSoundTime = Date.now();
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else if (!silenceTimerRef.current && Date.now() - lastSoundTime > 500) {
        silenceTimerRef.current = setTimeout(() => {
          // Auto-stop after silence
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
          }
        }, SILENCE_TIMEOUT_MS);
      }

      levelAnimRef.current = requestAnimationFrame(tick);
    }
    tick();
  }

  // WebSocket handler
  const handleMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    switch (msg.type as string) {
      case "persona":
        if (typeof msg.nick === "string") {
          const color = typeof msg.color === "string" && /^#[0-9a-fA-F]{3,8}$|^[a-z]{3,20}$/i.test(msg.color)
            ? msg.color : getPersonaColor(msg.nick);
          setPersonaColors((prev) => ({ ...prev, [msg.nick as string]: color }));
        }
        return;

      case "audio": {
        if (typeof msg.data === "string" && typeof msg.mimeType === "string") {
          const nick = typeof msg.nick === "string" ? msg.nick : "???";
          addToHistory({ nick, text: "\u266B vocal", isUser: false, hasAudio: true, audioData: msg.data as string, audioMime: msg.mimeType as string });
          enqueueAudio(nick, msg.data as string, msg.mimeType as string);
          setWaitingResponse(false);
        }
        return;
      }

      case "message": {
        const nick = typeof msg.nick === "string" ? msg.nick : undefined;
        const text = typeof msg.text === "string" ? msg.text : "";
        if (nick && personaColors[nick]) {
          addToHistory({ nick, text, isUser: false, hasAudio: false });
          setWaitingResponse(false);
          sounds.receive();
        }
        return;
      }

      case "system": {
        const text = typeof msg.text === "string" ? msg.text : "";
        const match = text.match(/^(.+?) est en train/);
        if (match) {
          setWaitingResponse(true);
          setActiveSpeaker(match[1]);
        }
        // Show transcription result
        if (text.includes("[Transcription]") || text.includes("[STT]")) {
          setTranscript(text.replace(/\[.*?\]\s*/, ""));
        }
        return;
      }

      default: return;
    }
  }, [personaColors, enqueueAudio, addToHistory, sounds]);

  const [wsUrl] = useState(buildWsUrl);
  const ws = useWebSocket({ url: wsUrl, onMessage: handleMessage, enabled: true });

  // Recording
  function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/wav";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        cancelAnimationFrame(levelAnimRef.current);
        analyserRef.current = null;
        if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
        setAudioLevel(0);
        if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        setRecordingDuration(0);

        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 1000) return; // too short, skip

        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          if (ws.connected) {
            ws.send({ type: "upload", filename: `voice-${Date.now()}.webm`, mimeType, size: blob.size, data: base64 });
            setTranscript("Transcription...");
            setWaitingResponse(true);
            sounds.send();
            addToHistory({ nick: userNick, text: "\u266B vocal envoye", isUser: true, hasAudio: false });
          }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setTranscript("");
      const start = Date.now();
      recordingTimerRef.current = setInterval(() => setRecordingDuration(Math.floor((Date.now() - start) / 1000)), 500);
      startLevelMonitor(stream);
    }).catch((err) => {
      setTranscript(err.name === "NotAllowedError" ? "Permission micro refusee" : "Erreur micro");
    });
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  // Push-to-talk: mousedown/up + touch
  function onMicDown() { if (!isRecording && ws.connected) startRecording(); }
  function onMicUp() { if (isRecording) stopRecording(); }

  // Cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      cancelAnimationFrame(levelAnimRef.current);
      if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
      if (mediaRecorderRef.current?.state === "recording") {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null; }
      audioQueueRef.current.length = 0;
    };
  }, []);

  // Level bar characters
  const levelBars = Math.floor(audioLevel * 20);
  const levelStr = "\u2588".repeat(levelBars) + "\u2591".repeat(20 - levelBars);

  return (
    <div className="voice-chat">
      <VideotexPageHeader title="CHAT VOCAL" subtitle="Push-to-talk + TTS" color="green" />

      {/* Status bar */}
      <div className="voice-chat-header">
        <span>{userNick}</span>
        <span className={`voice-status ${ws.connected ? "voice-status-on" : "voice-status-off"}`}>
          {ws.connected ? "\u25CF connecte" : "\u25CB deconnecte"}
        </span>
      </div>

      {/* Active speaker */}
      <div className={`voice-active-speaker${activeSpeaker ? " speaking" : ""}`}>
        {activeSpeaker ? (
          <>
            <div className="voice-speaker-label">En train de parler</div>
            <div className="voice-speaker-name"
              style={personaColors[activeSpeaker] ? { color: personaColors[activeSpeaker] } : undefined}
            >
              {">>>"} {activeSpeaker.toUpperCase()} {"<<<"}
            </div>
          </>
        ) : waitingResponse ? (
          <div className="voice-thinking">Reflexion en cours...</div>
        ) : (
          <div className="voice-speaker-idle">Maintenir le micro pour parler</div>
        )}
      </div>

      {/* Audio level + transcript */}
      {isRecording && (
        <div className="voice-level">
          <span className="voice-level-bar">{levelStr}</span>
          <span className="voice-level-time">{recordingDuration}s</span>
        </div>
      )}

      <div className="voice-transcript">
        {transcript ? (
          <span>{transcript}</span>
        ) : (
          <span className="voice-transcript-placeholder">
            {isRecording ? "Parlez maintenant..." : "Relache auto apres 2s de silence"}
          </span>
        )}
      </div>

      {/* Push-to-talk button */}
      <button
        className={`voice-mic-btn${isRecording ? " recording" : ""}`}
        onMouseDown={onMicDown}
        onMouseUp={onMicUp}
        onMouseLeave={onMicUp}
        onTouchStart={onMicDown}
        onTouchEnd={onMicUp}
        disabled={!ws.connected}
        title="Maintenir pour parler"
      >
        {isRecording ? "\u25A0" : "\u25CF"}
      </button>
      <div className="voice-mic-label">
        {!ws.connected ? "Connexion..." : isRecording ? "ENREGISTREMENT" : "MAINTENIR"}
      </div>

      {/* Volume */}
      <div className="voice-volume">
        <span>{volume === 0 ? "\uD83D\uDD07" : "\uD83D\uDD0A"}</span>
        <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} />
        <span>{Math.round(volume * 100)}%</span>
      </div>

      {/* History */}
      <div className="voice-history">
        <div className="voice-history-title">Historique</div>
        {voiceHistory.length === 0 && <div className="voice-history-empty">Aucun echange</div>}
        {voiceHistory.map((entry) => (
          <div key={entry.id} className="voice-history-entry">
            <span className={`voice-nick ${entry.isUser ? "voice-nick-user" : "voice-nick-persona"}`}
              style={!entry.isUser && personaColors[entry.nick] ? { color: personaColors[entry.nick] } : undefined}
            >
              [{entry.nick}]
            </span>{" "}
            {entry.hasAudio && (
              <span className="voice-audio-icon" onClick={() => replayAudio(entry)} title="Rejouer">
                &#9835;{" "}
              </span>
            )}
            <span className="voice-entry-text">
              {entry.text.length > 120 ? entry.text.slice(0, 120) + "..." : entry.text}
            </span>
          </div>
        ))}
        <div ref={historyEndRef} />
      </div>
    </div>
  );
}
