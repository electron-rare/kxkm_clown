import React, { useState, useEffect, useRef, useCallback } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useMinitelSounds } from "../hooks/useMinitelSounds";

const WS_URL = import.meta.env.VITE_WS_URL || (() => {
  if (typeof window === "undefined") return "ws://127.0.0.1:4180/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
})();

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

const MAX_VOICE_HISTORY = 20;
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

  const audioQueueRef = useRef<Array<{ nick: string; data: string; mime: string }>>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeRef = useRef(volume);
  const historyEndRef = useRef<HTMLDivElement>(null);

  const sounds = useMinitelSounds();

  // Keep volume ref in sync
  useEffect(() => {
    volumeRef.current = volume;
    if (currentAudioRef.current) {
      currentAudioRef.current.volume = volume;
    }
    try { localStorage.setItem("kxkm_voice_volume", String(volume)); } catch {}
  }, [volume]);

  // Auto-scroll history
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
    audio.onended = () => {
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      setActiveSpeaker(null);
      playNext();
    };
    audio.onerror = () => {
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      setActiveSpeaker(null);
      playNext();
    };
    audio.play().catch(() => {
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      setActiveSpeaker(null);
      playNext();
    });
  }, []);

  const enqueueAudio = useCallback((nick: string, data: string, mime: string) => {
    audioQueueRef.current.push({ nick, data, mime });
    playNext();
  }, [playNext]);

  // Replay a history entry
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

  // WebSocket message handler
  const handleMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    const type = msg.type as string;

    switch (type) {
      case "persona":
        if (typeof msg.nick === "string" && typeof msg.color === "string") {
          const color = msg.color as string;
          if (/^#[0-9a-fA-F]{3,8}$|^[a-z]{3,20}$/i.test(color)) {
            setPersonaColors((prev) => ({ ...prev, [msg.nick as string]: color }));
          }
        }
        return;

      case "audio": {
        if (typeof msg.data === "string" && typeof msg.mimeType === "string") {
          const nick = typeof msg.nick === "string" ? msg.nick : "???";
          // Add to history
          addToHistory({
            nick,
            text: "\u266B message vocal",
            isUser: false,
            hasAudio: true,
            audioData: msg.data as string,
            audioMime: msg.mimeType as string,
          });
          // Auto-play (voice chat always plays)
          enqueueAudio(nick, msg.data as string, msg.mimeType as string);
          setWaitingResponse(false);
        }
        return;
      }

      case "message": {
        const nick = typeof msg.nick === "string" ? msg.nick : undefined;
        const text = typeof msg.text === "string" ? msg.text : "";
        if (nick && personaColors[nick]) {
          // Persona text message
          addToHistory({
            nick,
            text,
            isUser: false,
            hasAudio: false,
          });
          setWaitingResponse(false);
          sounds.receive();
        }
        return;
      }

      case "system": {
        const text = typeof msg.text === "string" ? msg.text : "";
        if (text.includes("est en train d'ecrire") || text.includes("est en train d\u2019ecrire")) {
          setWaitingResponse(true);
          // Extract persona name from "X est en train d'ecrire..."
          const match = text.match(/^(.+?) est en train/);
          if (match) {
            setActiveSpeaker(match[1]);
          }
        }
        return;
      }

      case "uploadCapability":
      case "userlist":
      case "channelInfo":
      case "join":
      case "part":
        // Silently handled
        return;

      default:
        return;
    }
  }, [personaColors, enqueueAudio, addToHistory, sounds]);

  const ws = useWebSocket({
    url: WS_URL,
    onMessage: handleMessage,
    enabled: true,
  });

  // Recording controls
  function toggleRecording() {
    if (isRecording) {
      // Stop recording
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecordingDuration(0);
    } else {
      // Start recording
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/wav";
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: mimeType });
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            if (ws.connected) {
              ws.send({
                type: "upload",
                filename: `voice-${Date.now()}.webm`,
                mimeType,
                size: blob.size,
                data: base64,
              });
              setTranscript("Transcription en cours...");
              setWaitingResponse(true);
              sounds.send();

              // Add user entry to history
              addToHistory({
                nick: "toi",
                text: "\u266B message vocal envoye",
                isUser: true,
                hasAudio: false,
              });
            }
          };
          reader.readAsDataURL(blob);
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
        setIsRecording(true);
        setRecordingDuration(0);
        setTranscript("");
        const start = Date.now();
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration(Math.floor((Date.now() - start) / 1000));
        }, 500);
      }).catch(() => {
        // Microphone permission denied or unavailable
      });
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current?.stop();
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
  }, []);

  const volumePercent = Math.round(volume * 100);

  return (
    <div className="voice-chat">
      {/* Header */}
      <div className="voice-chat-header">
        <span>3615 KXKM &mdash; CHAT VOCAL</span>
        <span className={`voice-status ${ws.connected ? "voice-status-on" : "voice-status-off"}`}>
          {ws.connected ? "\u25CF connecte" : "\u25CB deconnecte"}
        </span>
      </div>

      {/* Active speaker zone */}
      <div className={`voice-active-speaker${activeSpeaker ? " speaking" : ""}`}>
        {activeSpeaker ? (
          <>
            <div className="voice-speaker-label">Persona qui parle</div>
            <div className="voice-speaker-name"
              style={personaColors[activeSpeaker] ? { color: personaColors[activeSpeaker] } : undefined}
            >
              &gt;&gt;&gt; {activeSpeaker.toUpperCase()} &lt;&lt;&lt;
            </div>
          </>
        ) : waitingResponse ? (
          <div className="voice-thinking">Reflexion en cours...</div>
        ) : (
          <div className="voice-speaker-idle">En attente</div>
        )}
      </div>

      {/* Transcript zone */}
      <div className="voice-transcript">
        {isRecording ? (
          <span className="voice-recording-text">Enregistrement... {recordingDuration}s</span>
        ) : transcript ? (
          <span>{transcript}</span>
        ) : (
          <span className="voice-transcript-placeholder">
            Appuyez sur le micro pour parler
          </span>
        )}
      </div>

      {/* Big mic button */}
      <button
        className={`voice-mic-btn${isRecording ? " recording" : ""}`}
        onClick={toggleRecording}
        disabled={!ws.connected}
        title={isRecording ? "Arreter l'enregistrement" : "Appuyer pour parler"}
      >
        {isRecording ? "\u25A0" : "\u25CF"}
      </button>
      <div className="voice-mic-label">
        {!ws.connected
          ? "Connexion..."
          : isRecording
            ? "STOP"
            : "PARLER"}
      </div>

      {/* Volume slider */}
      <div className="voice-volume">
        <span>{volumePercent === 0 ? "\uD83D\uDD07" : "\uD83D\uDD0A"}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
        />
        <span>{volumePercent}%</span>
      </div>

      {/* Voice history */}
      <div className="voice-history">
        <div className="voice-history-title">Historique vocal (derniers echanges)</div>
        {voiceHistory.length === 0 && (
          <div className="voice-history-empty">Aucun echange pour l'instant</div>
        )}
        {voiceHistory.map((entry) => (
          <div key={entry.id} className="voice-history-entry">
            <span className={`voice-nick ${entry.isUser ? "voice-nick-user" : "voice-nick-persona"}`}
              style={!entry.isUser && personaColors[entry.nick] ? { color: personaColors[entry.nick] } : undefined}
            >
              [{entry.nick}]
            </span>{" "}
            {entry.hasAudio && (
              <span
                className="voice-audio-icon"
                onClick={() => replayAudio(entry)}
                title="Rejouer"
              >
                &#9835;{" "}
              </span>
            )}
            <span className="voice-entry-text">
              {entry.text.length > 80 ? entry.text.slice(0, 80) + "..." : entry.text}
            </span>
          </div>
        ))}
        <div ref={historyEndRef} />
      </div>
    </div>
  );
}
