import { useEffect, useState } from "react";
import { api, type PersonaData } from "../api";

interface PersonaListProps {
  onSelect: (id: string) => void;
}

export default function PersonaList({ onSelect }: PersonaListProps) {
  const [personas, setPersonas] = useState<PersonaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    loadPersonas();
  }, []);

  async function loadPersonas() {
    setLoading(true);
    try {
      const list = await api.listPersonas();
      setPersonas(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(e: React.MouseEvent, persona: PersonaData) {
    e.stopPropagation();
    setToggling(persona.id);
    try {
      const updated = await api.togglePersona(persona.id, persona.enabled === false);
      setPersonas((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "toggle_failed");
    } finally {
      setToggling(null);
    }
  }

  if (loading) return <div className="muted">Chargement des personas...</div>;
  if (error) return <div className="banner">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Personas</h2>
        <button className="btn btn-secondary" onClick={loadPersonas}>Rafraichir</button>
      </div>
      <div className="card-grid">
        {personas.map((persona) => {
          const isEnabled = persona.enabled !== false;
          return (
            <div
              key={persona.id}
              className={`card persona-card${!isEnabled ? " persona-card-disabled" : ""}`}
              onClick={() => onSelect(persona.id)}
            >
              <div className="card-header">
                <span
                  className={`status-dot ${isEnabled ? "status-dot-on" : "status-dot-off"}`}
                  title={isEnabled ? "Active" : "Desactivee"}
                />
                <strong>{persona.name}</strong>
                <button
                  className={`btn persona-toggle-btn ${isEnabled ? "btn-secondary" : "btn-danger"}`}
                  onClick={(e) => handleToggle(e, persona)}
                  disabled={toggling === persona.id}
                  title={isEnabled ? "Desactiver" : "Activer"}
                >
                  {toggling === persona.id
                    ? "..."
                    : isEnabled
                      ? "ON"
                      : "OFF"}
                </button>
              </div>
              <span className="model-tag">{persona.model}</span>
              <p className="card-desc">{persona.summary}</p>
            </div>
          );
        })}
      </div>
      {personas.length === 0 && <p className="muted">Aucune persona configuree.</p>}
    </div>
  );
}
