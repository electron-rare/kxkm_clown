import { useState, useEffect, useRef, useCallback } from "react";
import { VideotexPageHeader } from "./VideotexMosaic";

interface MediaItem {
  id: string;
  type: "image" | "audio" | "video";
  title: string;
  url: string;
  thumbnail?: string;
  createdAt: string;
  duration?: number;
  source: "daw" | "comfyui" | "chat";
}

type FilterType = "all" | "image" | "audio" | "video";

const PAGE_SIZE = 24;

export default function MediaGallery() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  // IntersectionObserver for lazy loading
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => c + PAGE_SIZE);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items, filter]);

  async function loadAll() {
    setLoading(true);
    const all: MediaItem[] = [];

    // DAW samples
    try {
      const r = await fetch("/api/v2/daw/samples");
      const d = await r.json();
      if (d.ok && Array.isArray(d.data)) {
        for (const s of d.data) {
          all.push({
            id: s.id || s.filename,
            type: "audio",
            title: s.name || s.filename,
            url: s.url,
            createdAt: s.createdAt || new Date().toISOString(),
            duration: s.duration,
            source: "daw",
          });
        }
      }
    } catch {
      /* fetch failed — ignore */
    }

    // Generated images endpoint
    try {
      const r = await fetch("/api/v2/media/images");
      if (r.ok) {
        const d = await r.json();
        if (d.ok && Array.isArray(d.data)) {
          for (const img of d.data) {
            all.push({
              id: img.id || img.filename,
              type: "image",
              title: img.title || img.prompt || img.filename || "image",
              url: img.url,
              thumbnail: img.thumbnail || img.url,
              createdAt: img.createdAt || new Date().toISOString(),
              source: "comfyui",
            });
          }
        }
      }
    } catch {
      /* endpoint may not exist yet */
    }

    // SessionStorage images from ImaginePage
    try {
      const raw = sessionStorage.getItem("imagine-results");
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) {
          for (const img of saved) {
            all.push({
              id: img.id || `imagine-${img.url}`,
              type: "image",
              title: img.prompt || img.title || "Imagine",
              url: img.url,
              thumbnail: img.thumbnail || img.url,
              createdAt: img.createdAt || new Date().toISOString(),
              source: "comfyui",
            });
          }
        }
      }
    } catch {
      /* parse error — ignore */
    }

    all.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    setItems(all);
    setVisibleCount(PAGE_SIZE);
    setLoading(false);
  }

  const filtered = items.filter((i) => {
    if (filter !== "all" && i.type !== filter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const searchable = [i.title, i.source, i.type, i.id].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes(q);
    }
    return true;
  });
  const visible = filtered.slice(0, visibleCount);

  const countFor = useCallback(
    (f: FilterType) =>
      f === "all" ? items.length : items.filter((i) => i.type === f).length,
    [items]
  );

  return (
    <div className="media-gallery">
      <VideotexPageHeader
        title="MEDIATHEQUE"
        subtitle={`${items.length} fichiers`}
        color="cyan"
      />

      <div className="mg-filters">
        <input
          type="text"
          className="mg-search"
          placeholder="Rechercher (prompt, nick, type)..."
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
          style={{ flex: 1, minWidth: 120, maxWidth: 300, padding: "4px 8px", fontFamily: "inherit", fontSize: "0.8em", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border, rgba(51,255,51,0.15))", color: "var(--ink, #39ff14)", borderRadius: 3 }}
        />
        {(["all", "image", "audio", "video"] as FilterType[]).map((f) => (
          <button
            key={f}
            className={`mg-filter ${filter === f ? "mg-filter-active" : ""}`}
            onClick={() => {
              setFilter(f);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            {f === "all" ? "TOUT" : f.toUpperCase()} ({countFor(f)})
          </button>
        ))}
        <button
          className="mg-refresh"
          onClick={loadAll}
          disabled={loading}
        >
          {loading ? "..." : "REFRESH"}
        </button>
      </div>

      <div className="mg-grid">
        {visible.map((item) => (
          <div key={item.id} className={`mg-card mg-card-${item.type}`}>
            {item.type === "image" && item.thumbnail && (
              <img
                src={item.thumbnail}
                alt={item.title}
                className="mg-thumb"
                loading="lazy"
              />
            )}
            {item.type === "audio" && (
              <audio
                src={item.url}
                controls
                preload="none"
                className="mg-audio"
              />
            )}
            {item.type === "video" && (
              <video
                src={item.url}
                controls
                preload="none"
                className="mg-video"
              />
            )}
            <div className="mg-info">
              <span className="mg-type">{item.type.toUpperCase()}</span>
              <span className="mg-title">{item.title}</span>
              {item.duration != null && (
                <span className="mg-dur">{item.duration}s</span>
              )}
            </div>
            <div className="mg-actions">
              <a
                href={item.url}
                download
                className="mg-dl"
                title="Telecharger"
              >
                DL
              </a>
              <span className="mg-date">
                {new Date(item.createdAt).toLocaleDateString("fr-FR")}
              </span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && !loading && (
          <div className="mg-empty">Aucun media.</div>
        )}
      </div>

      {/* Sentinel for IntersectionObserver lazy-load */}
      {visibleCount < filtered.length && (
        <div ref={sentinelRef} className="mg-sentinel" />
      )}
    </div>
  );
}
