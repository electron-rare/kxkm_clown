import { useEffect, useState } from "react";
import { api, type AnalyticsData } from "../api";

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const width = max > 0 ? Math.round((value / max) * 24) : 0;
  const bar = "\u2588".repeat(width);
  return (
    <div style={{ fontFamily: "monospace", whiteSpace: "pre", lineHeight: "1.6" }}>
      <span style={{ display: "inline-block", width: "14ch", textAlign: "right", marginRight: "1ch", color: "#0f0" }}>
        {label}
      </span>
      <span style={{ color: "#0a0" }}>{bar}</span>
      <span style={{ color: "#888", marginLeft: "0.5ch" }}>{value}</span>
    </div>
  );
}

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getAnalytics()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur chargement analytics"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 20, color: "#0f0", fontFamily: "monospace" }}>
        Chargement des statistiques...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: "#f44", fontFamily: "monospace" }}>
        Erreur: {error}
      </div>
    );
  }

  if (!data) return null;

  const topMax = data.topPersonas.length > 0 ? data.topPersonas[0].count : 1;
  const dayMax = data.messagesPerDay.length > 0
    ? Math.max(...data.messagesPerDay.map((d) => d.count))
    : 1;

  const recentDays = data.messagesPerDay.slice(0, 7).reverse();

  return (
    <div style={{ fontFamily: "monospace", color: "#0f0", padding: 16 }}>
      <h2 style={{ color: "#0f0", borderBottom: "1px solid #333", paddingBottom: 8 }}>
        STATISTIQUES KXKM_Clown V2
      </h2>

      {/* Overview cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          margin: "16px 0",
        }}
      >
        <StatCard label="Messages" value={data.totalMessages} />
        <StatCard label="Jours actifs" value={data.totalDays} />
        <StatCard label="Uploads" value={data.uploadsCount} />
        <StatCard label="Personas" value={data.topPersonas.length} />
        <StatCard label="Msg. utilisateur" value={data.userMessages} />
        <StatCard label="Msg. persona" value={data.totalMessages - data.userMessages - data.systemMessages} />
      </div>

      {/* Top personas */}
      {data.topPersonas.length > 0 && (
        <div style={{ margin: "24px 0" }}>
          <h3 style={{ color: "#0f0", marginBottom: 8 }}>TOP PERSONAS</h3>
          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid #333",
              padding: "12px 16px",
              borderRadius: 4,
            }}
          >
            {data.topPersonas.slice(0, 10).map((p) => (
              <Bar key={p.nick} label={p.nick} value={p.count} max={topMax} />
            ))}
          </div>
        </div>
      )}

      {/* Messages per day */}
      {recentDays.length > 0 && (
        <div style={{ margin: "24px 0" }}>
          <h3 style={{ color: "#0f0", marginBottom: 8 }}>MESSAGES / JOUR (7 derniers)</h3>
          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid #333",
              padding: "12px 16px",
              borderRadius: 4,
            }}
          >
            {recentDays.map((d) => {
              const shortDate = d.date.slice(5); // MM-DD
              return <Bar key={d.date} label={shortDate} value={d.count} max={dayMax} />;
            })}
          </div>
        </div>
      )}

      {/* No data fallback */}
      {data.totalMessages === 0 && (
        <div style={{ color: "#888", padding: "20px 0", textAlign: "center" }}>
          Aucune donnee de chat disponible. Les statistiques apparaitront apres les premieres conversations.
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: "#0a0a0a",
        border: "1px solid #333",
        padding: "12px 16px",
        borderRadius: 4,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "0.8em", color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.6em", fontWeight: "bold", color: "#0f0" }}>{value}</div>
    </div>
  );
}
