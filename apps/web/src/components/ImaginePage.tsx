import { useState, useEffect, useRef, useCallback } from "react";
import { useGenerationCommand } from "../hooks/useGenerationCommand";
import { VideotexPageHeader } from "./VideotexMosaic";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ImageResult {
  [key: string]: unknown;
  prompt: string;
  imageData?: string;
  imageMime?: string;
  model?: string;
  lora?: string;
  seed?: number;
  elapsed?: number;
  mode?: string;
  /** Server-persisted URL (available after save to media-store) */
  savedUrl?: string;
}

interface RealProgress {
  step: number;
  totalSteps: number;
  percent: number;
  phase: "queued" | "loading" | "sampling" | "decoding" | "saving" | "done";
  model?: string;
  lora?: string;
  elapsed: number;
  preview?: string;
}

type Mode = "txt2img" | "img2img" | "style" | "faceswap" | "video";

const MODES: { id: Mode; label: string }[] = [
  { id: "txt2img", label: "TEXT \u2192 IMAGE" },
  { id: "img2img", label: "IMAGE \u2192 IMAGE" },
  { id: "style", label: "STYLE TRANSFER" },
  { id: "faceswap", label: "FACE SWAP" },
  { id: "video", label: "TEXT \u2192 VIDEO" },
];

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

/** Resolve image src: prefer server URL, fall back to base64 data URI */
function imgSrc(r: ImageResult): string {
  if (r.savedUrl) return r.savedUrl;
  if (r.imageData && r.imageMime) return `data:${r.imageMime};base64,${r.imageData}`;
  return "";
}

const STYLE_OPTIONS = [
  "painting",
  "anime",
  "cyberpunk",
  "surreal",
  "impressionist",
  "glitch",
  "minimal",
];

const TXT2IMG_PRESETS: { label: string; suffix: string }[] = [
  { label: "PHOTO REALISTE", suffix: ", ultra realistic photograph, 8k, cinematic lighting, sharp focus" },
  { label: "ANIME", suffix: ", anime style, studio ghibli, cel shading, vibrant colors" },
  { label: "CYBERPUNK", suffix: ", cyberpunk aesthetic, neon lights, rain, blade runner, dark city" },
  { label: "PEINTURE", suffix: ", oil painting, masterful brushwork, rich textures, gallery quality" },
  { label: "PIXEL ART", suffix: ", pixel art, 16-bit retro style, clean pixels, nostalgic" },
  { label: "GLITCH", suffix: ", glitch art, databending, corrupted signal, VHS distortion" },
  { label: "MINITEL", suffix: ", green phosphor CRT screen, vintage minitel terminal, scanlines" },
  { label: "ABSTRAIT", suffix: ", abstract art, geometric shapes, bold colors, kandinsky style" },
];

/* ------------------------------------------------------------------ */
/*  ImageUpload — reusable drag-drop + preview                        */
/* ------------------------------------------------------------------ */

function ImageUpload({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (base64: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // strip data:...;base64, prefix — store raw base64
        const base64 = result.includes(",") ? result.split(",")[1] : result;
        onChange(base64);
      };
      reader.readAsDataURL(file);
    },
    [onChange],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      className={`img-upload ${dragging ? "img-upload-dragging" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {value ? (
        <img
          src={`data:image/png;base64,${value}`}
          alt="preview"
          className="img-upload-preview"
        />
      ) : (
        <div className="img-upload-placeholder">
          <span className="img-upload-icon">+</span>
          <span className="img-upload-label">{label}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Txt2ImgForm — existing functionality                              */
/* ------------------------------------------------------------------ */

function Txt2ImgForm({
  prompt,
  setPrompt,
  generating,
  phase,
  elapsed,
  onSubmit,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  generating: boolean;
  phase: string;
  elapsed: number;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const togglePreset = (preset: typeof TXT2IMG_PRESETS[number]) => {
    if (activePreset === preset.label) {
      // Remove suffix from prompt
      setPrompt(prompt.replace(preset.suffix, ""));
      setActivePreset(null);
    } else {
      // Remove previous preset suffix if any
      let cleaned = prompt;
      if (activePreset) {
        const prev = TXT2IMG_PRESETS.find((p) => p.label === activePreset);
        if (prev) cleaned = cleaned.replace(prev.suffix, "");
      }
      setPrompt(cleaned + preset.suffix);
      setActivePreset(preset.label);
    }
  };

  return (
    <form onSubmit={onSubmit} className="img-form">
      <div className="img-presets">
        {TXT2IMG_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`img-preset ${activePreset === p.label ? "img-preset-active" : ""}`}
            onClick={() => togglePreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="a cyberpunk terminal glowing green, dark room, phosphor CRT aesthetic..."
        className="img-textarea"
        rows={2}
        maxLength={500}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e);
          }
        }}
      />
      <button
        type="submit"
        className="img-gen-btn"
        disabled={generating || !prompt.trim()}
      >
        {generating
          ? `${PHASE_ICONS[phase]} ${elapsed}s`
          : "GENERER"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Img2ImgForm                                                        */
/* ------------------------------------------------------------------ */

function Img2ImgForm({
  onResult,
  allResults,
  setAllResults,
}: {
  onResult: (r: ImageResult) => void;
  allResults: ImageResult[];
  setAllResults: React.Dispatch<React.SetStateAction<ImageResult[]>>;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!image || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v2/comfyui/img2img", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, prompt, strength }),
      });
      const json = await res.json();
      if (json.ok && json.data?.imageBase64) {
        const result: ImageResult = {
          prompt: prompt || "(img2img)",
          imageData: json.data.imageBase64,
          imageMime: "image/png",
          seed: json.data.seed,
          mode: "img2img",
          savedUrl: json.data.savedUrl,
        };
        onResult(result);
      } else {
        setError(json.error || "Generation failed");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="img-mode-form">
      <ImageUpload label="Image source" value={image} onChange={setImage} />
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe modifications..."
        className="img-textarea"
        rows={2}
        maxLength={500}
      />
      <div className="img-slider-row">
        <label className="img-slider-label">
          Strength: <span className="img-slider-value">{strength.toFixed(2)}</span>
        </label>
        <input
          type="range"
          className="img-slider"
          min={0.1}
          max={0.9}
          step={0.05}
          value={strength}
          onChange={(e) => setStrength(parseFloat(e.target.value))}
        />
      </div>
      {error && <div className="img-error">{error}</div>}
      <button
        type="submit"
        className="img-gen-btn"
        disabled={busy || !image}
      >
        {busy ? "GENERATION..." : "GENERER"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  StyleForm                                                          */
/* ------------------------------------------------------------------ */

function StyleForm({
  onResult,
}: {
  onResult: (r: ImageResult) => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [style, setStyle] = useState(STYLE_OPTIONS[0]);
  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(0.6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!image || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v2/comfyui/style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, style, prompt, strength }),
      });
      const json = await res.json();
      if (json.ok && json.data?.imageBase64) {
        const result: ImageResult = {
          prompt: `[${style}] ${prompt || "(style transfer)"}`,
          imageData: json.data.imageBase64,
          imageMime: "image/png",
          seed: json.data.seed,
          mode: "style",
          savedUrl: json.data.savedUrl,
        };
        onResult(result);
      } else {
        setError(json.error || "Generation failed");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="img-mode-form">
      <ImageUpload label="Image source" value={image} onChange={setImage} />
      <div className="img-slider-row">
        <label className="img-slider-label">Style:</label>
        <select
          className="img-select"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        >
          {STYLE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.toUpperCase()}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Optional: additional prompt..."
        className="img-textarea"
        rows={2}
        maxLength={500}
      />
      <div className="img-slider-row">
        <label className="img-slider-label">
          Strength: <span className="img-slider-value">{strength.toFixed(2)}</span>
        </label>
        <input
          type="range"
          className="img-slider"
          min={0.3}
          max={0.9}
          step={0.05}
          value={strength}
          onChange={(e) => setStrength(parseFloat(e.target.value))}
        />
      </div>
      {error && <div className="img-error">{error}</div>}
      <button
        type="submit"
        className="img-gen-btn"
        disabled={busy || !image}
      >
        {busy ? "GENERATION..." : "GENERER"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  FaceSwapForm                                                       */
/* ------------------------------------------------------------------ */

function FaceSwapForm({
  onResult,
}: {
  onResult: (r: ImageResult) => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!source || !target || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v2/comfyui/faceswap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, target }),
      });
      const json = await res.json();
      if (json.ok && json.data?.imageBase64) {
        const result: ImageResult = {
          prompt: "(face swap)",
          imageData: json.data.imageBase64,
          imageMime: "image/png",
          seed: json.data.seed,
          mode: "faceswap",
          savedUrl: json.data.savedUrl,
        };
        onResult(result);
      } else {
        setError(json.error || "Generation failed");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="img-mode-form">
      <div className="img-upload-pair">
        <ImageUpload label="Source face" value={source} onChange={setSource} />
        <ImageUpload label="Target image" value={target} onChange={setTarget} />
      </div>
      {error && <div className="img-error">{error}</div>}
      <button
        type="submit"
        className="img-gen-btn"
        disabled={busy || !source || !target}
      >
        {busy ? "GENERATION..." : "GENERER"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  VideoForm                                                          */
/* ------------------------------------------------------------------ */

function VideoForm({
  onResult,
}: {
  onResult: (r: ImageResult) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v2/comfyui/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, duration }),
      });
      const json = await res.json();
      if (json.ok && json.data?.imageBase64) {
        const result: ImageResult = {
          prompt: `[video ${duration}s] ${prompt}`,
          imageData: json.data.imageBase64,
          imageMime: "image/png",
          seed: json.data.seed,
          mode: "video",
          savedUrl: json.data.savedUrl,
        };
        onResult(result);
      } else {
        setError(json.error || "Generation failed");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="img-mode-form">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the video scene..."
        className="img-textarea"
        rows={2}
        maxLength={500}
      />
      <div className="img-slider-row">
        <label className="img-slider-label">
          Duration: <span className="img-slider-value">{duration}s</span>
        </label>
        <input
          type="range"
          className="img-slider"
          min={2}
          max={10}
          step={1}
          value={duration}
          onChange={(e) => setDuration(parseInt(e.target.value, 10))}
        />
      </div>
      {error && <div className="img-error">{error}</div>}
      <button
        type="submit"
        className="img-gen-btn"
        disabled={busy || !prompt.trim()}
      >
        {busy ? "GENERATION..." : "GENERER"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function ImaginePage() {
  const [activeMode, setActiveMode] = useState<Mode>("txt2img");
  const [prompt, setPrompt] = useState("");
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [realProgress, setRealProgress] = useState<RealProgress | null>(null);
  const [elapsedTimer, setElapsedTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { generating, progress, results, setResults, error, send, getWs } =
    useGenerationCommand<ImageResult>({
      responseType: "image",
      extractResult: (msg) =>
        msg.imageData
          ? {
              prompt: (msg.text as string) || prompt,
              imageData: msg.imageData as string,
              imageMime: (msg.imageMime as string) || "image/png",
              model: (msg.model as string) || undefined,
              lora: (msg.lora as string) || undefined,
              mode: "txt2img",
            }
          : null,
      errorMatch: "echoue",
      progressInterval: 200,
      progressStep: 2,
      maxResults: 50,
    });

  // Load persisted images from server on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/v2/media/images");
        if (!r.ok) return;
        const d = await r.json();
        if (d.ok && Array.isArray(d.data) && d.data.length > 0) {
          const persisted: ImageResult[] = d.data
            .filter((img: any) => img.url && img.filename)
            .slice(0, 50)
            .map((img: any) => ({
              prompt: img.prompt || img.filename,
              savedUrl: img.url,
              imageMime: img.mime || "image/png",
              seed: img.seed,
              mode: "txt2img",
            }));
          setResults((prev) => {
            // Avoid duplicates — only add persisted items not already in state
            const existingPrompts = new Set(prev.map((r) => r.prompt));
            const newItems = persisted.filter((p) => !existingPrompts.has(p.prompt));
            return [...prev, ...newItems].slice(0, 50);
          });
        }
      } catch {
        /* API not available — ignore */
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Merged results: WS txt2img results + HTTP results from other modes
  // We store HTTP results in a separate ref and merge them into the shared list
  const addHttpResult = useCallback(
    (r: ImageResult) => {
      setResults((prev) => [r, ...prev].slice(0, 50));
    },
    [setResults],
  );

  // Listen for image_progress messages on WS
  useEffect(() => {
    const ws = getWs();
    if (!ws) return;
    const handler = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "image_progress") {
          setRealProgress((prev) => ({
            step: msg.step || prev?.step || 0,
            totalSteps: msg.totalSteps || prev?.totalSteps || 0,
            percent:
              msg.percent >= 0 ? msg.percent : prev?.percent || 0,
            phase: msg.phase || prev?.phase || "sampling",
            model: msg.model || prev?.model,
            lora: msg.lora || prev?.lora,
            elapsed: msg.elapsed || prev?.elapsed || 0,
            preview: msg.preview || prev?.preview,
          }));
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
      timerRef.current = setInterval(
        () => setElapsedTimer((t) => t + 1),
        1000,
      );
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [generating]);

  // Auto-show newest image
  useEffect(() => {
    if (results.length > 0) setViewIdx(0);
  }, [results.length]);

  const handleImagine = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!prompt.trim() || generating) return;
      send(`/imagine ${prompt.trim()}`);
    },
    [prompt, generating, send],
  );

  const pct = realProgress?.percent ?? progress;
  const phase = realProgress?.phase ?? (generating ? "sampling" : "done");
  const elapsed = realProgress
    ? Math.round(realProgress.elapsed / 1000)
    : elapsedTimer;

  return (
    <div className="imagine-page">
      <VideotexPageHeader
        title="GENERATION"
        subtitle={`ComfyUI \u2014 ${MODES.length} modes`}
        color="amber"
      />

      {/* MODE TABS */}
      <div className="img-tabs">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`img-tab ${activeMode === m.id ? "img-tab-active" : ""}`}
            onClick={() => setActiveMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* MODE-SPECIFIC FORMS */}
      {activeMode === "txt2img" && (
        <Txt2ImgForm
          prompt={prompt}
          setPrompt={setPrompt}
          generating={generating}
          phase={phase}
          elapsed={elapsed}
          onSubmit={handleImagine}
        />
      )}
      {activeMode === "img2img" && (
        <Img2ImgForm
          onResult={addHttpResult}
          allResults={results}
          setAllResults={setResults}
        />
      )}
      {activeMode === "style" && <StyleForm onResult={addHttpResult} />}
      {activeMode === "faceswap" && <FaceSwapForm onResult={addHttpResult} />}
      {activeMode === "video" && <VideoForm onResult={addHttpResult} />}

      {error && <div className="img-error">{error}</div>}

      {/* REAL PROGRESS PANEL (txt2img WS) */}
      {generating && (
        <div className="img-progress">
          <div className="img-progress-header">
            <span className="img-progress-phase">
              {PHASE_ICONS[phase]} {PHASE_LABELS[phase] || phase.toUpperCase()}
            </span>
            <span className="img-progress-time">{elapsed}s</span>
          </div>

          <div className="img-progress-bar-wrap">
            <div
              className="img-progress-bar"
              style={{ width: `${Math.min(pct, 100)}%` }}
            >
              <div className="img-progress-bar-glow" />
            </div>
          </div>
          <div className="img-progress-detail">
            {realProgress ? (
              <>
                <span>
                  Step {realProgress.step}/{realProgress.totalSteps}
                </span>
                <span>{Math.round(pct)}%</span>
              </>
            ) : (
              <>
                <span className="img-progress-sim">estimation...</span>
                <span>{Math.round(pct)}%</span>
              </>
            )}
          </div>

          {realProgress?.model && (
            <div className="img-progress-model">
              <span className="img-progress-model-label">Modele:</span>{" "}
              {realProgress.model}
              {realProgress.lora && (
                <span className="img-progress-lora">
                  {" "}
                  + {realProgress.lora}
                </span>
              )}
            </div>
          )}

          {realProgress?.preview ? (
            <div className="img-preview-live">
              <img
                src={realProgress.preview}
                alt="preview"
                className="img-preview-img"
              />
            </div>
          ) : (
            <div className="img-spinner">
              <div className="img-spinner-inner" />
            </div>
          )}
        </div>
      )}

      {/* FULLSCREEN VIEWER */}
      {viewIdx !== null && (results[viewIdx]?.imageData || results[viewIdx]?.savedUrl) && (
        <div className="img-viewer" onClick={() => setViewIdx(null)}>
          <div
            className="img-viewer-frame"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={imgSrc(results[viewIdx])}
              alt={results[viewIdx].prompt}
              className="img-viewer-img"
            />
            <div className="img-viewer-info">
              <div className="img-viewer-prompt">
                {results[viewIdx].prompt}
              </div>
              <div className="img-viewer-meta">
                {results[viewIdx].mode && (
                  <span className="img-viewer-badge img-viewer-badge-mode">
                    {results[viewIdx].mode}
                  </span>
                )}
                {results[viewIdx].model && (
                  <span className="img-viewer-badge">
                    {results[viewIdx].model}
                  </span>
                )}
                {results[viewIdx].lora && (
                  <span className="img-viewer-badge img-viewer-badge-lora">
                    {results[viewIdx].lora}
                  </span>
                )}
              </div>
            </div>
            <div className="img-viewer-nav">
              {viewIdx < results.length - 1 && (
                <button
                  className="img-viewer-btn"
                  onClick={() => setViewIdx(viewIdx + 1)}
                >
                  {"\u25C0"}
                </button>
              )}
              <span className="img-viewer-count">
                {results.length - viewIdx} / {results.length}
              </span>
              <button
                className="img-viewer-btn img-viewer-close"
                onClick={() => setViewIdx(null)}
              >
                {"\u2715"}
              </button>
              {viewIdx > 0 && (
                <button
                  className="img-viewer-btn"
                  onClick={() => setViewIdx(viewIdx - 1)}
                >
                  {"\u25B6"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GALLERY GRID */}
      {results.length > 0 && (
        <div className="img-gallery">
          <div className="img-gallery-title">
            IMAGES ({results.length})
          </div>
          <div className="img-grid">
            {results.map((r, i) => (
              <div
                key={i}
                className={`img-card ${viewIdx === i ? "img-card-active" : ""}`}
                onClick={() => setViewIdx(i)}
              >
                {(r.imageData || r.savedUrl) && (
                  <img
                    src={imgSrc(r)}
                    alt={r.prompt}
                    className="img-card-img"
                    loading="lazy"
                  />
                )}
                <div className="img-card-overlay">
                  <div className="img-card-prompt">{r.prompt}</div>
                  <div className="img-card-meta-row">
                    {r.mode && r.mode !== "txt2img" && (
                      <span className="img-card-mode">{r.mode}</span>
                    )}
                    {r.model && (
                      <span className="img-card-model">
                        {(r.model as string).replace(/\.safetensors$/, "")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
