import { useState, useCallback, useRef, memo } from "react";

type STTStatus = "idle" | "loading" | "recording" | "transcribing";

interface BrowserSTTProps {
  onTranscript: (text: string) => void;
}

let pipeline: any = null;
let pipelinePromise: Promise<any> | null = null;

async function getWhisperPipeline() {
  if (pipeline) return pipeline;
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const { pipeline: createPipeline } = await import("@huggingface/transformers");
    pipeline = await createPipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", {
      dtype: "q8",
      device: "wasm",
    });
    return pipeline;
  })();
  return pipelinePromise;
}

export const BrowserSTT = memo(function BrowserSTT({ onTranscript }: BrowserSTTProps) {
  const [status, setStatus] = useState<STTStatus>("idle");
  const [error, setError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    setError("");
    setStatus("loading");
    try {
      await getWhisperPipeline();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setStatus("transcribing");
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const arrayBuffer = await blob.arrayBuffer();
          const audioCtx = new AudioContext({ sampleRate: 16000 });
          const decoded = await audioCtx.decodeAudioData(arrayBuffer);
          const float32 = decoded.getChannelData(0);
          const whisper = await getWhisperPipeline();
          const result = await whisper(float32, { language: "french", task: "transcribe" });
          const text = typeof result === "string" ? result : result?.text || "";
          if (text.trim()) onTranscript(text.trim());
          audioCtx.close();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed");
        }
        setStatus("idle");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
      setStatus("idle");
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return (
    <div className="browser-stt">
      {status === "idle" && (
        <button
          className="stt-btn"
          onClick={startRecording}
          title="Dicter (Whisper local)"
          aria-label="Activer la dictee vocale"
        >
          {"\uD83C\uDF99\uFE0F"}
        </button>
      )}
      {status === "loading" && (
        <button className="stt-btn stt-loading" disabled title="Chargement Whisper...">...</button>
      )}
      {status === "recording" && (
        <button
          className="stt-btn stt-recording"
          onClick={stopRecording}
          title="Arreter l'enregistrement"
          aria-label="Arreter la dictee"
        >
          {"\u23F9"}
        </button>
      )}
      {status === "transcribing" && (
        <button className="stt-btn stt-transcribing" disabled title="Transcription...">
          {"\u23F3"}
        </button>
      )}
      {error && <span className="stt-error" title={error}>!</span>}
    </div>
  );
});
