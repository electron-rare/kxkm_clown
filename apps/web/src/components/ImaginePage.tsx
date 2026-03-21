import { useState, useEffect, useRef, useCallback } from "react";
import { useGenerationCommand } from "../hooks/useGenerationCommand";
import { VideotexPageHeader } from "./VideotexMosaic";

interface ImageResult {
  [key: string]: unknown;
  prompt: string;
  imageData?: string;
  imageMime?: string;
  model?: string;
  lora?: string;
  seed?: number;
  elapsed?: number;
}

interface RealProgress {
  step: number;
  totalSteps: number;
  percent: number;
  phase: "queued" | "loading" | "sampling" | "decoding" | "saving" | "done";
  model?: string;
  lora?: string;
  elapsed: number;
}

const PHASE_LABELS: Record<string, string> = {
  queued: "EN FILE",
  loading: "CHARGEMENT MODELE",
  sampling: "ECHANTILLONNAGE",
  decoding: "DECODAGE VAE",
  saving: "SAUVEGARDE",
  done: "TERMINE",
};

const PHASE_ICONS: Record<string, string> = {
  queued: "\u23F3",
  loading: "\u2699\uFE0F",
  sampling: "\u{1F3A8}",
  decoding: "\u{1F5BC}\uFE0F",
  saving: "\u{1F4BE}",
  done: "\u2705",
};

export default function ImaginePage() {
  const [prompt, setPrompt] = useState("");
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [realProgress, setRealProgress] = useState<RealProgress | null>(null);
  const [elapsedTimer, setElapsedTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { generating, progress, results, error, send, getWs } = useGenerationCommand<ImageResult>({
    responseType: "image",
    extractResult: (msg) =>
      msg.imageData
        ? {
            prompt: (msg.text as string) || prompt,
            imageData: msg.imageData as string,
            imageMime: (msg.imageMime as string) || "image/png",
            model: (msg.model as string) || undefined,
            lora: (msg.lora as string) || undefined,
          }
        : null,
    errorMatch: "echoue",
    progressInterval: 200,
    progressStep: 2,
    maxResults: 50,
  });

  // Listen for image_progress messages on WS
  useEffect(() => {
    const ws = getWs();
    if (!ws) return;
    const handler = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "image_progress") {
          setRealProgress({
            step: msg.step,
            totalSteps: msg.totalSteps,
            percent: msg.percent,
            phase: msg.phase,
            model: msg.model,
            lora: msg.lora,
            elapsed: msg.elapsed,
          });
        }
      } catch {}
    };
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [getWs]);

  // Elapsed timer during generation
  useEffect(() => {
    if (generating) {
      setElapsedTimer(0);
      setRealProgress(null);
      timerRef.current = setInterval(() => setElapsedTimer(t => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [generating]);

  // Auto-show newest image
  useEffect(() => {
    if (results.length > 0) setViewIdx(0);
  }, [results.length]);

  const handleImagine = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || generating) return;
    send(`/imagine ${prompt.trim()}`);
  }, [prompt, generating, send]);

  const pct = realProgress?.percent ?? progress;
  const phase = realProgress?.phase ?? (generating ? "sampling" : "done");
  const elapsed = realProgress ? Math.round(realProgress.elapsed / 1000) : elapsedTimer;

  return (
    <div className="imagine-page">
      <VideotexPageHeader title="GENERATION IMAGES" subtitle="ComfyUI — Smart Model Selection" color="amber" />

      {/* PROMPT FORM */}
      <form onSubmit={handleImagine} className="img-form">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="a cyberpunk terminal glowing green, dark room, phosphor CRT aesthetic..."
          className="img-textarea"
          rows={2}
          maxLength={500}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleImagine(e); } }}
        />
        <button type="submit" className="img-gen-btn" disabled={generating || !prompt.trim()}>
          {generating ? `${PHASE_ICONS[phase]} ${elapsed}s` : "GENERER"}
        </button>
      </form>

      {error && <div className="img-error">{error}</div>}

      {/* REAL PROGRESS PANEL */}
      {generating && (
        <div className="img-progress">
          <div className="img-progress-header">
            <span className="img-progress-phase">{PHASE_ICONS[phase]} {PHASE_LABELS[phase] || phase.toUpperCase()}</span>
            <span className="img-progress-time">{elapsed}s</span>
          </div>

          {/* Step progress bar */}
          <div className="img-progress-bar-wrap">
            <div className="img-progress-bar" style={{ width: `${Math.min(pct, 100)}%` }}>
              <div className="img-progress-bar-glow" />
            </div>
          </div>
          <div className="img-progress-detail">
            {realProgress ? (
              <>
                <span>Step {realProgress.step}/{realProgress.totalSteps}</span>
                <span>{Math.round(pct)}%</span>
              </>
            ) : (
              <>
                <span className="img-progress-sim">estimation...</span>
                <span>{Math.round(pct)}%</span>
              </>
            )}
          </div>

          {/* Model info */}
          {realProgress?.model && (
            <div className="img-progress-model">
              <span className="img-progress-model-label">Modele:</span> {realProgress.model}
              {realProgress.lora && <span className="img-progress-lora"> + {realProgress.lora}</span>}
            </div>
          )}

          {/* Spinner animation */}
          <div className="img-spinner">
            <div className="img-spinner-inner" />
          </div>
        </div>
      )}

      {/* FULLSCREEN VIEWER */}
      {viewIdx !== null && results[viewIdx]?.imageData && (
        <div className="img-viewer" onClick={() => setViewIdx(null)}>
          <div className="img-viewer-frame" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:${results[viewIdx].imageMime};base64,${results[viewIdx].imageData}`}
              alt={results[viewIdx].prompt}
              className="img-viewer-img"
            />
            <div className="img-viewer-info">
              <div className="img-viewer-prompt">{results[viewIdx].prompt}</div>
              <div className="img-viewer-meta">
                {results[viewIdx].model && <span className="img-viewer-badge">{results[viewIdx].model}</span>}
                {results[viewIdx].lora && <span className="img-viewer-badge img-viewer-badge-lora">{results[viewIdx].lora}</span>}
              </div>
            </div>
            <div className="img-viewer-nav">
              {viewIdx < results.length - 1 && (
                <button className="img-viewer-btn" onClick={() => setViewIdx(viewIdx + 1)}>{"\u25C0"}</button>
              )}
              <span className="img-viewer-count">{results.length - viewIdx} / {results.length}</span>
              <button className="img-viewer-btn img-viewer-close" onClick={() => setViewIdx(null)}>{"\u2715"}</button>
              {viewIdx > 0 && (
                <button className="img-viewer-btn" onClick={() => setViewIdx(viewIdx - 1)}>{"\u25B6"}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GALLERY GRID */}
      {results.length > 0 && (
        <div className="img-gallery">
          <div className="img-gallery-title">IMAGES ({results.length})</div>
          <div className="img-grid">
            {results.map((r, i) => (
              <div key={i} className={`img-card ${viewIdx === i ? "img-card-active" : ""}`} onClick={() => setViewIdx(i)}>
                {r.imageData && r.imageMime && (
                  <img
                    src={`data:${r.imageMime};base64,${r.imageData}`}
                    alt={r.prompt}
                    className="img-card-img"
                    loading="lazy"
                  />
                )}
                <div className="img-card-overlay">
                  <div className="img-card-prompt">{r.prompt}</div>
                  {r.model && <div className="img-card-model">{r.model.replace(/\.safetensors$/, "")}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
