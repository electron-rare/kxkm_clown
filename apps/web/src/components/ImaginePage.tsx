import { useState, useEffect } from "react";
import { useGenerationCommand } from "../hooks/useGenerationCommand";
import { VideotexPageHeader } from "./VideotexMosaic";

interface ImageResult {
  prompt: string;
  imageData?: string;
  imageMime?: string;
  model?: string;
}

export default function ImaginePage() {
  const [prompt, setPrompt] = useState("");
  const [viewIdx, setViewIdx] = useState<number | null>(null);

  const { generating, progress, results, error, send } = useGenerationCommand<ImageResult>({
    responseType: "image",
    extractResult: (msg) =>
      msg.imageData
        ? {
            prompt: (msg.text as string) || prompt,
            imageData: msg.imageData as string,
            imageMime: (msg.imageMime as string) || "image/png",
            model: (msg.model as string) || "SDXL Lightning",
          }
        : null,
    errorMatch: "echoue",
    progressInterval: 100,
    progressStep: 4,
    maxResults: 20,
  });

  // Auto-show newest image
  useEffect(() => {
    if (results.length > 0) setViewIdx(0);
  }, [results.length]);

  function handleImagine(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || generating) return;
    send(`/imagine ${prompt.trim()}`);
  }

  return (
    <div className="imagine-page">
      <VideotexPageHeader title="GENERATION IMAGES" subtitle="ComfyUI — SDXL Lightning" color="amber" />

      <form onSubmit={handleImagine} className="compose-form">
        <div className="minitel-field">
          <label>Description (anglais) _</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="a cyberpunk terminal glowing green, dark room, phosphor CRT aesthetic..." className="minitel-input compose-textarea" rows={3} maxLength={500} />
        </div>
        <button type="submit" className="minitel-login-btn" disabled={generating || !prompt.trim()}>
          {generating ? "Generation en cours..." : ">>> Generer <<<"}
        </button>
      </form>

      {error && <div className="minitel-login-error">{error}</div>}

      {generating && (
        <div className="vtx-progress vtx-amber">
          <div className="vtx-progress-label"><span className="minitel-cursor">{"█"}</span> RENDU EN COURS</div>
          <div className="vtx-progress-bar">
            <div className="vtx-progress-fill" style={{ width: `${progress}%` }}>{"\u2593".repeat(Math.floor(progress / 2.5))}</div>
          </div>
          <div className="vtx-progress-pct">{Math.floor(progress)}%</div>
        </div>
      )}

      {viewIdx !== null && results[viewIdx]?.imageData && (
        <div className="vtx-viewer" onClick={() => setViewIdx(null)}>
          <div className="vtx-viewer-frame" onClick={(e) => e.stopPropagation()}>
            <img src={`data:${results[viewIdx].imageMime};base64,${results[viewIdx].imageData}`} alt={results[viewIdx].prompt} className="vtx-viewer-img" />
            <div className="vtx-viewer-caption">{results[viewIdx].prompt}</div>
            <div className="vtx-viewer-model">Modele: {results[viewIdx].model || "SDXL Lightning"}</div>
            <div className="vtx-viewer-nav">
              {viewIdx < results.length - 1 && <button className="vtx-viewer-btn" onClick={() => setViewIdx(viewIdx + 1)}>{"\u25C0"} Prec</button>}
              <button className="vtx-viewer-btn vtx-viewer-close" onClick={() => setViewIdx(null)}>{"\u2715"} Fermer</button>
              {viewIdx > 0 && <button className="vtx-viewer-btn" onClick={() => setViewIdx(viewIdx - 1)}>Suiv {"\u25B6"}</button>}
            </div>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="imagine-results">
          <div className="compose-results-title">{"--- Images generees (" + results.length + ") ---"}</div>
          <div className="imagine-grid">
            {results.map((r, i) => (
              <div key={i} className="imagine-result" onClick={() => setViewIdx(i)}>
                {r.imageData && r.imageMime && <img src={`data:${r.imageMime};base64,${r.imageData}`} alt={r.prompt} className="imagine-img" />}
                <div className="imagine-prompt">{r.prompt}</div>
                <div className="imagine-model-badge">{r.model || "SDXL Lightning"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
