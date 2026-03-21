import { useState, useEffect, useRef } from "react";
import { api, type MediaMeta } from "../api";
import { VideotexPageHeader, VideotexSeparator } from "./VideotexMosaic";

type Tab = "images" | "audio" | "compositions";

interface CompositionMeta {
  id: string;
  name: string;
  trackCount: number;
  hasMix: boolean;
  mixFilename?: string;
  createdAt: string;
}

export default function MediaExplorer() {
  const [tab, setTab] = useState<Tab>("images");
  const [images, setImages] = useState<MediaMeta[]>([]);
  const [audio, setAudio] = useState<MediaMeta[]>([]);
  const [compositions, setCompositions] = useState<CompositionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function fetchCompositions(): Promise<CompositionMeta[]> {
    try {
      const base = import.meta.env.VITE_API_BASE_URL || "";
      const res = await fetch(`${base}/api/v2/media/compositions`, { credentials: "include" });
      if (!res.ok) return [];
      const body = await res.json();
      return body.data || [];
    } catch {
      return [];
    }
  }

  async function loadAll() {
    setLoading(true);
    const [imgs, auds, comps] = await Promise.all([
      api.listImages().catch(() => []),
      api.listAudio().catch(() => []),
      fetchCompositions(),
    ]);
    setImages(Array.isArray(imgs) ? imgs : []);
    setAudio(Array.isArray(auds) ? auds : []);
    setCompositions(Array.isArray(comps) ? comps : []);
    setLoading(false);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function playCompositionMix(comp: CompositionMeta) {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (!comp.mixFilename) return;
    const base = import.meta.env.VITE_API_BASE_URL || "";
    const a = new Audio(`${base}/api/v2/media/compositions/${encodeURIComponent(comp.mixFilename)}`);
    a.onended = () => setPlayingIdx(null);
    a.play().catch(() => {});
    audioRef.current = a;
  }

  function downloadComposition(comp: CompositionMeta) {
    if (!comp.mixFilename) return;
    const base = import.meta.env.VITE_API_BASE_URL || "";
    const link = document.createElement("a");
    link.href = `${base}/api/v2/media/compositions/${encodeURIComponent(comp.mixFilename)}`;
    link.download = comp.mixFilename;
    link.click();
  }

  function playAudio(idx: number) {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playingIdx === idx) { setPlayingIdx(null); return; }
    const item = audio[idx];
    const a = new Audio(api.mediaUrl("audio", item.filename));
    a.onended = () => setPlayingIdx(null);
    a.play().catch(() => {});
    audioRef.current = a;
    setPlayingIdx(idx);
  }

  if (loading) return <div className="muted" role="status" aria-busy="true">Chargement des medias...</div>;

  return (
    <div className="media-explorer">
      <VideotexPageHeader title="MEDIATHEQUE" subtitle="Images, Audio & Compositions" color="cyan" />

      {/* Tabs */}
      <div className="media-tabs">
        <button
          className={`media-tab${tab === "images" ? " media-tab-active" : ""}`}
          onClick={() => setTab("images")}
        >
          Images ({images.length})
        </button>
        <button
          className={`media-tab${tab === "audio" ? " media-tab-active" : ""}`}
          onClick={() => setTab("audio")}
        >
          Audio ({audio.length})
        </button>
        <button
          className={`media-tab${tab === "compositions" ? " media-tab-active" : ""}`}
          onClick={() => setTab("compositions")}
        >
          Compositions ({compositions.length})
        </button>
        <button className="media-tab media-tab-refresh" onClick={loadAll}>
          Rafraichir
        </button>
      </div>

      <VideotexSeparator color="cyan" />

      {/* IMAGES TAB */}
      {tab === "images" && (
        <>
          {images.length === 0 ? (
            <div className="media-empty">Aucune image generee pour le moment.</div>
          ) : (
            <div className="media-grid">
              {images.map((img, i) => (
                <div key={img.id} className="media-card" onClick={() => setViewIdx(i)}>
                  <img
                    src={api.mediaUrl("images", img.filename)}
                    alt={img.prompt}
                    className="media-thumb"
                    loading="lazy"
                  />
                  <div className="media-card-info">
                    <div className="media-card-prompt">{img.prompt}</div>
                    <div className="media-card-meta">{img.nick} — {formatDate(img.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Image viewer overlay */}
          {viewIdx !== null && images[viewIdx] && (
            <div className="vtx-viewer" onClick={() => setViewIdx(null)}>
              <div className="vtx-viewer-frame" onClick={(e) => e.stopPropagation()}>
                <img
                  src={api.mediaUrl("images", images[viewIdx].filename)}
                  alt={images[viewIdx].prompt}
                  className="vtx-viewer-img"
                />
                <div className="vtx-viewer-caption">{images[viewIdx].prompt}</div>
                <div className="vtx-viewer-meta">
                  {images[viewIdx].nick} — {formatDate(images[viewIdx].createdAt)}
                </div>
                <div className="vtx-viewer-nav">
                  {viewIdx < images.length - 1 && (
                    <button className="vtx-viewer-btn" onClick={() => setViewIdx(viewIdx + 1)}>Prec</button>
                  )}
                  <button className="vtx-viewer-btn vtx-viewer-close" onClick={() => setViewIdx(null)}>Fermer</button>
                  {viewIdx > 0 && (
                    <button className="vtx-viewer-btn" onClick={() => setViewIdx(viewIdx - 1)}>Suiv</button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* AUDIO TAB */}
      {tab === "audio" && (
        <>
          {audio.length === 0 ? (
            <div className="media-empty">Aucun audio genere pour le moment.</div>
          ) : (
            <div className="media-playlist">
              {audio.map((a, i) => (
                <div
                  key={a.id}
                  className={`media-track${playingIdx === i ? " media-track-playing" : ""}`}
                  onClick={() => playAudio(i)}
                >
                  <span className="media-track-icon">{playingIdx === i ? "■" : "▶"}</span>
                  <div className="media-track-info">
                    <div className="media-track-prompt">{a.prompt}</div>
                    <div className="media-track-meta">{a.nick} — {formatDate(a.createdAt)}</div>
                  </div>
                </div>
              ))}

              {/* Persistent player */}
              {playingIdx !== null && audio[playingIdx] && (
                <div className="media-player-bar">
                  <span className="media-player-title">{audio[playingIdx].prompt}</span>
                  <audio
                    controls
                    autoPlay
                    src={api.mediaUrl("audio", audio[playingIdx].filename)}
                    className="vtx-audio"
                    onEnded={() => setPlayingIdx(null)}
                    ref={(el) => { audioRef.current = el; }}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* COMPOSITIONS TAB */}
      {tab === "compositions" && (
        <>
          {compositions.length === 0 ? (
            <div className="media-empty">Aucune composition pour le moment. Utilisez /compose pour creer.</div>
          ) : (
            <div className="media-playlist">
              {compositions.map((comp) => (
                <div key={comp.id} className="media-track">
                  <div className="media-track-info" style={{ flex: 1 }}>
                    <div className="media-track-prompt">{comp.name}</div>
                    <div className="media-track-meta">
                      {comp.trackCount} piste{comp.trackCount > 1 ? "s" : ""} — {formatDate(comp.createdAt)}
                    </div>
                  </div>
                  <div className="media-track-actions" style={{ display: "flex", gap: "0.5rem" }}>
                    {comp.hasMix && (
                      <button className="vtx-viewer-btn" onClick={() => playCompositionMix(comp)}>
                        {"\u25B6"} Mix
                      </button>
                    )}
                    {comp.hasMix && (
                      <button className="vtx-viewer-btn" onClick={() => downloadComposition(comp)}>
                        {"\u2B07"} DL
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
