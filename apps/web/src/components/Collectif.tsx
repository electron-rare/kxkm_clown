import { useEffect, useState } from "react";
import { api, type PersonaData } from "../api";
import MinitelFrame from "./MinitelFrame";

interface CollectifProps {
  onNavigate: (page: string, id?: string) => void;
}

interface DomainGroup {
  label: string;
  nicks: string[];
}

const DOMAINS: DomainGroup[] = [
  { label: "ORCHESTRATEUR", nicks: ["Pharmacius"] },
  {
    label: "MUSIQUE & SON",
    nicks: ["Schaeffer", "Radigue", "Oliveros", "Merzbow", "Cage", "Bjork", "Oram"],
  },
  { label: "ARTS DE LA RUE", nicks: ["RoyalDeLuxe", "Decroux", "Mnouchkine"] },
  { label: "ARTS NUMERIQUES", nicks: ["Ikeda", "TeamLab", "Demoscene"] },
  { label: "SPECTACLE VIVANT", nicks: ["Pina", "Grotowski", "Fratellini"] },
  {
    label: "SCIENCES & PHILOSOPHIE",
    nicks: ["Hypatia", "Curie", "Foucault", "Deleuze"],
  },
  { label: "SOCIETE & ECOLOGIE", nicks: ["Bookchin", "LeGuin"] },
  { label: "TECH & POLITIQUE", nicks: ["Turing", "Swartz", "Haraway"] },
  { label: "CYBERPUNK", nicks: ["Batty", "SunRa"] },
  { label: "DESIGN & CINEMA", nicks: ["Fuller", "Tarkovski"] },
];

// Hardcoded colors matching ws-chat.ts DEFAULT_PERSONAS
const PERSONA_COLORS: Record<string, string> = {
  Pharmacius: "#00e676",
  Schaeffer: "#4fc3f7",
  Radigue: "#ab47bc",
  Oliveros: "#66bb6a",
  Merzbow: "#e040fb",
  Cage: "#e0e0e0",
  Bjork: "#f06292",
  Oram: "#aed581",
  RoyalDeLuxe: "#ff6e40",
  Decroux: "#8d6e63",
  Mnouchkine: "#ffab40",
  Ikeda: "#b0bec5",
  TeamLab: "#69f0ae",
  Demoscene: "#00e5ff",
  Pina: "#f48fb1",
  Grotowski: "#a1887f",
  Fratellini: "#ffee58",
  Hypatia: "#26c6da",
  Curie: "#80cbc4",
  Foucault: "#9575cd",
  Deleuze: "#7986cb",
  Bookchin: "#81c784",
  LeGuin: "#a5d6a7",
  Turing: "#42a5f5",
  Swartz: "#ff7043",
  Haraway: "#ff69b4",
  Batty: "#ef5350",
  SunRa: "#ffd54f",
  Fuller: "#4dd0e1",
  Tarkovski: "#78909c",
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

export default function Collectif({ onNavigate }: CollectifProps) {
  const [personas, setPersonas] = useState<PersonaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listPersonas()
      .then((list) => {
        setPersonas(list);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "load_failed"))
      .finally(() => setLoading(false));
  }, []);

  const personaByName = new Map(personas.map((p) => [p.name, p]));

  function handleClick(nick: string) {
    const p = personaByName.get(nick);
    if (p) {
      onNavigate("persona", p.id);
    } else {
      onNavigate("personas");
    }
  }

  return (
    <MinitelFrame channel="COLLECTIF">
      <div style={{ padding: "1rem", fontFamily: "'Courier New', Courier, monospace" }}>
        <div
          style={{
            textAlign: "center",
            borderBottom: "2px solid var(--border, #2f2218)",
            paddingBottom: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ margin: 0, letterSpacing: "0.15em" }}>
            3615 J'ai pété — LE COLLECTIF
          </h2>
          <div style={{ color: "var(--muted, #6f5d4f)", marginTop: "0.25rem" }}>
            {personas.length} personas — {DOMAINS.length} domaines
          </div>
        </div>

        {loading && <div className="muted">Chargement du collectif...</div>}
        {error && <div className="banner">{error}</div>}

        {!loading &&
          !error &&
          DOMAINS.map((domain) => (
            <div key={domain.label} style={{ marginBottom: "1.25rem" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    height: "1px",
                    background: "var(--border-light, rgba(47,34,24,0.2))",
                  }}
                />
                <span
                  style={{
                    fontWeight: "bold",
                    letterSpacing: "0.1em",
                    fontSize: "0.85rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  {domain.label}
                </span>
                <span
                  style={{
                    flex: 1,
                    height: "1px",
                    background: "var(--border-light, rgba(47,34,24,0.2))",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem 1.5rem",
                }}
              >
                {domain.nicks.map((nick) => {
                  const p = personaByName.get(nick);
                  const color = PERSONA_COLORS[nick] || "var(--accent, #c84c0c)";
                  const summary = p?.summary || "";
                  const model = p?.model || "?";
                  const isEnabled = p ? p.enabled !== false : true;

                  return (
                    <div
                      key={nick}
                      onClick={() => handleClick(nick)}
                      title={summary}
                      style={{
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "baseline",
                        gap: "0.35rem",
                        padding: "0.25rem 0.5rem",
                        border: "1px solid var(--border-light, rgba(47,34,24,0.2))",
                        background: isEnabled
                          ? "rgba(47, 34, 24, 0.04)"
                          : "rgba(47, 34, 24, 0.12)",
                        opacity: isEnabled ? 1 : 0.5,
                        transition: "background 0.15s",
                        minWidth: "200px",
                        flex: "1 1 200px",
                        maxWidth: "350px",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background =
                          "rgba(47, 34, 24, 0.1)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = isEnabled
                          ? "rgba(47, 34, 24, 0.04)"
                          : "rgba(47, 34, 24, 0.12)";
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: color,
                          flexShrink: 0,
                          marginTop: "2px",
                        }}
                      />
                      <span style={{ display: "flex", flexDirection: "column", gap: "1px", overflow: "hidden" }}>
                        <span>
                          <strong>{nick}</strong>{" "}
                          <span
                            style={{
                              color: "var(--muted, #6f5d4f)",
                              fontSize: "0.8em",
                            }}
                          >
                            [{model}]
                          </span>
                        </span>
                        {summary && (
                          <span
                            style={{
                              fontSize: "0.75em",
                              color: "var(--muted, #6f5d4f)",
                              lineHeight: 1.3,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {truncate(summary, 50)}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </MinitelFrame>
  );
}
